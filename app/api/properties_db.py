"""Properties — one building, one row, one lifecycle.

A property moves prospecto → oferta → desarrollo → {en_renta | vendida}, with
en_renta → vendida and any non-terminal state → archivada. What changes along
the way is not the entity but the *question the numbers answer*, so the metric
contract carries three groups that appear and disappear together instead of
degrading into zeros:

  · Projection — what the underwriting says the deal will do. Alive from
    prospecto through en_renta, gone at the exit: a sold property is a closed
    fact, not a live model.
  · Realized  — the mark against the money actually in. From desarrollo (the
    first state that has an acquisition and a valuation) through en_renta.
  · Exit      — frozen at the sale, only in vendida, computed off sale_price
    with the hold stopped at sale_date.

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
realizedRoi) are symmetric by construction rather than by coincidence.
"""
from dataclasses import asdict
from datetime import date
from decimal import Decimal

from psycopg2.extras import Json

from api.checks import run_checks, stage_requirements
from api.db import get_db, _camel_to_snake, _row_to_dict
from api.finance import underwriting
from api.finance.analysis import months_between, parse_date, roi_cagr
from api.finance.quantize import frac4, money, money0, to_decimal


# ─── Lifecycle vocabulary ─────────────────────────────────────────────────────

STATUSES = ("prospecto", "oferta", "desarrollo", "en_renta", "vendida", "archivada")

INITIAL_STATUS = "prospecto"

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

_PROJECTION_STATUSES = frozenset({"prospecto", "oferta", "desarrollo", "en_renta"})
_REALIZED_STATUSES = frozenset({"desarrollo", "en_renta"})
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
    "sqmLand", "sqmConstruction", "landPrice", "acquisitionCostPct",
    "permitsCost", "subdivisionCost", "constructionCostPerSqm",
    "constructionOverhead", "projectedSale", "holdMonths", "rentMonthly",
    "totalUnits", "acquisitionDate", "firstRentDate", "saleDate", "salePrice",
    "totalInvestment", "currentValuation", "valuationDate", "milestones",
    "notes", "isFavorite",
})

# Emptying a field is its own operation (POST /clear-fields): PATCH uses
# exclude_none, so a null never reaches SQL and the null → NOT NULL 500 has no
# way to happen. Everything nullable is listed; whether a *particular* row may
# lose a *particular* field is decided by stage_requirements, not by this set.
CLEARABLE_FIELDS = frozenset({
    "assetType", "strategyType",
    "sqmLand", "sqmConstruction", "landPrice", "acquisitionCostPct",
    "permitsCost", "subdivisionCost", "constructionCostPerSqm",
    "constructionOverhead", "projectedSale", "holdMonths", "rentMonthly",
    "totalUnits", "acquisitionDate", "firstRentDate", "saleDate", "salePrice",
    "totalInvestment", "currentValuation", "valuationDate",
})

_DATE_FIELDS = frozenset({"acquisitionDate", "firstRentDate", "saleDate", "valuationDate"})
_JSON_FIELDS = frozenset({"milestones"})

IMAGE_TYPES = ("general", "antes", "despues")


class PropertyError(Exception):
    """Domain rejection carrying a message written for the user (Spanish)."""


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

_PROJECTION_KEYS = (
    "acquisitionCosts", "acquisitionTotal", "constructionBase", "constructionTotal",
    "landPricePerSqm", "investmentPerSqm", "salePerSqm",
    "projectedProfit", "projectedRoi", "projectedRoiTotal",
    "capRate", "rentAnnual",
)
_REALIZED_KEYS = ("unrealizedGain", "unrealizedGainPct", "roi")
_EXIT_KEYS = ("realizedGain", "realizedGainPct", "realizedRoi")

METRIC_KEYS = _PROJECTION_KEYS + _REALIZED_KEYS + _EXIT_KEYS + (
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


def conclusion_date(row: dict) -> date | None:
    """When the work stopped: the sale for a flip, the first rent for a hold.
    The waterfall's on-time bonus and the investor hold both close on it."""
    return row.get("sale_date") or row.get("first_rent_date")


def metrics(row: dict) -> dict:
    """The three metric groups for one raw property row (snake_case keys)."""
    status = row["status"]
    basis = underwriting.basis(row)
    stack = underwriting.metrics(row)
    held = hold_months_actual(row)

    out: dict = {
        "totalInvestment": money0(basis) if basis is not None else None,
        "investmentBasis": underwriting.basis_kind(row),
        "holdMonthsActual": held,
    }

    out.update(dict.fromkeys(_PROJECTION_KEYS + _REALIZED_KEYS + _EXIT_KEYS))

    if status in _PROJECTION_STATUSES:
        sale = row.get("projected_sale")
        out.update({
            "acquisitionCosts": stack["acquisition_costs"],
            "acquisitionTotal": stack["acquisition_total"],
            "constructionBase": stack["construction_base"],
            "constructionTotal": stack["construction_total"],
            "landPricePerSqm": stack["land_price_per_sqm"],
            "investmentPerSqm": _per_sqm(basis, row.get("sqm_land")),
            "salePerSqm": stack["sale_per_sqm"],
            "projectedProfit": underwriting.gain(basis, sale),
            "projectedRoiTotal": underwriting.gain_pct(basis, sale),
            "projectedRoi": _cagr(basis, sale, row.get("hold_months")),
            # Yield on cost: the same formula whether the rent is still modeled
            # or already collected, so it belongs to the projection window and
            # freezes with it at the sale.
            "capRate": underwriting.cap_rate(row.get("rent_monthly"), basis),
            "rentAnnual": underwriting.rent_annual(row.get("rent_monthly")),
        })

    if status in _REALIZED_STATUSES:
        valuation = row.get("current_valuation")
        out.update({
            "unrealizedGain": underwriting.gain(basis, valuation),
            "unrealizedGainPct": underwriting.gain_pct(basis, valuation),
            "roi": _cagr(basis, valuation, held),
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
    same verdict."""
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
# the sonar importer, a future feed. The seven cost inputs get concrete values
# instead of NULL so the investment base resolves from birth, which leaves NULL
# meaning one unambiguous thing: somebody emptied the field on purpose.
CAPTURE_DEFAULTS = {
    "sqm_land": 0.0,
    "sqm_construction": 0.0,
    "land_price": 0.0,
    "acquisition_cost_pct": 0.065,
    "permits_cost": 0.0,
    "subdivision_cost": 0.0,
    "construction_cost_per_sqm": 0.0,
    "construction_overhead": 1.3,
    "hold_months": 12,
}


def create_property(data: dict) -> dict:
    """A property is born a prospecto. Every other state is reached by living
    through the one before it."""
    columns = {**CAPTURE_DEFAULTS, **to_columns(data)}
    columns["status"] = INITIAL_STATUS
    names = ", ".join(columns)
    placeholders = ", ".join(["%s"] * len(columns))
    with get_db() as conn:
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
            raise InvalidTransition(
                f"Transición no permitida: {from_status} → {to_status}."
            )

        after = {**before, **_plain(columns), "status": to_status}
        missing = stage_requirements(to_status, after)
        if missing:
            raise InvalidTransition(" ".join(missing[field] for field in sorted(missing)))

        assignments = ", ".join(f"{col} = %s" for col in columns)
        assignments = f"{assignments}, status = %s" if assignments else "status = %s"
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


def delete_property(property_id: int) -> None:
    with get_db() as conn:
        deleted = conn.execute("DELETE FROM properties WHERE id = %s", (property_id,))
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
