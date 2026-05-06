import sqlite3
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

SCHEMA_PATH = Path(__file__).parent.parent.parent / "data" / "schema.sql"

SEED_PROSPECT = """
INSERT INTO prospects (
    name, address, city, status, url,
    latitude, longitude, sqm_land, sqm_construction,
    land_price, acquisition_cost_pct, permits_cost, subdivision_cost,
    construction_cost_per_sqm, construction_overhead,
    projected_sale, hold_months, rent_monthly, notes
) VALUES (
    'Lote Test', 'Calle Ejemplo 123', 'Monterrey', 'evaluating', 'https://refigan.mx',
    25.6866, -100.3161, 200, 400,
    5000000, 0.065, 50000, 30000,
    8000, 1.3,
    22000000, 18, 18000, 'Prospect de prueba'
)
"""


@pytest.fixture
def tmp_db(monkeypatch, tmp_path):
    db = tmp_path / "test.db"
    schema = SCHEMA_PATH.read_text()
    with sqlite3.connect(db) as conn:
        conn.executescript(schema)
        conn.execute(SEED_PROSPECT)
    import api.db
    monkeypatch.setattr(api.db, "DB_PATH", db)
    return db


@pytest.fixture
def client(tmp_db):
    from api.main import app
    return TestClient(app)


def test_get_prospects_returns_list(client):
    r = client.get("/api/prospects")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) > 0


def test_prospect_has_required_fields(client):
    r = client.get("/api/prospects")
    p = r.json()[0]
    for field in ["id", "name", "roi", "capRate", "profit", "totalInvestment",
                  "latitude", "longitude", "score"]:
        assert field in p, f"Missing field: {field}"


def test_prospect_has_issues_list(client):
    r = client.get("/api/prospects")
    p = r.json()[0]
    assert "issues" in p
    assert isinstance(p["issues"], list)


def test_get_single_prospect(client):
    r = client.get("/api/prospects/1")
    assert r.status_code == 200
    p = r.json()
    assert p["id"] == 1
    assert "issues" in p


def test_get_missing_prospect_returns_404(client):
    r = client.get("/api/prospects/99999")
    assert r.status_code == 404


def test_quality_endpoint(client):
    r = client.get("/api/quality")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    # each item has id, name, issues
    for item in data:
        assert "id" in item
        assert "name" in item
        assert "issues" in item


def test_patch_prospect_updates_field(client):
    r = client.patch("/api/prospects/1", json={"name": "Test Patched Name"})
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Test Patched Name"
    assert "score" in data
    assert "issues" in data


def test_patch_missing_prospect_returns_404(client):
    r = client.patch("/api/prospects/99999", json={"name": "ghost"})
    assert r.status_code == 404


def test_post_creates_new_prospect(client):
    r = client.post("/api/prospects", json={
        "name": "Test New Prospect",
        "address": "Calle Test 1",
        "city": "Monterrey",
        "status": "evaluating",
        "holdMonths": 18
    })
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Test New Prospect"
    assert "id" in data
    assert "score" in data
    assert "issues" in data
