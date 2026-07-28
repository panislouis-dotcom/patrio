from decimal import Decimal
from api.db import get_db, get_project, set_prospect_geometry, get_project_geometry


def test_project_without_breakdown_falls_back_to_stored(test_project):
    p = get_project(test_project["id"])
    assert p["landPrice"] is None
    assert Decimal(str(p["totalInvestment"])) == Decimal("5000000")  # stored fixture value
    assert p["projectedRoi"] is None


def test_project_without_breakdown_derives_cap_rate_from_stored_total(test_project):
    """No cost breakdown → cap rate still lands, off the stored total_investment."""
    with get_db() as conn:
        conn.execute("UPDATE projects SET rent_monthly=30000 WHERE id=%s", (test_project["id"],))
    p = get_project(test_project["id"])
    assert p["landPrice"] is None
    # 30,000*12 = 360,000 over the fixture's stored 5,000,000
    assert Decimal(str(p["capRate"])) == Decimal("0.0720")
    assert Decimal(str(p["rentAnnual"])) == Decimal("360000")


def test_project_without_breakdown_or_rent_has_no_cap_rate(test_project):
    p = get_project(test_project["id"])
    assert p["rentMonthly"] is None
    assert p["capRate"] is None
    assert p["rentAnnual"] is None


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
    assert Decimal(str(p["capRate"])) == expected["cap_rate"]
    assert Decimal(str(p["rentAnnual"])) == expected["rent_annual"]


def test_update_persists_the_computed_total_investment(client, test_project):
    """While a breakdown exists it owns the stored total, so the column never goes
    stale behind the computed figure the read path displays."""
    from api.finance import underwriting
    pid = test_project["id"]
    r = client.patch(f"/api/projects/{pid}", json=dict(
        landPrice=1000000, acquisitionCostPct=0.065, permitsCost=50000, subdivisionCost=25000,
        sqmConstruction=200, constructionCostPerSqm=9000, constructionOverhead=1.3,
        projectedSale=2500000, holdMonths=18, rentMonthly=18000, sqmLand=300))
    assert r.status_code == 200

    with get_db() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id=%s", (pid,)).fetchone()
    expected = underwriting.metrics(dict(row))["total_investment"]
    assert Decimal(str(row["total_investment"])) == expected == Decimal("3480000")


def test_clearing_the_breakdown_keeps_the_total_it_computed(client, test_project):
    """Back to manual mode: the fallback total is the last one the breakdown produced,
    not the manual figure from before it — and cap rate follows that total."""
    pid = test_project["id"]
    client.patch(f"/api/projects/{pid}", json=dict(
        landPrice=1000000, acquisitionCostPct=0.065, permitsCost=50000, subdivisionCost=25000,
        sqmConstruction=200, constructionCostPerSqm=9000, constructionOverhead=1.3,
        projectedSale=2500000, holdMonths=18, rentMonthly=18000, sqmLand=300))

    r = client.patch(f"/api/projects/{pid}", json={"landPrice": None})
    assert r.status_code == 200
    p = r.json()
    assert p["landPrice"] is None
    assert Decimal(str(p["totalInvestment"])) == Decimal("3480000")  # not the fixture's 5,000,000
    assert Decimal(str(p["capRate"])) == Decimal("0.0621")  # 216,000 / 3,480,000


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


def test_convert_carries_geometry_to_new_project(client, test_prospect):
    pid = test_prospect["id"]
    model = {
        "schemaVersion": 2, "slab_m": 0.15, "activeFloor": 0,
        "floors": [{
            "name": "Planta Baja", "height_m": 2.60, "extWall_m": 0.15, "intWall_m": 0.10,
            "vertices": {"v1": {"id": "v1", "x": 0, "y": 0}, "v2": {"id": "v2", "x": 5, "y": 0}},
            "edges": {"e1": {"id": "e1", "v1": "v1", "v2": "v2", "thickness": 0.15, "openings": []}},
            "rooms": [],
        }],
    }
    set_prospect_geometry(pid, model)

    r = client.post(f"/api/prospects/{pid}/convert", json={
        "type": "ground_up", "totalUnits": 1, "acquisitionDate": "2025-01",
        "conclusionDate": "2026-07", "currentValuation": 2500000, "valuationDate": "2026-01",
        "status": "construction"})
    assert r.status_code == 201
    project = r.json()
    assert get_project_geometry(project["id"]) == model

    with get_db() as conn:
        conn.execute("DELETE FROM projects WHERE id=%s", (project["id"],))


def test_convert_with_no_geometry_leaves_project_geometry_empty(client, test_prospect):
    pid = test_prospect["id"]
    r = client.post(f"/api/prospects/{pid}/convert", json={
        "type": "ground_up", "totalUnits": 1, "acquisitionDate": "2025-01",
        "conclusionDate": "2026-07", "currentValuation": 2500000, "valuationDate": "2026-01",
        "status": "construction"})
    assert r.status_code == 201
    project = r.json()
    assert get_project_geometry(project["id"]) == {}

    with get_db() as conn:
        conn.execute("DELETE FROM projects WHERE id=%s", (project["id"],))
