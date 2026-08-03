"""What has to be true of a property, and what merely ought to be.

Two layers over the same raw row (snake_case, straight from `properties`):

  · stage_requirements() — the hard rules: exactly what the transition trigger
    (migration 027) and the table CHECKs enforce, restated here so the user gets
    a sentence and a 422 instead of a constraint name and a 500. One definition,
    three callers: the gate of POST /transition, the guard of PATCH and
    clear-fields, and the `error` issues below.
  · run_checks() — those errors plus the stage's soft warnings. A prospect is
    judged on how complete its underwriting is; a building under construction on
    whether its capital and dates hold up; a rented one on how stale its
    valuation is; a sold one on whether the record is closed.
"""
from dataclasses import dataclass
from datetime import date
from typing import Literal

from api.finance import underwriting
from api.finance.analysis import months_between
from api.finance.quantize import to_decimal


@dataclass
class Issue:
    field: str
    message: str
    severity: Literal["error", "warning"]


# A valuation older than this stops describing the property it values.
_STALE_VALUATION_MONTHS = 18


def _positive(value) -> bool:
    return value is not None and to_decimal(value) > 0


def stage_requirements(status: str, row: dict) -> dict[str, str]:
    """What a property must carry to legitimately BE in `status`, keyed by the
    field that is missing or wrong. Empty dict = admissible."""
    missing: dict[str, str] = {}

    if status == "oferta" and not _positive(row.get("projected_sale")):
        missing["projectedSale"] = "Toda Oferta modela su salida: falta la venta proyectada."

    if status == "desarrollo":
        if row.get("acquisition_date") is None:
            missing["acquisitionDate"] = (
                "Una propiedad en Desarrollo ya se compró: falta la fecha de adquisición.")
        if row.get("total_units") is None:
            missing["totalUnits"] = "Falta el número de unidades."
        # Comprar no produce un avalúo. La valuación se captura cuando alguien
        # de verdad valúa; hasta entonces la ganancia no realizada es None, que
        # es la respuesta honesta. Exigirla aquí solo lograba que se inventara.
        #
        # El precio de compra sí: a Desarrollo se entra habiendo comprado, y no
        # se compra sin saber cuánto se pagó. Es la única parte del desglose que
        # no puede ser cero de verdad, y con ella la inversión siempre resuelve.
        if not _positive(row.get("purchase_price")):
            missing["purchasePrice"] = (
                "No se entra a Desarrollo sin saber qué se pagó: falta el precio de compra.")

    if status == "en_renta":
        if row.get("first_rent_date") is None:
            missing["firstRentDate"] = "Falta la fecha de la primera renta."
        if row.get("rent_monthly_actual") is None:
            missing["rentMonthlyActual"] = "Falta la renta mensual cobrada."

    if status == "vendida":
        if row.get("sale_date") is None:
            missing["saleDate"] = "Falta la fecha de venta."
        if row.get("sale_price") is None:
            missing["salePrice"] = "Falta el precio de venta."

    # Coherence the table CHECKs also enforce, mirrored so a bad ordering comes
    # back as a sentence rather than as a constraint violation.
    acquisition = row.get("acquisition_date")
    first_rent = row.get("first_rent_date")
    sale = row.get("sale_date")
    if first_rent and acquisition and first_rent < acquisition:
        missing["firstRentDate"] = "La primera renta no puede ser anterior a la adquisición."
    if sale and acquisition and sale < acquisition:
        missing["saleDate"] = "La venta no puede ser anterior a la adquisición."
    if sale and first_rent and sale < first_rent:
        missing["saleDate"] = "La venta no puede ser anterior a la primera renta."
    for column, field in (("rent_monthly_projected", "rentMonthlyProjected"),
                          ("rent_monthly_actual", "rentMonthlyActual")):
        if row.get(column) is not None and to_decimal(row[column]) <= 0:
            missing[field] = "La renta se captura positiva; «no renta» se expresa dejándola vacía."

    return missing


