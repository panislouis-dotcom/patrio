import sqlite3
import json
from datetime import datetime, date
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "refigan.db"

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


def _row_to_dict(row: sqlite3.Row) -> dict:
    return {_snake_to_camel(k): v for k, v in dict(row).items()}


def get_prospects() -> list[dict]:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(PROSPECTS_QUERY).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_prospect(prospect_id: int) -> dict | None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            f"{PROSPECTS_QUERY} WHERE pm.id = ?", (prospect_id,)
        ).fetchone()
    return _row_to_dict(row) if row else None


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
    columns = ", ".join(f"{col} = ?" for col in snake_case_data.keys())
    values = list(snake_case_data.values()) + [prospect_id]
    query = f"UPDATE prospects SET {columns} WHERE id = ?"

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(query, values)

    return get_prospect(prospect_id)


PROJECTS_RAW_FIELDS = {
    "name", "type", "address", "city", "status", "url",
    "latitude", "longitude", "totalUnits",
    "acquisitionDate", "firstRentDate",
    "totalInvestment", "currentValuation", "valuationDate",
    "milestones", "budget", "notes",
}


def _parse_project(row: sqlite3.Row) -> dict:
    """Convert a projects row into a camelCase dict with computed fields."""
    d = _row_to_dict(row)

    # Parse JSON fields
    raw_milestones = d.get("milestones")
    d["milestones"] = json.loads(raw_milestones) if isinstance(raw_milestones, str) and raw_milestones else {}
    raw_budget = d.get("budget")
    d["budget"] = json.loads(raw_budget) if isinstance(raw_budget, str) and raw_budget else {}

    # Computed fields
    total_investment = d.get("totalInvestment") or 0.0
    current_valuation = d.get("currentValuation") or 0.0
    unrealized_gain = current_valuation - total_investment
    unrealized_gain_pct = round(unrealized_gain / total_investment, 4) if total_investment != 0 else 0

    # acquisition_date stored as YYYY-MM
    acquisition_date_str = d.get("acquisitionDate", "")
    try:
        acq_year, acq_month = map(int, acquisition_date_str.split("-"))
        today = date.today()
        hold_months_actual = (today.year - acq_year) * 12 + (today.month - acq_month)
    except (ValueError, AttributeError):
        hold_months_actual = 0

    d["unrealizedGain"] = unrealized_gain
    d["unrealizedGainPct"] = unrealized_gain_pct
    d["holdMonthsActual"] = hold_months_actual

    return d


def get_projects() -> list[dict]:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM projects ORDER BY acquisition_date DESC").fetchall()
    return [_parse_project(r) for r in rows]


def get_project(project_id: int) -> dict | None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
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

    columns = ", ".join(f"{col} = ?" for col in snake_case_data.keys())
    values = list(snake_case_data.values()) + [project_id]
    query = f"UPDATE projects SET {columns} WHERE id = ?"

    with sqlite3.connect(DB_PATH) as conn:
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

    columns = ", ".join(snake_case_data.keys())
    placeholders = ", ".join("?" * len(snake_case_data))
    values = list(snake_case_data.values())
    query = f"INSERT INTO projects ({columns}) VALUES ({placeholders})"

    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(query, values)
        project_id = cur.lastrowid

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
    placeholders = ", ".join("?" * len(snake_case_data))
    values = list(snake_case_data.values())
    query = f"INSERT INTO prospects ({columns}) VALUES ({placeholders})"

    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(query, values)
        prospect_id = cur.lastrowid

    # Return created prospect with computed metrics
    return get_prospect(prospect_id)
