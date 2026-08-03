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
    sale_price with the hold stopped at sale_date. A sale price on a property
    that has not sold is not a realized anything.

Two rules keep the contract honest:
  · Raw columns are always returned as stored. Only *derived* figures are gated
    by status — blanking a stored value would lie about the database and would
    break the product rule that later stages can still read everything from the
    earlier ones.
  · The capital base (totalInvestment / investmentBasis) is a fact, not a
    projection. It survives into vendida because it is the denominator every
    realized figure divides by.

Every gain in here is the same pair of finance functions applied to a different
exit value — projected sale, current valuation, sale price — so the learning
pairs the firm cares about (projectedProfit ↔ realizedGain, projectedRoi ↔
realizedRoi, capRate ↔ capRateActual) are symmetric by construction rather than
by coincidence, and both halves of every pair are readable at once.

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

from api.checks import run_checks, stage_requirements
from api.db import get_db, _camel_to_snake, _row_to_dict, _snake_to_camel
from api.finance import underwriting
from api.finance.analysis import months_between, parse_date, roi_cagr
from api.finance.quantize import frac4, money, money0, to_decimal


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
ANALYSIS_STATUSES = frozenset({"prospecto", "oferta", "desarrollo"})
PROCESS_STATUSES = frozenset({"desarrollo", "en_renta", "vendida"})


# ─── Write surface ────────────────────────────────────────────────────────────

# Columns a client may write through POST/PATCH. `status` is absent on purpose:
# it only ever moves through POST /transition, which validates the gate and
# records the event.
WRITABLE_FIELDS = frozenset({
    "name", "address", "city", "url", "latitude", "longitude",
    "assetType", "strategyType",
    "sqmLand", "sqmConstruction", "purchasePrice", "acquisitionCostPct",
    "permitsCost", "subdivisionCost", "constructionCostPerSqm",
    "constructionOverhead", "projectedSale", "holdMonths",
    "rentMonthlyProjected", "rentMonthlyActual",
    "totalUnits", "acquisitionDate", "firstRentDate", "saleDate", "salePrice",
    "totalInvestmentCaptured", "currentValuation", "valuationDate", "milestones",
    "notes", "isFavorite",
})

# Emptying a field is its own operation (POST /clear-fields): PATCH uses
# exclude_none, so a null never reaches SQL and the null → NOT NULL 500 has no
# way to happen. Everything nullable is listed; whether a *particular* row may
# lose a *particular* field is decided by stage_requirements, not by this set.
#
# The three assumptions are clearable like anything else, and clearing one is a
# real operation with a visible meaning: it hands the field back to the model's
# default and the ficha starts labelling it «supuesto por omisión».
CLEARABLE_FIELDS = frozenset({
    "assetType", "strategyType",
    "sqmLand", "sqmConstruction", "purchasePrice", "acquisitionCostPct",
    "permitsCost", "subdivisionCost", "constructionCostPerSqm",
    "constructionOverhead", "projectedSale", "holdMonths",
    "rentMonthlyProjected", "rentMonthlyActual",
    "totalUnits", "acquisitionDate", "firstRentDate", "saleDate", "salePrice",
    "totalInvestmentCaptured", "currentValuation", "valuationDate",
})

_DATE_FIELDS = frozenset({"acquisitionDate", "firstRentDate", "saleDate", "valuationDate"})
_JSON_FIELDS = frozenset({"milestones"})
_RENT_FIELDS = frozenset({"rentMonthlyProjected", "rentMonthlyActual"})

IMAGE_TYPES = ("general", "antes", "despues")


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
    # Realidad post-compra
    "properties_total_units_check": "El número de unidades debe ser mayor que cero.",
    "properties_sale_price_check": "El precio de venta no puede ser negativo.",
    "properties_total_investment_captured_check":
        "La inversión capturada no puede ser negativa.",
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
        "Tipo de foto inválido: se espera general, antes o después.",
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
_RECORD_KEYS = (
    "acquisitionCosts", "acquisitionTotal", "constructionBase", "constructionTotal",
    "purchasePricePerSqm", "investmentPerSqm", "salePerSqm",
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
    "totalInvestment", "investmentBasis", "holdMonthsActual",
)


def _cagr(basis, exit_value, months) -> Decimal | None:
    annual = roi_cagr(basis, exit_value, months)
    return frac4(annual) if annual is not None else None


