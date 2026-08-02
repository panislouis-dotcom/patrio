"""Integration tests for /api/analyses routes."""
import pytest
from unittest import mock
from api.db import get_db


@pytest.fixture(autouse=True)
def analysis_zones():
    """Ensure the fallback zone exists so the analyzer does not crash on zone lookup."""
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


def test_post_analysis_returns_snapshot(client, test_property):
    p1, p2 = _mock_analysis_patches()
    with p1, p2:
        r = client.post("/api/analyses", json={"propertyId": test_property["id"]})
    assert r.status_code == 201
    data = r.json()
    assert "id" in data
    assert data["propertyId"] == test_property["id"]


def test_get_analysis_by_id(client, test_property):
    p1, p2 = _mock_analysis_patches()
    with p1, p2:
        create_r = client.post("/api/analyses", json={"propertyId": test_property["id"]})
    assert create_r.status_code == 201
    snapshot_id = create_r.json()["id"]

    r = client.get(f"/api/analyses/{snapshot_id}")
    assert r.status_code == 200
    assert r.json()["id"] == snapshot_id


def test_list_analyses_all(client, test_property):
    p1, p2 = _mock_analysis_patches()
    with p1, p2:
        client.post("/api/analyses", json={"propertyId": test_property["id"]})
    r = client.get("/api/analyses")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_list_analyses_by_property(client, test_property):
    p1, p2 = _mock_analysis_patches()
    with p1, p2:
        create_r = client.post("/api/analyses", json={"propertyId": test_property["id"]})
    snapshot_id = create_r.json()["id"]

    r = client.get(f"/api/analyses?property_id={test_property['id']}")
    assert r.status_code == 200
    ids = [a["id"] for a in r.json()]
    assert snapshot_id in ids


def test_post_missing_property_id_422(client):
    r = client.post("/api/analyses", json={})
    assert r.status_code == 422


def test_requires_auth(client, anonymous):
    r = client.get("/api/analyses")
    assert r.status_code == 401
