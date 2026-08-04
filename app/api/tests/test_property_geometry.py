"""Floorplan geometry — one blob per property, stored and served whole.

One file, because there is now one entity: this replaces the four that existed
when a prospect and a project each had their own identical implementation."""
from api.properties_db import get_geometry, set_geometry

MODEL = {
    "schemaVersion": 2, "slab_m": 0.15, "activeFloor": 0,
    "floors": [{
        "name": "Planta Baja", "height_m": 2.60, "extWall_m": 0.15, "intWall_m": 0.10,
        "vertices": {
            "v1": {"id": "v1", "x": 0, "y": 0},
            "v2": {"id": "v2", "x": 5, "y": 0},
        },
        "edges": {
            "e1": {"id": "e1", "v1": "v1", "v2": "v2", "thickness": 0.15, "openings": []},
        },
        "rooms": [{"name": "Sala", "cx": 2.5, "cy": 2.0}],
    }],
}


def test_geometry_defaults_to_empty_dict(test_property):
    assert get_geometry(test_property["id"]) == {}


def test_set_and_get_roundtrips(test_property):
    assert set_geometry(test_property["id"], MODEL) == MODEL
    assert get_geometry(test_property["id"]) == MODEL


def test_missing_property_returns_none():
    assert get_geometry(999_999_999) is None


def test_get_route_is_empty_by_default(client, test_property):
    r = client.get(f"/api/properties/{test_property['id']}/geometry")
    assert r.status_code == 200
    assert r.json() == {}


def test_put_route_roundtrips(client, test_property):
    r = client.put(f"/api/properties/{test_property['id']}/geometry",
                   json={"geometry": MODEL})
    assert r.status_code == 200
    assert r.json() == MODEL
    assert client.get(f"/api/properties/{test_property['id']}/geometry").json() == MODEL


def test_put_on_a_missing_property_is_404(client):
    assert client.put("/api/properties/999999999/geometry",
                      json={"geometry": {}}).status_code == 404


def test_geometry_requires_auth(client, anonymous):
    assert client.get("/api/properties/1/geometry").status_code in (401, 403)
