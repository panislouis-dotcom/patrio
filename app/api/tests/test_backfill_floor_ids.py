"""El backfill de ids de piso efímeros y el re-ligado de renders huérfanos
(migración 048), ejecutando el SQL REAL de la migración contra datos sintéticos
— no una copia a mano que pudiera divergir de lo que de verdad corre en
producción. Ver el comentario de la migración para el porqué completo.
"""
import threading
import time
from pathlib import Path

import psycopg2
import psycopg2.errors
import pytest
from psycopg2.extras import Json

from api.config import DATABASE_URL
from api.db import get_db


def _migration_up_sql() -> str:
    path = (Path(__file__).resolve().parent.parent.parent.parent
            / "db" / "migrations" / "048_backfill_floor_ids.sql")
    text = path.read_text()
    up = text.split("-- migrate:up", 1)[1].split("-- migrate:down", 1)[0]
    return up


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


def _insert_render(conn, property_id, **cols):
    cols = {"property_id": property_id, "content_type": "image/png", "prompt_text": "x",
            "provider": "openai", "model": "gpt-image-2", **cols}
    keys = ", ".join(cols)
    placeholders = ", ".join(f"%({k})s" for k in cols)
    return conn.execute(
        f"INSERT INTO property_renders ({keys}) VALUES ({placeholders}) RETURNING id",
        cols).fetchone()["id"]


def _run_migration():
    with get_db() as conn:
        conn.execute(_migration_up_sql())


def _geometry(pid):
    with get_db() as conn:
        return conn.execute(
            "SELECT geometry FROM properties WHERE id = %s", (pid,)).fetchone()["geometry"]


def _is_chosen(rid):
    with get_db() as conn:
        return conn.execute(
            "SELECT is_chosen FROM property_renders WHERE id = %s", (rid,)).fetchone()["is_chosen"]


def _floor_id(rid):
    with get_db() as conn:
        return conn.execute(
            "SELECT floor_id FROM property_renders WHERE id = %s", (rid,)).fetchone()["floor_id"]


def _floor(name, fid=None):
    f = {"name": name, "height_m": 2.6, "extWall_m": 0.15, "intWall_m": 0.10,
         "vertices": {}, "edges": {}, "rooms": []}
    if fid is not None:
        f["id"] = fid
    return f


# ─── geometry: v2→v3 + backfill de id por piso ──────────────────────────────

def test_v2_sin_id_sube_a_v3_con_id_real(make_property):
    pid = make_property("[TEST048] v2", {"schemaVersion": 2, "slab_m": 0.15,
                                          "activeFloor": 0, "floors": [_floor("PB")]})
    _run_migration()
    g = _geometry(pid)
    assert g["schemaVersion"] == 3
    assert g["variants"]["original"]["floors"][0]["id"]
    assert g["variants"]["planned"] is None


def test_v3_sin_planned_normaliza_a_null_y_rellena_id(make_property):
    pid = make_property("[TEST048] v3 sin planned", {"schemaVersion": 3, "variants": {
        "original": {"slab_m": 0.15, "activeFloor": 0, "floors": [_floor("PB")]}}})
    _run_migration()
    g = _geometry(pid)
    assert g["variants"]["original"]["floors"][0]["id"]
    assert g["variants"]["planned"] is None


def test_v3_con_id_ya_puesto_no_lo_pisa(make_property):
    geometry = {"schemaVersion": 3, "variants": {
        "original": {"slab_m": 0.15, "activeFloor": 0, "floors": [_floor("PB", "piso-1")]},
        "planned": None}}
    pid = make_property("[TEST048] ya bien", geometry)
    _run_migration()
    assert _geometry(pid) == geometry