def _pre_purchase_warnings(row: dict, computed: dict) -> list[Issue]:
    """Is the underwriting complete enough to bet on? These are the questions a
    prospecto and an oferta answer, and only they: after the purchase the model
    stops being the thing under review."""
    issues: list[Issue] = []
    if not row.get("latitude"):
        issues.append(Issue("latitude", "Falta la latitud (o quedó en 0)", "error"))
    if not row.get("longitude"):
        issues.append(Issue("longitude", "Falta la longitud (o quedó en 0)", "error"))
    if not _positive(row.get("purchase_price")):
        issues.append(Issue("purchasePrice", "El precio de compra está en 0", "error"))
    if not _positive(row.get("sqm_land")):
        issues.append(Issue("sqmLand", "La superficie de terreno está en 0", "error"))
    # `projectedRoi` es el ROI ANUALIZADO — es lo único que el sistema llama ROI.
    # La cifra sobre el plazo completo es la ganancia proyectada, otro nombre.
    roi = computed.get("projectedRoi")
    if roi is not None and roi < 0:
        issues.append(Issue("projectedRoi", f"ROI proy. anual negativo ({roi:.1%})", "error"))
    overhead = row.get("construction_overhead")
    if overhead is not None and overhead < 1.0:
        issues.append(Issue(
            "constructionOverhead",
            f"El overhead de obra es un multiplicador: ×{overhead} abarata la obra "
            f"en vez de sumarle indirectos", "error"))

    if not _positive(row.get("construction_cost_per_sqm")):
        issues.append(Issue("constructionCostPerSqm",
                            "El costo por m² de la obra a ejecutar está en 0", "warning"))
    if row.get("rent_monthly_projected") is None:
        issues.append(Issue("rentMonthlyProjected", "Renta mensual estimada sin capturar", "warning"))
    acq_pct = row.get("acquisition_cost_pct")
    if acq_pct is not None and acq_pct > 0.10:
        issues.append(Issue("acquisitionCostPct",
                            f"Costos de adquisición altos ({acq_pct:.1%} del precio de compra)",
                            "warning"))
    profit = computed.get("projectedProfit")
    if profit is not None and profit < 500_000:
        issues.append(Issue("projectedProfit", f"Ganancia proyectada < $500k ({profit:,.0f} MXN)", "warning"))
    return issues


def _valuation_warnings(row: dict, today: date) -> list[Issue]:
    """A mark is only as good as its date — and the date now does work: the ROI
    anual de la marca se anualiza de la compra a ella. Sin fecha el reloj corre
    a hoy; anterior a la compra el periodo sale negativo y no hay ROI que dar."""
    valuation_date = row.get("valuation_date")
    if valuation_date is None:
        return [Issue("valuationDate", "La valuación no tiene fecha de corte", "warning")]
    acquisition = row.get("acquisition_date")
    if acquisition and valuation_date < acquisition:
        return [Issue("valuationDate",
                      "La valuación es anterior a la adquisición: no hay periodo que anualizar",
                      "warning")]
    age = months_between(valuation_date, today)
    if age > _STALE_VALUATION_MONTHS:
        return [Issue("valuationDate", f"Valuación de hace {age} meses", "warning")]
    return []


def run_checks(row: dict, computed: dict, today: date | None = None) -> list[Issue]:
    """Every issue a property has at its current stage: the hard requirements it
    fails, then the soft ones. `row` is the raw record, `computed` the metric
    payload for it — the warnings that read a metric read the same number the
    client is shown."""
    today = today or date.today()
    status = row.get("status")
    issues = [Issue(field, message, "error")
              for field, message in sorted(stage_requirements(status, row).items())]

    if status in ("prospecto", "oferta"):
        issues += _pre_purchase_warnings(row, computed)
    elif status == "desarrollo":
        issues += _valuation_warnings(row, today)
    elif status == "en_renta":
        issues += _valuation_warnings(row, today)
        if computed.get("capRateActual") is None:
            issues.append(Issue("capRateActual",
                                "Sin cap rate real: falta la renta cobrada o la inversión total",
                                "warning"))
    elif status == "vendida":
        if row.get("acquisition_date") is None:
            issues.append(Issue("acquisitionDate",
                                "Sin fecha de adquisición no hay plazo real ni ROI real anual",
                                "warning"))
        if underwriting.basis(row) is None:
            issues.append(Issue("purchasePrice",
                                "Sin inversión total no hay ganancia realizada: el desglose "
                                "de costos está vacío", "warning"))

    return issues
