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


def _snake_to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])


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
