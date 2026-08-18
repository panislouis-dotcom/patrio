"""La garantía de «uno por grupo» vive en el índice, no en el código que la usa —
si algo la rodea (una migración de datos, un script suelto), la base de datos la
sigue cumpliendo. Esta suite prueba el índice directo, sin pasar por la API.

Cada render se inserta con su propio `file_path`: la tabla ya trae UNIQUE
(property_id, file_path) desde antes, y repetir la ruta haría que el segundo
INSERT reventara por ESA restricción — las pruebas pasarían sin que el índice
nuevo existiera siquiera.
"""
import itertools

import pytest
from psycopg2 import IntegrityError

from api.db import get_db


PROPERTY = dict(name="[TEST] Elegir render", address="Calle Test 1", city="Monterrey",
                status="prospecto", url="http://x", latitude=25.67, longitude=-100.31)

_ruta = itertools.count()


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
    """Una foto de verdad: `source_image_id` es llave foránea a property_images,
    así que un id inventado fallaría por la FK y no por lo que se quiere probar."""
    with get_db() as conn:
        return conn.execute(
            "INSERT INTO property_images (property_id, file_path, file_name, content_type)"
            " VALUES (%s, %s, 'x.jpg', 'image/jpeg') RETURNING id",
            (property_id, f"properties/{property_id}/x.jpg")).fetchone()["id"]


def _insert_render(conn, property_id, **cols):
    cols = {"property_id": property_id, "file_path": f"render-{next(_ruta)}.png",
            "content_type": "image/png", "prompt_text": "x", "provider": "openai",
            "model": "gpt-image-2", **cols}
    keys = ", ".join(cols)
    placeholders = ", ".join(f"%({k})s" for k in cols)
    return conn.execute(
        f"INSERT INTO property_renders ({keys}) VALUES ({placeholders}) RETURNING id",
        cols).fetchone()["id"]


def test_no_puede_haber_dos_elegidos_en_el_mismo_piso_y_variante(property_id):
    with get_db() as conn:
        _insert_render(conn, property_id, floor_id="f1", source_variant="original", is_chosen=True)
    with pytest.raises(IntegrityError):
        with get_db() as conn:
            _insert_render(conn, property_id, floor_id="f1", source_variant="original",
                           is_chosen=True)


def test_variantes_distintas_del_mismo_piso_pueden_tener_cada_una_su_elegido(property_id):
    with get_db() as conn:
        _insert_render(conn, property_id, floor_id="f1", source_variant="original", is_chosen=True)
        # No debe reventar: es OTRO grupo (mismo piso, variante distinta).
        _insert_render(conn, property_id, floor_id="f1", source_variant="planned", is_chosen=True)


def test_no_puede_haber_dos_elegidos_de_la_misma_foto(property_id, image_id):
    with get_db() as conn:
        _insert_render(conn, property_id, source_image_id=image_id, is_chosen=True)
    with pytest.raises(IntegrityError):
        with get_db() as conn:
            _insert_render(conn, property_id, source_image_id=image_id, is_chosen=True)


def test_pisos_sin_floor_id_nunca_chocan_entre_si(property_id):
    """floor_id NULL es el caso de los renders anteriores al 7-ago (migración 042,
    sin backfill). NULL <> NULL en un índice único de Postgres, así que da igual
    cuántos existan marcados: nunca compiten. El índice también los excluye
    explícitamente (WHERE floor_id IS NOT NULL) — las dos protecciones cuentan."""
    with get_db() as conn:
        _insert_render(conn, property_id, floor_id=None, source_variant=None, is_chosen=True)
        _insert_render(conn, property_id, floor_id=None, source_variant=None, is_chosen=True)
