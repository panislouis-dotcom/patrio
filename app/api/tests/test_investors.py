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
