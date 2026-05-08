import json
from datetime import date, timedelta

from .db import get_db, _snake_to_camel, _camel_to_snake

PROFIT_RAW_FIELDS = {
    "exitPrice", "investorCapital", "investorRateAnnual", "investorMonths", "isrRate",
    "finderFeePct", "directorPct", "responsablePct", "liderPct", "maestroPct", "ayudantePct",
    "finderMemberId", "responsableMemberId", "liderMemberId",
    "maestroMemberIds", "ayudanteMemberIds",
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
            "SELECT * FROM profit_split_config WHERE project_id = ?", (project_id,)
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
            "SELECT id FROM profit_split_config WHERE project_id IS ?", (project_id,)
        ).fetchone()

        if existing:
            # 5. UPDATE
            if snake_data:
                columns = ", ".join(f"{col} = ?" for col in snake_data.keys())
                values = list(snake_data.values()) + [project_id]
                conn.execute(
                    f"UPDATE profit_split_config SET {columns} WHERE project_id IS ?",
                    values,
                )
        else:
            # 6. INSERT
            insert_data = {"project_id": project_id, **snake_data}
            columns = ", ".join(insert_data.keys())
            placeholders = ", ".join("?" * len(insert_data))
            values = list(insert_data.values())
            conn.execute(
                f"INSERT INTO profit_split_config ({columns}) VALUES ({placeholders})",
                values,
            )

    # 7. Return the saved record
    if project_id is None:
        return get_profit_template()
    return get_project_profit(project_id)


def compute_bonus_tier(config: dict) -> float:
    planned = config.get("plannedEndDate")
    actual = config.get("actualEndDate")
    buffer = config.get("bufferDays") or 0
    if not planned or not actual or not buffer:
        return 0.0
    p = date.fromisoformat(planned)
    a = date.fromisoformat(actual)
    early_threshold = p - timedelta(days=buffer)
    half_threshold = p - timedelta(days=buffer // 2)
    if a <= early_threshold:
        return 0.50
    if a <= half_threshold:
        return 0.25
    return 0.0


def compute_waterfall(project: dict, config: dict, team: list[dict]) -> dict:
    investment = project.get("totalInvestment") or 0
    exit_price = config.get("exitPrice") or project.get("currentValuation") or 0
    months = config.get("investorMonths") or project.get("holdMonthsActual") or 12
    investor_capital = config.get("investorCapital") or investment
    rate = config.get("investorRateAnnual") or 0.12
    isr_rate = config.get("isrRate") or 0.30

    investor_cuota = investor_capital * rate * (months / 12)
    gross_profit = exit_price - investment
    operator_gross = gross_profit - investor_cuota
    isr = max(0, operator_gross * isr_rate)
    net_profit = operator_gross - isr
    distributable = max(0, net_profit)

    finder_amount = distributable * (config.get("finderFeePct") or 0)
    remaining = distributable - finder_amount

    director_amount = remaining * (config.get("directorPct") or 0)
    responsable_amount = remaining * (config.get("responsablePct") or 0)
    lider_amount = remaining * (config.get("liderPct") or 0)
    maestro_pool = remaining * (config.get("maestroPct") or 0)
    ayudante_pool = remaining * (config.get("ayudantePct") or 0)
    allocated = (
        finder_amount + director_amount + responsable_amount
        + lider_amount + maestro_pool + ayudante_pool
    )
    residual = distributable - allocated

    bonus_tier = compute_bonus_tier(config)
    bonus_director = director_amount * bonus_tier
    bonus_responsable = responsable_amount * bonus_tier
    bonus_lider = lider_amount * bonus_tier
    bonus_maestro = maestro_pool * bonus_tier
    bonus_ayudante = ayudante_pool * bonus_tier
    total_bonuses = (
        bonus_director + bonus_responsable + bonus_lider + bonus_maestro + bonus_ayudante
    )
    company_residual = residual - total_bonuses

    # Build a lookup map of team members by id
    team_by_id = {m["id"]: m for m in team}

    splits = []

    # Helper to build a split entry
    def _entry(label, member_id, pct, base, bonus):
        member = team_by_id.get(member_id) or {}
        return {
            "label": label,
            "id": member_id,
            "name": member.get("name"),
            "role": member.get("role"),
            "pct": pct,
            "base": base,
            "bonus": bonus,
            "total": base + bonus,
        }

    # Finder
    finder_id = config.get("finderMemberId")
    if finder_id is not None:
        splits.append(_entry("Finder", finder_id, config.get("finderFeePct") or 0, finder_amount, 0))

    # Directors — split equally among all directors on the team
    directors = [m for m in team if m.get("role") == "director"]
    if directors:
        n = len(directors)
        per_director_base = director_amount / n
        per_director_bonus = bonus_director / n
        for d in directors:
            splits.append(_entry(
                "Director", d["id"],
                (config.get("directorPct") or 0) / n,
                per_director_base,
                per_director_bonus,
            ))

    # Responsable
    responsable_id = config.get("responsableMemberId")
    if responsable_id is not None:
        splits.append(_entry(
            "Responsable", responsable_id,
            config.get("responsablePct") or 0,
            responsable_amount,
            bonus_responsable,
        ))

    # Líder
    lider_id = config.get("liderMemberId")
    if lider_id is not None:
        splits.append(_entry(
            "Líder", lider_id,
            config.get("liderPct") or 0,
            lider_amount,
            bonus_lider,
        ))

    # Maestros
    maestro_ids = config.get("maestroMemberIds") or []
    if maestro_ids:
        n = len(maestro_ids)
        per_base = maestro_pool / n
        per_bonus = bonus_maestro / n
        for mid in maestro_ids:
            splits.append(_entry(
                "Maestro", mid,
                (config.get("maestroPct") or 0) / n,
                per_base,
                per_bonus,
            ))

    # Ayudantes
    ayudante_ids = config.get("ayudanteMemberIds") or []
    if ayudante_ids:
        n = len(ayudante_ids)
        per_base = ayudante_pool / n
        per_bonus = bonus_ayudante / n
        for aid in ayudante_ids:
            splits.append(_entry(
                "Ayudante", aid,
                (config.get("ayudantePct") or 0) / n,
                per_base,
                per_bonus,
            ))

    return {
        "exitPrice": exit_price,
        "investment": investment,
        "grossProfit": gross_profit,
        "investorCuota": investor_cuota,
        "operatorGross": operator_gross,
        "isr": isr,
        "netProfit": net_profit,
        "distributable": distributable,
        "bonusTier": bonus_tier,
        "splits": splits,
        "companyResidual": company_residual,
        "totalAllocated": allocated + total_bonuses,
    }
