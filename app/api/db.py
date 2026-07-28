import json
import threading
from contextlib import contextmanager
from datetime import datetime, date

import psycopg2
import psycopg2.extras
from psycopg2.extras import Json
from psycopg2.pool import ThreadedConnectionPool

from api.config import DATABASE_URL, DB_POOL_MIN, DB_POOL_MAX
from api.finance import underwriting
from api.finance.quantize import to_decimal, frac4
from api.finance.analysis import roi_cagr

_pool: ThreadedConnectionPool | None = None
# Gates connection acquisition so at most DB_POOL_MAX callers hold a connection
# at once. psycopg2's ThreadedConnectionPool.getconn() *raises* when exhausted
# rather than waiting; the semaphore makes over-capacity callers block until a
# connection frees, turning a hard 500 ceiling into graceful queueing.
_pool_slots = threading.BoundedSemaphore(DB_POOL_MAX)
_pool_lock = threading.Lock()


def _get_pool() -> ThreadedConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = ThreadedConnectionPool(
                    minconn=DB_POOL_MIN,
                    maxconn=DB_POOL_MAX,
                    dsn=DATABASE_URL,
                )
    return _pool


class _ConnProxy:
    """Thin wrapper over a psycopg2 connection that executes SQL via RealDictCursor."""

    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql: str, params=None):
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params or ())
        return cur


@contextmanager
def get_db():
    pool = _get_pool()
    # Block here when DB_POOL_MAX connections are already checked out, instead of
    # letting getconn() raise PoolError. Released in finally, paired 1:1.
    _pool_slots.acquire()
    try:
        conn = pool.getconn()
        try:
            conn.autocommit = False
            yield _ConnProxy(conn)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            pool.putconn(conn)
    finally:
        _pool_slots.release()



RAW_FIELDS = {
    "name",
    "address",
    "city",
    "status",
    "type",
    "url",
    "latitude",
    "longitude",
    "sqmLand",
    "sqmConstruction",
    "landPrice",
    "acquisitionCostPct",
    "permitsCost",
    "subdivisionCost",
    "constructionCostPerSqm",
    "constructionOverhead",
    "projectedSale",
    "rentMonthly",
    "holdMonths",
    "notes",
    "isFavorite",
}


def _snake_to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])


def _camel_to_snake(name: str) -> str:
    """Convert camelCase to snake_case.

    Examples:
        sqmLand -> sqm_land
        acquisitionCostPct -> acquisition_cost_pct
        name -> name
    """
    result = []
    for i, char in enumerate(name):
        if char.isupper():
            if i > 0:
                result.append("_")
            result.append(char.lower())
        else:
            result.append(char)
    return "".join(result)


def _row_to_dict(row) -> dict | None:
    if row is None:
        return None
    return {_snake_to_camel(k): v for k, v in dict(row).items()}


def _parse_prospect(row, images: list | None = None) -> dict:
    """Base prospects row → camelCase dict with underwriting metrics computed in Python."""
    d = _row_to_dict(row)
    m = underwriting.metrics(dict(row))
    d["acquisitionCosts"] = m["acquisition_costs"]
    d["acquisitionTotal"] = m["acquisition_total"]
    d["constructionBase"] = m["construction_base"]
    d["constructionTotal"] = m["construction_total"]
    d["totalInvestment"] = m["total_investment"]
    d["profit"] = m["profit"]
    d["roi"] = m["roi"]
    d["roiTotal"] = m["roi_total"]
    d["capRate"] = m["cap_rate"]
    d["landPricePerSqm"] = m["land_price_per_sqm"]
    d["salePerSqm"] = m["sale_per_sqm"]
    d["investmentPerSqm"] = m["investment_per_sqm"]
    d["rentAnnual"] = m["rent_annual"]
    d["images"] = images if images is not None else get_prospect_images(d["id"])
    return d


