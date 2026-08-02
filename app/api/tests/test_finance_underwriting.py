from decimal import Decimal

from api.finance.quantize import money, money0, frac4, pct2, to_decimal


def test_to_decimal_from_float_is_exact():
    assert to_decimal(0.1) == Decimal("0.1")


def test_money0_rounds_half_away_from_zero_like_postgres():
    assert money0(Decimal("0.5")) == Decimal("1")
    assert money0(Decimal("2.5")) == Decimal("3")


def test_money_two_dp():
    assert money(Decimal("1234.005")) == Decimal("1234.01")


def test_frac4_four_dp():
    assert frac4(Decimal("0.12345")) == Decimal("0.1235")


def test_pct2_two_dp():
    assert pct2(Decimal("12.345")) == Decimal("12.35")


from api.finance import underwriting as uw

# Clean inputs (float-exact) so Decimal output matches the float4 SQL view byte-for-byte.
INPUTS = dict(
    land_price=1_000_000, acquisition_cost_pct=0.065,
    permits_cost=50_000, subdivision_cost=25_000,
    sqm_construction=200, construction_cost_per_sqm=9_000,
    construction_overhead=1.3, projected_sale=2_500_000,
    hold_months=18, rent_monthly=18_000, sqm_land=300,
)


def test_investment_raw_unrounded_single_expression():
    # 1_000_000*1.065 + 50_000 + 25_000 + 200*9_000*1.3 = 1_065_000 + 75_000 + 2_340_000
    assert uw.investment_raw(**{k: INPUTS[k] for k in (
        "land_price", "acquisition_cost_pct", "permits_cost", "subdivision_cost",
        "sqm_construction", "construction_cost_per_sqm", "construction_overhead")}
    ) == Decimal("3480000.000")


# Regression oracle: the exact figures the prospect_metrics view produced for INPUTS
# (locked here before the view was dropped in migration 020). A future change that
# breaks the round-of-sum discipline — summing pre-rounded sub-totals instead of the
# single unrounded investment_raw — would drift these by ~1 peso and fail.
# cap_rate is the one figure that no longer matches the old view: the 2026-07 formula
# change made it yield on cost (216,000 / 3,480,000 = 0.0621) instead of the view's
# rent*12*0.70 / projected_sale (0.0605).
_EXPECTED = {
    "total_investment": Decimal("3480000"),
    "acquisition_costs": Decimal("65000"),
    "acquisition_total": Decimal("1065000"),
    "construction_base": Decimal("1800000"),
    "construction_total": Decimal("2340000"),
    "profit": Decimal("-980000"),
    "cap_rate": Decimal("0.0621"),
    "land_price_per_sqm": Decimal("3333.33"),
    "sale_per_sqm": Decimal("8333.33"),
    "investment_per_sqm": Decimal("11600.00"),
    "rent_annual": Decimal("216000"),
    "roi": Decimal("-0.1979"),
    "roi_total": Decimal("-0.2816"),
}


def test_metrics_matches_locked_oracle(client, test_property):
    """finance.underwriting reproduces the figures the prospect_metrics view
    produced, reading a real properties row (the view itself is long gone)."""
    from api.db import get_db
    with get_db() as conn:
        conn.execute(
            """UPDATE properties SET land_price=%s, acquisition_cost_pct=%s, permits_cost=%s,
                   subdivision_cost=%s, sqm_construction=%s, construction_cost_per_sqm=%s,
                   construction_overhead=%s, projected_sale=%s, hold_months=%s,
                   rent_monthly=%s, sqm_land=%s WHERE id=%s""",
            (INPUTS["land_price"], INPUTS["acquisition_cost_pct"], INPUTS["permits_cost"],
             INPUTS["subdivision_cost"], INPUTS["sqm_construction"], INPUTS["construction_cost_per_sqm"],
             INPUTS["construction_overhead"], INPUTS["projected_sale"], INPUTS["hold_months"],
             INPUTS["rent_monthly"], INPUTS["sqm_land"], test_property["id"]))
        base = conn.execute("SELECT * FROM properties WHERE id=%s",
                            (test_property["id"],)).fetchone()

    m = uw.metrics(dict(base))
    for key, expected in _EXPECTED.items():
        assert m[key] == expected, f"{key}: {m[key]} != {expected}"


def test_metrics_zero_guards_return_none():
    m = uw.metrics(dict(
        land_price=0, acquisition_cost_pct=0, permits_cost=0, subdivision_cost=0,
        sqm_construction=0, construction_cost_per_sqm=0, construction_overhead=1,
        projected_sale=0, hold_months=0, rent_monthly=0, sqm_land=0,
    ))
    assert m["roi"] is None
    assert m["roi_total"] is None
    assert m["profit"] is None
    assert m["cap_rate"] is None
    assert m["rent_annual"] is None
    assert m["land_price_per_sqm"] is None


# ── The one gain, applied to three different exits ───────────────────────────

