"""Integration tests for /api/investors and /api/projects/{id}/investors routes."""
import pytest
from api.db import get_db


@pytest.fixture
def test_investor(client):
    r = client.post("/api/investors", json={"name": "[TEST] Investor", "email": "test-inv@refigan.com"})
    assert r.status_code == 201
    inv = r.json()
    yield inv
    with get_db() as conn:
        conn.execute("DELETE FROM investors WHERE id = %s", (inv["id"],))


def test_list_investors(client):
    r = client.get("/api/investors")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_create_investor(client, test_investor):
    assert "id" in test_investor
    assert test_investor["name"] == "[TEST] Investor"


def test_get_investor_by_id(client, test_investor):
    r = client.get(f"/api/investors/{test_investor['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == test_investor["id"]


def test_put_investor(client, test_investor):
    r = client.put(f"/api/investors/{test_investor['id']}", json={"name": "[TEST] Updated Investor"})
    assert r.status_code == 200
    assert r.json()["name"] == "[TEST] Updated Investor"


def test_delete_investor(client, test_investor):
    r = client.delete(f"/api/investors/{test_investor['id']}")
    assert r.status_code == 204
    # fixture teardown will be a no-op


def test_delete_nonexistent_404(client):
    r = client.delete("/api/investors/999999")
    assert r.status_code == 404


def test_list_project_investors_empty(client, test_project):
    r = client.get(f"/api/projects/{test_project['id']}/investors")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_add_investor_to_project(client, test_project, test_investor):
    r = client.post(f"/api/projects/{test_project['id']}/investors", json={
        "investorId": test_investor["id"],
        "status": "interesado",
        "fundedAmount": 500_000,
    })
    assert r.status_code == 201
    data = r.json()
    assert "id" in data


def test_delete_project_investment(client, test_project, test_investor):
    add = client.post(f"/api/projects/{test_project['id']}/investors", json={
        "investorId": test_investor["id"],
        "status": "interesado",
    })
    assert add.status_code == 201
    inv_id = add.json()["id"]
    r = client.delete(f"/api/projects/{test_project['id']}/investors/{inv_id}")
    assert r.status_code == 204


def test_requires_auth(client):
    from api.main import app
    from api.auth import get_current_user
    app.dependency_overrides.clear()
    try:
        r = client.get("/api/investors")
        assert r.status_code == 401
    finally:
        app.dependency_overrides[get_current_user] = lambda: {"id": 1, "email": "test@test.com"}


def test_project_investor_metrics_match_finance_module(client, test_project):
    """The API's position metrics equal finance.investor of the same position —
    the parity oracle after project_investor_metrics is dropped (migration 020)."""
    from decimal import Decimal
    from api.db import get_db
    from api.investor_db import get_project_investors
    from api.finance import investor as fin_investor
    with get_db() as conn:
        inv = conn.execute(
            "INSERT INTO investors (name) VALUES ('[TEST] Parity') RETURNING id").fetchone()
        conn.execute(
            """INSERT INTO project_investors (project_id, investor_id, status, funded_amount,
                   interest_rate_annual, investment_date)
               VALUES (%s,%s,'fondeado',1000000,0.12,'2025-01-01')""",
            (test_project["id"], inv["id"]))
        proj = conn.execute(
            "SELECT acquisition_date, conclusion_date FROM projects WHERE id=%s",
            (test_project["id"],)).fetchone()

    # Expected from the finance module, using the project's own acquisition/conclusion dates.
    hm = fin_investor.hold_months(proj["acquisition_date"], proj["conclusion_date"])
    exp_interest = fin_investor.cuota(1000000, 0.12, hm)
    exp_return = fin_investor.expected_return(1000000, 0.12, hm)
    exp_pct = fin_investor.return_pct(0.12, hm)

    positions = get_project_investors(test_project["id"])
    pos = next(p for p in positions if p["investorId"] == inv["id"])
    assert pos["holdMonths"] == hm
    assert Decimal(str(pos["interestAmount"])) == exp_interest
    assert Decimal(str(pos["expectedReturn"])) == exp_return
    assert Decimal(str(pos["returnPct"])) == exp_pct

    with get_db() as conn:
        conn.execute("DELETE FROM project_investors WHERE investor_id=%s", (inv["id"],))
        conn.execute("DELETE FROM investors WHERE id=%s", (inv["id"],))
