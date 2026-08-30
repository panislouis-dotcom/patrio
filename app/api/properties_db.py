"""Properties — one building, one row, one lifecycle.

A property moves prospecto → oferta → desarrollo → {en_renta | vendida}, with
en_renta → vendida and any non-terminal state → archivada. What changes along
the way is not the entity but the *question the numbers answer*.

Only ONE kind of figure is gated by status, and it is not the model: a figure
that ASSERTS OWNERSHIP. Everything else is computed wherever its inputs exist
and comes back None when they do not — which is the same answer, arrived at
from the data instead of from a table of statuses.

  · The record — the cost stack, what the underwriting promised on it, and the
    yield on each of the two rents. Never gated. A plan does not expire when
    the deal closes; it becomes the thing the result is graded against, and
    switching it off at the sale turned the pairs below into a promise that
    broke at the exact moment it became checkable.
  · The mark  — unrealizedGain / roi, the valuation against the money in. Gated
    to {desarrollo, en_renta, archivada}: marking capital you have not put in
    is not a measurement, it is a wish. Archiving does not sell anything, so an
    archived property is still owned and its last mark is still its last mark.
  · The exit  — realizedGain / realizedRoi, only in vendida, computed off
    sale_price with its own clock stopped at sale_date (`exit_months`, not
    `holdMonthsActual`, which freezes at the first rent). A sale price on a
    property that has not sold is not a realized anything.

Two rules keep the contract honest:
  · Raw columns are always returned as stored. Only *derived* figures are gated
    by status — blanking a stored value would lie about the database and would
    break the product rule that later stages can still read everything from the
    earlier ones.
  · The capital base (totalInvestment) is a fact, not a projection. It survives
    into vendida because it is the denominator every realized figure divides by.
    It is always the cost stack — never a hand-typed total, because there is no
    longer one to disagree with it.

Every gain in here is the same pair of finance functions applied to a different
exit value — projected sale, current valuation, sale price — so the learning
pairs the firm cares about (projectedProfit ↔ realizedGain, projectedRoi ↔
realizedRoi, capRate ↔ capRateActual) are symmetric by construction rather than
by coincidence, and both halves of every pair are readable at once.

projectedProfit/projectedRoiTotal/projectedRoi are the one exception, and on
purpose: they divide by totalInvestmentWithFeesVenta (fees.py), not the bare
cost stack — pedido explícito, para que "lo que se proyecta ganar" ya cuente
la comisión de salida que la venta modelada cobraría, en vez de un profit
inflado que nadie se embolsa así. unrealizedGain/roi and realizedGain/
realizedRoi still divide by the bare `basis`: la marca y lo realizado no
llevan comisión de salida hasta que de verdad hay una salida que cobrarla.

Each annualized return closes its clock on the date of its own numerator: the
exit on sale_date, the mark on valuation_date. An annualized figure whose
numerator is months older than its denominator falls a little every month
without a single input changing, which is a number that reports the calendar
instead of the asset.
"""
from contextlib import contextmanager
from dataclasses import asdict
from datetime import date
from decimal import Decimal

from psycopg2 import IntegrityError
from psycopg2.extras import Json

from api import budget_db
from api.checks import run_checks, stage_requirements
from api.db import get_db, _camel_to_snake, _row_to_dict, _snake_to_camel
from api.finance import fees, underwriting
from api.finance.analysis import months_between, parse_date, roi_cagr
from api.finance.quantize import frac4, money0


# ─── Lifecycle vocabulary ─────────────────────────────────────────────────────

STATUSES = ("prospecto", "oferta", "desarrollo", "en_renta", "vendida", "archivada")

INITIAL_STATUS = "prospecto"

# El nombre de cada etapa en las frases que lee una persona. `en_renta` es un
# valor de columna, no una palabra: ningún mensaje lo publica crudo. Espeja
# PROPERTY_STATUS_LABEL de app/web/src/lib/status.ts (ahí en mayúsculas, que es
# el estilo del chip; aquí en prosa).
STATUS_LABEL = {
    "prospecto": "Prospecto",
    "oferta": "Oferta",
    "desarrollo": "Desarrollo",
    "en_renta": "En renta",
    "vendida": "Vendida",
    "archivada": "Archivada",
}


def status_label(status: str) -> str:
    return STATUS_LABEL.get(status, status)


def _refusal(from_status: str, to_status: str) -> str:
    """Por qué no, y qué sí. Un rechazo que solo dice «no permitida» obliga a
    adivinar el grafo; el grafo ya está en ALLOWED_TRANSITIONS, así que se dice.
    El orden de los destinos es el del ciclo, no el arbitrario del frozenset."""
    head = (f"No se puede pasar de {status_label(from_status)} "
            f"a {status_label(to_status)}.")
    allowed = [s for s in STATUSES if s in ALLOWED_TRANSITIONS.get(from_status, frozenset())]
    if not allowed:
        return f"{head} Una propiedad {status_label(from_status)} ya no se mueve."
    destinations = " o ".join(
        [", ".join(status_label(s) for s in allowed[:-1]), status_label(allowed[-1])]
        if len(allowed) > 1 else [status_label(allowed[0])]
    )
    return f"{head} Desde {status_label(from_status)} solo se puede pasar a {destinations}."

# Mirrors properties_guard_transition() in migration 024. The API validates first
# so the user gets a readable 422; the trigger is the net underneath that no
# UPDATE — from a script, a fixture or a future endpoint — can slip past.
ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "prospecto": frozenset({"oferta", "archivada"}),
    "oferta": frozenset({"desarrollo", "archivada"}),
    "desarrollo": frozenset({"en_renta", "vendida", "archivada"}),
    "en_renta": frozenset({"vendida", "archivada"}),
    # vendida is terminal: a sold property IS the firm's track record and cannot
    # be archived out of it.
    "vendida": frozenset(),
    "archivada": frozenset(),
}

# Las dos ventanas que quedan, y las dos gatean una AFIRMACIÓN DE PROPIEDAD.
# `archivada` está en la marca porque archivar no vende ni devuelve nada: saca
# la propiedad del inventario activo y le deja exactamente los números que tenía
# el minuto anterior. Se archiva justamente para poder volver a mirarla, y sin
# ventana toda cifra derivada salía en blanco — la etapa a la que se llega desde
# cualquier otra era la única que no contestaba nada.
#
# No hay ventana de EXIT para `archivada` y no puede haberla: `vendida` es
# terminal, así que ninguna archivada tiene una venta que reportar.
_MARK_STATUSES = frozenset({"desarrollo", "en_renta", "archivada"})
_EXIT_STATUSES = frozenset({"vendida"})

# A score ranks candidates you can still walk away from. After the purchase the
# cohort is gone and the question changes from "which one" to "how is it doing".
SCORED_STATUSES = frozenset({"prospecto", "oferta"})

