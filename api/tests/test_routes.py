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