def _per_sqm(amount, sqm_land) -> Decimal | None:
    """Basis-aware unit price. underwriting.metrics() divides its own cost stack;
    this one divides whatever the capital base resolved to, so a manually
    totalled property still reports a per-m² figure that matches its total."""
    sqm = to_decimal(sqm_land)
    return money(to_decimal(amount) / sqm) if (amount is not None and sqm > 0) else None


def hold_months_actual(row: dict) -> int | None:
    """Months held: acquisition → sale for a closed deal, acquisition → today
    while it is still owned. None before the purchase — nothing is being held."""
    acquisition = row.get("acquisition_date")
    if acquisition is None:
        return None
    return months_between(acquisition, row.get("sale_date") or date.today())


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

    out: dict = {
        "totalInvestment": money0(basis) if basis is not None else None,
        "investmentBasis": underwriting.basis_kind(row),
        "holdMonthsActual": held,
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
    out.update({
        "acquisitionCosts": stack["acquisition_costs"],
        "acquisitionTotal": stack["acquisition_total"],
        "constructionBase": stack["construction_base"],
        "constructionTotal": stack["construction_total"],
        "purchasePricePerSqm": stack["purchase_price_per_sqm"],
        "investmentPerSqm": _per_sqm(basis, row.get("sqm_land")),
        "salePerSqm": stack["sale_per_sqm"],
        "projectedProfit": underwriting.gain(basis, sale),
        "projectedRoiTotal": underwriting.gain_pct(basis, sale),
        "projectedRoi": _cagr(basis, sale, underwriting.assumption(row, "hold_months")[0]),
        # Yield on cost off the MODELED rent — "what did the underwriting
        # promise?" — next to the same formula fed the rent actually collected.
        "capRate": underwriting.cap_rate(row.get("rent_monthly_projected"), basis),
        "rentAnnual": underwriting.rent_annual(row.get("rent_monthly_projected")),
        "capRateActual": underwriting.cap_rate(rent_actual, basis),
        "rentAnnualActual": underwriting.rent_annual(rent_actual),
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
            "realizedRoi": _cagr(basis, sale_price, held),
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

def parse_property(row, images: list | None = None) -> dict:
    """Raw row → the unified camelCase contract: stored columns as they are, plus
    the stage-appropriate metrics, the stage's issues and its images. Issues are
    computed here rather than in a router so every read of a property carries the
    same verdict.

    No computed key shadows a stored one any more. `totalInvestmentCaptured` is
    the column exactly as typed and `totalInvestment` is the base the model
    resolved — two names because they are two facts, and because a hand-typed
    total used to vanish from the payload the moment the breakdown was complete,
    which left it unreadable and uneditable in the very row that had it."""
    raw = dict(row)
    computed = metrics(raw)
    parsed = _row_to_dict(row)
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


def _fetch(conn, where: str = "", params: tuple | list = ()) -> list[dict]:
    rows = conn.execute(
        f"SELECT * FROM properties {where} ORDER BY id", params
    ).fetchall()
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
# instead of NULL so the investment base resolves from birth; a zero cost is a
# real claim ("no permits until you say otherwise") and it fabricates no money.
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
    "construction_cost_per_sqm": 0.0,
}


def create_property(data: dict) -> dict:
    """A property is born a prospecto. Every other state is reached by living
    through the one before it."""
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
    return get_property(new_id)


def update_property(property_id: int, data: dict) -> dict:
    """Partial update of the raw columns. Cannot move `status` (not writable) and
    cannot empty anything (the caller strips None before it gets here)."""
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
    "analysis_snapshots": "tiene análisis guardados",
    "process_instances": "tiene tareas ligadas",
    "profit_split_config": "tiene un reparto de utilidades configurado",
    "signals": "está ligada a una señal del sonar",
}


def delete_property(property_id: int) -> None:
    with get_db() as conn:
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
              content_type: str, image_type: str = "general") -> dict:
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


# ─── Geometry ─────────────────────────────────────────────────────────────────

def get_geometry(property_id: int) -> dict | None:
    """The stored floorplan model ({} when unset), or None if no such property."""
    with get_db() as conn:
        row = conn.execute("SELECT geometry FROM properties WHERE id = %s", (property_id,)).fetchone()
    return None if row is None else (row["geometry"] or {})


def set_geometry(property_id: int, geometry: dict) -> dict | None:
    """Whole-blob replace. Returns the stored model, or None if no such property."""
    with get_db() as conn:
        row = conn.execute(
            "UPDATE properties SET geometry = %s WHERE id = %s RETURNING geometry",
            (Json(geometry), property_id),
        ).fetchone()
    return None if row is None else (row["geometry"] or {})