# Windows in which each stage tool is offered. Enforced by the routers that own
# them; kept here so the lifecycle is described in exactly one file.
INVESTOR_STATUSES = frozenset({"oferta", "desarrollo", "en_renta", "vendida"})
PROFIT_STATUSES = frozenset({"desarrollo", "en_renta", "vendida"})
PROCESS_STATUSES = frozenset({"desarrollo", "en_renta", "vendida"})


# ─── Write surface ────────────────────────────────────────────────────────────

# Columns a client may write through POST/PATCH. `status` is absent on purpose:
# it only ever moves through POST /transition, which validates the gate and
# records the event.
#
# ESTOS DOS FROZENSETS SE LEEN COMO TEXTO DESDE FUERA. `app/web/src/lib/
# contract.test.ts` los recorta de este archivo con `?raw` para probar que el
# espejo del cliente no se desincronizó — se desincronizó dos veces el día que
# el costo de obra pasó al presupuesto, y el síntoma es un botón ✕ que solo
# produce un 422. El recorte busca la línea literal `NOMBRE = frozenset({` y
# lee hasta el primer `})`, sacando todo lo que esté entre comillas dobles: si
# renombras las listas, cambias esa forma o metes una palabra entrecomillada en
# un comentario DENTRO de las llaves, esa prueba se rompe o miente.
#
# `constructionCostPerSqm` SÍ ESTÁ, y volvió a estarlo a propósito: es el
# SUPUESTO CAPTURADO —«a cuánto creo que sale el m² de obra»—, su propia columna,
# escribible como cualquier otra. No gobierna nada. El costo de obra sigue siendo
# la suma del presupuesto, y se cambia capturando renglones; lo que este campo da
# es el otro término de la comparación, `budgetedCostPerSqm` (presupuesto ÷ m²),
# que la ficha enseña al lado. Dos números reales, rotulados, ninguno relevo del
# otro — que es la única forma en que una comparación es honesta.
#
# ESCRIBIRLO NO TOCA EL PRESUPUESTO. Ni este ni `sqmConstruction`: hasta el
# 2026-08-30 un PATCH de cualquiera de los dos repreciaba la obra entera, trece
# capítulos cotizados con proveedor incluidos, y nada en la pantalla lo decía.
#
# `constructionOverhead` NO está: sigue siendo solo entrada de la CALCULADORA de
# POST /api/properties, que corre una vez y no guarda nada.
WRITABLE_FIELDS = frozenset({
    "name", "address", "city", "url", "latitude", "longitude",
    "assetType", "strategyType",
    "constructionCostPerSqm",
    "sqmLand", "sqmConstruction", "purchasePrice", "acquisitionCostPct",
    "permitsCost", "subdivisionCost",
    "projectedSale", "holdMonths",
    "rentMonthlyProjected", "rentMonthlyActual",
    "totalUnits", "acquisitionDate", "firstRentDate", "saleDate", "salePrice",
    "currentValuation", "valuationDate", "milestones",
    "notes", "isFavorite",
    "landCommissionPct", "constructionCommissionPct", "exitSaleCommissionPct",
    "exitRentMonths", "exitStrategy",
})

# Emptying a field is its own operation (POST /clear-fields): PATCH uses
# exclude_none, so a null never reaches SQL and the null → NOT NULL 500 has no
# way to happen. Everything nullable is listed; whether a *particular* row may
# lose a *particular* field is decided by stage_requirements, not by this set.
#
# The six assumptions (acquisitionCostPct, holdMonths, and the four
# commission/exit-timing ones the fund's fee structure needs) are clearable
# like anything else, and clearing one is a real operation with a visible
# meaning: it hands the field back to the model's default and the ficha starts
# labelling it «supuesto por omisión». exitStrategy is clearable too but is not
# one of the six — it is a captured fact with no default (migration 049), so
# clearing it means «nadie ha decidido todavía», not «vuelve al modelo».
CLEARABLE_FIELDS = frozenset({
    "assetType", "strategyType",
    "sqmLand", "sqmConstruction", "purchasePrice", "acquisitionCostPct",
    "permitsCost", "subdivisionCost",
    "projectedSale", "holdMonths",
    "rentMonthlyProjected", "rentMonthlyActual",
    "totalUnits", "acquisitionDate", "firstRentDate", "saleDate", "salePrice",
    "currentValuation", "valuationDate",
    "landCommissionPct", "constructionCommissionPct", "exitSaleCommissionPct",
    "exitRentMonths", "exitStrategy",
})

_DATE_FIELDS = frozenset({"acquisitionDate", "firstRentDate", "saleDate", "valuationDate"})
_JSON_FIELDS = frozenset({"milestones"})
_RENT_FIELDS = frozenset({"rentMonthlyProjected", "rentMonthlyActual"})

IMAGE_TYPES = ("antes", "despues")


class PropertyError(Exception):
    """Domain rejection carrying a message written for the user (Spanish)."""


