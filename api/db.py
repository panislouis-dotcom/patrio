import sqlite3
import re
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