def get_prospects() -> list[dict]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM prospects").fetchall()
        if not rows:
            return []
        ids = [r["id"] for r in rows]
        placeholders = ",".join(["%s"] * len(ids))
        img_rows = conn.execute(
            f"SELECT * FROM prospect_images WHERE prospect_id IN ({placeholders}) ORDER BY sort_order, uploaded_at",
            ids,
        ).fetchall()
    imgs_by_id: dict[int, list] = {}
    for ir in img_rows:
        imgs_by_id.setdefault(ir["prospect_id"], []).append(_row_to_dict(ir))
    return [_parse_prospect(r, imgs_by_id.get(r["id"], [])) for r in rows]


def get_prospect(prospect_id: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM prospects WHERE id = %s", (prospect_id,)).fetchone()
    return _parse_prospect(row) if row else None


def delete_prospect(prospect_id: int) -> None:
    with get_db() as conn:
        result = conn.execute("DELETE FROM prospects WHERE id = %s", (prospect_id,))
        if result.rowcount == 0:
            raise ValueError(f"Prospect {prospect_id} not found")


def delete_project(project_id: int) -> None:
    with get_db() as conn:
        result = conn.execute("DELETE FROM projects WHERE id = %s", (project_id,))
        if result.rowcount == 0:
            raise ValueError(f"Project {project_id} not found")


def get_prospect_images(prospect_id: int) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM prospect_images WHERE prospect_id = %s ORDER BY sort_order, uploaded_at",
            (prospect_id,),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def add_prospect_image(prospect_id: int, file_path: str, file_name: str, content_type: str) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "INSERT INTO prospect_images (prospect_id, file_path, file_name, content_type) VALUES (%s, %s, %s, %s) RETURNING *",
            (prospect_id, file_path, file_name, content_type),
        ).fetchone()
    return _row_to_dict(row)


def delete_prospect_image(image_id: int, prospect_id: int) -> str:
    with get_db() as conn:
        row = conn.execute(
            "DELETE FROM prospect_images WHERE id = %s AND prospect_id = %s RETURNING file_path",
            (image_id, prospect_id),
        ).fetchone()
        if row is None:
            raise ValueError(f"Image {image_id} not found for prospect {prospect_id}")
    return row["file_path"]


def get_project_images(project_id: int) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM project_images WHERE project_id = %s ORDER BY sort_order, uploaded_at",
            (project_id,),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def add_project_image(project_id: int, file_path: str, file_name: str, content_type: str, image_type: str = 'antes') -> dict:
    with get_db() as conn:
        row = conn.execute(
            "INSERT INTO project_images (project_id, file_path, file_name, content_type, image_type)"
            " VALUES (%s, %s, %s, %s, %s) RETURNING *",
            (project_id, file_path, file_name, content_type, image_type),
        ).fetchone()
    return _row_to_dict(row)


def delete_project_image(image_id: int, project_id: int) -> str:
    with get_db() as conn:
        row = conn.execute(
            "DELETE FROM project_images WHERE id = %s AND project_id = %s RETURNING file_path",
            (image_id, project_id),
        ).fetchone()
        if row is None:
            raise ValueError(f"Image {image_id} not found for project {project_id}")
    return row["file_path"]


def update_project_image_type(image_id: int, project_id: int, image_type: str) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "UPDATE project_images SET image_type = %s"
            " WHERE id = %s AND project_id = %s RETURNING *",
            (image_type, image_id, project_id),
        ).fetchone()
    if row is None:
        raise ValueError(f"Image {image_id} not found for project {project_id}")
    return _row_to_dict(row)