# Cada restricción de las migraciones 024/025, dicha como una instrucción que
# alguien puede seguir. El nombre de la restricción es un identificador de
# Postgres — «properties_en_renta_needs_first_rent» no le dice a nadie qué
# teclear, y encima enseña nombres de columnas que no existen en la ficha.
#
# La lista está completa a propósito: una restricción sin traducción cae al
# fallback, que vuelve a publicar el identificador. Si una migración futura
# agrega un CHECK, agrega también su renglón aquí.
_CONSTRAINT_MESSAGES = {
    # Identidad
    "properties_name_check": "El nombre no puede quedar vacío.",
    "properties_address_check": "La dirección no puede quedar vacía.",
    "properties_city_check": "La ciudad no puede quedar vacía.",
    "properties_status_check": "Esa etapa no existe en el ciclo de vida.",
    "properties_asset_type_check":
        "Tipo de activo inválido: se espera casa, departamento, local, edificio, lote o bodega.",
    "properties_strategy_type_check":
        "Estrategia inválida: se espera Reconversión, Obra nueva, Flip o Renta.",
    # Insumos del underwriting — todos «no negativos»
    "properties_sqm_land_check": "La superficie de terreno no puede ser negativa.",
    "properties_sqm_construction_check": "La obra a ejecutar no puede ser negativa.",
    "properties_purchase_price_check": "El precio de compra no puede ser negativo.",
    "properties_acquisition_cost_pct_check":
        "Los costos de adquisición no pueden ser un porcentaje negativo.",
    "properties_permits_cost_check": "El costo de permisos no puede ser negativo.",
    "properties_subdivision_cost_check": "El costo de subdivisión no puede ser negativo.",
    "properties_construction_cost_per_sqm_check":
        "El costo por m² de la obra a ejecutar no puede ser negativo.",
    "properties_construction_overhead_check":
        "El overhead de obra es un multiplicador: no puede ser negativo.",
    "properties_projected_sale_check": "La venta proyectada no puede ser negativa.",
    "properties_hold_months_check": "El plazo proyectado se captura en meses, mayor que cero.",
    "properties_rent_monthly_projected_check":
        "La renta mensual estimada se captura positiva; «no renta» se expresa dejándola vacía.",
    "properties_rent_monthly_actual_check":
        "La renta mensual cobrada se captura positiva; «no renta» se expresa dejándola vacía.",
    "properties_land_commission_pct_check":
        "La comisión de compra de terreno no puede ser un porcentaje negativo.",
    "properties_construction_commission_pct_check":
        "La comisión sobre obra no puede ser un porcentaje negativo.",
    "properties_exit_sale_commission_pct_check":
        "La comisión de venta no puede ser un porcentaje negativo.",
    "properties_exit_rent_months_check":
        "Los meses de renta de la comisión de salida no pueden ser negativos.",
    "properties_exit_strategy_check":
        "Estrategia de salida inválida: se espera venta o renta.",
    # Realidad post-compra
    "properties_total_units_check": "El número de unidades debe ser mayor que cero.",
    "properties_sale_price_check": "El precio de venta no puede ser negativo.",
    "properties_current_valuation_check": "La valuación no puede ser negativa.",
    "properties_milestones_check": "Los hitos se guardan como un objeto de fecha a descripción.",
    # Coherencia entre etapa y datos
    "properties_en_renta_needs_first_rent":
        "Una propiedad En renta necesita la fecha de la primera renta.",
    "properties_vendida_needs_sale":
        "Una propiedad Vendida necesita su fecha y su precio de venta.",
    "properties_first_rent_after_acquisition":
        "La primera renta no puede ser anterior a la adquisición.",
    "properties_sale_after_acquisition":
        "La venta no puede ser anterior a la adquisición.",
    "properties_sale_after_first_rent":
        "La venta no puede ser anterior a la primera renta.",
    # Tablas satélite
    "property_images_unique_path": "Esa foto ya está cargada en la propiedad.",
    "property_images_file_path_check": "La foto no llegó con su archivo.",
    "property_images_image_type_check":
        "Tipo de foto inválido: se espera antes o después.",
    "property_images_legacy_source_check":
        "Origen de foto heredada inválido: solo lo escribe la migración 024.",
    "property_status_events_moves": "Una transición tiene que cambiar de etapa.",
    "property_status_events_from_status_check":
        "La etapa de origen del evento no existe en el ciclo de vida.",
    "property_status_events_to_status_check":
        "La etapa destino del evento no existe en el ciclo de vida.",
}


def _db_reason(exc: Exception) -> str:
    """Lo que Postgres rechazó, dicho para quien lo va a corregir.

    Traduce por nombre de restricción. Sin traducción — o sin nombre, que es el
    caso de los RAISE del trigger de transiciones — cae a la primera línea del
    error, que en el trigger ya viene escrita en español."""
    constraint = getattr(getattr(exc, "diag", None), "constraint_name", None)
    if constraint in _CONSTRAINT_MESSAGES:
        return _CONSTRAINT_MESSAGES[constraint]
    return str(exc).strip().splitlines()[0]


@contextmanager
def _readable_rejection():
    """La base es la última defensa, no la primera: cuando algo la rompe, el
    cliente lee qué regla violó en vez de recibir un 500 que al navegador le
    llega disfrazado de error de CORS. Toda escritura pasa por aquí."""
    try:
        yield
    except IntegrityError as exc:
        raise PropertyError(_db_reason(exc))


class PropertyNotFound(PropertyError):
    """No such property — the routers turn this into a 404."""


class InvalidTransition(PropertyError):
    """The lifecycle refuses the move, or the target stage lacks its minimum
    data. The routers turn this into a 422, always before the UPDATE, so the
    trigger's 500 stays theoretical."""


# ─── Value coercion ───────────────────────────────────────────────────────────

def to_date(value) -> date | None:
    """finance.analysis.parse_date with the user-facing rejection attached."""
    try:
        return parse_date(value)
    except ValueError:
        raise PropertyError(f"Fecha inválida: {value!r} (se espera YYYY-MM o YYYY-MM-DD)")


def to_columns(data: dict) -> dict:
    """camelCase client payload → snake_case column values, filtered to what a
    client may write and adapted to the column types."""
    out: dict = {}
    for key, value in data.items():
        if key not in WRITABLE_FIELDS:
            continue
        if key in _DATE_FIELDS:
            value = to_date(value)
        elif key in _JSON_FIELDS:
            value = Json(value if value is not None else {})
        elif key in _RENT_FIELDS and value == 0:
            # Una renta de cero no existe: las columnas solo aceptan positivos y
            # la ausencia se guarda como NULL. Un cliente que manda 0 está
            # diciendo "no hay renta capturada", igual que la migración 024 lo
            # interpretó al normalizar los ceros heredados.
            value = None
        out[_camel_to_snake(key)] = value
    return out


# ─── Stage rules ──────────────────────────────────────────────────────────────

def _reject_new_violations(status: str, before: dict, after: dict) -> None:
    """Let a write through unless it *introduces* a stage violation. A row that
    already fails a rule (a clear-fields on an unrelated field, a name typo on a
    half-captured property) must stay editable — otherwise the only way to fix a
    bad row is SQL."""
    introduced = set(stage_requirements(status, after)) - set(stage_requirements(status, before))
    if introduced:
        messages = stage_requirements(status, after)
        raise InvalidTransition(
            " ".join(messages[field] for field in sorted(introduced))
        )


# ─── Metrics ──────────────────────────────────────────────────────────────────

