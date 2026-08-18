"""El backfill de source_image_id para cadenas de render editadas antes del arreglo.

`edit_property_render` mandaba `source_image_id=None` a secas — la cabeza de
una cadena editada (la única que el prospecto y la estrella ven) quedaba
huérfana. El arreglo hacia adelante vive en `routes/renders.py` y se prueba en
`test_renders.py` (junto a las pruebas de choose/unchoose que ya usan sus mismos
fixtures `source_image`/`fake_openai`). Esta suite cubre solo el backfill de lo
que ya quedó mal escrito (migración 047), ejecutando el SQL REAL de la
migración contra datos sintéticos — no una copia a mano que pudiera divergir de
lo que de verdad corre en producción.
"""
from pathlib import Path

import pytest

from api.db import get_db


def _migration_up_sql() -> str:
    path = (Path(__file__).resolve().parent.parent.parent.parent
            / "db" / "migrations" / "047_render_edit_inherits_source_image.sql")
    text = path.read_text()
    up = text.split("-- migrate:up", 1)[1].split("-- migrate:down", 1)[0]
    return up


# ─── El backfill: mismo SQL que la migración 047, contra datos sintéticos ──────

PROPERTY = dict(name="[TEST] Backfill source_image", address="Calle Test 1", city="Monterrey",
                status="prospecto", url="http://x", latitude=25.67, longitude=-100.31)


@pytest.fixture
def property_id():
    with get_db() as conn:
        pid = conn.execute(
            "INSERT INTO properties (name, address, city, status, url, latitude, longitude)"
            " VALUES (%(name)s, %(address)s, %(city)s, %(status)s, %(url)s,"
            "         %(latitude)s, %(longitude)s) RETURNING id", PROPERTY).fetchone()["id"]
    yield pid
    with get_db() as conn:
        conn.execute("DELETE FROM properties WHERE id = %s", (pid,))


@pytest.fixture
def image_id(property_id):
    with get_db() as conn:
        return conn.execute(
            "INSERT INTO property_images (property_id, file_path, file_name, content_type)"
            " VALUES (%s, %s, 'x.jpg', 'image/jpeg') RETURNING id",
            (property_id, f"properties/{property_id}/x.jpg")).fetchone()["id"]


def _insert_render(conn, property_id, **cols):
    cols = {"property_id": property_id, "content_type": "image/png",
            "prompt_text": "x", "provider": "openai", "model": "gpt-image-2", **cols}
    keys = ", ".join(cols)
    placeholders = ", ".join(f"%({k})s" for k in cols)
    return conn.execute(
        f"INSERT INTO property_renders ({keys}) VALUES ({placeholders}) RETURNING id",
        cols).fetchone()["id"]


def test_backfill_propaga_desde_la_raiz_a_toda_la_cadena_de_foto(property_id, image_id):
    with get_db() as conn:
        root = _insert_render(conn, property_id, file_path="r0.png", source_image_id=image_id)
        mid = _insert_render(conn, property_id, file_path="r1.png", parent_render_id=root)
        head = _insert_render(conn, property_id, file_path="r2.png", parent_render_id=mid)

    with get_db() as conn:
        conn.execute(_migration_up_sql())

    with get_db() as conn:
        rows = {r["id"]: r for r in conn.execute(
            "SELECT id, source_image_id FROM property_renders WHERE id = ANY(%s)",
            ([root, mid, head],)).fetchall()}
    assert rows[mid]["source_image_id"] == image_id
    assert rows[head]["source_image_id"] == image_id


def test_backfill_no_toca_cadenas_de_plano(property_id, image_id):
    with get_db() as conn:
        # source_image_id en la raíz es un dato inconsistente a propósito — un
        # render de plano no debería traerlo nunca — para probar de verdad que
        # la guarda `root.source_plan_path IS NULL` es la que excluye esta
        # cadena, y no solo la ausencia casual de un source_image_id.
        root = _insert_render(conn, property_id, file_path="p0.png",
                              source_plan_path="properties/x/plan.png", source_variant="original",
                              source_image_id=image_id)
        head = _insert_render(conn, property_id, file_path="p1.png", parent_render_id=root)

    with get_db() as conn:
        conn.execute(_migration_up_sql())

    with get_db() as conn:
        row = conn.execute("SELECT source_image_id FROM property_renders WHERE id = %s",
                           (head,)).fetchone()
    assert row["source_image_id"] is None


def test_backfill_no_pisa_un_source_image_id_que_ya_estaba_bien(property_id, image_id):
    with get_db() as conn:
        second_image = conn.execute(
            "INSERT INTO property_images (property_id, file_path, file_name, content_type)"
            " VALUES (%s, %s, 'y.jpg', 'image/jpeg') RETURNING id",
            (property_id, f"properties/{property_id}/y.jpg")).fetchone()["id"]
        root = _insert_render(conn, property_id, file_path="r0.png", source_image_id=image_id)
        head = _insert_render(conn, property_id, file_path="r1.png", parent_render_id=root,
                              source_image_id=second_image)

    with get_db() as conn:
        conn.execute(_migration_up_sql())

    with get_db() as conn:
        row = conn.execute("SELECT source_image_id FROM property_renders WHERE id = %s",
                           (head,)).fetchone()
    assert row["source_image_id"] == second_image


def test_backfill_no_inventa_una_foto_que_la_raiz_nunca_tuvo(property_id):
    with get_db() as conn:
        root = _insert_render(conn, property_id, file_path="r0.png")  # huérfano desde el origen
        head = _insert_render(conn, property_id, file_path="r1.png", parent_render_id=root)

    with get_db() as conn:
        conn.execute(_migration_up_sql())

    with get_db() as conn:
        row = conn.execute("SELECT source_image_id FROM property_renders WHERE id = %s",
                           (head,)).fetchone()
    assert row["source_image_id"] is None
