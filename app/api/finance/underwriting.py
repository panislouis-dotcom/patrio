"""Property underwriting model — the single home for the cost stack and its
derived metrics. Exact-money in Decimal. Annualized ROI delegates to
finance.analysis.roi_cagr (float, correct tool for fractional powers).

The cost stack answers one question and answers it once:

    precio de COMPRA  +  costos de adquisición  +  permisos  +  subdivisión
                      +  obra A EJECUTAR

That expression is the *only* way this system knows what a property cost. There
used to be a second one — a total typed in by hand — and two ways to answer one
question is one way too many: every reader had to be told which of the two it
was looking at, and when they disagreed somebody had to pick a winner. A missing
component is worth 0, so the sum is always defined, and a sum of 0 means nobody
has captured anything yet (see `basis`).

`purchase_price` is what you pay to take the building as it stands — a bare lot
or a finished house, no special case per asset type. The construction terms are
the work *you* will do afterwards (`sqm_construction` × `construction_cost_per_sqm`
× overhead): a remodel, an extension, a ground-up build. Nothing already paid
for inside the purchase price appears again in them, which is what stops a built
house from being counted twice.

Three of the inputs are ASSUMPTIONS, not costs: `acquisition_cost_pct`,
`construction_overhead` and `hold_months`. They are never stored at capture
time, so NULL means "nobody chose one — the model applies its default" and a
stored value means "a person captured this". The defaults live here, in one
place, and every reader gets them together with their provenance, because a
number that moves money has to be visible to whoever reads the money.

Descends from the prospect_metrics view (migration 019) and still matches it
formula-for-formula except for cap_rate: as of 2026-07 cap rate is *yield on
cost* — gross annual rent over total investment — replacing the view's
rent*12*0.70 / projected_sale. One formula now serves prospects, projects and
the investor prospectus, and it answers the question an investor actually asks
("what does this yield on the money I put in?") without the fabricated 30% opex
haircut. The 0.70 factor is gone; net-of-opex cap rate belongs in the analyzer,
which models real NOI. rent_annual diverges from the view the same way: None
where the view reported 0, because a property that does not rent has no rent.
"""
from decimal import Decimal

from .quantize import money, money0, frac4, to_decimal
from .analysis import roi_cagr

# The five COSTS. Together they ARE the investment — there is no other way to
# state it, and no total that can disagree with them. A missing one is worth 0,
# so the sum is always defined and the stack is never "incomplete".
# Order matches investment_raw's cost parameters so `investment()` can splat them.
COST_KEYS = (
    "purchase_price", "permits_cost", "subdivision_cost",
    "sqm_construction", "construction_cost_per_sqm",
)

# The three ASSUMPTIONS and what the model applies when nobody chose. They are
# deliberately absent from the capture defaults: writing 0.065 into the column
# at birth makes "the system assumed it" indistinguishable from "somebody picked
# it", and these three produce visible money and a visible deadline.
ASSUMPTION_DEFAULTS: dict[str, Decimal | int] = {
    "acquisition_cost_pct": Decimal("0.065"),
    "construction_overhead": Decimal("1.3"),
    "hold_months": 12,
}

ASSUMPTION_KEYS = tuple(ASSUMPTION_DEFAULTS)

_INPUT_KEYS = COST_KEYS + ASSUMPTION_KEYS + (
    "projected_sale", "rent_monthly_projected", "rent_monthly_actual", "sqm_land",
)


def assumption(inputs: dict, key: str):
    """The assumption in force and where it came from: the captured value, or
    the model's default when the column is empty."""
    value = inputs.get(key)
    return (ASSUMPTION_DEFAULTS[key], "default") if value is None else (value, "captured")


def assumptions(inputs: dict) -> dict[str, dict]:
    """Every assumption with its value and its provenance, keyed by column. The
    read path turns this into the payload the ficha shows *always* — not only in
    edit mode — so no figure on screen is computed from a number nobody can see."""
    out = {}
    for key in ASSUMPTION_KEYS:
        value, source = assumption(inputs, key)
        out[key] = {"value": value, "source": source}
    return out


def overhead_factor(construction_overhead) -> Decimal:
    """Construction overhead is a *multiplier* (1.3 = +30% indirect costs), so a
    captured zero means no surcharge — identity 1, never ×0, which would erase
    the construction the user explicitly captured. Contrast acquisition_cost_pct,
    an additive share whose identity is correctly 0. An *absent* overhead is not
    handled here: it resolves to the default before it ever gets this far."""
    return to_decimal(construction_overhead) or Decimal(1)