# El expediente: en qué se fue el dinero, qué prometió ese dinero, y el yield de
# cada una de las dos rentas. Ninguna de estas claves está gateada — todas son
# función de columnas guardadas, y ninguna afirma nada sobre el presente.
#
# Los cinco costos y sus derivados por m² están aquí y no entre las cifras del
# capital por una razón muy concreta: son las barras del DESGLOSE. Apagarlos
# fuera de la ventana de proyección dejaba a la ficha pintando un desglose cuyas
# partes visibles sumaban 58-70% de su propio total.
#
# capRateActual / rentAnnualActual son las mismas dos fórmulas alimentadas con la
# renta COBRADA en vez de la modelada. Viven junto a su par para que (capRate ↔
# capRateActual) se lea como se lee todo pareado en este archivo: lo que dijimos,
# al lado de lo que pasó — y para que ninguno de los dos se apague sin el otro.
#
# Las cifras de obra son cuatro y no una, y las cuatro viven aquí porque las
# cuatro son función de lo capturado: `constructionBudgeted` es la barra del
# desglose —el plan, lo único que alimenta la inversión total— y comprometida,
# pagada y sus variaciones son el avance de la obra EN DINERO contra ese plan.
# Ninguna de las tres de ejecución redefine la inversión: lo que la obra va a
# costar y lo que ya se pagó de ella son dos preguntas distintas.
#
# `constructionBase` y `constructionTotal` desaparecieron con la fórmula que
# nombraban. Eran el mismo gasto con y sin overhead; sin un overhead que
# aplicar, «base» y «total» serían dos nombres para un número, que es justo lo
# que el glosario prohíbe.
_RECORD_KEYS = (
    "acquisitionCosts", "acquisitionTotal",
    "constructionBudgeted", "constructionCommitted", "constructionPaid",
    "constructionCommittedVariance", "constructionPaidVariance",
    # Derivada, no capturada: presupuesto ÷ metraje. Se publica para mostrarse y
    # nada la vuelve a leer para calcular dinero. `constructionCostPerSqm` NO
    # está aquí y ésa es la corrección: es la COLUMNA, el supuesto que alguien
    # tecleó, y viaja con las demás crudas. Compartían nombre siendo dos cosas
    # distintas, con la columna sin escribir mientras el derivado se publicaba
    # con su nombre.
    "budgetedCostPerSqm",
    # `purchasePricePerSqm`, `salePerSqm` e `investmentPerSqm` no sobrevivieron:
    # la ficha fue la primera en dejar de mostrar los dos primeros, y el
    # prospecto en PDF —su último lector— dejó de mostrar el tercero
    # (`_opportunity()` en prospectus_html.py, pedido explícito: "Financieros"
    # no necesitaba esa fila).
    "projectedProfit", "projectedRoi", "projectedRoiTotal",
    "capRate", "rentAnnual", "capRateActual", "rentAnnualActual",
)
_MARK_KEYS = ("unrealizedGain", "unrealizedGainPct", "roi")
_EXIT_KEYS = ("realizedGain", "realizedGainPct", "realizedRoi")

# Los supuestos vigentes también son cómputo: la fila puede traerlos vacíos y
# aun así hay un valor en uso. Por eso viajan aquí y no entre las columnas crudas.
_ASSUMPTION_KEYS = tuple(
    _snake_to_camel(k) for k in underwriting.ASSUMPTION_KEYS
) + ("assumptions",)

METRIC_KEYS = _RECORD_KEYS + _MARK_KEYS + _EXIT_KEYS + _ASSUMPTION_KEYS + (
    "totalInvestment", "holdMonthsActual",
)


def _cagr(basis, exit_value, months) -> Decimal | None:
    annual = roi_cagr(basis, exit_value, months)
    return frac4(annual) if annual is not None else None


def hold_months_actual(row: dict) -> int | None:
    """Months held: acquisition → first rent (when the property became
    productive), or → sale for a flip that never rented, or → today while it is
    still in development. None before the purchase — nothing is being held.

    Freezes at whichever milestone came first, not the later one: a property
    that rented and then sold reports how long it took to become productive,
    not how long it took to exit — ese plazo lo cuenta `exit_months`."""
    acquisition = row.get("acquisition_date")
    if acquisition is None:
        return None
    end = row.get("first_rent_date") or row.get("sale_date") or date.today()
    return months_between(acquisition, end)


def mark_months(row: dict) -> int | None:
    """Los meses que la marca anualiza: de la compra a la FECHA DE LA VALUACIÓN.

    No es el plazo real y no debe serlo. Una valuación de hace meses dividida
    entre un reloj que corre hasta hoy da un ROI que baja solo cada mes sin que
    cambie ni un dato — el número reporta el calendario, no el activo. Aquí el
    numerador y el denominador cierran el mismo día, exactamente como el ROI
    realizado cierra ambos en la fecha de venta.

    Sin fecha de corte no hay contra qué congelar, y una valuación sin fecha
    afirma implícitamente ser de hoy: se le toma la palabra y el reloj corre a
    hoy. La ficha lo dice con esas palabras, y checks.py levanta la advertencia
    de que a esa valuación le falta su fecha."""
    acquisition = row.get("acquisition_date")
    if acquisition is None:
        return None
    return months_between(acquisition, row.get("valuation_date") or date.today())


def exit_months(row: dict) -> int | None:
    """Los meses que el ROI REALIZADO anualiza: de la compra a la FECHA DE VENTA.

    No es `hold_months_actual`: ese congela en la primera renta, y una propiedad
    que rentó dos años antes de venderse anualizaría su salida sobre el tramo en
    que todavía no vendía nada — el resultado sale inflado por el pedazo del
    plazo que se le quitó al divisor. Cada retorno anualizado cierra contra su
    propio numerador: el realizado contra el precio de venta, el no realizado
    contra la valuación (`mark_months`).

    Sin venta no hay salida que anualizar."""
    acquisition = row.get("acquisition_date")
    if acquisition is None:
        return None
    sale = row.get("sale_date")
    return months_between(acquisition, sale) if sale else None


def conclusion_date(row: dict) -> date | None:
    """When the work stopped: the sale for a flip, the first rent for a hold.
    The waterfall's on-time bonus and the investor hold both close on it."""
    return row.get("sale_date") or row.get("first_rent_date")