def test_gain_is_the_exit_minus_the_basis():
    assert uw.gain(3_480_000, 5_000_000) == Decimal("1520000")
    assert uw.gain_pct(3_480_000, 5_000_000) == Decimal("0.4368")


def test_a_loss_is_reported_as_a_loss():
    assert uw.gain(3_480_000, 2_500_000) == Decimal("-980000")
    assert uw.gain_pct(3_480_000, 2_500_000) == Decimal("-0.2816")


def test_no_exit_value_means_no_gain_never_zero():
    """0 means "not captured" for every exit in this domain — a modeled sale
    that does not exist, a valuation nobody made. Reporting 0 would claim the
    property broke even; reporting the negative would claim it lost everything."""
    for absent in (0, None):
        assert uw.gain(3_480_000, absent) is None
        assert uw.gain_pct(3_480_000, absent) is None


def test_no_basis_means_no_gain():
    for absent in (0, None):
        assert uw.gain(absent, 5_000_000) is None
        assert uw.gain_pct(absent, 5_000_000) is None


def test_the_breakdown_is_complete_only_with_all_seven():
    assert uw.has_breakdown(INPUTS)
    assert not uw.has_breakdown(dict(INPUTS, permits_cost=None))


def test_the_basis_prefers_the_breakdown_over_the_typed_total():
    """While the breakdown is complete the system owns the total; a stale manual
    figure must never win over it."""
    assert uw.basis(dict(INPUTS, total_investment=9_000_000)) == Decimal("3480000.000")
    assert uw.basis_kind(dict(INPUTS)) == "underwriting"


def test_without_a_breakdown_the_basis_is_the_typed_total():
    partial = dict(INPUTS, permits_cost=None, total_investment=9_000_000)
    assert uw.basis(partial) == Decimal("9000000")
    assert uw.basis_kind(partial) == "manual"


def test_with_neither_there_is_no_basis():
    assert uw.basis(dict(INPUTS, permits_cost=None)) is None


def test_cap_rate_is_yield_on_cost():
    # 18,000*12 = 216,000 over 3,480,000 invested
    assert uw.cap_rate(18_000, 3_480_000) == Decimal("0.0621")


def test_cap_rate_none_without_positive_investment():
    assert uw.cap_rate(18_000, 0) is None
    assert uw.cap_rate(18_000, None) is None
    assert uw.cap_rate(18_000, -3_480_000) is None


def test_cap_rate_none_without_positive_rent():
    assert uw.cap_rate(0, 3_480_000) is None
    assert uw.cap_rate(None, 3_480_000) is None
    assert uw.cap_rate(-18_000, 3_480_000) is None


def test_rent_annual_is_twelve_months_or_nothing():
    assert uw.rent_annual(18_000) == Decimal("216000")
    assert uw.rent_annual(0) is None
    assert uw.rent_annual(None) is None
    assert uw.rent_annual(-18_000) is None


_NO_OVERHEAD = dict(
    land_price=2_000_000, acquisition_cost_pct=None, permits_cost=None, subdivision_cost=None,
    sqm_construction=120, construction_cost_per_sqm=1_000, construction_overhead=None,
    projected_sale=None, hold_months=None, rent_monthly=None, sqm_land=None,
)


def test_absent_overhead_is_no_surcharge_not_no_construction():
    """Overhead multiplies construction, so its absence must read as ×1. Treating
    it as ×0 erased the 120,000 of construction the user explicitly captured."""
    assert uw.investment_raw(**{k: _NO_OVERHEAD[k] for k in (
        "land_price", "acquisition_cost_pct", "permits_cost", "subdivision_cost",
        "sqm_construction", "construction_cost_per_sqm", "construction_overhead")}
    ) == Decimal("2120000")


def test_zero_overhead_reads_like_an_absent_one():
    """0 is not a meaningful multiplier — the UI writes it for an empty field just
    as often as NULL, and both mean the same thing: no indirect-cost surcharge."""
    m = uw.metrics(dict(_NO_OVERHEAD, construction_overhead=0))
    assert m["total_investment"] == Decimal("2120000")
    assert m["construction_base"] == m["construction_total"] == Decimal("120000")


def test_overhead_still_multiplies_when_given():
    """The surcharge itself is untouched: 1.3 keeps costing +30%."""
    m = uw.metrics(dict(_NO_OVERHEAD, construction_overhead=1.3))
    assert m["construction_total"] == Decimal("156000")
    assert m["total_investment"] == Decimal("2156000")


def test_metrics_cap_rate_ignores_projected_sale():
    """The denominator is the cost stack, so changing the exit cannot move cap rate."""
    m = uw.metrics(dict(INPUTS))
    cheaper_exit = uw.metrics(dict(INPUTS, projected_sale=1_000_000))
    assert cheaper_exit["cap_rate"] == m["cap_rate"] == Decimal("0.0621")
