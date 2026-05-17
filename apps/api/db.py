import json
from contextlib import contextmanager
from datetime import datetime, date

import psycopg2
import psycopg2.extras
from psycopg2.pool import ThreadedConnectionPool

from api.config import DATABASE_URL

_pool: ThreadedConnectionPool | None = None


def _get_pool() -> ThreadedConnectionPool:
    global _pool
    if _pool is None:
        _pool = ThreadedConnectionPool(
            minconn=1,
            maxconn=10,
            dsn=DATABASE_URL,
        )
    return _pool


class _ConnProxy:
    """Mimics sqlite3 connection.execute() so all db functions work unchanged."""

    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql: str, params=None):
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params or ())
        return cur


@contextmanager
def get_db():
    pool = _get_pool()
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


def execute_script(sql: str) -> None:
    pool = _get_pool()
    conn = pool.getconn()
    try:
        cur = conn.cursor()
        cur.execute(sql)
        conn.commit()
    finally:
        pool.putconn(conn)


PROSPECTS_QUERY = """
SELECT
    pm.*,
    p.latitude,
    p.longitude,
    p.construction_cost_per_sqm,
    p.construction_overhead
FROM prospect_metrics pm
JOIN prospects p ON pm.id = p.id
"""

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


def get_prospects() -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(PROSPECTS_QUERY).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_prospect(prospect_id: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute(
            f"{PROSPECTS_QUERY} WHERE pm.id = %s", (prospect_id,)
        ).fetchone()
    return _row_to_dict(row) if row else None


def set_prospect_image_path(prospect_id: int, image_path: str) -> None:
    with get_db() as conn:
        result = conn.execute(
            "UPDATE prospects SET image_path = %s WHERE id = %s",
            (image_path, prospect_id),
        )
        if result.rowcount == 0:
            raise ValueError(f"Prospect {prospect_id} not found")


def set_project_image_path(project_id: int, image_path: str) -> None:
    with get_db() as conn:
        result = conn.execute(
            "UPDATE projects SET image_path = %s WHERE id = %s",
            (image_path, project_id),
        )
        if result.rowcount == 0:
            raise ValueError(f"Project {project_id} not found")


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
    "milestones", "budget", "notes", "prospectId",
}


def _parse_project(row) -> dict:
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

    # Computed fields
    total_investment = d.get("totalInvestment") or 0.0
    current_valuation = d.get("currentValuation") or 0.0
    unrealized_gain = current_valuation - total_investment
    unrealized_gain_pct = round(unrealized_gain / total_investment, 4) if total_investment != 0 else 0

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

    roi = None
    if total_investment > 0 and current_valuation > 0 and hold_months_actual > 0:
        roi = round((current_valuation / total_investment) ** (12.0 / hold_months_actual) - 1, 4)

    d["unrealizedGain"] = unrealized_gain
    d["unrealizedGainPct"] = unrealized_gain_pct
    d["holdMonthsActual"] = hold_months_actual
    d["roi"] = roi

    return d


def get_projects() -> list[dict]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM projects ORDER BY acquisition_date DESC").fetchall()
    return [_parse_project(r) for r in rows]


def get_project(project_id: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = %s", (project_id,)).fetchone()
    return _parse_project(row) if row else None


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
    filtered_data = {k: v for k, v in data.items() if k in PROJECTS_RAW_FIELDS}

    if not filtered_data:
        raise ValueError("No valid fields provided for create_project")

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

    columns = ", ".join(snake_case_data.keys())
    placeholders = ", ".join(["%s"] * len(snake_case_data))
    values = list(snake_case_data.values())
    query = f"INSERT INTO projects ({columns}) VALUES ({placeholders}) RETURNING id"

    with get_db() as conn:
        cur = conn.execute(query, values)
        project_id = cur.fetchone()["id"]

    return get_project(project_id)


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
