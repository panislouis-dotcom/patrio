"""Floorplan geometry — one blob per property, stored and served whole.

One file, because there is now one entity: this replaces the four that existed
when a prospect and a project each had their own identical implementation.

Desde la 052 el blob viaja con su `revision` (candado optimista): guardar
reemplaza TODO el JSON, así que cada escritura declara de qué revisión partió
y solo procede si sigue vigente — el guardado tardío recibe 409, nunca pisa."""
import pytest

from api.properties_db import GeometryConflict, get_geometry, set_geometry

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


def test_geometry_defaults_to_empty_dict_at_revision_zero(test_property):
    assert get_geometry(test_property["id"]) == {"geometry": {}, "revision": 0}


def test_set_and_get_roundtrips_and_bumps_the_revision(test_property):
    saved = set_geometry(test_property["id"], MODEL, expected_revision=0)
    assert saved == {"geometry": MODEL, "revision": 1}
    assert get_geometry(test_property["id"]) == saved


def test_a_stale_revision_conflicts_and_writes_nothing(test_property):
    set_geometry(test_property["id"], MODEL, expected_revision=0)
    late = {**MODEL, "slab_m": 0.20}
    # El guardado que partió de la revisión 0 llega tarde: 409, y el blob
    # vigente queda intacto — perder el cambio TARDÍO es recuperable (su autor
    # se entera y recarga); perder el ya guardado no lo sería.
    with pytest.raises(GeometryConflict) as exc:
        set_geometry(test_property["id"], late, expected_revision=0)
    assert exc.value.current_revision == 1
    assert get_geometry(test_property["id"]) == {"geometry": MODEL, "revision": 1}


def test_missing_property_returns_none():
    assert get_geometry(999_999_999) is None
    assert set_geometry(999_999_999, MODEL, expected_revision=0) is None


def test_get_route_is_empty_by_default(client, test_property):
    r = client.get(f"/api/properties/{test_property['id']}/geometry")
    assert r.status_code == 200
    assert r.json() == {"geometry": {}, "revision": 0}


def test_put_route_roundtrips(client, test_property):
    r = client.put(f"/api/properties/{test_property['id']}/geometry",
                   json={"geometry": MODEL, "expectedRevision": 0})
    assert r.status_code == 200
    assert r.json() == {"geometry": MODEL, "revision": 1}
    assert client.get(f"/api/properties/{test_property['id']}/geometry").json() \
        == {"geometry": MODEL, "revision": 1}


def test_put_with_a_stale_revision_is_409(client, test_property):
    pid = test_property["id"]
    client.put(f"/api/properties/{pid}/geometry",
               json={"geometry": MODEL, "expectedRevision": 0})
    r = client.put(f"/api/properties/{pid}/geometry",
                   json={"geometry": {}, "expectedRevision": 0})
    assert r.status_code == 409
    assert "otra sesión" in r.json()["error"]["message"]
    assert client.get(f"/api/properties/{pid}/geometry").json() \
        == {"geometry": MODEL, "revision": 1}


def test_put_without_a_revision_is_rejected(client, test_property):
    # Un guardado que no declara su punto de partida es exactamente el que
    # pisa a los demás en silencio: 422, no un default complaciente.
    r = client.put(f"/api/properties/{test_property['id']}/geometry",
                   json={"geometry": MODEL})
    assert r.status_code == 422


def test_put_on_a_missing_property_is_404(client):
    assert client.put("/api/properties/999999999/geometry",
                      json={"geometry": {}, "expectedRevision": 0}).status_code == 404


def test_geometry_requires_auth(client, anonymous):
    assert client.get("/api/properties/1/geometry").status_code in (401, 403)
