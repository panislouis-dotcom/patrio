import json
from datetime import date, timedelta

from .db import get_db, _snake_to_camel, _camel_to_snake

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


def compute_bonus_tier(config: dict, conclusion_date: str | None = None) -> float | None:
    """
    Returns 0.50, 0.25, 0.0, or None.
    None means: no config (can't determine tier).
    conclusion_date is YYYY-MM from the project, used as fallback when actualEndDate is absent.
    """
    planned = config.get("plannedEndDate")
    buffer = config.get("bufferDays") or 0
    if not planned or buffer <= 0:
        return None  # no colchón configured

    actual_raw = config.get("actualEndDate") or conclusion_date
    if not actual_raw:
        return None  # project not concluded yet

    # Normalize: YYYY-MM → YYYY-MM-01 for date comparison
    actual_str = actual_raw + "-01" if len(actual_raw) == 7 else actual_raw
    planned_str = planned + "-01" if len(planned) == 7 else planned

    p = date.fromisoformat(planned_str)
    a = date.fromisoformat(actual_str)
    early_threshold = p - timedelta(days=buffer)
    half_threshold = p - timedelta(days=buffer // 2)

    if a <= early_threshold:
        return 0.50
    if a <= half_threshold:
        return 0.25
    return 0.0


def _compute_splits_for_tier(
    tier: float,
    finder_amount: float,
    director_amount: float,
    responsable_amount: float,
    lider_amount: float,
    maestro_pool: float,
    ayudante_pool: float,
    residual: float,
    config: dict,
    team_by_id: dict,
    directors: list,
    m_count: int,
    a_count: int,
    maestro_ids: list,
    ayudante_ids: list,
) -> dict:
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

    splits = []

    # Finder — no bonus regardless of tier
    finder_id = config.get("finderMemberId")
    if finder_id is not None:
        splits.append(_entry("Finder", finder_id, config.get("finderFeePct") or 0, finder_amount, 0))

    # Directors
    if directors:
        n = len(directors)
        per_base = director_amount / n
        per_bonus = (director_amount * tier) / n
        for d in directors:
            splits.append(_entry(
                "Director", d["id"],
                (config.get("directorPct") or 0) / n,
                per_base, per_bonus,
            ))

    # Responsable
    responsable_id = config.get("responsableMemberId")
    if responsable_id is not None:
        bonus = responsable_amount * tier
        splits.append(_entry(
            "Responsable", responsable_id,
            config.get("responsablePct") or 0,
            responsable_amount, bonus,
        ))

    # Líder
    lider_id = config.get("liderMemberId")
    if lider_id is not None:
        bonus = lider_amount * tier
        splits.append(_entry(
            "Líder", lider_id,
            config.get("liderPct") or 0,
            lider_amount, bonus,
        ))

    # Maestros (named + anonymous)
    mc_val = config.get("maestroCount")
    if maestro_ids or (mc_val is not None and mc_val > 0):
        per_base = maestro_pool / m_count
        per_bonus = (maestro_pool * tier) / m_count
        for mid in maestro_ids:
            splits.append(_entry(
                "Maestro", mid,
                (config.get("maestroPct") or 0) / m_count,
                per_base, per_bonus,
            ))
        for _ in range(m_count - len(maestro_ids)):
            splits.append({
                "label": "Maestro", "pct": (config.get("maestroPct") or 0) / m_count,
                "id": None, "name": "—", "role": "maestro",
                "base": per_base, "bonus": per_bonus, "total": per_base + per_bonus,
            })

    # Ayudantes (named + anonymous)
    ac_val = config.get("ayudanteCount")
    if ayudante_ids or (ac_val is not None and ac_val > 0):
        per_base = ayudante_pool / a_count
        per_bonus = (ayudante_pool * tier) / a_count
        for aid in ayudante_ids:
            splits.append(_entry(
                "Ayudante", aid,
                (config.get("ayudantePct") or 0) / a_count,
                per_base, per_bonus,
            ))
        for _ in range(a_count - len(ayudante_ids)):
            splits.append({
                "label": "Ayudante", "pct": (config.get("ayudantePct") or 0) / a_count,
                "id": None, "name": "—", "role": "ayudante",
                "base": per_base, "bonus": per_bonus, "total": per_base + per_bonus,
            })

    total_bonuses = sum(s["bonus"] for s in splits)
    company_residual = residual - total_bonuses
    return {"splits": splits, "companyResidual": company_residual}


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
    residual = max(0.0, distributable - allocated)

    team_by_id = {m["id"]: m for m in team}
    directors = [m for m in team if m.get("role") == "director"]

    maestro_ids = config.get("maestroMemberIds") or []
    mc = config.get("maestroCount")
    m_count = max(1, mc if (mc is not None and mc > 0) else (len(maestro_ids) or 1))
    m_count = max(m_count, len(maestro_ids))

    ayudante_ids = config.get("ayudanteMemberIds") or []
    ac = config.get("ayudanteCount")
    a_count = max(1, ac if (ac is not None and ac > 0) else (len(ayudante_ids) or 1))
    a_count = max(a_count, len(ayudante_ids))

    shared = dict(
        finder_amount=finder_amount,
        director_amount=director_amount,
        responsable_amount=responsable_amount,
        lider_amount=lider_amount,
        maestro_pool=maestro_pool,
        ayudante_pool=ayudante_pool,
        residual=residual,
        config=config,
        team_by_id=team_by_id,
        directors=directors,
        m_count=m_count,
        a_count=a_count,
        maestro_ids=maestro_ids,
        ayudante_ids=ayudante_ids,
    )

    scenarios = {
        "sin_bono": _compute_splits_for_tier(tier=0.0, **shared),
        "bono_25":  _compute_splits_for_tier(tier=0.25, **shared),
        "bono_50":  _compute_splits_for_tier(tier=0.50, **shared),
    }

    active_tier = compute_bonus_tier(config, project.get("conclusionDate"))

    return {
        "exitPrice": exit_price,
        "investment": investment,
        "grossProfit": gross_profit,
        "investorCuota": investor_cuota,
        "operatorGross": operator_gross,
        "isr": isr,
        "netProfit": net_profit,
        "distributable": distributable,
        "activeTier": active_tier,
        "scenarios": scenarios,
    }
