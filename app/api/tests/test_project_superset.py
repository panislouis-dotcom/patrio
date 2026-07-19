from decimal import Decimal
from api.db import get_db, get_project


def test_project_without_breakdown_falls_back_to_stored(test_project):
    p = get_project(test_project["id"])
    assert p["landPrice"] is None
    assert Decimal(str(p["totalInvestment"])) == Decimal("5000000")  # stored fixture value
    assert p["projectedRoi"] is None


def test_project_with_breakdown_computes_total(test_project):
    from api.finance import underwriting
    with get_db() as conn:
        conn.execute(
            """UPDATE projects SET land_price=1000000, acquisition_cost_pct=0.065,
                   permits_cost=50000, subdivision_cost=25000, sqm_construction=200,
                   construction_cost_per_sqm=9000, construction_overhead=1.3,
                   projected_sale=2500000, hold_months=18, rent_monthly=18000, sqm_land=300
               WHERE id=%s""", (test_project["id"],))
    p = get_project(test_project["id"])
    expected = underwriting.metrics(dict(
        land_price=1000000, acquisition_cost_pct=0.065, permits_cost=50000,
        subdivision_cost=25000, sqm_construction=200, construction_cost_per_sqm=9000,
        construction_overhead=1.3, projected_sale=2500000, hold_months=18,
        rent_monthly=18000, sqm_land=300))
    assert Decimal(str(p["totalInvestment"])) == expected["total_investment"]
    assert Decimal(str(p["investmentPerSqm"])) == expected["investment_per_sqm"]
    assert Decimal(str(p["projectedProfit"])) == expected["profit"]
    assert Decimal(str(p["projectedRoi"])) == expected["roi"]


def test_convert_is_atomic_and_lossless(client, test_prospect):
    pid = test_prospect["id"]
    with get_db() as conn:
        conn.execute(
            """UPDATE prospects SET land_price=1000000, acquisition_cost_pct=0.065,
                   permits_cost=50000, subdivision_cost=25000, sqm_construction=200,
                   construction_cost_per_sqm=9000, construction_overhead=1.3,
                   projected_sale=2500000, hold_months=18, rent_monthly=18000, sqm_land=300
               WHERE id=%s""", (pid,))
    prospect = client.get(f"/api/prospects/{pid}").json()

    r = client.post(f"/api/prospects/{pid}/convert", json={
        "type": "ground_up", "totalUnits": 1, "acquisitionDate": "2025-01",
        "conclusionDate": "2026-07", "currentValuation": 2500000, "valuationDate": "2026-01",
        "status": "construction"})
    assert r.status_code == 201
    project = r.json()
    # underwriting carried over, total_investment == prospect's
    assert Decimal(str(project["landPrice"])) == Decimal("1000000")
    assert Decimal(str(project["totalInvestment"])) == Decimal(str(prospect["totalInvestment"]))
    assert Decimal(str(project["projectedRoi"])) == Decimal(str(prospect["roi"]))
    assert project["prospectId"] == pid
    # prospect NOT deleted; archived
    still = client.get(f"/api/prospects/{pid}")
    assert still.status_code == 200
    assert still.json()["status"] == "converted"

    with get_db() as conn:
        conn.execute("DELETE FROM projects WHERE id=%s", (project["id"],))