def update_prospect(prospect_id: int, data: dict) -> dict | None:
    """Update a prospect record with the provided data.

    Only fields in RAW_FIELDS are updated. All other keys are ignored.
    Field names are converted from camelCase to snake_case before updating.

    Args:
        prospect_id: The ID of the prospect to update
        data: Dictionary of fields to update (camelCase keys)

    Returns:
        The updated prospect (with computed metrics) or None if not found
    """
    # Filter to only raw fields
    filtered_data = {k: v for k, v in data.items() if k in RAW_FIELDS}

    if not filtered_data:
        # No valid fields to update, return current prospect
        return get_prospect(prospect_id)

    # Convert camelCase keys to snake_case
    snake_case_data = {_camel_to_snake(k): v for k, v in filtered_data.items()}

    # Build UPDATE statement
    columns = ", ".join(f"{col} = %s" for col in snake_case_data.keys())
    values = list(snake_case_data.values()) + [prospect_id]
    query = f"UPDATE prospects SET {columns} WHERE id = %s"

    with get_db() as conn:
        conn.execute(query, values)

    return get_prospect(prospect_id)


PROJECTS_RAW_FIELDS = {
    "name", "type", "address", "city", "status", "url",
    "latitude", "longitude", "totalUnits",
    "acquisitionDate", "conclusionDate",
    "totalInvestment", "currentValuation", "valuationDate",
    "milestones", "budget", "notes", "prospectId", "isFavorite",
    # Underwriting superset (Project ⊇ Prospect) — the 11 prospect inputs
    "sqmLand", "sqmConstruction", "landPrice", "acquisitionCostPct",
    "permitsCost", "subdivisionCost", "constructionCostPerSqm",
    "constructionOverhead", "projectedSale", "holdMonths", "rentMonthly",
}


def _normalize_project_data(data: dict) -> dict:
    """Filter camelCase input to PROJECTS_RAW_FIELDS, convert keys to snake_case,
    serialize JSON fields, and normalize the DATE column. Single home for the
    project write-column prep shared by create/update/convert."""
    filtered = {k: v for k, v in data.items() if k in PROJECTS_RAW_FIELDS}
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    for f in ("milestones", "budget"):
        if f in snake and not isinstance(snake[f], str):
            snake[f] = json.dumps(snake[f])
    # Frontend sends YYYY-MM; the conclusion_date DATE column needs YYYY-MM-01
    if "conclusion_date" in snake and isinstance(snake["conclusion_date"], str) and len(snake["conclusion_date"]) == 7:
        snake["conclusion_date"] += "-01"
    return snake