def metrics(row: dict) -> dict:
    """The record, plus whichever of the two gated groups this status opens, for
    one raw property row (snake_case keys)."""
    status = row["status"]
    basis = underwriting.basis(row)
    stack = underwriting.metrics(row)
    held = hold_months_actual(row)
    fee_lines = fees.compute_fees(row, basis)

    out: dict = {
        "totalInvestment": money0(basis) if basis is not None else None,
        "holdMonthsActual": held,
        "landFee": fee_lines["landFee"],
        "constructionFee": fee_lines["constructionFee"],
        "exitFeeVenta": fee_lines["exitFeeVenta"],
        "exitFeeRenta": fee_lines["exitFeeRenta"],
        "totalFeesVenta": fee_lines["totalFeesVenta"],
        "totalFeesRenta": fee_lines["totalFeesRenta"],
        "totalInvestmentWithFeesVenta": fee_lines["totalInvestmentWithFeesVenta"],
        "totalInvestmentWithFeesRenta": fee_lines["totalInvestmentWithFeesRenta"],
        "feesMissingInputsVenta": fee_lines["missingInputsVenta"],
        "feesMissingInputsRenta": fee_lines["missingInputsRenta"],
    }

    # Not gated by status: an assumption is in force in every stage, and the
    # ficha shows it always. Hiding them was how 6.5%, a 1.3 multiplier and a
    # 12-month clock came to move money nobody had agreed to.
    #
    # Each one is published twice on purpose, and they are not the same fact:
    # the plain key (`holdMonths`) is the value IN FORCE — what every formula,
    # document and table actually used — while `assumptions` records where that
    # value came from. Readers that only need the number keep working; readers
    # that need to say "assumed" ask for the provenance.
    stated = underwriting.assumptions(row)
    out["assumptions"] = {_snake_to_camel(k): v for k, v in stated.items()}
    out.update({_snake_to_camel(k): v["value"] for k, v in stated.items()})

    out.update(dict.fromkeys(_MARK_KEYS + _EXIT_KEYS))

    # El expediente, sin ventana. Cada cifra es función de columnas guardadas y
    # sale None cuando no están, que es la misma respuesta a la que llegaba la
    # ventana — pero derivada del dato y no del estado. Lo que se gana con eso es
    # que la venta deja de apagar el plan contra el que se mide: la pareja
    # proyectado ↔ realizado solo sirve si se puede leer completa.
    sale = row.get("projected_sale")
    rent_actual = row.get("rent_monthly_actual")
    # Con comisiones de venta, no con la inversión sin ellas: lo que se
    # proyecta ganar tiene que descontar lo que la salida modelada de verdad
    # cobraría — pedido explícito, ver el comentario del encabezado del
    # archivo sobre por qué este trío es la excepción a "misma base que basis".
    #
    # `fee_lines` no sirve aquí tal cual: su comisión de venta usa sale_price
    # REAL una vez que existe (fees.py, mismo relevo que ya usa `_resolve_
    # sale_value`), y esta es la proyección CONGELADA — la misma pregunta que
    # `sale` (arriba) ya contesta con projected_sale sin importar si la
    # propiedad se vendió. Recalcular con sale_price=None fuerza esa misma
    # respuesta para la comisión, no la que cobraría una venta ya cerrada.
    fee_lines_projected = fees.compute_fees({**row, "sale_price": None}, basis)
    inv_with_fees_venta = fee_lines_projected["totalInvestmentWithFeesVenta"]
    out.update(budget_db.metrics(row))
    out.update({
        "acquisitionCosts": stack["acquisition_costs"],
        "acquisitionTotal": stack["acquisition_total"],
        "projectedProfit": underwriting.gain(inv_with_fees_venta, sale),
        "projectedRoiTotal": underwriting.gain_pct(inv_with_fees_venta, sale),
        "projectedRoi": _cagr(inv_with_fees_venta, sale, underwriting.assumption(row, "hold_months")[0]),
        # capRate (proyectado) es NOI modelada / venta proyectada: la apuesta.
        # capRateActual (real) es NOI cobrada / valuación actual, no venta
        # proyectada: una vez que la propiedad renta, lo que vale hoy —no lo que
        # se apostó que valdría al vender— es la cifra contra la que se mide un
        # cobro real. Cada una empareja lo real con lo real y lo proyectado con
        # lo proyectado; forzarlas al mismo denominador habría sido comparar la
        # renta YA cobrada contra un precio de salida que sigue siendo una
        # apuesta. Sin valuación capturada —comprar no produce un avalúo— no hay
        # honestamente contra qué medir, y `cap_rate()` lo dice con None, no con
        # la venta proyectada como relevo.
        "capRate": underwriting.cap_rate(row.get("rent_monthly_projected"), sale),
        "rentAnnual": underwriting.rent_annual(row.get("rent_monthly_projected")),
        "capRateActual": underwriting.cap_rate(rent_actual, row.get("current_valuation")),
        "rentAnnualActual": underwriting.rent_annual(rent_actual),
        # Meses de renta ESTIMADA (mensual, no anual) para recuperar la
        # inversión con comisiones de venta — pedido explícito, para la tarjeta
        # de oportunidad. Usa la comisión que corresponda hoy (real una vez que
        # exista, como cualquier otro lector de totalInvestmentWithFeesVenta):
        # a diferencia de projectedProfit, este campo no tiene una mitad
        # "realizada" que proteger de que se mueva.
        "paybackMonths": underwriting.payback_months(
            row.get("rent_monthly_projected"), fee_lines["totalInvestmentWithFeesVenta"]),
        # El "yield on cost" que capRate dejó de ser (ver el docstring del
        # módulo): NOI modelada / lo que de verdad cuesta comprar y vender —
        # pedido explícito, para leerlo AL LADO del cap rate de mercado, no en
        # su lugar. Misma función (`cap_rate()` no sabe ni le importa qué
        # denominador recibe), congelada sobre projected_sale como
        # projectedProfit — mismo motivo: la comisión de venta no debe
        # moverse retroactivamente porque la propiedad ya se vendió por otro
        # precio.
        "yieldOnCost": underwriting.cap_rate(row.get("rent_monthly_projected"), inv_with_fees_venta),
    })

    if status in _MARK_STATUSES:
        valuation = row.get("current_valuation")
        out.update({
            "unrealizedGain": underwriting.gain(basis, valuation),
            "unrealizedGainPct": underwriting.gain_pct(basis, valuation),
            # mark_months, no held: la marca se anualiza contra su propia fecha.
            "roi": _cagr(basis, valuation, mark_months(row)),
        })

    if status in _EXIT_STATUSES:
        sale_price = row.get("sale_price")
        out.update({
            "realizedGain": underwriting.gain(basis, sale_price),
            "realizedGainPct": underwriting.gain_pct(basis, sale_price),
            # exit_months, no held: el realizado se anualiza contra su venta.
            "realizedRoi": _cagr(basis, sale_price, exit_months(row)),
        })

    return out


_SCORE_WEIGHTS = {"projectedRoi": 0.5, "capRate": 0.3, "projectedProfit": 0.2}


def score(prop: dict, peers: list[dict]) -> int | None:
    """Percentile rank against the other pre-purchase properties, 0-100.
    Server-authoritative: the client paints it, it does not recompute it."""
    if prop.get("status") not in SCORED_STATUSES:
        return None
    total = 0.0
    for field, weight in _SCORE_WEIGHTS.items():
        values = [float(p.get(field) or 0) for p in peers]
        value = float(prop.get(field) or 0)
        below = sum(1 for x in values if x < value)
        ties = sum(1 for x in values if x == value)
        total += weight * ((below + 0.5 * ties) / len(values) if values else 0.5)
    return round(total * 100)


# ─── Read path ────────────────────────────────────────────────────────────────

# Columnas RETIRADAS que la tabla todavía tiene y el contrato ya no publica.
#
# `construction_overhead` dejó de multiplicar nada: se aplica una sola vez al
# calcular el primer renglón del presupuesto y desde ahí vive dentro del
# importe. Publicarlo igual dejaría en la ficha un número que se puede leer,
# comparar y hasta editar, y que no mueve un peso — que es el defecto «NO SE
# USA» otra vez, con otro nombre.
#
# La columna sobrevive un rato más porque las SEMILLAS la usan para calcular el
# presupuesto de una base recién sembrada, igual que los campos homónimos de
# POST /api/properties. Su DROP va con la reescritura de db/seeds.
#
# `construction_cost_per_sqm` no está aquí porque NO se retiró: volvió a ser el
# supuesto que alguien captura, se escribe por `WRITABLE_FIELDS` y se publica tal
# cual. El derivado —presupuesto ÷ m²— viaja al lado con su propio nombre,
# `budgetedCostPerSqm`, que es justo lo que evita que los dos vuelvan a
# confundirse bajo una sola etiqueta.
_RETIRED_COLUMNS = ("constructionOverhead",)


