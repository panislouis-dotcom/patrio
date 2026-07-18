"""Integration tests for /api/comparables and /api/zones routes."""
import pytest
from api.db import get_db

_ZONE_NAME = "[TEST] Zone Comparables"


@pytest.fixture
def test_zone():
    with get_db() as conn:
        row = conn.execute(
            "INSERT INTO zones (name) VALUES (%s) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id",
            (_ZONE_NAME,),
        ).fetchone()
    zone_id = dict(row)["id"]
    yield zone_id
    with get_db() as conn:
        conn.execute("DELETE FROM zones WHERE id = %s", (zone_id,))


@pytest.fixture
def test_comparable(client, test_zone):
    r = client.post("/api/comparables", json={
        "address": "Calle Test 1, Monterrey",
        "zoneId": test_zone,
        "m2": 120.0,
        "price": 3_000_000,
        "listingUrl": "https://test.example.com/comp-fixture-1",
        "sourcePortal": "other",
        "listedAt": "2025-01-01",
    })
    assert r.status_code == 201
    comp = r.json()
    yield comp
    with get_db() as conn:
        conn.execute("DELETE FROM comparables WHERE id = %s", (comp["id"],))


def test_get_zones_returns_list(client):
    r = client.get("/api/zones")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_create_comparable(client, test_comparable):
    assert "id" in test_comparable
    assert test_comparable["listingUrl"] == "https://test.example.com/comp-fixture-1"


def test_duplicate_url_returns_existing(client, test_comparable, test_zone):
    r = client.post("/api/comparables", json={
        "address": "Duplicado",
        "zoneId": test_zone,
        "m2": 100.0,
        "price": 2_000_000,
        "listingUrl": "https://test.example.com/comp-fixture-1",  # same URL
        "sourcePortal": "other",
        "listedAt": "2025-01-01",
    })
    assert r.status_code == 201
    assert r.json()["id"] == test_comparable["id"]


def test_list_comparables(client, test_comparable):
    r = client.get("/api/comparables")
    assert r.status_code == 200
    ids = [c["id"] for c in r.json()]
    assert test_comparable["id"] in ids


def test_filter_by_zone(client, test_comparable, test_zone):
    r = client.get(f"/api/comparables?zone_id={test_zone}")
    assert r.status_code == 200
    ids = [c["id"] for c in r.json()]
    assert test_comparable["id"] in ids


def test_patch_comparable(client, test_comparable):
    r = client.patch(f"/api/comparables/{test_comparable['id']}", json={"price": 3_500_000})
    assert r.status_code == 200
    assert r.json()["price"] == 3_500_000


def test_delete_comparable(client, test_comparable):
    r = client.delete(f"/api/comparables/{test_comparable['id']}")
    assert r.status_code == 204
    # fixture teardown will be a no-op


def test_delete_nonexistent_404(client):
    r = client.delete("/api/comparables/999999")
    assert r.status_code == 404


def test_requires_auth(client):
    from api.main import app
    from api.auth import get_current_user
    app.dependency_overrides.clear()
    try:
        r = client.get("/api/comparables")
        assert r.status_code == 401
    finally:
        app.dependency_overrides[get_current_user] = lambda: {"id": 1, "email": "test@test.com"}