def _parse_project(row, images: list | None = None) -> dict:
    """Convert a projects row into a camelCase dict with computed fields."""
    d = _row_to_dict(row)

    # Parse JSON fields
    raw_milestones = d.get("milestones")
    try:
        d["milestones"] = json.loads(raw_milestones) if isinstance(raw_milestones, str) and raw_milestones else {}
    except json.JSONDecodeError:
        d["milestones"] = {}

    raw_budget = d.get("budget")
    try:
        d["budget"] = json.loads(raw_budget) if isinstance(raw_budget, str) and raw_budget else {}
    except json.JSONDecodeError:
        d["budget"] = {}

    # Underwriting superset (Project ⊇ Prospect). A project carrying the full
    # breakdown derives its *projected* metrics identically to a prospect, and its
    # computed total_investment overrides the stored fallback. Breakdown-less
    # projects (land_price NULL) keep the stored total and expose NULL derived fields —
    # except the two that only need rent and the total: cap rate and annual rent.
    _UW_NULL = ("acquisitionCosts", "acquisitionTotal", "constructionBase", "constructionTotal",
                "landPricePerSqm", "salePerSqm", "investmentPerSqm",
                "projectedProfit", "projectedRoi", "projectedRoiTotal")
    if d.get("landPrice") is not None:
        m = underwriting.metrics(dict(row))
        d["totalInvestment"] = m["total_investment"]  # computed overrides stored fallback
        d["acquisitionCosts"] = m["acquisition_costs"]
        d["acquisitionTotal"] = m["acquisition_total"]
        d["constructionBase"] = m["construction_base"]
        d["constructionTotal"] = m["construction_total"]
        d["landPricePerSqm"] = m["land_price_per_sqm"]
        d["salePerSqm"] = m["sale_per_sqm"]
        d["investmentPerSqm"] = m["investment_per_sqm"]
        d["capRate"] = m["cap_rate"]
        d["rentAnnual"] = m["rent_annual"]
        d["projectedProfit"] = m["profit"]
        d["projectedRoi"] = m["roi"]
        d["projectedRoiTotal"] = m["roi_total"]
    else:
        for k in _UW_NULL:
            d[k] = None
        rent = d.get("rentMonthly")
        d["capRate"] = underwriting.cap_rate(rent, d.get("totalInvestment"))
        d["rentAnnual"] = underwriting.rent_annual(rent)

    # Computed fields — money as Decimal, CAGR via shared float primitive
    total_investment = to_decimal(d.get("totalInvestment"))
    current_valuation = to_decimal(d.get("currentValuation"))
    unrealized_gain = current_valuation - total_investment
    unrealized_gain_pct = frac4(unrealized_gain / total_investment) if total_investment != 0 else 0

    # Months from acquisition to conclusion (or today for active projects)
    # conclusion_date is DATE in PostgreSQL — psycopg2 returns datetime.date; format to YYYY-MM for frontend
    acq_str = d.get("acquisitionDate", "")
    conc_val = d.get("conclusionDate")
    conc_has_val = False
    if isinstance(conc_val, date):
        d["conclusionDate"] = conc_val.strftime("%Y-%m")
        conc_year, conc_month = conc_val.year, conc_val.month
        conc_has_val = True
    elif isinstance(conc_val, str) and conc_val:
        conc_year, conc_month = map(int, conc_val.split("-"))
        conc_has_val = True
    try:
        acq_year, acq_month = map(int, acq_str.split("-"))
        if not conc_has_val:
            today = date.today()
            conc_year, conc_month = today.year, today.month
        hold_months_actual = (conc_year - acq_year) * 12 + (conc_month - acq_month)
    except (ValueError, AttributeError):
        hold_months_actual = 0

    roi = roi_cagr(total_investment, current_valuation, hold_months_actual)

    d["unrealizedGain"] = unrealized_gain
    d["unrealizedGainPct"] = unrealized_gain_pct
    d["holdMonthsActual"] = hold_months_actual
    d["roi"] = frac4(roi) if roi is not None else None
    d["images"] = images if images is not None else get_project_images(d["id"])

    return d


def get_projects() -> list[dict]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM projects ORDER BY acquisition_date DESC").fetchall()
        if not rows:
            return []
        ids = [r["id"] for r in rows]
        placeholders = ",".join(["%s"] * len(ids))
        img_rows = conn.execute(
            f"SELECT * FROM project_images WHERE project_id IN ({placeholders}) ORDER BY sort_order, uploaded_at",
            ids,
        ).fetchall()
    imgs_by_id: dict[int, list] = {}
    for ir in img_rows:
        imgs_by_id.setdefault(ir["project_id"], []).append(_row_to_dict(ir))
    return [_parse_project(r, imgs_by_id.get(r["id"], [])) for r in rows]


