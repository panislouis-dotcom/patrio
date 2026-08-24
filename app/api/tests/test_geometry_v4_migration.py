"""La migración de geometría v3→v4 y el CHECK relajado de source_variant
(migración 050), ejecutando el SQL REAL de la migración contra datos sintéticos
— no una copia a mano que pudiera divergir de lo que corre en producción
(mismo patrón que test_backfill_floor_ids.py para la 048). Ver el comentario
de la migración para el porqué del id literal 'planned'.
"""
from pathlib import Path

import psycopg2.errors
import pytest
from psycopg2.extras import Json

from api.db import get_db


def _migration_up_sql() -> str:
    path = (Path(__file__).resolve().parent.parent.parent.parent
            / "db" / "migrations" / "050_geometry_v4_planes.sql")
    text = path.read_text()
    return text.split("-- migrate:up", 1)[1].split("-- migrate:down", 1)[0]


PROPERTY = dict(address="Calle Test 1", city="Monterrey", status="prospecto",
                url="http://x", latitude=25.67, longitude=-100.31)


@pytest.fixture
def make_property():
    ids = []

    def _make(name, geometry):
        with get_db() as conn:
            pid = conn.execute(
                "INSERT INTO properties (name, address, city, status, url, latitude,"
                " longitude, geometry) VALUES (%(name)s, %(address)s, %(city)s,"
                " %(status)s, %(url)s, %(latitude)s, %(longitude)s, %(geometry)s)"
                " RETURNING id",
                {**PROPERTY, "name": name, "geometry": Json(geometry)}).fetchone()["id"]
        ids.append(pid)
        return pid

    yield _make
    with get_db() as conn:
        for pid in ids:
            conn.execute("DELETE FROM properties WHERE id = %s", (pid,))


def _run_migration():
    with get_db() as conn:
        conn.execute(_migration_up_sql())


def _geometry(pid):
    with get_db() as conn:
        return conn.execute(
            "SELECT geometry FROM properties WHERE id = %s", (pid,)).fetchone()["geometry"]


def _floor(name, fid="f-1"):
    return {"id": fid, "name": name, "height_m": 2.6, "extWall_m": 0.15,
            "intWall_m": 0.10, "vertices": {}, "edges": {}, "rooms": []}


def _floor_set(floor_name="Planta Baja", fid="f-1"):
    return {"slab_m": 0.15, "activeFloor": 0, "floors": [_floor(floor_name, fid)]}


# ─── geometry: v3 → v4 ───────────────────────────────────────────────────────

def test_v3_con_planned_sube_a_v4_con_el_plan_legado_exacto(make_property):
    planned = _floor_set("Planta Planeada", "f-plan")
    pid = make_property("con planned", {
        "schemaVersion": 3,
        "variants": {"original": _floor_set(), "planned": planned},
    })
    _run_migration()
    g = _geometry(pid)
    assert g["schemaVersion"] == 4
    # El id LITERAL 'planned' y el nombre por default — deterministas, idénticos a
    # lo que la rama v3→v4 de migrateGeometry (types.ts) produce en memoria.
    assert g["variants"]["plans"] == [
        {"id": "planned", "name": "Plan de proyecto", "fs": planned}]
    assert g["variants"]["original"] == _floor_set()
    assert "planned" not in g["variants"]


def test_v3_sin_planned_sube_a_v4_con_plans_vacio(make_property):
    con_null = make_property("planned null", {
        "schemaVersion": 3,
        "variants": {"original": _floor_set(), "planned": None},
    })
    sin_clave = make_property("sin clave planned", {
        "schemaVersion": 3,
        "variants": {"original": _floor_set()},
    })
    _run_migration()
    for pid in (con_null, sin_clave):
        g = _geometry(pid)
        assert g["schemaVersion"] == 4
        assert g["variants"]["plans"] == []


def test_v3_con_planned_malformado_no_se_toca(make_property):
    # migrateGeometry rechaza el blob entero al leer; no hay nada honesto que
    # escribir de vuelta — se queda en v3 tal cual, mismo criterio que la 048.
    blob = {"schemaVersion": 3,
            "variants": {"original": _floor_set(), "planned": {"floors": "no soy arreglo"}}}
    pid = make_property("planned malformado", blob)
    _run_migration()
    assert _geometry(pid) == blob


def test_v4_existente_v2_v1_y_vacia_no_se_tocan(make_property):
    v4 = {"schemaVersion": 4,
          "variants": {"original": _floor_set(),
                       "plans": [{"id": "abc", "name": "Plan B", "fs": _floor_set("Otra", "f-2")}]}}
    v2 = {"schemaVersion": 2, "slab_m": 0.15, "activeFloor": 0, "floors": [_floor("PB")]}
    v1 = {"schemaVersion": 1, "active": 0, "floors": []}
    intactos = {
        make_property("ya v4", v4): v4,
        make_property("v2 legado", v2): v2,
        make_property("v1 ilegible", v1): v1,
        make_property("vacia", {}): {},
    }
    _run_migration()
    for pid, blob in intactos.items():
        assert _geometry(pid) == blob


# ─── property_renders: el CHECK relajado ─────────────────────────────────────

def _insert_render(conn, property_id, **cols):
    cols = {"property_id": property_id, "content_type": "image/png", "prompt_text": "x",
            "provider": "openai", "model": "gpt-image-2",
            "file_path": f"t/{id(cols)}.png", **cols}
    keys = ", ".join(cols)
    placeholders = ", ".join(f"%({k})s" for k in cols)
    return conn.execute(
        f"INSERT INTO property_renders ({keys}) VALUES ({placeholders}) RETURNING id",
        cols).fetchone()["id"]


def test_renders_existentes_quedan_intactos_cero_updates(make_property):
    pid = make_property("con renders", {
        "schemaVersion": 3,
        "variants": {"original": _floor_set(), "planned": _floor_set("Planeada", "f-p")},
    })
    with get_db() as conn:
        r_planned = _insert_render(conn, pid, source_variant="planned",
                                   file_path="t/planned.png", floor_id="f-p")
        r_original = _insert_render(conn, pid, source_variant="original",
                                    file_path="t/original.png", floor_id="f-1")
        r_foto = _insert_render(conn, pid, source_variant=None, file_path="t/foto.png")
    _run_migration()
    with get_db() as conn:
        rows = {r["id"]: r for r in conn.execute(
            "SELECT id, source_variant, floor_id, is_chosen FROM property_renders"
            " WHERE property_id = %s", (pid,)).fetchall()}
    # La migración no toca property_renders: el plan migrado conserva el id
    # 'planned', así que estas filas ya lo direccionan sin backfill.
    assert rows[r_planned]["source_variant"] == "planned"
    assert rows[r_original]["source_variant"] == "original"
    assert rows[r_foto]["source_variant"] is None
    with get_db() as conn:
        conn.execute("DELETE FROM property_renders WHERE property_id = %s", (pid,))


def test_check_nuevo_acepta_plan_id_y_rechaza_vacio(make_property):
    pid = make_property("check nuevo", {})
    _run_migration()
    with get_db() as conn:
        rid = _insert_render(conn, pid, source_variant="7f0c1a2e-un-plan-id",
                             file_path="t/uuid.png")
        assert rid
    with pytest.raises(psycopg2.errors.CheckViolation):
        with get_db() as conn:
            _insert_render(conn, pid, source_variant="", file_path="t/vacio.png")
    with get_db() as conn:
        conn.execute("DELETE FROM property_renders WHERE property_id = %s", (pid,))
