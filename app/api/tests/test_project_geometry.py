"""Geometry blob persistence on projects."""
from api.db import get_project_geometry, set_project_geometry


def test_geometry_defaults_to_empty_dict(client, test_project):
    assert get_project_geometry(test_project["id"]) == {}


def test_set_and_get_geometry_roundtrips(test_project):
    model = {
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
    returned = set_project_geometry(test_project["id"], model)
    assert returned == model
    assert get_project_geometry(test_project["id"]) == model


def test_get_geometry_missing_project_returns_none():
    assert get_project_geometry(999_999_999) is None
