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
_EXPECTED = {
    "total_investment": Decimal("3480000"),
    "acquisition_costs": Decimal("65000"),
    "acquisition_total": Decimal("1065000"),
    "construction_base": Decimal("1800000"),
    "construction_total": Decimal("2340000"),
    "profit": Decimal("-980000"),
    "cap_rate": Decimal("0.0605"),
    "land_price_per_sqm": Decimal("3333.33"),
    "sale_per_sqm": Decimal("8333.33"),
    "investment_per_sqm": Decimal("11600.00"),
    "rent_annual": Decimal("216000"),
    "roi": Decimal("-0.1979"),
    "roi_total": Decimal("-0.2816"),
}


def test_metrics_matches_locked_oracle(client, test_prospect):
    """finance.underwriting reproduces the figures the prospect_metrics view produced,
    reading the base prospects row (the view itself is gone after migration 020)."""
    from api.db import get_db
    with get_db() as conn:
        conn.execute(
            """UPDATE prospects SET land_price=%s, acquisition_cost_pct=%s, permits_cost=%s,
                   subdivision_cost=%s, sqm_construction=%s, construction_cost_per_sqm=%s,
                   construction_overhead=%s, projected_sale=%s, hold_months=%s,
                   rent_monthly=%s, sqm_land=%s WHERE id=%s""",
            (INPUTS["land_price"], INPUTS["acquisition_cost_pct"], INPUTS["permits_cost"],
             INPUTS["subdivision_cost"], INPUTS["sqm_construction"], INPUTS["construction_cost_per_sqm"],
             INPUTS["construction_overhead"], INPUTS["projected_sale"], INPUTS["hold_months"],
             INPUTS["rent_monthly"], INPUTS["sqm_land"], test_prospect["id"]))
        base = conn.execute("SELECT * FROM prospects WHERE id=%s", (test_prospect["id"],)).fetchone()

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
    assert m["cap_rate"] is None
    assert m["land_price_per_sqm"] is None
