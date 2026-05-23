"""Integration tests for prospects and projects routes against real PostgreSQL DB."""
from api.db import get_db


# ── Prospects ─────────────────────────────────────────────────────────────────

def test_get_prospects_returns_list(client, test_prospect):
    r = client.get("/api/prospects")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert any(p["id"] == test_prospect["id"] for p in data)


def test_prospect_has_required_fields(client, test_prospect):
    r = client.get(f"/api/prospects/{test_prospect['id']}")
    p = r.json()
    for field in ["id", "name", "roi", "capRate", "profit", "totalInvestment",
                  "latitude", "longitude", "score"]:
        assert field in p, f"Missing field: {field}"


def test_prospect_has_issues_list(client, test_prospect):
    r = client.get(f"/api/prospects/{test_prospect['id']}")
    p = r.json()
    assert "issues" in p
    assert isinstance(p["issues"], list)


def test_get_single_prospect(client, test_prospect):
    r = client.get(f"/api/prospects/{test_prospect['id']}")
    assert r.status_code == 200
    p = r.json()
    assert p["id"] == test_prospect["id"]
    assert "issues" in p


def test_get_missing_prospect_returns_404(client):
    r = client.get("/api/prospects/99999999")
    assert r.status_code == 404


def test_quality_endpoint(client):
    r = client.get("/api/quality")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    for item in data:
        assert "id" in item
        assert "name" in item
        assert "issues" in item


def test_patch_prospect_updates_field(client, test_prospect):
    r = client.patch(f"/api/prospects/{test_prospect['id']}", json={"name": "[TEST] Patched Name"})
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "[TEST] Patched Name"
    assert "score" in data
    assert "issues" in data


def test_patch_missing_prospect_returns_404(client):
    r = client.patch("/api/prospects/99999999", json={"name": "ghost"})
    assert r.status_code == 404


def test_post_creates_new_prospect(client):
    r = client.post("/api/prospects", json={
        "name":        "[TEST] Post Prospect",
        "address":     "Calle Ejemplo 1",
        "city":        "Monterrey",
        "status":      "evaluating",
        "holdMonths":  12,
        "rentMonthly": 20000,
    })
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "[TEST] Post Prospect"
    assert "id" in data
    assert "score" in data
    assert "issues" in data
    # Cleanup
    with get_db() as conn:
        conn.execute("DELETE FROM prospects WHERE id = %s", (data["id"],))


def test_delete_prospect(client, test_prospect):
    r = client.delete(f"/api/prospects/{test_prospect['id']}")
    assert r.status_code == 204
    r2 = client.get(f"/api/prospects/{test_prospect['id']}")
    assert r2.status_code == 404


# ── Projects ──────────────────────────────────────────────────────────────────

def test_get_projects_returns_list(client, test_project):
    r = client.get("/api/projects")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert any(p["id"] == test_project["id"] for p in data)


def test_project_has_required_fields(client, test_project):
    r = client.get(f"/api/projects/{test_project['id']}")
    p = r.json()
    for field in [
        "id", "name", "type", "totalInvestment", "currentValuation",
        "unrealizedGain", "unrealizedGainPct", "holdMonthsActual",
        "milestones", "budget",
    ]:
        assert field in p, f"Missing field: {field}"


def test_project_milestones_parsed_as_dict(client, test_project):
    r = client.get(f"/api/projects/{test_project['id']}")
    p = r.json()
    assert isinstance(p["milestones"], dict), "milestones should be a dict, not a string"


def test_project_budget_parsed_as_dict(client, test_project):
    r = client.get(f"/api/projects/{test_project['id']}")
    p = r.json()
    assert isinstance(p["budget"], dict), "budget should be a dict, not a string"


def test_get_single_project(client, test_project):
    r = client.get(f"/api/projects/{test_project['id']}")
    assert r.status_code == 200
    p = r.json()
    assert p["id"] == test_project["id"]


def test_get_missing_project_returns_404(client):
    r = client.get("/api/projects/99999999")
    assert r.status_code == 404


def test_patch_project_updates_field(client, test_project):
    r = client.patch(f"/api/projects/{test_project['id']}", json={"name": "[TEST] Patched Project"})
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "[TEST] Patched Project"


def test_patch_missing_project_returns_404(client):
    r = client.patch("/api/projects/99999999", json={"name": "ghost"})
    assert r.status_code == 404


def test_post_creates_new_project(client):
    r = client.post("/api/projects", json={
        "name":             "[TEST] Post Project",
        "type":             "ground_up",
        "address":          "Av. Constitución 100",
        "city":             "Monterrey",
        "status":           "construction",
        "totalUnits":       10,
        "acquisitionDate":  "2025-01",
        "conclusionDate":   "2026-06",
        "totalInvestment":  8000000,
        "currentValuation": 8000000,
        "valuationDate":    "2026-01",
    })
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "[TEST] Post Project"
    assert "id" in data
    # Cleanup
    with get_db() as conn:
        conn.execute("DELETE FROM projects WHERE id = %s", (data["id"],))


def test_delete_project(client, test_project):
    r = client.delete(f"/api/projects/{test_project['id']}")
    assert r.status_code == 204
    r2 = client.get(f"/api/projects/{test_project['id']}")
    assert r2.status_code == 404


# ── Project image type ────────────────────────────────────────────────────────

def test_patch_project_image_type_changes_to_despues(client, test_project, test_project_image):
    r = client.patch(
        f"/api/projects/{test_project['id']}/images/{test_project_image['id']}",
        json={"image_type": "despues"},
    )
    assert r.status_code == 200
    assert r.json()["imageType"] == "despues"


def test_patch_project_image_type_changes_back_to_antes(client, test_project, test_project_image):
    # flip to despues first
    setup_r = client.patch(
        f"/api/projects/{test_project['id']}/images/{test_project_image['id']}",
        json={"image_type": "despues"},
    )
    assert setup_r.status_code == 200
    # flip back to antes
    r = client.patch(
        f"/api/projects/{test_project['id']}/images/{test_project_image['id']}",
        json={"image_type": "antes"},
    )
    assert r.status_code == 200
    assert r.json()["imageType"] == "antes"


def test_patch_project_image_type_invalid_value_returns_422(client, test_project, test_project_image):
    r = client.patch(
        f"/api/projects/{test_project['id']}/images/{test_project_image['id']}",
        json={"image_type": "unknown"},
    )
    assert r.status_code == 422
