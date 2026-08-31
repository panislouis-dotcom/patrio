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
or a finished house, no special case per asset type. `construction_budgeted` is
the work *you* will do afterwards: a remodel, an extension, a ground-up build.
Nothing already paid for inside the purchase price appears again in it, which is
what stops a built house from being counted twice.

That construction term used to be a formula — `sqm_construction` ×
`construction_cost_per_sqm` × overhead — and is now the SUM OF THE WORK BUDGET
(`budget_lines`), in every stage and without a branch. The formula survives only
as a calculator that produces the budget's first line at capture time, so the
30% overhead is applied exactly ONCE, there, and lives inside the amount from
then on. Applying it again here would inflate every construction cost by 30%
with nothing looking broken — which is why this module no longer knows the word
«overhead» and no longer takes a multiplier it could re-apply.

Six of the inputs are ASSUMPTIONS, not costs: `acquisition_cost_pct` and
`hold_months`, plus the four commission/exit assumptions the fund's fee
structure needs (`land_commission_pct`, `construction_commission_pct`,
`exit_sale_commission_pct`, `exit_rent_months`). They are never stored at
capture time, so NULL means "nobody chose one — the model applies its default"
and a stored value means "a person captured this". The defaults live here, in
one place, and every reader gets them together with their provenance, because a
number that moves money has to be visible to whoever reads the money.

