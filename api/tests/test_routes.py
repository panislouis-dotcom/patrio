import pytest
from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)

def test_get_prospects_returns_list():
    r = client.get("/api/prospects")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) > 0

def test_prospect_has_required_fields():
    r = client.get("/api/prospects")
    p = r.json()[0]
    for field in ["id", "name", "roi", "capRate", "profit", "totalInvestment",
                  "latitude", "longitude", "score"]:
        assert field in p, f"Missing field: {field}"

def test_prospect_has_issues_list():
    r = client.get("/api/prospects")
    p = r.json()[0]
    assert "issues" in p
    assert isinstance(p["issues"], list)

def test_get_single_prospect():
    r = client.get("/api/prospects/1")
    assert r.status_code == 200
    p = r.json()
    assert p["id"] == 1
    assert "issues" in p

def test_get_missing_prospect_returns_404():
    r = client.get("/api/prospects/99999")
    assert r.status_code == 404

def test_quality_endpoint():
    r = client.get("/api/quality")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    # each item has id, name, issues
    for item in data:
        assert "id" in item
        assert "name" in item
        assert "issues" in item

def test_patch_prospect_updates_field():
    # First get a valid prospect id
    r = client.get("/api/prospects")
    prospect_id = r.json()[0]["id"]

    # Patch with a specific name change
    r = client.patch(f"/api/prospects/{prospect_id}", json={"name": "Test Patched Name"})
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Test Patched Name"
    assert "score" in data
    assert "issues" in data

def test_patch_missing_prospect_returns_404():
    r = client.patch("/api/prospects/99999", json={"name": "ghost"})
    assert r.status_code == 404

def test_post_creates_new_prospect():
    r = client.post("/api/prospects", json={
        "name": "Test New Prospect",
        "address": "Calle Test 1",
        "city": "Monterrey",
        "status": "evaluating",
        "investmentDate": "2027-01-01",
        "saleDate": "2028-01-01"
    })
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Test New Prospect"
    assert "id" in data
    assert "score" in data
    assert "issues" in data
