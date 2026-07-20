import json

from .db import get_db, _snake_to_camel, _camel_to_snake
from api.finance.waterfall import compute_waterfall, compute_bonus_tier  # noqa: F401


PROFIT_RAW_FIELDS = {
    "exitPrice", "investorCapital", "investorRateAnnual", "investorMonths", "isrRate",
    "finderFeePct", "directorPct", "responsablePct", "liderPct", "maestroPct", "ayudantePct",
    "finderMemberId", "responsableMemberId", "liderMemberId",
    "maestroMemberIds", "ayudanteMemberIds",
    "maestroCount", "ayudanteCount",
    "plannedEndDate", "actualEndDate", "bufferDays", "notes",
}


def _template_defaults() -> dict:
    return {
        "id": None, "projectId": None,
        "exitPrice": None, "investorCapital": None,
        "investorRateAnnual": 0.12, "investorMonths": None, "isrRate": 0.30,
        "finderFeePct": 0.0, "directorPct": 0.0, "responsablePct": 0.0,
        "liderPct": 0.0, "maestroPct": 0.0, "ayudantePct": 0.0,
        "finderMemberId": None, "responsableMemberId": None, "liderMemberId": None,
        "maestroMemberIds": [], "ayudanteMemberIds": [],
        "maestroCount": None, "ayudanteCount": None,
        "plannedEndDate": None, "actualEndDate": None, "bufferDays": 0, "notes": "",
    }


def _profit_row_to_dict(row) -> dict | None:
    if row is None:
        return None
    d = {_snake_to_camel(k): v for k, v in dict(row).items()}
    # Parse JSON list fields
    for field in ("maestroMemberIds", "ayudanteMemberIds"):
        val = d.get(field)
        if isinstance(val, str) and val:
            try:
                d[field] = json.loads(val)
            except json.JSONDecodeError:
                d[field] = []
        elif val is None:
            d[field] = []
    return d


def get_profit_template() -> dict:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM profit_split_config WHERE project_id IS NULL LIMIT 1"
        ).fetchone()
    if row:
        return _profit_row_to_dict(row)
    return _template_defaults()


def get_project_profit(project_id: int) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM profit_split_config WHERE project_id = %s", (project_id,)
        ).fetchone()

    if row:
        config = _profit_row_to_dict(row)
    else:
        config = {"projectId": project_id}

    template = get_profit_template()

    # Merge: template as base, overlay config fields where value is not None
    merged = dict(template)
    for k, v in config.items():
        if v is not None:
            merged[k] = v

    merged["projectId"] = project_id
    merged["id"] = config.get("id")  # None when project row not yet inserted
    return merged


def upsert_profit_template(data: dict) -> dict:
    return _upsert(None, data)


def upsert_project_profit(project_id: int, data: dict) -> dict:
    return _upsert(project_id, data)


def _upsert(project_id, data: dict) -> dict:
    # 1. Filter to only allowed raw fields
    filtered = {k: v for k, v in data.items() if k in PROFIT_RAW_FIELDS}

    # 2. Serialize list fields to JSON strings
    for field in ("maestroMemberIds", "ayudanteMemberIds"):
        if field in filtered and isinstance(filtered[field], list):
            filtered[field] = json.dumps(filtered[field])

    # 3. Convert camelCase keys to snake_case
    snake_data = {_camel_to_snake(k): v for k, v in filtered.items()}

    with get_db() as conn:
        # 4. Check if row exists
        existing = conn.execute(
            "SELECT id FROM profit_split_config WHERE project_id IS NOT DISTINCT FROM %s", (project_id,)
        ).fetchone()

        if existing:
            # 5. UPDATE
            if snake_data:
                columns = ", ".join(f"{col} = %s" for col in snake_data.keys())
                values = list(snake_data.values()) + [project_id]
                conn.execute(
                    f"UPDATE profit_split_config SET {columns} WHERE project_id IS NOT DISTINCT FROM %s",
                    values,
                )
        else:
            # 6. INSERT
            insert_data = {"project_id": project_id, **snake_data}
            columns = ", ".join(insert_data.keys())
            placeholders = ", ".join(["%s"] * len(insert_data))
            values = list(insert_data.values())
            conn.execute(
                f"INSERT INTO profit_split_config ({columns}) VALUES ({placeholders})",
                values,
            )

    # 7. Return the saved record
    if project_id is None:
        return get_profit_template()
    return get_project_profit(project_id)