def get_project(project_id: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = %s", (project_id,)).fetchone()
    return _parse_project(row) if row else None


def get_project_geometry(project_id: int) -> dict | None:
    """Return the stored geometry model ({} when unset), or None if no such project."""
    with get_db() as conn:
        row = conn.execute("SELECT geometry FROM projects WHERE id = %s", (project_id,)).fetchone()
    if row is None:
        return None
    return row["geometry"] or {}


def set_project_geometry(project_id: int, geometry: dict) -> dict | None:
    """Whole-blob replace of a project's geometry. Returns the stored model, or None."""
    with get_db() as conn:
        row = conn.execute(
            "UPDATE projects SET geometry = %s WHERE id = %s RETURNING geometry",
            (Json(geometry), project_id),
        ).fetchone()
    return None if row is None else (row["geometry"] or {})


def get_prospect_geometry(prospect_id: int) -> dict | None:
    """Return the stored geometry model ({} when unset), or None if no such prospect."""
    with get_db() as conn:
        row = conn.execute("SELECT geometry FROM prospects WHERE id = %s", (prospect_id,)).fetchone()
    if row is None:
        return None
    return row["geometry"] or {}


def set_prospect_geometry(prospect_id: int, geometry: dict) -> dict | None:
    """Whole-blob replace of a prospect's geometry. Returns the stored model, or None."""
    with get_db() as conn:
        row = conn.execute(
            "UPDATE prospects SET geometry = %s WHERE id = %s RETURNING geometry",
            (Json(geometry), prospect_id),
        ).fetchone()
    return None if row is None else (row["geometry"] or {})


def _sync_stored_total_investment(conn, project_id: int) -> None:
    """Persist the total the breakdown computes, inside the caller's transaction.

    While a breakdown exists it owns the total and _parse_project displays the
    computed one, so the stored column has to follow or it silently goes stale —
    and that column is what resurfaces, as the total and as the cap rate
    denominator, the day the breakdown is cleared and the project goes back to a
    manual total. A project without a breakdown keeps whatever was written to it.
    """
    row = conn.execute("SELECT * FROM projects WHERE id = %s", (project_id,)).fetchone()
    if row is not None and row["land_price"] is not None:
        conn.execute(
            "UPDATE projects SET total_investment = %s WHERE id = %s",
            (underwriting.metrics(dict(row))["total_investment"], project_id))


def update_project(project_id: int, data: dict) -> dict | None:
    """Update a project record with the provided data.

    Only fields in PROJECTS_RAW_FIELDS are updated. All other keys are ignored.
    Field names are converted from camelCase to snake_case before updating.
    JSON fields (milestones, budget) are serialized if passed as dicts.

    Args:
        project_id: The ID of the project to update
        data: Dictionary of fields to update (camelCase keys)

    Returns:
        The updated project or None if not found
    """
    filtered_data = {k: v for k, v in data.items() if k in PROJECTS_RAW_FIELDS}

    if not filtered_data:
        return get_project(project_id)

    snake_case_data = {_camel_to_snake(k): v for k, v in filtered_data.items()}

    # Serialize JSON fields
    for snake_field in ("milestones", "budget"):
        if snake_field in snake_case_data and not isinstance(snake_case_data[snake_field], str):
            snake_case_data[snake_field] = json.dumps(snake_case_data[snake_field])

    # Frontend sends YYYY-MM; DATE column needs YYYY-MM-01
    if "conclusion_date" in snake_case_data and isinstance(snake_case_data["conclusion_date"], str):
        val = snake_case_data["conclusion_date"]
        if len(val) == 7:
            snake_case_data["conclusion_date"] = val + "-01"

    columns = ", ".join(f"{col} = %s" for col in snake_case_data.keys())
    values = list(snake_case_data.values()) + [project_id]
    query = f"UPDATE projects SET {columns} WHERE id = %s"

    with get_db() as conn:
        conn.execute(query, values)
        _sync_stored_total_investment(conn, project_id)

    return get_project(project_id)


def create_project(data: dict) -> dict:
    """Create a new project record.

    Only fields in PROJECTS_RAW_FIELDS are inserted. All other keys are ignored.
    Field names are converted from camelCase to snake_case before inserting.
    JSON fields (milestones, budget) are serialized if passed as dicts.

    Args:
        data: Dictionary of fields for the new project (camelCase keys)

    Returns:
        The created project
    """
    snake_case_data = _normalize_project_data(data)

    if not snake_case_data:
        raise ValueError("No valid fields provided for create_project")

    columns = ", ".join(snake_case_data.keys())
    placeholders = ", ".join(["%s"] * len(snake_case_data))
    values = list(snake_case_data.values())
    query = f"INSERT INTO projects ({columns}) VALUES ({placeholders}) RETURNING id"

    with get_db() as conn:
        cur = conn.execute(query, values)
        project_id = cur.fetchone()["id"]
        _sync_stored_total_investment(conn, project_id)

    return get_project(project_id)


def convert_prospect(prospect_id: int, fields: dict) -> dict:
    """Atomically create a project from a prospect's full underwriting, link it,
    and archive the prospect (status='converted'). Never deletes the prospect.

    `fields` (camelCase) carries the project-only lifecycle inputs the prospect
    lacks: type, totalUnits, acquisitionDate, conclusionDate, currentValuation,
    valuationDate, status. The 11 underwriting inputs come from the prospect.
    """
    _UW = ("sqm_land", "sqm_construction", "land_price", "acquisition_cost_pct",
           "permits_cost", "subdivision_cost", "construction_cost_per_sqm",
           "construction_overhead", "projected_sale", "hold_months", "rent_monthly")
    with get_db() as conn:
        prow = conn.execute("SELECT * FROM prospects WHERE id=%s", (prospect_id,)).fetchone()
        if not prow:
            raise ValueError(f"Prospect {prospect_id} not found")
        p = dict(prow)
        data = {
            "name": p["name"], "address": p["address"], "city": p["city"],
            "url": p.get("url") or "https://refigan.mx",
            "latitude": p.get("latitude") or 0.0, "longitude": p.get("longitude") or 0.0,
            "notes": p.get("notes") or "-", "prospectId": prospect_id,
        }
        # Carry the 11 underwriting inputs (snake→camel so PROJECTS_RAW_FIELDS accepts them)
        for k in _UW:
            data[_snake_to_camel(k)] = p[k]
        data.update(fields)  # project-only lifecycle inputs (camelCase)
        # Stored total_investment fallback = computed underwriting total (kept in sync)
        data["totalInvestment"] = underwriting.metrics(p)["total_investment"]
        data.setdefault("currentValuation", data["totalInvestment"])
        data.setdefault("valuationDate", data.get("acquisitionDate"))

        snake = _normalize_project_data(data)
        columns = ", ".join(snake.keys())
        placeholders = ", ".join(["%s"] * len(snake))
        new = conn.execute(
            f"INSERT INTO projects ({columns}) VALUES ({placeholders}) RETURNING id",
            list(snake.values())).fetchone()
        new_id = new["id"]
        if p["geometry"]:
            conn.execute("UPDATE projects SET geometry = %s WHERE id = %s", (Json(p["geometry"]), new_id))
        conn.execute("UPDATE prospects SET status='converted' WHERE id=%s", (prospect_id,))
    return get_project(new_id)


def create_prospect(data: dict) -> dict:
    """Create a new prospect record.

    Only fields in RAW_FIELDS are inserted. All other keys are ignored.
    Field names are converted from camelCase to snake_case before inserting.

    Args:
        data: Dictionary of fields for the new prospect (camelCase keys)

    Returns:
        The created prospect (with computed metrics)
    """
    # Filter to only raw fields
    filtered_data = {k: v for k, v in data.items() if k in RAW_FIELDS}

    if not filtered_data:
        raise ValueError("No valid fields provided for create_prospect")

    # Convert camelCase keys to snake_case
    snake_case_data = {_camel_to_snake(k): v for k, v in filtered_data.items()}

    # Build INSERT statement
    columns = ", ".join(snake_case_data.keys())
    placeholders = ", ".join(["%s"] * len(snake_case_data))
    values = list(snake_case_data.values())
    query = f"INSERT INTO prospects ({columns}) VALUES ({placeholders}) RETURNING id"

    with get_db() as conn:
        cur = conn.execute(query, values)
        prospect_id = cur.fetchone()["id"]

    # Return created prospect with computed metrics
    return get_prospect(prospect_id)


# ─── Sonar signals ───────────────────────────────

def get_signals(status: str | None = None, portal: str | None = None) -> list[dict]:
    query = "SELECT * FROM signals"
    conditions, params = [], []
    if status:
        conditions.append("status = %s")
        params.append(status)
    if portal:
        conditions.append("portal = %s")
        params.append(portal)
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY scraped_at DESC"
    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_row_to_dict(r) for r in rows]