Descends from the prospect_metrics view (migration 019) and still matches it
formula-for-formula except for cap_rate: as of 2026-08 cap rate is the
textbook definition again — gross annual rent over MARKET VALUE (projected
sale), not over cost. It briefly lived as *yield on cost* (rent / total
investment, 2026-07 through 2026-08): dropping the view's fabricated 30% opex
haircut was correct, but dropping the value denominator along with it wasn't —
"yield on cost" answers a real question ("what does this return on the money I
put in?") but it isn't a cap rate, and calling it one read as wrong to anyone
who knows the term. Cap rate now means NOI / value again, still gross (no opex
haircut — net-of-opex belongs in the analyzer, which models real NOI). capRate
and capRateActual each pick the value that matches their rent — projected sale
for the modeled rent, current valuation for the collected one — rather than
sharing one denominator (see properties_db.py). rent_annual diverges from the
view the same way: None where the view reported 0, because a property that
does not rent has no rent.

Yield on cost did not disappear — it lives on as its own field, `yieldOnCost`
(properties_db.py), fed by this same `cap_rate()` with the investment as its
`market_value` argument instead of a market value. The function does not care
what its second argument represents; the two readings are kept apart by NAME,
not by two functions doing the same division.
"""
from decimal import Decimal, ROUND_HALF_UP

from .quantize import money, money0, frac4, to_decimal
from .analysis import roi_cagr

# The four COSTS. Together they ARE the investment — there is no other way to
# state it, and no total that can disagree with them. A missing one is worth 0,
# so the sum is always defined and the stack is never "incomplete".
#
# They were five while the work was priced by a formula. Now the work arrives as
# one figure —the budget's sum— so the term that used to need two columns and a
# multiplier needs one number. Fewer inputs, same money.
# Order matches investment_raw's cost parameters so `investment()` can splat them.
COST_KEYS = (
    "purchase_price", "permits_cost", "subdivision_cost", "construction_budgeted",
)

# The six ASSUMPTIONS — acquisition cost, hold period, and the fund's four
# commission/exit assumptions — and what the model applies when nobody chose.
# They are deliberately absent from the capture defaults: writing 0.065 into
# the column at birth makes "the system assumed it" indistinguishable from
# "somebody picked it", and both produce visible money or a visible deadline.
#
# `construction_overhead` used to be one of them and is gone: it multiplies
# nothing here any more. An assumption that moves no money is not an
# assumption, and leaving it published would be a field the ficha shows and
# nothing reads.
ASSUMPTION_DEFAULTS: dict[str, Decimal | int] = {
    "acquisition_cost_pct": Decimal("0.065"),
    "hold_months": 12,
    # Comisiones del fondo — ver finance/fees.py, que es quien de verdad las
    # aplica. Viven aquí y no allá por la misma regla que las dos de arriba:
    # un solo lugar con nombre para todo default que mueve dinero.
    "land_commission_pct": Decimal("0.05"),
    "construction_commission_pct": Decimal("0.15"),
    "exit_sale_commission_pct": Decimal("0.05"),
    "exit_rent_months": Decimal("3"),
    # Default de la escalera de renta (finance/fee_tiers.py) cuando la propiedad no
    # tiene tramos configurados. No sustituye a exit_rent_months arriba —esa key
    # queda huérfana hasta la migración de limpieza que la retira del schema— es la
    # tasa que reemplaza el mecanismo de "N meses de renta" por "% de un mes de
    # renta", igual que exit_sale_commission_pct para el lado de venta. Sin default
    # previo que heredar: se elige 5% para arrancar en el mismo punto que venta.
    "exit_rent_commission_pct": Decimal("0.05"),
}

# exit_rent_commission_pct vive en ASSUMPTION_DEFAULTS porque ahí es donde vive todo
# default que mueve dinero (mismo criterio de la nota de comisiones), pero no es un
# input capturable de la propiedad — no tiene columna en `properties`, nadie lo
# "captura", y por eso no debe aparecer como séptimo campo en assumptions()/la
# respuesta de properties_db.py ("captured vs default" es un concepto de columnas de
# propiedad, y esta key no es una). finance/fee_tiers.py lo lee directo de
# ASSUMPTION_DEFAULTS, sin pasar por assumption()/ASSUMPTION_KEYS.
#
# Exclusión explícita en vez de una tupla escrita a mano: así cualquier assumption
# legítima que se agregue después a ASSUMPTION_DEFAULTS sigue apareciendo aquí sola,
# sin que alguien tenga que acordarse de tocar dos lugares — solo esta única
# excepción deliberada queda nombrada.
_MODEL_ONLY_DEFAULTS = frozenset({"exit_rent_commission_pct"})
ASSUMPTION_KEYS = tuple(k for k in ASSUMPTION_DEFAULTS if k not in _MODEL_ONLY_DEFAULTS)

_INPUT_KEYS = COST_KEYS + ASSUMPTION_KEYS + (
    "projected_sale", "rent_monthly_projected", "rent_monthly_actual", "sqm_land",
    # Metraje FÍSICO de la obra a ejecutar. Ya no pone precio a nada —lo pone el
    # presupuesto— y sobrevive porque el analizador de mercado y el PDF lo leen,
    # y porque es el divisor del costo por m² derivado.
    "sqm_construction",
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


def investment_raw(purchase_price, acquisition_cost_pct, permits_cost, subdivision_cost,
                   construction_budgeted) -> Decimal:
    """Unrounded COST expression — the single source every metric derives from.
    Pure arithmetic: the assumptions arrive already resolved.

    `construction_budgeted` enters already whole. No factor is applied to it
    here, in any stage, for any property: the overhead was applied once when the
    budget was seeded and multiplying again would silently add 30% to the cost
    of work somebody already priced."""
    pp = to_decimal(purchase_price)
    acq = to_decimal(acquisition_cost_pct)
    return (
        pp * (Decimal(1) + acq)
        + to_decimal(permits_cost)
        + to_decimal(subdivision_cost)
        + to_decimal(construction_budgeted)
    )


def investment(inputs: dict) -> Decimal:
    """Unrounded cost total from a raw-inputs dict, with the assumptions in
    force resolved — investment_raw, keyed."""
    return investment_raw(
        inputs.get("purchase_price"),
        assumption(inputs, "acquisition_cost_pct")[0],
        inputs.get("permits_cost"),
        inputs.get("subdivision_cost"),
        inputs.get("construction_budgeted"),
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


def cap_rate(rent_monthly, market_value) -> Decimal | None:
    """Gross annual rent / market_value. Named for its usual caller (capRate,
    capRateActual: `market_value` is whichever value figure matches the rent —
    projected sale for the modeled rent, current valuation for the collected
    one, proyectado against proyectado, real against real, never a real number
    measured against a still-hypothetical exit price), but the division itself
    doesn't know or care whether `market_value` is a market value at all:
    `yieldOnCost` (properties_db.py) calls this same function with the
    investment instead, on purpose — same shape (NOI over SOME denominator),
    different question. None unless both sides are positive — a property that
    does not rent, or has nothing captured to measure against, yields nothing,
    and 0 would read as a real (terrible) return. Same rule as rent_annual
    about *which* rent."""
    rent = to_decimal(rent_monthly)
    value = to_decimal(market_value)
    if rent <= 0 or value <= 0:
        return None
    return frac4(rent * Decimal(12) / value)


def payback_months(rent_monthly, investment) -> Decimal | None:
    """Meses de renta —sin anualizar— para recuperar una inversión: investment /
    rent_monthly, directo en meses porque el divisor ya es mensual (a
    diferencia de cap_rate(), que anualiza la renta para comparar contra un
    valor). None unless both sides are positive — sin renta no hay con qué
    recuperar nada, y 0 se leería como recuperación instantánea. Redondeado al
    mes entero: el mismo lenguaje que ya usan holdMonths y exitRentMonths, que
    tampoco hablan en fracciones de mes."""
    rent = to_decimal(rent_monthly)
    inv = to_decimal(investment)
    if rent <= 0 or inv <= 0:
        return None
    return (inv / rent).quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def metrics(inputs: dict) -> dict:
    """Compute every prospect_metrics column from a raw-inputs dict (snake_case
    keys). Returns Decimal values (or None on guarded zero-division). The rent
    figures here are the PROJECTED ones: this is the underwriting stack."""
    g = {k: inputs.get(k) for k in _INPUT_KEYS}
    acq = to_decimal(assumption(inputs, "acquisition_cost_pct")[0])
    hold = assumption(inputs, "hold_months")[0]

    inv_raw = investment_raw(
        g["purchase_price"], acq, g["permits_cost"], g["subdivision_cost"],
        g["construction_budgeted"],
    )
    pp = to_decimal(g["purchase_price"])
    ps = to_decimal(g["projected_sale"])
    sqm_land = to_decimal(g["sqm_land"])

    roi = roi_cagr(inv_raw, ps, hold)

    return {
        "acquisition_costs": money0(pp * acq),
        "acquisition_total": money0(pp * (Decimal(1) + acq)),
        # La obra no se restaura aquí: llega entera y la publica el módulo del
        # presupuesto, junto a lo comprometido y lo pagado contra ella. Dos
        # lugares que dijeran el mismo peso serían dos lugares que pueden
        # diferir.
        "total_investment": money0(inv_raw),
        "profit": gain(inv_raw, ps),
        "roi": frac4(roi) if roi is not None else None,
        "roi_total": gain_pct(inv_raw, ps),
        "cap_rate": cap_rate(g["rent_monthly_projected"], ps),
        "purchase_price_per_sqm": money(pp / sqm_land) if sqm_land > 0 else None,
        "sale_per_sqm": money(ps / sqm_land) if sqm_land > 0 else None,
        "investment_per_sqm": money(inv_raw / sqm_land) if sqm_land > 0 else None,
        "rent_annual": rent_annual(g["rent_monthly_projected"]),
    }