def parse_property(row, images: list | None = None) -> dict:
    """Raw row → the unified camelCase contract: stored columns as they are, plus
    the stage-appropriate metrics, the stage's issues and its images. Issues are
    computed here rather than in a router so every read of a property carries the
    same verdict.

    `totalInvestment` is derived, always, from the five stored costs — so it
    shadows no column and contradicts none. There is exactly one investment
    figure in the payload, which is why nothing here has to say where it came
    from."""
    raw = dict(row)
    computed = metrics(raw)
    parsed = _row_to_dict(row)
    for retired in _RETIRED_COLUMNS:
        parsed.pop(retired, None)
    parsed.update(computed)
    parsed["issues"] = [asdict(i) for i in run_checks(raw, computed)]
    parsed["images"] = images if images is not None else []
    return parsed


def _images_by_property(conn, ids: list[int]) -> dict[int, list]:
    if not ids:
        return {}
    placeholders = ",".join(["%s"] * len(ids))
    rows = conn.execute(
        f"SELECT * FROM property_images WHERE property_id IN ({placeholders})"
        " ORDER BY sort_order, uploaded_at",
        ids,
    ).fetchall()
    grouped: dict[int, list] = {}
    for row in rows:
        grouped.setdefault(row["property_id"], []).append(_row_to_dict(row))
    return grouped


# La fila cruda más las tres cifras de su presupuesto, en un solo viaje.
#
# El LATERAL trae el costo de obra junto con el resto del desglose porque la
# suma presupuestada YA ES uno de los costos: sacarla en una segunda consulta
# abriría la puerta a leer una propiedad con la obra de otro instante, que es
# como una fila puede publicar una inversión total que sus partes no explican.
#
# `LEFT JOIN` no hace falta: el subselect es un agregado sin GROUP BY, así que
# devuelve exactamente una fila incluso cuando la propiedad no tiene
# presupuesto —0 presupuestado, NULL comprometido, NULL pagado— y por eso no hay
# ninguna rama «si existe presupuesto» en ningún lado.
_FETCH_SQL = f"""
    SELECT p.*, obra.*
      FROM properties p
      JOIN LATERAL ({budget_db.totals_sql('p.id')}) obra ON TRUE
     {{where}}
     ORDER BY p.id
"""


def _fetch(conn, where: str = "", params: tuple | list = ()) -> list[dict]:
    rows = conn.execute(_FETCH_SQL.format(where=where), params).fetchall()
    images = _images_by_property(conn, [r["id"] for r in rows])
    return [parse_property(r, images.get(r["id"], [])) for r in rows]


def _scored(properties: list[dict], peers: list[dict]) -> list[dict]:
    return [{**p, "score": score(p, peers)} for p in properties]


def get_properties(include_archived: bool = False) -> list[dict]:
    """Every property with its metrics, images and score. Archived ones stay out
    of sight unless asked for — that is what archiving is. The scoring cohort is
    always the live pre-purchase pipeline, so including the archived ones in the
    listing cannot move anybody's rank."""
    where = "" if include_archived else "WHERE status <> 'archivada'"
    with get_db() as conn:
        properties = _fetch(conn, where)
    return _scored(properties, [p for p in properties if p["status"] in SCORED_STATUSES])


def get_property(property_id: int) -> dict | None:
    with get_db() as conn:
        found = _fetch(conn, "WHERE id = %s", (property_id,))
        if not found:
            return None
        prop = found[0]
        peers = (
            _fetch(conn, "WHERE status IN ('prospecto', 'oferta')")
            if prop["status"] in SCORED_STATUSES
            else []
        )
    return {**prop, "score": score(prop, peers)}


def exists(property_id: int) -> bool:
    with get_db() as conn:
        return conn.execute(
            "SELECT 1 FROM properties WHERE id = %s", (property_id,)
        ).fetchone() is not None


def headline_roi(prop: dict) -> Decimal | None:
    """The annualized return a property is judged by at its own stage — realized
    once sold, marked while held, modeled before the purchase. One number, so a
    single ROI filter can span a list that mixes all of them."""
    for key in ("realizedRoi", "roi", "projectedRoi"):
        value = prop.get(key)
        if value is not None:
            return value
    return None


def _require_row(conn, property_id: int) -> dict:
    row = conn.execute("SELECT * FROM properties WHERE id = %s", (property_id,)).fetchone()
    if row is None:
        raise PropertyNotFound(f"Propiedad {property_id} no encontrada")
    return dict(row)


# ─── Write path ───────────────────────────────────────────────────────────────

# What a freshly captured property starts with, whoever captured it — the form,
# the sonar importer, a future feed. The five cost inputs get a concrete 0
# instead of NULL because a zero cost is a real claim ("no permits until you say
# otherwise") and it fabricates no money. The base still comes back «—» until
# something is actually captured: a stack that sums to zero is not a $0
# investment, it is an empty one.
#
# The three ASSUMPTIONS are deliberately not here. Writing 6.5%, 1.3 and 12
# months into the row at birth made the model's guesses indistinguishable from
# somebody's decision, and they are the three inputs that do move money and set
# a deadline. Absent, they resolve to underwriting.ASSUMPTION_DEFAULTS at read
# time and the ficha shows them labelled as assumptions — which is the whole
# point: nothing is computed with a number that cannot be seen and changed.
CAPTURE_DEFAULTS = {
    "sqm_land": 0.0,
    "sqm_construction": 0.0,
    "purchase_price": 0.0,
    "permits_cost": 0.0,
    "subdivision_cost": 0.0,
}

# Los tres insumos de la CALCULADORA con la que nace el presupuesto, y SOLO al
# nacer: producen el importe del primer renglón y ahí termina su trabajo. El
# resultado vive en el presupuesto, como un renglón normal que se edita y se
# borra, y no en una fórmula que siga opinando cada vez que alguien corrija un
# metraje — que es exactamente la diferencia entre una calculadora y una liga
# viva.
#
# Dos de los tres SON columnas, y no es contradicción: `sqmConstruction` es
# metraje físico y `constructionCostPerSqm` es el supuesto de $/m² que alguien
# tecleó. Se guardan porque valen por sí solos —el PDF lee el metraje, y la
# ficha enseña el supuesto contra el `budgetedCostPerSqm` del presupuesto— y
# además, aquí y una sola vez, se multiplican. `constructionOverhead` es el
# único que solo pasa: no se guarda en ningún lado.
_CALCULATOR_FIELDS = ("sqmConstruction", "constructionCostPerSqm", "constructionOverhead")


