"""Integration tests for /api/analyses routes."""
import pytest
from unittest import mock
from api.db import get_db


@pytest.fixture(autouse=True)
def analysis_zones():
    """Ensure the fallback zone exists so analyze_prospect doesn't crash on zone lookup."""
    with get_db() as conn:
        conn.execute(
            "INSERT INTO zones (name) VALUES ('monterrey_general') ON CONFLICT (name) DO NOTHING"
        )
    yield
    with get_db() as conn:
        conn.execute("DELETE FROM zones WHERE name = 'monterrey_general'")


def _mock_analysis_patches():
    return (
        mock.patch("api.analyzer.find_comparables", return_value=([], None)),
        mock.patch("api.analyzer.get_remodel_cost", return_value=None),
    )


def test_post_analysis_returns_snapshot(client, test_prospect):
    p1, p2 = _mock_analysis_patches()
    with p1, p2:
        r = client.post("/api/analyses", json={"prospectId": test_prospect["id"]})
    assert r.status_code == 201
    data = r.json()
    assert "id" in data
    assert data["prospectId"] == test_prospect["id"]


def test_get_analysis_by_id(client, test_prospect):
    p1, p2 = _mock_analysis_patches()
    with p1, p2:
        create_r = client.post("/api/analyses", json={"prospectId": test_prospect["id"]})
    assert create_r.status_code == 201
    snapshot_id = create_r.json()["id"]

    r = client.get(f"/api/analyses/{snapshot_id}")
    assert r.status_code == 200
    assert r.json()["id"] == snapshot_id


def test_list_analyses_all(client, test_prospect):
    p1, p2 = _mock_analysis_patches()
    with p1, p2:
        client.post("/api/analyses", json={"prospectId": test_prospect["id"]})
    r = client.get("/api/analyses")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_list_analyses_by_prospect(client, test_prospect):
    p1, p2 = _mock_analysis_patches()
    with p1, p2:
        create_r = client.post("/api/analyses", json={"prospectId": test_prospect["id"]})
    snapshot_id = create_r.json()["id"]

    r = client.get(f"/api/analyses?prospect_id={test_prospect['id']}")
    assert r.status_code == 200
    ids = [a["id"] for a in r.json()]
    assert snapshot_id in ids


def test_post_missing_prospect_id_422(client):
    r = client.post("/api/analyses", json={})
    assert r.status_code == 422


def test_requires_auth(client):
    from api.main import app
    from api.auth import get_current_user
    app.dependency_overrides.clear()
    try:
        r = client.get("/api/analyses")
        assert r.status_code == 401
    finally:
        app.dependency_overrides[get_current_user] = lambda: {"id": 1, "email": "test@test.com"}