def create_signal(data: dict) -> bool:
    """Insert a signal. Returns True if inserted, False if duplicate (url UNIQUE).
    On duplicate, backfills sqm_land if the existing row has none."""
    sqm = data.get("sqm_land", 0)
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO signals (portal, url, title, address, city, price, sqm_land)
               VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT (url) DO NOTHING""",
            (data["portal"], data["url"], data["title"],
             data.get("address", ""), data.get("city", "Monterrey"),
             data.get("price", 0), sqm)
        )
        is_new = cur.rowcount > 0
        if not is_new and sqm > 0:
            conn.execute(
                "UPDATE signals SET sqm_land = %s WHERE url = %s AND sqm_land = 0",
                (sqm, data["url"])
            )
        return is_new


def update_signal_sqm(url: str, sqm: float) -> None:
    with get_db() as conn:
        conn.execute(
            "UPDATE signals SET sqm_land = %s WHERE url = %s AND sqm_land = 0",
            (sqm, url)
        )


def get_signals_missing_sqm(portals: list[str]) -> list[dict]:
    """Return signals with sqm_land=0 for the given portals."""
    placeholders = ",".join(["%s"] * len(portals))
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT id, url, portal FROM signals WHERE sqm_land = 0 AND portal IN ({placeholders})",
            portals
        ).fetchall()
    return [{"id": r["id"], "url": r["url"], "portal": r["portal"]} for r in rows]


def dismiss_signal(signal_id: int) -> dict | None:
    with get_db() as conn:
        conn.execute(
            "UPDATE signals SET status = 'dismissed' WHERE id = %s", (signal_id,)
        )
    return _get_signal(signal_id)


def import_signal(signal_id: int) -> tuple[dict | None, dict | None]:
    """Import a signal as a prospect. Returns (signal, prospect) or (None, None) if not found."""
    signal = _get_signal(signal_id)
    if signal is None:
        return None, None
    # Create a prospect from signal fields with all required fields populated
    prospect = create_prospect({
        "name": signal["title"],
        "address": signal["address"] or signal["title"],
        "city": signal["city"],
        "status": "evaluating",
        "url": signal["url"],
        "latitude": 0.0,
        "longitude": 0.0,
        "sqmLand": signal.get("sqmLand") or 0.0,
        "sqmConstruction": 0.0,
        "landPrice": signal.get("price") or 0.0,
        "acquisitionCostPct": 0.065,
        "permitsCost": 0.0,
        "subdivisionCost": 0.0,
        "constructionCostPerSqm": 0.0,
        "constructionOverhead": 1.3,
        "projectedSale": 0.0,
        "holdMonths": 12,
        "rentMonthly": 0,  # placeholder — zero allowed now that constraint is >= 0
        "notes": "-",
    })
    # Mark signal as imported
    with get_db() as conn:
        conn.execute(
            "UPDATE signals SET status = 'imported', prospect_id = %s WHERE id = %s",
            (prospect["id"], signal_id)
        )
    updated_signal = _get_signal(signal_id)
    return updated_signal, prospect


def _get_signal(signal_id: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM signals WHERE id = %s", (signal_id,)).fetchone()
    return _row_to_dict(row) if row else None


# ─── Team members ─────────────────────────────────

TEAM_RAW_FIELDS = {"name", "role", "managerId", "email", "notes"}


def get_team_members() -> list[dict]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM team_members ORDER BY id").fetchall()
    return [_row_to_dict(r) for r in rows]


def get_team_member(member_id: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM team_members WHERE id = %s", (member_id,)).fetchone()
    return _row_to_dict(row) if row else None


def create_team_member(data: dict) -> dict:
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO team_members (name, role, manager_id, email, notes) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (data["name"], data["role"], data.get("managerId"), data.get("email", ""), data.get("notes", ""))
        )
        member_id = cur.fetchone()["id"]
    return get_team_member(member_id)


def delete_team_member(member_id: int) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM team_members WHERE id = %s", (member_id,))


def update_team_member(member_id: int, data: dict) -> dict | None:
    filtered = {k: v for k, v in data.items() if k in TEAM_RAW_FIELDS}
    if not filtered:
        return get_team_member(member_id)
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(f"{col} = %s" for col in snake.keys())
    values = list(snake.values()) + [member_id]
    with get_db() as conn:
        conn.execute(f"UPDATE team_members SET {columns} WHERE id = %s", values)
    return get_team_member(member_id)


# ─── Comparables ─────────────────────────────────────

COMPARABLE_RAW_FIELDS = {
    "address", "zoneId", "m2", "price", "listingUrl", "sourcePortal",
    "listedAt", "neighborhood", "city", "lat", "lng",
    "bedrooms", "bathrooms", "parkingSpots",
    "propertyType", "condition", "styleTags",
    "status", "soldAt", "notes",
}


def get_comparables(
    status: str | None = None,
    zone_id: int | None = None,
) -> list[dict]:
    query = "SELECT * FROM comparables"
    conditions, params = [], []
    if status:
        conditions.append("status = %s")
        params.append(status)
    if zone_id:
        conditions.append("zone_id = %s")
        params.append(zone_id)
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY captured_at DESC"
    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_parse_comparable(r) for r in rows]


def get_comparable(comparable_id: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM comparables WHERE id = %s", (comparable_id,)
        ).fetchone()
    return _parse_comparable(row) if row else None


def create_comparable(data: dict) -> dict | None:
    filtered = {k: v for k, v in data.items() if k in COMPARABLE_RAW_FIELDS}
    if not filtered:
        raise ValueError("No valid fields provided for create_comparable")

    snake = {_camel_to_snake(k): v for k, v in filtered.items()}

    # Serialize JSONB fields
    if "style_tags" in snake and not isinstance(snake["style_tags"], str):
        snake["style_tags"] = json.dumps(snake["style_tags"])

    columns = ", ".join(snake.keys())
    placeholders = ", ".join(["%s"] * len(snake))
    values = list(snake.values())
    query = f"INSERT INTO comparables ({columns}) VALUES ({placeholders}) ON CONFLICT (listing_url) DO NOTHING RETURNING id"

    with get_db() as conn:
        cur = conn.execute(query, values)
        row = cur.fetchone()

    if row is None:
        # Duplicate — return existing row
        with get_db() as conn:
            existing = conn.execute(
                "SELECT id FROM comparables WHERE listing_url = %s", (snake.get("listing_url"),)
            ).fetchone()
        return get_comparable(existing["id"]) if existing else None

    return get_comparable(row["id"])


def update_comparable(comparable_id: int, data: dict) -> dict | None:
    filtered = {k: v for k, v in data.items() if k in COMPARABLE_RAW_FIELDS}
    if not filtered:
        return get_comparable(comparable_id)

    snake = {_camel_to_snake(k): v for k, v in filtered.items()}

    # Serialize JSONB fields
    if "style_tags" in snake and not isinstance(snake["style_tags"], str):
        snake["style_tags"] = json.dumps(snake["style_tags"])

    columns = ", ".join(f"{col} = %s" for col in snake.keys())
    values = list(snake.values()) + [comparable_id]
    query = f"UPDATE comparables SET {columns} WHERE id = %s"

    with get_db() as conn:
        conn.execute(query, values)

    return get_comparable(comparable_id)


def delete_comparable(comparable_id: int) -> bool:
    with get_db() as conn:
        cur = conn.execute("DELETE FROM comparables WHERE id = %s", (comparable_id,))
    return cur.rowcount > 0


def _parse_comparable(row) -> dict | None:
    if row is None:
        return None
    d = _row_to_dict(row)
    # Parse JSONB style_tags
    raw_tags = d.get("styleTags")
    if isinstance(raw_tags, str):
        try:
            d["styleTags"] = json.loads(raw_tags)
        except json.JSONDecodeError:
            d["styleTags"] = []
    return d
