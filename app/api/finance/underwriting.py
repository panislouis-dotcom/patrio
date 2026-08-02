"""Property underwriting model — the single home for the cost stack and its
derived metrics. Exact-money in Decimal. Annualized ROI delegates to
finance.analysis.roi_cagr (float, correct tool for fractional powers).

Descends from the prospect_metrics view (migration 019) and still matches it
formula-for-formula except for cap_rate: as of 2026-07 cap rate is *yield on
cost* — gross annual rent over total investment — replacing the view's
rent*12*0.70 / projected_sale. One formula now serves prospects, projects and
the investor prospectus, and it answers the question an investor actually asks
("what does this yield on the money I put in?") without the fabricated 30% opex
haircut. The 0.70 factor is gone; net-of-opex cap rate belongs in the analyzer,
which models real NOI. rent_annual diverges from the view the same way: None
where the view reported 0, because a property that does not rent has no rent."""
from decimal import Decimal

from .quantize import money, money0, frac4, to_decimal
from .analysis import roi_cagr

_INPUT_KEYS = (
    "land_price", "acquisition_cost_pct", "permits_cost", "subdivision_cost",
    "sqm_construction", "construction_cost_per_sqm", "construction_overhead",
    "projected_sale", "hold_months", "rent_monthly", "sqm_land",
)

# The seven costs that make up the investment. Order matches investment_raw's
# signature so `investment()` can splat them.
BREAKDOWN_KEYS = (
    "land_price", "acquisition_cost_pct", "permits_cost", "subdivision_cost",
    "sqm_construction", "construction_cost_per_sqm", "construction_overhead",
)


def overhead_factor(construction_overhead) -> Decimal:
    """Construction overhead is a *multiplier* (1.3 = +30% indirect costs), so an
    absent or zero value means no surcharge — identity 1, never ×0, which would
    erase the construction the user explicitly captured. Contrast
    acquisition_cost_pct, an additive share whose identity is correctly 0."""
    return to_decimal(construction_overhead) or Decimal(1)


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
        * overhead_factor(construction_overhead)
    )


def has_breakdown(inputs: dict) -> bool:
    """True when all seven costs are captured — the only condition under which the
    system can recompute the investment itself instead of trusting a typed-in
    total. Mirrors the `desarrollo` branch of the 024 transition trigger; the
    domain layer turns it into `investmentBasis`."""
    return all(inputs.get(k) is not None for k in BREAKDOWN_KEYS)


def investment(inputs: dict) -> Decimal:
    """Unrounded cost total from a raw-inputs dict — investment_raw, keyed."""
    return investment_raw(*(inputs.get(k) for k in BREAKDOWN_KEYS))


def basis(inputs: dict) -> Decimal | None:
    """The capital base: the money in, unrounded so everything derived from it
    rounds exactly once.

    Two resolutions and only two — the pair migration 024's trigger accepts: the
    complete breakdown (the system recomputes and owns the total) or the
    manually captured `total_investment`. None means neither exists, which is
    precisely what the `desarrollo` stage refuses to accept."""
    if has_breakdown(inputs):
        return investment(inputs)
    total = inputs.get("total_investment")
    return to_decimal(total) if total is not None else None


def basis_kind(inputs: dict) -> str:
    """Where basis() came from — the one thing a reader needs in order to know
    how much to trust the total."""
    return "underwriting" if has_breakdown(inputs) else "manual"


def gain(basis, exit_value) -> Decimal | None:
    """Money made over an investment basis, in whole pesos. None unless both sides
    are positive: an exit value of 0 means "not captured" everywhere in this
    domain (a modeled sale that does not exist, a valuation nobody made), and
    subtracting from it would report the entire investment as a loss.

    One expression for all three exits — projected sale, current valuation,
    sale price — so projectedProfit, unrealizedGain and realizedGain can never
    drift apart."""
    b = to_decimal(basis)
    e = to_decimal(exit_value)
    if b <= 0 or e <= 0:
        return None
    return money0(e - b)


def gain_pct(basis, exit_value) -> Decimal | None:
    """gain() as a fraction of the basis — the simple (non-annualized) return.
    None, never 0, when it cannot be computed: 0 would read as "broke even"."""
    b = to_decimal(basis)
    e = to_decimal(exit_value)
    if b <= 0 or e <= 0:
        return None
    return frac4((e - b) / b)


def rent_annual(rent_monthly) -> Decimal | None:
    """Gross annual rent in whole pesos, or None when the property does not rent."""
    rent = to_decimal(rent_monthly)
    return money0(rent * Decimal(12)) if rent > 0 else None


def cap_rate(rent_monthly, total_investment) -> Decimal | None:
    """Yield on cost: gross annual rent / total investment. None unless both sides
    are positive — a property that does not rent has no cap rate, and 0 would read
    as a real (terrible) yield."""
    rent = to_decimal(rent_monthly)
    inv = to_decimal(total_investment)
    if rent <= 0 or inv <= 0:
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
    ovh = overhead_factor(g["construction_overhead"])
    ps = to_decimal(g["projected_sale"])
    sqm_land = to_decimal(g["sqm_land"])
    hold = g["hold_months"]

    roi = roi_cagr(inv_raw, ps, hold)

    return {
        "acquisition_costs": money0(lp * acq),
        "acquisition_total": money0(lp * (Decimal(1) + acq)),
        "construction_base": money0(sqm_c * cps),
        "construction_total": money0(sqm_c * cps * ovh),
        "total_investment": money0(inv_raw),
        "profit": gain(inv_raw, ps),
        "roi": frac4(roi) if roi is not None else None,
        "roi_total": gain_pct(inv_raw, ps),
        "cap_rate": cap_rate(g["rent_monthly"], inv_raw),
        "land_price_per_sqm": money(lp / sqm_land) if sqm_land > 0 else None,
        "sale_per_sqm": money(ps / sqm_land) if sqm_land > 0 else None,
        "investment_per_sqm": money(inv_raw / sqm_land) if sqm_land > 0 else None,
        "rent_annual": rent_annual(g["rent_monthly"]),
    }