def test_planned_malformado_invalida_el_blob_entero(make_property):
    """types.ts:245 — 'si miente en una variante puede mentir en la otra': ni
    siquiera `original` (que sí es válido) se toca."""
    geometry = {"schemaVersion": 3, "variants": {
        "original": {"slab_m": 0.15, "activeFloor": 0, "floors": [_floor("PB")]},
        "planned": {"noFloorsKey": True}}}
    pid = make_property("[TEST048] planned malo", geometry)
    _run_migration()
    assert _geometry(pid) == geometry


def test_schema_version_1_ilegible_no_se_toca(make_property):
    geometry = {"schemaVersion": 1, "walls": []}
    pid = make_property("[TEST048] v1", geometry)
    _run_migration()
    assert _geometry(pid) == geometry


def test_geometria_vacia_no_se_toca(make_property):
    pid = make_property("[TEST048] vacia", {})
    _run_migration()
    assert _geometry(pid) == {}


# ─── property_renders.floor_id: re-ligar por floor_name ────────────────────

def test_dos_renders_huerfanos_con_ids_distintos_convergen_al_mismo_id_real(make_property):
    """El caso real de Vicente Guerrero: un piso sin id persistido, dos renders
    generados en cargas distintas (cada uno con su propio id efímero de esa
    carga) — ambos deben re-ligarse al MISMO id real tras la migración."""
    pid = make_property("[TEST048] vicente", {"schemaVersion": 3, "variants": {
        "original": {"slab_m": 0.15, "activeFloor": 0,
                     "floors": [_floor("Planta Baja"), _floor("Planta Alta")]},
        "planned": None}})
    with get_db() as conn:
        r1 = _insert_render(conn, pid, file_path="r1.png", source_variant="original",
                            floor_id="ephemeral-aaa", floor_name="Planta Baja")
        r2 = _insert_render(conn, pid, file_path="r2.png", source_variant="original",
                            floor_id="ephemeral-bbb", floor_name="Planta Baja")
        r3 = _insert_render(conn, pid, file_path="r3.png", source_variant="original",
                            floor_id="ephemeral-ccc", floor_name="Planta Alta")

    _run_migration()

    baja_id = _geometry(pid)["variants"]["original"]["floors"][0]["id"]
    alta_id = _geometry(pid)["variants"]["original"]["floors"][1]["id"]
    assert _floor_id(r1) == _floor_id(r2) == baja_id
    assert _floor_id(r3) == alta_id
    assert baja_id != alta_id


def test_nombre_de_piso_ambiguo_no_adivina(make_property):
    """Dos pisos con el mismo nombre: no hay forma honesta de saber a cuál
    pertenecía el render — se deja tal cual, no se adivina."""
    pid = make_property("[TEST048] nombre duplicado", {"schemaVersion": 3, "variants": {
        "original": {"slab_m": 0.15, "activeFloor": 0,
                     "floors": [_floor("PB"), _floor("PB")]},
        "planned": None}})
    with get_db() as conn:
        r = _insert_render(conn, pid, file_path="r.png", source_variant="original",
                           floor_id="ephemeral-ddd", floor_name="PB")

    _run_migration()
    assert _floor_id(r) == "ephemeral-ddd"


def test_render_ya_bien_ligado_no_se_toca(make_property):
    pid = make_property("[TEST048] ya ligado", {"schemaVersion": 3, "variants": {
        "original": {"slab_m": 0.15, "activeFloor": 0, "floors": [_floor("PB", "piso-1")]},
        "planned": None}})
    with get_db() as conn:
        r = _insert_render(conn, pid, file_path="r.png", source_variant="original",
                           floor_id="piso-1", floor_name="PB")

    _run_migration()
    assert _floor_id(r) == "piso-1"


def test_render_sin_floor_id_no_se_toca(make_property):
    """El caso histórico real de la propiedad 5 (migración 042): 8 renders de
    antes de que floor_id/floor_name existieran, floor_id vacío para siempre
    — no hay piso que inventarles."""
    pid = make_property("[TEST048] sin floor_id", {"schemaVersion": 3, "variants": {
        "original": {"slab_m": 0.15, "activeFloor": 0, "floors": [_floor("PB")]},
        "planned": None}})
    with get_db() as conn:
        r = _insert_render(conn, pid, file_path="r.png", source_variant=None,
                           floor_id=None, floor_name=None)

    _run_migration()
    assert _floor_id(r) is None


