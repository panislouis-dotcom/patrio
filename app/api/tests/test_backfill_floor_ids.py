"""El job de reparación de app/api/jobs/backfill_floor_ids.py: clasifica propiedades
en ilegibles / ya bien / por reparar, y solo escribe las del tercer grupo.
`plano_js.backfill_floor_ids` (el migrateGeometry real) ya se prueba en
test_plano_js.py — esta suite prueba la parte propia del job: el diff y el escrito.

Nunca se llama `job.main()` aquí: fetch_geometries() lee TODA la tabla properties, y
en una base de pruebas compartida eso arrastraría filas de otras fixtures — cada
prueba compone `plan()`/`apply()` a mano sobre un `by_id` acotado a su propia
propiedad, nunca sobre la base entera."""
import asyncio

import pytest
from psycopg2.extras import Json

from api.db import get_db
from api.jobs import backfill_floor_ids as job

pytestmark = pytest.mark.skipif(
    not job.plano_js._BUNDLE.exists(), reason="corre `make build-plano` primero")

PROPERTY = dict(name="[TEST] Backfill floor ids", address="Calle Test 1", city="Monterrey",
                status="prospecto", url="http://x", latitude=25.67, longitude=-100.31)


def _rect(fid=None):
    V = {"v0": {"id": "v0", "x": 0, "y": 0}, "v1": {"id": "v1", "x": 4, "y": 0},
         "v2": {"id": "v2", "x": 4, "y": 3}, "v3": {"id": "v3", "x": 0, "y": 3}}
    E = {f"e{i}": {"id": f"e{i}", "v1": f"v{i}", "v2": f"v{(i + 1) % 4}",
                   "thickness": 0.15, "openings": []} for i in range(4)}
    f = {"name": "Planta Baja", "height_m": 2.6, "extWall_m": 0.15, "intWall_m": 0.10,
         "vertices": V, "edges": E, "rooms": [], "fixtures": [], "manualDimensions": []}
    if fid is not None:
        f["id"] = fid
    return f


V2_SIN_ID = {"schemaVersion": 2, "slab_m": 0.15, "activeFloor": 0, "floors": [_rect()]}
V3_CON_ID = {"schemaVersion": 3, "variants": {
    "original": {"slab_m": 0.15, "activeFloor": 0, "floors": [_rect("piso-1")]},
    "planned": None}}


@pytest.fixture
def make_property():
    ids = []

    def _make(geometry):
        with get_db() as conn:
            pid = conn.execute(
                "INSERT INTO properties (name, address, city, status, url, latitude, longitude,"
                " geometry) VALUES (%(name)s, %(address)s, %(city)s, %(status)s, %(url)s,"
                " %(latitude)s, %(longitude)s, %(geometry)s) RETURNING id",
                {**PROPERTY, "geometry": Json(geometry)},
            ).fetchone()["id"]
        ids.append(pid)
        return pid

    yield _make
    with get_db() as conn:
        for pid in ids:
            conn.execute("DELETE FROM properties WHERE id = %s", (pid,))


def test_una_propiedad_v2_sin_id_cae_en_por_reparar(make_property):
    pid = make_property(V2_SIN_ID)
    by_id = {pid: (PROPERTY["name"], V2_SIN_ID)}
    illegible, unchanged, to_fix = asyncio.run(job.plan(by_id))
    assert illegible == [] and unchanged == []
    assert [p for p, _, _ in to_fix] == [pid]


def test_una_propiedad_v3_con_id_cae_en_ya_bien(make_property):
    pid = make_property(V3_CON_ID)
    by_id = {pid: (PROPERTY["name"], V3_CON_ID)}
    illegible, unchanged, to_fix = asyncio.run(job.plan(by_id))
    assert to_fix == [] and illegible == []
    assert [p for p, _ in unchanged] == [pid]


def test_geometria_ilegible_cae_en_ilegible(make_property):
    basura = {"schemaVersion": 1, "walls": []}
    pid = make_property(basura)
    by_id = {pid: (PROPERTY["name"], basura)}
    illegible, unchanged, to_fix = asyncio.run(job.plan(by_id))
    assert to_fix == [] and unchanged == []
    assert [p for p, _ in illegible] == [pid]


def test_apply_persiste_el_id_relleno(make_property):
    pid = make_property(V2_SIN_ID)
    by_id = {pid: (PROPERTY["name"], V2_SIN_ID)}
    _, _, to_fix = asyncio.run(job.plan(by_id))
    job.apply(to_fix)

    with get_db() as conn:
        row = conn.execute("SELECT geometry FROM properties WHERE id = %s", (pid,)).fetchone()
    floor = row["geometry"]["variants"]["original"]["floors"][0]
    assert floor["id"]


def test_reparar_una_propiedad_no_toca_otra(make_property):
    """apply() solo escribe las filas listadas en to_fix — nunca toda la tabla."""
    fixed = make_property(V2_SIN_ID)
    untouched = make_property(V3_CON_ID)
    by_id = {fixed: (PROPERTY["name"], V2_SIN_ID), untouched: (PROPERTY["name"], V3_CON_ID)}
    _, _, to_fix = asyncio.run(job.plan(by_id))
    assert [p for p, _, _ in to_fix] == [fixed]
    job.apply(to_fix)

    with get_db() as conn:
        row = conn.execute("SELECT geometry FROM properties WHERE id = %s", (untouched,)).fetchone()
    assert row["geometry"] == V3_CON_ID


def test_correr_apply_dos_veces_es_idempotente(make_property):
    pid = make_property(V2_SIN_ID)
    by_id = {pid: (PROPERTY["name"], V2_SIN_ID)}
    _, _, to_fix = asyncio.run(job.plan(by_id))
    job.apply(to_fix)

    with get_db() as conn:
        after_first = conn.execute(
            "SELECT geometry FROM properties WHERE id = %s", (pid,)).fetchone()["geometry"]

    # Segunda pasada: plan() sobre el estado YA reparado debe caer en "ya bien",
    # no volver a ofrecerlo para reparar.
    by_id_2 = {pid: (PROPERTY["name"], after_first)}
    illegible, unchanged, to_fix_2 = asyncio.run(job.plan(by_id_2))
    assert to_fix_2 == [] and [p for p, _ in unchanged] == [pid]
