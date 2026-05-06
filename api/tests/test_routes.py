import sqlite3
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

SCHEMA_PATH = Path(__file__).parent.parent.parent / "data" / "schema.sql"

SEED_PROJECT = """
INSERT INTO projects (
    name, type, address, city, status, total_units,
    acquisition_date, first_rent_date,
    total_investment, current_valuation, valuation_date,
    url, latitude, longitude,
    milestones, budget, notes
) VALUES (
    'Edificio Test', 'adaptive_reuse', 'Centro, Monterrey', 'Monterrey', 'operating', 5,
    '2022-01', '2023-06',
    5000000, 9000000, '2026-04',
    'https://refigan.mx', 25.6694, -100.3098,
    '{"2022-01":"Adquisición","2023-06":"Primera renta"}',
    '{"Adquisición":4000000,"Obra":1000000}',
    'Proyecto de prueba'
)
"""

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
        conn.execute(SEED_PROJECT)
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
        "holdMonths": 18,
        "rentMonthly": 20000
    })
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Test New Prospect"
    assert "id" in data
    assert "score" in data
    assert "issues" in data


# ── Projects ──────────────────────────────────────────────────────────────────

def test_get_projects_returns_list(client):
    r = client.get("/api/projects")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) > 0


def test_project_has_required_fields(client):
    r = client.get("/api/projects")
    p = r.json()[0]
    for field in [
        "id", "name", "type", "totalInvestment", "currentValuation",
        "unrealizedGain", "unrealizedGainPct", "holdMonthsActual",
        "milestones", "budget",
    ]:
        assert field in p, f"Missing field: {field}"


def test_project_milestones_parsed_as_dict(client):
    r = client.get("/api/projects")
    p = r.json()[0]
    assert isinstance(p["milestones"], dict), "milestones should be a dict, not a string"


def test_project_budget_parsed_as_dict(client):
    r = client.get("/api/projects")
    p = r.json()[0]
    assert isinstance(p["budget"], dict), "budget should be a dict, not a string"


def test_get_single_project(client):
    r = client.get("/api/projects/1")
    assert r.status_code == 200
    p = r.json()
    assert p["id"] == 1


def test_get_missing_project_returns_404(client):
    r = client.get("/api/projects/99999")
    assert r.status_code == 404


def test_patch_project_updates_field(client):
    r = client.patch("/api/projects/1", json={"name": "Patched"})
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Patched"


def test_patch_missing_project_returns_404(client):
    r = client.patch("/api/projects/99999", json={"name": "ghost"})
    assert r.status_code == 404


def test_post_creates_new_project(client):
    r = client.post("/api/projects", json={
        "name": "Nuevo Proyecto",
        "type": "ground_up",
        "address": "Av. Constitución 100",
        "city": "Monterrey",
        "status": "construction",
        "totalUnits": 10,
        "acquisitionDate": "2025-01",
        "firstRentDate": "2026-06",
        "totalInvestment": 8000000,
        "currentValuation": 8000000,
        "valuationDate": "2026-01",
    })
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Nuevo Proyecto"
    assert "id" in data