def test_render_de_una_propiedad_no_toca_el_de_otra(make_property):
    """El match por floor_name está acotado a la MISMA propiedad — dos
    propiedades distintas pueden compartir nombre de piso sin cruzarse."""
    p1 = make_property("[TEST048] prop A", {"schemaVersion": 3, "variants": {
        "original": {"slab_m": 0.15, "activeFloor": 0, "floors": [_floor("PB")]},
        "planned": None}})
    p2 = make_property("[TEST048] prop B", {"schemaVersion": 3, "variants": {
        "original": {"slab_m": 0.15, "activeFloor": 0, "floors": [_floor("PB")]},
        "planned": None}})
    with get_db() as conn:
        r1 = _insert_render(conn, p1, file_path="r1.png", source_variant="original",
                            floor_id="ephemeral-a", floor_name="PB")
        r2 = _insert_render(conn, p2, file_path="r2.png", source_variant="original",
                            floor_id="ephemeral-b", floor_name="PB")

    _run_migration()
    id1 = _geometry(p1)["variants"]["original"]["floors"][0]["id"]
    id2 = _geometry(p2)["variants"]["original"]["floors"][0]["id"]
    assert _floor_id(r1) == id1
    assert _floor_id(r2) == id2
    assert id1 != id2


def test_correr_la_migracion_dos_veces_es_idempotente(make_property):
    pid = make_property("[TEST048] idempotente", {"schemaVersion": 2, "slab_m": 0.15,
                                                   "activeFloor": 0, "floors": [_floor("PB")]})
    with get_db() as conn:
        r = _insert_render(conn, pid, file_path="r.png", source_variant="original",
                           floor_id="ephemeral-x", floor_name="PB")

    _run_migration()
    geometry_after_first = _geometry(pid)
    floor_id_after_first = _floor_id(r)

    _run_migration()
    assert _geometry(pid) == geometry_after_first
    assert _floor_id(r) == floor_id_after_first


# ─── lock_timeout: una colisión de verdad falla rápido, no cuelga el deploy ──

def test_una_fila_bloqueada_falla_rapido_por_lock_timeout_no_se_cuelga(make_property):
    """`properties.geometry` no es una columna fría — el editor la escribe en vivo
    cada guardado. Sin `SET LOCAL lock_timeout`, un choque con un guardado real en
    prod se queda esperando en silencio hasta el activeDeadlineSeconds del Job de
    deploy (PreSync — congela el deploy ENTERO, no solo esta migración). Esta
    prueba reproduce esa colisión de verdad —dos conexiones reales, un lock real
    en un `properties.id` real— y confirma que la migración falla en segundos con
    un error identificable (55P03), no que se queda colgada."""
    pid = make_property("[TEST048] bloqueada", {"schemaVersion": 2, "slab_m": 0.15,
                                                 "activeFloor": 0, "floors": [_floor("PB")]})

    ready, release = threading.Event(), threading.Event()

    def _hold_the_row():
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = False
        cur = conn.cursor()
        cur.execute("UPDATE properties SET name = name WHERE id = %s", (pid,))
        ready.set()
        release.wait(10)
        conn.rollback()
        conn.close()

    holder = threading.Thread(target=_hold_the_row)
    holder.start()
    ready.wait(5)
    try:
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = False
        cur = conn.cursor()
        start = time.time()
        with pytest.raises(psycopg2.errors.LockNotAvailable):
            cur.execute(_migration_up_sql())
        elapsed = time.time() - start
        conn.rollback()
        conn.close()
        # El lock_timeout de la migración es 5s — 15s da margen de sobra a la
        # infraestructura de CI sin dejar pasar una regresión real (colgarse
        # hasta el activeDeadlineSeconds de 180s del Job de deploy).
        assert elapsed < 15, f"tardó {elapsed:.1f}s — ¿se perdió el SET LOCAL lock_timeout?"
    finally:
        release.set()
        holder.join()


