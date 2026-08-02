"""CRUD and images on /api/properties. The lifecycle lives in
test_property_lifecycle, the numbers in test_property_metrics."""
from api.db import get_db

from .conftest import _delete_property


def test_list_returns_the_property(client, test_property):
    r = client.get("/api/properties")
    assert r.status_code == 200
    assert any(p["id"] == test_property["id"] for p in r.json())


def test_detail_carries_the_whole_contract(client, test_property):
    p = client.get(f"/api/properties/{test_property['id']}").json()
    for field in ("id", "name", "status", "score", "issues", "images",
                  "totalInvestment", "investmentBasis", "projectedRoi", "capRate",
                  "latitude", "longitude", "milestones"):
        assert field in p, f"Missing field: {field}"
    assert isinstance(p["milestones"], dict)
    assert isinstance(p["issues"], list)


def test_missing_property_is_404(client):
    assert client.get("/api/properties/999999999").status_code == 404


def test_create_starts_in_prospecto(client):
    r = client.post("/api/properties", json={
        "name": "[TEST] Alta mínima",
        "address": "Calle Ejemplo 1",
        "city": "Monterrey",
    })
    assert r.status_code == 201, r.text
    created = r.json()
    try:
        assert created["status"] == "prospecto"
        # The capture defaults leave a resolvable base from the first save.
        assert created["investmentBasis"] == "underwriting"
        assert created["holdMonths"] == 12
    finally:
        _delete_property(created["id"])


def test_create_cannot_choose_its_status(client):
    r = client.post("/api/properties", json={
        "name": "[TEST] Alta con status",
        "address": "Calle Ejemplo 2",
        "city": "Monterrey",
        "status": "vendida",
    })
    assert r.status_code == 201
    try:
        assert r.json()["status"] == "prospecto"
    finally:
        _delete_property(r.json()["id"])


def test_delete(client, test_property):
    assert client.delete(f"/api/properties/{test_property['id']}").status_code == 204
    assert client.get(f"/api/properties/{test_property['id']}").status_code == 404


def test_delete_missing_property_is_404(client):
    assert client.delete("/api/properties/999999999").status_code == 404


def test_quality_reports_issues_per_property(client, test_property):
    r = client.get("/api/quality")
    assert r.status_code == 200
    entry = next(p for p in r.json() if p["id"] == test_property["id"])
    assert set(entry) == {"id", "name", "status", "issues"}


def test_requires_auth(client, anonymous):
    assert client.get("/api/properties").status_code == 401


# ── Images ───────────────────────────────────────────────────────────────────

def test_image_type_defaults_to_general(client, test_property_image):
    with get_db() as conn:
        row = conn.execute("SELECT image_type FROM property_images WHERE id = %s",
                           (test_property_image["id"],)).fetchone()
    assert row["image_type"] == "general"


def test_image_type_can_be_changed(client, test_property, test_property_image):
    for kind in ("despues", "antes", "general"):
        r = client.patch(
            f"/api/properties/{test_property['id']}/images/{test_property_image['id']}",
            json={"image_type": kind})
        assert r.status_code == 200, r.text
        assert r.json()["imageType"] == kind


def test_unknown_image_type_is_422(client, test_property, test_property_image):
    r = client.patch(
        f"/api/properties/{test_property['id']}/images/{test_property_image['id']}",
        json={"image_type": "unknown"})
    assert r.status_code == 422


def test_image_type_on_a_missing_image_is_404(client, test_property):
    r = client.patch(f"/api/properties/{test_property['id']}/images/999999999",
                     json={"image_type": "antes"})
    assert r.status_code == 404


def test_images_come_back_on_the_property(client, test_property, test_property_image):
    images = client.get(f"/api/properties/{test_property['id']}").json()["images"]
    assert [i["id"] for i in images] == [test_property_image["id"]]
