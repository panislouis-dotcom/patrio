def test_get_geometry_empty_by_default(client, test_prospect):
    r = client.get(f"/api/prospects/{test_prospect['id']}/geometry")
    assert r.status_code == 200
    assert r.json() == {}


def test_put_geometry_roundtrips(client, test_prospect):
    model = {"schemaVersion": 2, "slab_m": 0.15, "activeFloor": 0, "floors": []}
    r = client.put(f"/api/prospects/{test_prospect['id']}/geometry",
                   json={"geometry": model})
    assert r.status_code == 200
    assert r.json() == model
    r2 = client.get(f"/api/prospects/{test_prospect['id']}/geometry")
    assert r2.json() == model


def test_put_geometry_unknown_prospect_404(client):
    r = client.put("/api/prospects/999999999/geometry", json={"geometry": {}})
    assert r.status_code == 404


def test_geometry_requires_auth(client):
    from api.main import app
    from api.auth import get_current_user
    app.dependency_overrides.clear()
    try:
        r = client.get("/api/prospects/1/geometry")
        assert r.status_code in (401, 403)
    finally:
        app.dependency_overrides[get_current_user] = lambda: {"id": 1, "email": "test@test.com"}