# ─── is_chosen: repointing puede DESTAPAR una colisión, no debe tronar ──────

def test_dos_renders_elegidos_del_mismo_piso_bajo_ids_efimeros_distintos_se_desmarcan(make_property):
    """El caso real que reventó en prod (propiedad 10, "Levantamiento"): dos
    renders de la MISMA propiedad y variante, cada uno con su propio id efímero
    distinto, ambos is_chosen=true — el índice único de la migración 046 nunca
    los vio como el mismo piso porque, hasta este momento, no lo eran. En
    cuanto el repointing los re-liga al mismo piso real, competirían por el
    mismo (property_id, floor_id, source_variant); esta migración los desmarca
    a los DOS antes de que eso pase, en vez de tronar a mitad de camino."""
    pid = make_property("[TEST048] colision real", {"schemaVersion": 3, "variants": {
        "original": {"slab_m": 0.15, "activeFloor": 0,
                     "floors": [_floor("Levantamiento"), _floor("Planta Alta")]},
        "planned": None}})
    with get_db() as conn:
        r23 = _insert_render(conn, pid, file_path="r23.png", source_variant="original",
                             floor_id="ephemeral-AAA", floor_name="Levantamiento", is_chosen=True)
        r24 = _insert_render(conn, pid, file_path="r24.png", source_variant="original",
                             floor_id="ephemeral-BBB", floor_name="Planta Alta", is_chosen=True)
        r25 = _insert_render(conn, pid, file_path="r25.png", source_variant="original",
                             floor_id="ephemeral-CCC", floor_name="Levantamiento", is_chosen=True)

    _run_migration()  # no debe lanzar — antes de este arreglo, esto tronaba con 23505

    baja_id = _geometry(pid)["variants"]["original"]["floors"][0]["id"]
    assert _floor_id(r23) == _floor_id(r25) == baja_id
    assert _is_chosen(r23) is False and _is_chosen(r25) is False
    # el que no compite por nada sigue eligido y repuntado normalmente
    assert _is_chosen(r24) is True
    assert _floor_id(r24) == _geometry(pid)["variants"]["original"]["floors"][1]["id"]


def test_un_render_ya_elegido_sin_conflicto_no_se_desmarca(make_property):
    pid = make_property("[TEST048] sin conflicto", {"schemaVersion": 2, "slab_m": 0.15,
                                                     "activeFloor": 0, "floors": [_floor("PB")]})
    with get_db() as conn:
        r = _insert_render(conn, pid, file_path="r.png", source_variant="original",
                           floor_id="ephemeral-x", floor_name="PB", is_chosen=True)

    _run_migration()
    assert _is_chosen(r) is True


def test_nombre_ambiguo_con_is_chosen_no_se_toca_ni_el_id_ni_la_estrella(make_property):
    """`_final_floor_id` regresa NULL cuando el nombre no resuelve a un único
    piso — ni el repointing ni la resolución de colisiones deben tocar nada
    ahí, mismo "no adivina" que ya prueba test_nombre_de_piso_ambiguo_no_adivina
    para el floor_id; esta prueba cubre que is_chosen tampoco se toca."""
    pid = make_property("[TEST048] ambiguo elegido", {"schemaVersion": 3, "variants": {
        "original": {"slab_m": 0.15, "activeFloor": 0,
                     "floors": [_floor("PB"), _floor("PB")]},
        "planned": None}})
    with get_db() as conn:
        r = _insert_render(conn, pid, file_path="r.png", source_variant="original",
                           floor_id="ephemeral-ddd", floor_name="PB", is_chosen=True)

    _run_migration()
    assert _floor_id(r) == "ephemeral-ddd"
    assert _is_chosen(r) is True