def investment_raw(purchase_price, acquisition_cost_pct, permits_cost, subdivision_cost,
                   sqm_construction, construction_cost_per_sqm, construction_overhead) -> Decimal:
    """Unrounded COST expression — the single source every metric derives from.
    Pure arithmetic: the assumptions arrive already resolved."""
    pp = to_decimal(purchase_price)
    acq = to_decimal(acquisition_cost_pct)
    return (
        pp * (Decimal(1) + acq)
        + to_decimal(permits_cost)
        + to_decimal(subdivision_cost)
        + to_decimal(sqm_construction) * to_decimal(construction_cost_per_sqm)
        * overhead_factor(construction_overhead)
    )


def investment(inputs: dict) -> Decimal:
    """Unrounded cost total from a raw-inputs dict, with the assumptions in
    force resolved — investment_raw, keyed."""
    return investment_raw(
        inputs.get("purchase_price"),
        assumption(inputs, "acquisition_cost_pct")[0],
        inputs.get("permits_cost"),
        inputs.get("subdivision_cost"),
        inputs.get("sqm_construction"),
        inputs.get("construction_cost_per_sqm"),
        assumption(inputs, "construction_overhead")[0],
    )


def basis(inputs: dict) -> Decimal | None:
    """The capital base: the money in, unrounded so everything derived from it
    rounds exactly once.

    One resolution and only one — the cost stack. A capital base is never typed
    in and never disagrees with its own parts, so nothing downstream has to ask
    which of two numbers it is reading.

    Nothing is lost by dropping the hand-typed total. An all-in figure somebody
    would rather not break down is captured as `purchase_price` with
    `acquisition_cost_pct = 0`: same money, said in the one grammar left. What
    the explicit 0 buys is that an absent pct still means "apply the 6.5%
    default", and a total that already includes acquisition costs must not be
    surcharged again.

    None when the stack sums to zero — nobody captured anything. Zero is not a
    capital base: reporting it would let «—» turn into a $0 that reads as a
    measurement, and every ratio below already refuses to divide by it."""
    total = investment(inputs)
    return total if total > 0 else None


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
    """Gross annual rent in whole pesos, or None when the property does not rent.

    Which rent goes in is the caller's decision and a meaningful one: the
    projected rent answers "what did we underwrite?", the collected one answers
    "what are we earning?". They are two columns precisely so that one figure
    never silently stands for the other."""
    rent = to_decimal(rent_monthly)
    return money0(rent * Decimal(12)) if rent > 0 else None


def cap_rate(rent_monthly, total_investment) -> Decimal | None:
    """Yield on cost: gross annual rent / total investment. None unless both sides
    are positive — a property that does not rent has no cap rate, and 0 would read
    as a real (terrible) yield. Same rule as rent_annual about *which* rent."""
    rent = to_decimal(rent_monthly)
    inv = to_decimal(total_investment)
    if rent <= 0 or inv <= 0:
        return None
    return frac4(rent * Decimal(12) / inv)


def metrics(inputs: dict) -> dict:
    """Compute every prospect_metrics column from a raw-inputs dict (snake_case
    keys). Returns Decimal values (or None on guarded zero-division). The rent
    figures here are the PROJECTED ones: this is the underwriting stack."""
    g = {k: inputs.get(k) for k in _INPUT_KEYS}
    acq = to_decimal(assumption(inputs, "acquisition_cost_pct")[0])
    ovh = overhead_factor(assumption(inputs, "construction_overhead")[0])
    hold = assumption(inputs, "hold_months")[0]

    inv_raw = investment_raw(
        g["purchase_price"], acq, g["permits_cost"], g["subdivision_cost"],
        g["sqm_construction"], g["construction_cost_per_sqm"], ovh,
    )
    pp = to_decimal(g["purchase_price"])
    sqm_c = to_decimal(g["sqm_construction"])
    cps = to_decimal(g["construction_cost_per_sqm"])
    ps = to_decimal(g["projected_sale"])
    sqm_land = to_decimal(g["sqm_land"])

    roi = roi_cagr(inv_raw, ps, hold)

    return {
        "acquisition_costs": money0(pp * acq),
        "acquisition_total": money0(pp * (Decimal(1) + acq)),
        "construction_base": money0(sqm_c * cps),
        "construction_total": money0(sqm_c * cps * ovh),
        "total_investment": money0(inv_raw),
        "profit": gain(inv_raw, ps),
        "roi": frac4(roi) if roi is not None else None,
        "roi_total": gain_pct(inv_raw, ps),
        "cap_rate": cap_rate(g["rent_monthly_projected"], inv_raw),
        "purchase_price_per_sqm": money(pp / sqm_land) if sqm_land > 0 else None,
        "sale_per_sqm": money(ps / sqm_land) if sqm_land > 0 else None,
        "investment_per_sqm": money(inv_raw / sqm_land) if sqm_land > 0 else None,
        "rent_annual": rent_annual(g["rent_monthly_projected"]),
    }