def create_property(data: dict) -> dict:
    """A property is born a prospecto. Every other state is reached by living
    through the one before it.

    Nace también con su presupuesto de obra: un renglón con el estimado grueso
    que produce la calculadora, nombrado con la cuenta que lo produjo («Estimado
    inicial · 200 m² × $9,000/m² × 1.3»). Ese renglón YA es el costo de obra de
    la propiedad, desde `prospecto` y sin compuerta de etapa, y por eso nunca
    hay un momento en que la obra cambie de fuente.

    ES LA ÚNICA VEZ QUE LA CALCULADORA CORRE. De aquí en adelante el renglón es
    un renglón —se corrige, se parte en trece, se borra— y ninguna edición de la
    ficha lo vuelve a tocar. Sin los dos insumos no hay nada que multiplicar y
    el presupuesto nace vacío, sumando $0, que es un estado legítimo."""
    columns = {**CAPTURE_DEFAULTS, **to_columns(data)}
    columns["status"] = INITIAL_STATUS
    names = ", ".join(columns)
    placeholders = ", ".join(["%s"] * len(columns))
    with get_db() as conn:
        with _readable_rejection():
            new_id = conn.execute(
                f"INSERT INTO properties ({names}) VALUES ({placeholders}) RETURNING id",
                list(columns.values()),
            ).fetchone()["id"]
        conn.execute(
            "INSERT INTO property_status_events (property_id, from_status, to_status, notes)"
            " VALUES (%s, NULL, %s, %s)",
            (new_id, INITIAL_STATUS, "Alta de la propiedad."),
        )
        # Misma transacción que la fila: una propiedad sin presupuesto sería la
        # única que necesitaría una rama para contestar cuánto cuesta su obra.
        budget_id = budget_db.create_budget(conn, new_id)
        budget_db.seed_estimate_line(
            conn, budget_id, *(data.get(field) for field in _CALCULATOR_FIELDS))
    return get_property(new_id)


def update_property(property_id: int, data: dict) -> dict:
    """Partial update of the raw columns. Cannot move `status` (not writable) and
    cannot empty anything (the caller strips None before it gets here).

    NO TOCA EL PRESUPUESTO. Ni un peso, ni por ningún campo. `sqmConstruction` y
    `constructionCostPerSqm` se guardan en sus columnas y ahí termina: son
    metraje físico y un supuesto capturado, no la mitad de una fórmula.

    Hasta el 2026-08-30 esto corría la calculadora en cada PATCH y le escribía
    el resultado al presupuesto, por tres caminos, y el tercero era el grave:
    corregir el metraje de 200 a 220 m² derivaba la tasa vigente del total
    actual y la volvía a aplicar, inflando el presupuesto entero un 10% —los
    trece capítulos cotizados con proveedor incluidos—. Un campo rotulado como
    medida física repreciaba la carpintería y nada en la pantalla lo decía. Se
    fue completo, y no se cambió por un botón: el presupuesto es la suma de sus
    renglones, y para moverlo se mueven los renglones.

    La calculadora sigue existiendo y corre UNA sola vez, en `create_property`,
    donde deja un renglón que desde entonces es dato editable de alguien."""
    columns = to_columns(data)
    with get_db() as conn:
        before = _require_row(conn, property_id)
        if columns:
            _reject_new_violations(before["status"], before, {**before, **_plain(columns)})
            assignments = ", ".join(f"{col} = %s" for col in columns)
            with _readable_rejection():
                conn.execute(
                    f"UPDATE properties SET {assignments} WHERE id = %s",
                    list(columns.values()) + [property_id],
                )
    return get_property(property_id)


def clear_fields(property_id: int, fields: list[str]) -> dict:
    """Empty an allowlisted set of nullable columns — the one and only way a
    value goes away, so "cleared" never has to be guessed from a 0."""
    unknown = [f for f in fields if f not in CLEARABLE_FIELDS]
    if unknown:
        raise PropertyError(f"Campos no vaciables: {', '.join(sorted(unknown))}")
    if not fields:
        return get_property(property_id)
    columns = [_camel_to_snake(f) for f in fields]
    with get_db() as conn:
        before = _require_row(conn, property_id)
        _reject_new_violations(before["status"], before, {**before, **dict.fromkeys(columns)})
        assignments = ", ".join(f"{col} = NULL" for col in columns)
        with _readable_rejection():
            conn.execute(f"UPDATE properties SET {assignments} WHERE id = %s", (property_id,))
    return get_property(property_id)


def transition(property_id: int, to_status: str, data: dict,
               effective_on=None, notes: str = "", actor_email: str | None = None) -> dict:
    """Move a property to the next stage, carrying the inputs that stage requires.

    The gate is checked before the UPDATE, so the user gets a sentence instead of
    a constraint violation. The row and its status event are written in the same
    transaction: a stage change that left no trace never happened."""
    columns = to_columns(data)
    with get_db() as conn:
        before = _require_row(conn, property_id)
        from_status = before["status"]

        if to_status not in ALLOWED_TRANSITIONS.get(from_status, frozenset()):
            raise InvalidTransition(_refusal(from_status, to_status))

        after = {**before, **_plain(columns), "status": to_status}
        missing = stage_requirements(to_status, after)
        if missing:
            raise InvalidTransition(" ".join(missing[field] for field in sorted(missing)))

        assignments = ", ".join(f"{col} = %s" for col in columns)
        assignments = f"{assignments}, status = %s" if assignments else "status = %s"
        with _readable_rejection():
            conn.execute(
                f"UPDATE properties SET {assignments} WHERE id = %s",
                list(columns.values()) + [to_status, property_id],
            )
        # The actor is identified by email: it is the only thing both auth paths
        # carry, and an API key's own id is not a user id. Resolving it in the
        # statement keeps the write to a single round trip, and an unknown email
        # leaves created_by NULL rather than failing the transition.
        conn.execute(
            "INSERT INTO property_status_events"
            " (property_id, from_status, to_status, effective_on, notes, created_by)"
            " VALUES (%s, %s, %s, COALESCE(%s, CURRENT_DATE), %s,"
            "         (SELECT id FROM users WHERE email = %s))",
            (property_id, from_status, to_status, to_date(effective_on), notes, actor_email),
        )
    return get_property(property_id)


def _plain(columns: dict) -> dict:
    """Undo the psycopg2 adapters so the stage rules see comparable values."""
    return {k: (v.adapted if isinstance(v, Json) else v) for k, v in columns.items()}


# Lo que retiene a una propiedad, dicho como lo entiende quien intenta borrarla.
# Las tablas que sí caen con ella (fotos, inversionistas, eventos de etapa) no
# están aquí: su FK es ON DELETE CASCADE y nunca llegan a estorbar.
#
# El borrado no usa _readable_rejection() a propósito: ahí la regla rota es de
# captura ("este valor no es válido") y aquí es de referencia ("algo más todavía
# la usa"). Son dos frases distintas porque llevan a dos acciones distintas —
# corregir un campo, o desligar lo que apunta.
_DELETE_BLOCKERS = {
    # El presupuesto de obra retiene, no cae en cascada: sus renglones llevan
    # cantidades medidas, precios negociados y pagos hechos, y eso es captura
    # manual que ningún borrado debe llevarse sin que alguien lo decida.
    "budgets": "tiene renglones capturados en su presupuesto de obra",
    "profit_split_config": "tiene un reparto de utilidades configurado",
    "signals": "está ligada a una señal del sonar",
}


