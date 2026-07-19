"""Profit-split waterfall — Decimal port of the former profit_db logic.
Money exact; ratios (tier, isr, split pcts) coerced to Decimal."""
from datetime import date, timedelta
from decimal import Decimal

from .quantize import to_decimal
from .investor import cuota

_D0 = Decimal(0)


def compute_bonus_tier(config: dict, conclusion_date: str | None = None) -> Decimal | None:
    """0.50 / 0.25 / 0.0 / None (None = cannot determine)."""
    planned = config.get("plannedEndDate")
    buffer = config.get("bufferDays") or 0
    if not planned or buffer <= 0:
        return None
    actual_raw = config.get("actualEndDate") or conclusion_date
    if not actual_raw:
        return None
    actual_str = actual_raw + "-01" if len(actual_raw) == 7 else actual_raw
    planned_str = planned + "-01" if len(planned) == 7 else planned
    p = date.fromisoformat(planned_str)
    a = date.fromisoformat(actual_str)
    early_threshold = p - timedelta(days=buffer)
    half_threshold = p - timedelta(days=buffer // 2)
    if a <= early_threshold:
        return Decimal("0.50")
    if a <= half_threshold:
        return Decimal("0.25")
    return _D0


def _pct(config: dict, key: str) -> Decimal:
    return to_decimal(config.get(key) or 0)


def _compute_splits_for_tier(tier, finder_amount, director_amount, responsable_amount,
                             lider_amount, maestro_pool, ayudante_pool, residual, config,
                             team_by_id, directors, m_count, a_count, maestro_ids, ayudante_ids) -> dict:
    def _entry(label, member_id, pct, base, bonus):
        member = team_by_id.get(member_id) or {}
        return {"label": label, "id": member_id, "name": member.get("name"),
                "role": member.get("role"), "pct": pct, "base": base, "bonus": bonus,
                "total": base + bonus}

    splits = []
    finder_id = config.get("finderMemberId")
    if finder_id is not None:
        splits.append(_entry("Finder", finder_id, _pct(config, "finderFeePct"),
                             finder_amount, finder_amount * tier))
    if directors:
        n = Decimal(len(directors))
        per_base = director_amount / n
        per_bonus = (director_amount * tier) / n
        for d in directors:
            splits.append(_entry("Director", d["id"], _pct(config, "directorPct") / n, per_base, per_bonus))
    responsable_id = config.get("responsableMemberId")
    if responsable_id is not None:
        splits.append(_entry("Responsable", responsable_id, _pct(config, "responsablePct"),
                             responsable_amount, responsable_amount * tier))
    lider_id = config.get("liderMemberId")
    if lider_id is not None:
        splits.append(_entry("Líder", lider_id, _pct(config, "liderPct"),
                             lider_amount, lider_amount * tier))
    mc_val = config.get("maestroCount")
    if maestro_ids or (mc_val is not None and mc_val > 0):
        mc = Decimal(m_count)
        per_base = maestro_pool / mc
        per_bonus = (maestro_pool * tier) / mc
        for mid in maestro_ids:
            splits.append(_entry("Maestro", mid, _pct(config, "maestroPct") / mc, per_base, per_bonus))
        for _ in range(m_count - len(maestro_ids)):
            splits.append({"label": "Maestro", "pct": _pct(config, "maestroPct") / mc, "id": None,
                           "name": "—", "role": "maestro", "base": per_base, "bonus": per_bonus,
                           "total": per_base + per_bonus})
    ac_val = config.get("ayudanteCount")
    if ayudante_ids or (ac_val is not None and ac_val > 0):
        ac = Decimal(a_count)
        per_base = ayudante_pool / ac
        per_bonus = (ayudante_pool * tier) / ac
        for aid in ayudante_ids:
            splits.append(_entry("Ayudante", aid, _pct(config, "ayudantePct") / ac, per_base, per_bonus))
        for _ in range(a_count - len(ayudante_ids)):
            splits.append({"label": "Ayudante", "pct": _pct(config, "ayudantePct") / ac, "id": None,
                           "name": "—", "role": "ayudante", "base": per_base, "bonus": per_bonus,
                           "total": per_base + per_bonus})
    total_bonuses = sum((s["bonus"] for s in splits), _D0)
    company_residual = max(_D0, residual - total_bonuses)
    return {"splits": splits, "companyResidual": company_residual}


def compute_waterfall(project: dict, config: dict, team: list[dict],
                      project_investors: list[dict] = None) -> dict:
    investment = to_decimal(project.get("totalInvestment") or 0)
    exit_price = to_decimal(config.get("exitPrice") or project.get("currentValuation") or 0)
    months = config.get("investorMonths") or project.get("holdMonthsActual") or 12
    isr_rate = to_decimal(config.get("isrRate") or 0.30)

    if config.get("investorCapital"):
        investor_capital = to_decimal(config["investorCapital"])
        rate = config.get("investorRateAnnual") or 0.12
        investor_cuota = cuota(investor_capital, rate, months)
        investor_breakdown = [{"investorId": None, "name": "Capital (manual)",
                               "fundedAmount": investor_capital, "interestRateAnnual": rate,
                               "cuota": investor_cuota, "totalReturn": investor_capital + investor_cuota}]
    else:
        fondeados = [pi for pi in (project_investors or []) if pi.get("status") == "fondeado"]
        if fondeados:
            investor_capital = sum((to_decimal(pi.get("fundedAmount")) for pi in fondeados), _D0)
            investor_cuota = sum(
                (cuota(pi.get("fundedAmount") or 0, pi.get("interestRateAnnual") or 0.12, months)
                 for pi in fondeados), _D0)
            investor_breakdown = [{
                "investorId": pi.get("investorId"), "name": pi.get("investorName", "—"),
                "fundedAmount": to_decimal(pi.get("fundedAmount")),
                "interestRateAnnual": pi.get("interestRateAnnual") or 0.12,
                "cuota": cuota(pi.get("fundedAmount") or 0, pi.get("interestRateAnnual") or 0.12, months),
                "totalReturn": to_decimal(pi.get("fundedAmount"))
                + cuota(pi.get("fundedAmount") or 0, pi.get("interestRateAnnual") or 0.12, months),
            } for pi in fondeados]
        else:
            investor_capital = investment
            rate = config.get("investorRateAnnual") or 0.12
            investor_cuota = cuota(investor_capital, rate, months)
            investor_breakdown = [{"investorId": None, "name": "Inversión total (est.)",
                                   "fundedAmount": investment, "interestRateAnnual": rate,
                                   "cuota": investor_cuota, "totalReturn": investment + investor_cuota}]

    gross_profit = exit_price - investment
    operator_gross = gross_profit - investor_cuota
    isr = max(_D0, operator_gross * isr_rate)
    net_profit = operator_gross - isr
    distributable = max(_D0, net_profit)

    finder_amount = distributable * _pct(config, "finderFeePct")
    remaining = distributable - finder_amount
    director_amount = remaining * _pct(config, "directorPct")
    responsable_amount = remaining * _pct(config, "responsablePct")
    lider_amount = remaining * _pct(config, "liderPct")
    maestro_pool = remaining * _pct(config, "maestroPct")
    ayudante_pool = remaining * _pct(config, "ayudantePct")
    allocated = (finder_amount + director_amount + responsable_amount
                 + lider_amount + maestro_pool + ayudante_pool)
    residual = max(_D0, distributable - allocated)

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

    shared = dict(finder_amount=finder_amount, director_amount=director_amount,
                  responsable_amount=responsable_amount, lider_amount=lider_amount,
                  maestro_pool=maestro_pool, ayudante_pool=ayudante_pool, residual=residual,
                  config=config, team_by_id=team_by_id, directors=directors,
                  m_count=m_count, a_count=a_count, maestro_ids=maestro_ids, ayudante_ids=ayudante_ids)
    scenarios = {
        "sin_bono": _compute_splits_for_tier(tier=_D0, **shared),
        "bono_25": _compute_splits_for_tier(tier=Decimal("0.25"), **shared),
        "bono_50": _compute_splits_for_tier(tier=Decimal("0.50"), **shared),
    }
    active_tier = compute_bonus_tier(config, project.get("conclusionDate"))
    return {"exitPrice": exit_price, "investment": investment, "grossProfit": gross_profit,
            "investorCuota": investor_cuota, "operatorGross": operator_gross, "isr": isr,
            "netProfit": net_profit, "distributable": distributable, "activeTier": active_tier,
            "months": months, "investorBreakdown": investor_breakdown, "scenarios": scenarios}
