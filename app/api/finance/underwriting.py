"""Prospect/project underwriting model — the single home for the cost stack
and its derived metrics. Exact-money in Decimal. Annualized ROI delegates to
finance.analysis.roi_cagr (float, correct tool for fractional powers).

Descends from the prospect_metrics view (migration 019) and still matches it
formula-for-formula except for cap_rate: as of 2026-07 cap rate is *yield on
cost* — gross annual rent over total investment — replacing the view's
rent*12*0.70 / projected_sale. One formula now serves prospects, projects and
the investor prospectus, and it answers the question an investor actually asks
("what does this yield on the money I put in?") without the fabricated 30% opex
haircut. The 0.70 factor is gone; net-of-opex cap rate belongs in the analyzer,
which models real NOI."""
from decimal import Decimal

from .quantize import money, money0, frac4, to_decimal
from .analysis import roi_cagr

_INPUT_KEYS = (
    "land_price", "acquisition_cost_pct", "permits_cost", "subdivision_cost",
    "sqm_construction", "construction_cost_per_sqm", "construction_overhead",
    "projected_sale", "hold_months", "rent_monthly", "sqm_land",
)


def investment_raw(land_price, acquisition_cost_pct, permits_cost, subdivision_cost,
                   sqm_construction, construction_cost_per_sqm, construction_overhead) -> Decimal:
    """Unrounded COST expression — the single source every metric derives from."""
    lp = to_decimal(land_price)
    acq = to_decimal(acquisition_cost_pct)
    return (
        lp * (Decimal(1) + acq)
        + to_decimal(permits_cost)
        + to_decimal(subdivision_cost)
        + to_decimal(sqm_construction) * to_decimal(construction_cost_per_sqm)
        * to_decimal(construction_overhead)
    )


def cap_rate(rent_monthly, total_investment) -> Decimal | None:
    """Yield on cost: gross annual rent / total investment. None when either side
    is missing or zero — a property that does not rent has no cap rate, and 0 would
    read as a real (terrible) yield."""
    rent = to_decimal(rent_monthly)
    inv = to_decimal(total_investment)
    if rent == 0 or inv == 0:
        return None
    return frac4(rent * Decimal(12) / inv)


def metrics(inputs: dict) -> dict:
    """Compute every prospect_metrics column from a raw-inputs dict (snake_case
    keys). Returns Decimal values (or None on guarded zero-division)."""
    g = {k: inputs.get(k) for k in _INPUT_KEYS}
    inv_raw = investment_raw(
        g["land_price"], g["acquisition_cost_pct"], g["permits_cost"], g["subdivision_cost"],
        g["sqm_construction"], g["construction_cost_per_sqm"], g["construction_overhead"],
    )
    lp = to_decimal(g["land_price"])
    acq = to_decimal(g["acquisition_cost_pct"])
    sqm_c = to_decimal(g["sqm_construction"])
    cps = to_decimal(g["construction_cost_per_sqm"])
    ovh = to_decimal(g["construction_overhead"])
    ps = to_decimal(g["projected_sale"])
    sqm_land = to_decimal(g["sqm_land"])
    hold = g["hold_months"]

    roi = roi_cagr(inv_raw, ps, hold)
    simple = ((ps - inv_raw) / inv_raw) if (inv_raw > 0 and ps > 0) else None

    return {
        "acquisition_costs": money0(lp * acq),
        "acquisition_total": money0(lp * (Decimal(1) + acq)),
        "construction_base": money0(sqm_c * cps),
        "construction_total": money0(sqm_c * cps * ovh),
        "total_investment": money0(inv_raw),
        "profit": money0(ps - inv_raw),
        "roi": frac4(roi) if roi is not None else None,
        "roi_total": frac4(simple) if simple is not None else None,
        "cap_rate": cap_rate(g["rent_monthly"], inv_raw),
        "land_price_per_sqm": money(lp / sqm_land) if sqm_land > 0 else None,
        "sale_per_sqm": money(ps / sqm_land) if sqm_land > 0 else None,
        "investment_per_sqm": money(inv_raw / sqm_land) if sqm_land > 0 else None,
        "rent_annual": money0(to_decimal(g["rent_monthly"]) * Decimal(12)),
    }