def delete_property(property_id: int) -> None:
    with get_db() as conn:
        # El presupuesto sembrado se va con la propiedad; el capturado la
        # retiene. Desde que TODA propiedad nace con presupuesto, retener por su
        # sola existencia habría dejado el borrado inservible: ninguna propiedad
        # se podría borrar nunca, y el 422 dejaría de señalar trabajo real para
        # señalar una fila que puso el sistema.
        if not budget_db.holds_captured_work(conn, property_id):
            budget_db.drop_budget(conn, property_id)
        # Los procesos ligados caen con la propiedad. Borrarla es una acción
        # explícita, así que sus instancias de proceso —con estados de nodo,
        # comentarios y archivos, que ya cascadean por FK— se van con ella. La
        # FK process_instances.property_id no lleva ON DELETE CASCADE a propósito
        # (para no borrar en silencio), y aquí se hace la baja explícita antes de
        # la propiedad. El presupuesto capturado, el reparto y las señales
        # siguen reteniendo: eso no cambia.
        conn.execute("DELETE FROM process_instances WHERE property_id = %s", (property_id,))
        try:
            deleted = conn.execute("DELETE FROM properties WHERE id = %s", (property_id,))
        except IntegrityError as exc:
            # Borrar algo que otra cosa todavía usa es una respuesta legítima, no
            # una falla del servidor: se responde 422 y se dice qué lo retiene,
            # porque de un 500 mudo nadie deduce que hay que desligar la tarea.
            blocker = _DELETE_BLOCKERS.get(getattr(getattr(exc, "diag", None), "table_name", ""))
            raise PropertyError(
                f"No se puede eliminar la propiedad porque {blocker}."
                if blocker
                else "No se puede eliminar la propiedad porque algo más en el sistema "
                     "todavía la usa. Desliga eso primero."
            )
        if deleted.rowcount == 0:
            raise PropertyNotFound(f"Propiedad {property_id} no encontrada")


def status_events(property_id: int) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM property_status_events WHERE property_id = %s"
            " ORDER BY effective_on, id",
            (property_id,),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


# ─── Images ───────────────────────────────────────────────────────────────────

def get_images(property_id: int) -> list[dict]:
    with get_db() as conn:
        return _images_by_property(conn, [property_id]).get(property_id, [])


def add_image(property_id: int, file_path: str, file_name: str,
              content_type: str, image_type: str = "antes") -> dict:
    with get_db() as conn:
        row = conn.execute(
            "INSERT INTO property_images (property_id, file_path, file_name, content_type, image_type)"
            " VALUES (%s, %s, %s, %s, %s) RETURNING *",
            (property_id, file_path, file_name, content_type, image_type),
        ).fetchone()
    return _row_to_dict(row)


def delete_image(image_id: int, property_id: int) -> str:
    with get_db() as conn:
        row = conn.execute(
            "DELETE FROM property_images WHERE id = %s AND property_id = %s RETURNING file_path",
            (image_id, property_id),
        ).fetchone()
    if row is None:
        raise PropertyNotFound(f"Imagen {image_id} no encontrada en la propiedad {property_id}")
    return row["file_path"]


def update_image_type(image_id: int, property_id: int, image_type: str) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "UPDATE property_images SET image_type = %s WHERE id = %s AND property_id = %s RETURNING *",
            (image_type, image_id, property_id),
        ).fetchone()
    if row is None:
        raise PropertyNotFound(f"Imagen {image_id} no encontrada en la propiedad {property_id}")
    return _row_to_dict(row)


def reorder_images(property_id: int, image_ids: list[int]) -> list[dict]:
    """Vuelve a numerar sort_order 0..n-1 en el orden dado. `image_ids` tiene
    que ser exactamente el conjunto de fotos de la propiedad -- ni de más ni
    de menos -- porque un sort_order que se salta una foto la deja donde
    estaba, silenciosamente fuera del reordenamiento que el usuario pidió."""
    with get_db() as conn:
        existing = {r["id"] for r in conn.execute(
            "SELECT id FROM property_images WHERE property_id = %s", (property_id,)).fetchall()}
        if not existing and not exists(property_id):
            raise PropertyNotFound(f"Propiedad {property_id} no encontrada")
        if len(image_ids) != len(existing) or set(image_ids) != existing:
            raise PropertyError("El nuevo orden debe incluir exactamente las fotos de la propiedad, sin repetir ni faltar ninguna.")
        for index, image_id in enumerate(image_ids):
            conn.execute("UPDATE property_images SET sort_order = %s WHERE id = %s",
                         (index, image_id))
    return get_images(property_id)


# ─── Geometry ─────────────────────────────────────────────────────────────────

class GeometryConflict(Exception):
    """El guardado partió de una revisión que ya no es la vigente: alguien más
    guardó en medio. Escribir igual perdería SU cambio (el blob se reemplaza
    completo), así que no se escribe nada."""

    def __init__(self, current_revision: int):
        self.current_revision = current_revision
        super().__init__(
            "La geometría cambió en otra sesión mientras editabas. "
            "Recarga la página para ver la última versión antes de guardar.")


def get_geometry(property_id: int) -> dict | None:
    """{"geometry": model ({} when unset), "revision": n}, or None if no such
    property. The revision is the optimistic lock token: set_geometry only
    accepts a write that declares the revision it read."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT geometry, geometry_revision FROM properties WHERE id = %s",
            (property_id,),
        ).fetchone()
    if row is None:
        return None
    return {"geometry": row["geometry"] or {}, "revision": row["geometry_revision"]}


def set_geometry(property_id: int, geometry: dict, expected_revision: int) -> dict | None:
    """Whole-blob replace, guarded: writes only if the stored revision still is
    `expected_revision`, bumping it. Returns {"geometry", "revision"}, None if
    no such property, or raises GeometryConflict on a stale revision."""
    with get_db() as conn:
        row = conn.execute(
            "UPDATE properties SET geometry = %s, geometry_revision = geometry_revision + 1"
            " WHERE id = %s AND geometry_revision = %s"
            " RETURNING geometry, geometry_revision",
            (Json(geometry), property_id, expected_revision),
        ).fetchone()
        if row is not None:
            return {"geometry": row["geometry"] or {}, "revision": row["geometry_revision"]}
        # Nada se escribió: propiedad inexistente, o revisión vieja — distinguirlas
        # en la MISMA transacción para no confundir un borrado con un conflicto.
        current = conn.execute(
            "SELECT geometry_revision FROM properties WHERE id = %s", (property_id,),
        ).fetchone()
    if current is None:
        return None
    raise GeometryConflict(current["geometry_revision"])
