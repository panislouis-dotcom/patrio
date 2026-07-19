"""Integration tests for /api/profit routes."""
import pytest


def test_get_profit_template(client):
    r = client.get("/api/profit/template")
    assert r.status_code == 200
    data = r.json()
    assert "isrRate" in data


def test_put_profit_template(client):
    r = client.put("/api/profit/template", json={"isrRate": 0.25})
    assert r.status_code == 200
    assert r.json()["isrRate"] == 0.25


def test_get_project_profit(client, test_project):
    r = client.get(f"/api/projects/{test_project['id']}/profit")
    assert r.status_code == 200
    data = r.json()
    assert "config" in data
    assert "waterfall" in data


def test_put_project_profit(client, test_project):
    r = client.put(f"/api/projects/{test_project['id']}/profit", json={"exitPrice": 5_000_000.0})
    assert r.status_code == 200
    data = r.json()
    assert "config" in data
    assert "waterfall" in data


def test_put_then_get_project_profit(client, test_project):
    client.put(f"/api/projects/{test_project['id']}/profit", json={"exitPrice": 7_000_000.0})
    r = client.get(f"/api/projects/{test_project['id']}/profit")
    assert r.status_code == 200
    assert r.json()["config"]["exitPrice"] == 7_000_000.0


def test_requires_auth(client):
    from api.main import app
    from api.auth import get_current_user
    app.dependency_overrides.clear()
    try:
        r = client.get("/api/profit/template")
        assert r.status_code == 401
    finally:
        app.dependency_overrides[get_current_user] = lambda: {"id": 1, "email": "test@test.com"}
