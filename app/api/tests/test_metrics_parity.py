from decimal import Decimal
from api.db import get_db
from api.finance import underwriting

_FIELDS = [
    ("totalInvestment", "total_investment"), ("acquisitionCosts", "acquisition_costs"),
    ("acquisitionTotal", "acquisition_total"), ("constructionBase", "construction_base"),
    ("constructionTotal", "construction_total"), ("profit", "profit"),
    ("capRate", "cap_rate"), ("landPricePerSqm", "land_price_per_sqm"),
    ("salePerSqm", "sale_per_sqm"), ("investmentPerSqm", "investment_per_sqm"),
    ("rentAnnual", "rent_annual"), ("roi", "roi"), ("roiTotal", "roi_total"),
]

_INPUTS = dict(
    land_price=1000000, acquisition_cost_pct=0.065, permits_cost=50000,
    subdivision_cost=25000, sqm_construction=200, construction_cost_per_sqm=9000,
    construction_overhead=1.3, projected_sale=2500000, hold_months=18,
    rent_monthly=18000, sqm_land=300,
)


def test_api_prospect_matches_finance_module(client, test_prospect):
    """The API's prospect metrics equal finance.underwriting.metrics of the same
    inputs — the parity oracle after the SQL views are dropped (migration 020)."""
    pid = test_prospect["id"]
    with get_db() as conn:
        conn.execute(
            """UPDATE prospects SET land_price=%(land_price)s,
                   acquisition_cost_pct=%(acquisition_cost_pct)s, permits_cost=%(permits_cost)s,
                   subdivision_cost=%(subdivision_cost)s, sqm_construction=%(sqm_construction)s,
                   construction_cost_per_sqm=%(construction_cost_per_sqm)s,
                   construction_overhead=%(construction_overhead)s, projected_sale=%(projected_sale)s,
                   hold_months=%(hold_months)s, rent_monthly=%(rent_monthly)s, sqm_land=%(sqm_land)s
               WHERE id=%(id)s""", {**_INPUTS, "id": pid})

    expected = underwriting.metrics(dict(_INPUTS))
    api = client.get(f"/api/prospects/{pid}").json()
    for camel, snake in _FIELDS:
        exp = expected[snake]
        got = api[camel]
        assert (got is None) == (exp is None), f"{camel}: None-ness differs ({got} vs {exp})"
        if exp is not None:
            assert Decimal(str(got)) == exp, f"{camel}: {got} != {exp}"
