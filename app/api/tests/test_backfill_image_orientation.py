"""El backfill de orientación, contra las cuatro fuentes que guarda la base.

Su peor forma de fallar es callada: un campo renombrado en cualquiera de los
módulos de DB y el script recorre cero imágenes, reporta «0 por corregir» y se
le cree. Por eso cada fuente se siembra torcida y se exige que salga en el
recorrido — que no truene no prueba nada aquí.
"""
import io
import sys
from pathlib import Path

import pytest
from PIL import Image

from api import db_proveedores, properties_db, renders_db, storage

_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_ROOT / "scripts"))

import backfill_image_orientation as backfill  # noqa: E402

_ORIENTATION = 0x0112


def _torcida() -> bytes:
    """Lo que sube un teléfono: píxeles acostados y la rotación sólo en el tag."""
    exif = Image.Exif()
    exif[_ORIENTATION] = 6
    buf = io.BytesIO()
    Image.new("RGB", (20, 40), (200, 30, 30)).save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


def _stored(key: str) -> Image.Image:
    return Image.open(io.BytesIO(storage.stream(key)[0]))


@pytest.fixture
def torcidas(test_property):
    """Una imagen sin corregir en cada una de las cinco procedencias."""
    pid = test_property["id"]
    photo = properties_db.add_image(
        pid, f"properties/{pid}/backfill-foto.jpg", "foto.jpg", "image/jpeg")
    reference_key = f"properties/{pid}/floorplan/backfill-ref.jpg"
    properties_db.set_geometry(pid, {
        "schemaVersion": 2, "slab_m": 0.15, "activeFloor": 0,
        "floors": [{
            "name": "Planta Baja", "height_m": 2.6, "extWall_m": 0.15, "intWall_m": 0.10,
            "vertices": {}, "edges": {}, "rooms": [],
            "reference": {"imageKey": reference_key, "scale_m_per_px": 0.01,
                          "origin_px": [0, 0], "opacity": 0.5},
        }],
    })
    render = renders_db.add_render(
        pid, None, f"properties/{pid}/renders/backfill-render.jpg", "image/jpeg",
        None, "amuebla la sala", "openai", "gpt-image-2",
        source_plan_path=f"properties/{pid}/renders/backfill-plano.jpg")
    proveedor = db_proveedores.create_proveedor({"name": "[TEST] Backfill"})
    proveedor_photo = db_proveedores.add_proveedor_photo(
        proveedor["id"], f"proveedores/{proveedor['id']}/backfill-obra.jpg",
        "obra.jpg", "image/jpeg")

    keys = {
        backfill.PROPERTY_PHOTO: photo["filePath"],
        backfill.FLOORPLAN_REFERENCE: reference_key,
        backfill.RENDER: render["filePath"],
        backfill.RENDER_PLAN: render["sourcePlanPath"],
        backfill.PROVEEDOR_PHOTO: proveedor_photo["filePath"],
    }
    content = _torcida()
    for key in keys.values():
        storage.upload(key, content, "image/jpeg")
    yield keys
    for key in keys.values():
        storage.delete(key)
    db_proveedores.delete_proveedor(proveedor["id"])


@pytest.fixture
def otra_propiedad():
    """Otra propiedad con su propia foto torcida, para que acotar tenga qué dejar
    fuera: sin ella, un filtro roto que devuelve todo pasaría igual."""
    prop = properties_db.create_property({
        "name": "[TEST] Backfill vecina", "address": "Calle Vecina 2", "city": "Monterrey",
        "latitude": 25.6866, "longitude": -100.3161})
    photo = properties_db.add_image(
        prop["id"], f"properties/{prop['id']}/backfill-vecina.jpg", "vecina.jpg", "image/jpeg")
    storage.upload(photo["filePath"], _torcida(), "image/jpeg")
    yield {"id": prop["id"], "key": photo["filePath"]}
    storage.delete(photo["filePath"])
    properties_db.delete_property(prop["id"])


def test_el_recorrido_encuentra_las_cinco_procedencias(torcidas):
    encontradas = {key: source for source, key in backfill.collect_keys()}
    assert [encontradas.get(key) for key in torcidas.values()] == list(torcidas)


def test_la_simulacion_las_cuenta_pero_no_escribe(torcidas):
    resumen = backfill.backfill(apply=False)
    assert [resumen["fixed"][source] >= 1 for source in torcidas] == [True] * len(torcidas)
    for key in torcidas.values():
        assert _stored(key).getexif().get(_ORIENTATION, 1) == 6


def test_apply_las_endereza_y_una_segunda_pasada_ya_no_halla_nada(torcidas):
    backfill.backfill(apply=True)
    for key in torcidas.values():
        corregida = _stored(key)
        assert corregida.size == (40, 20)
        assert corregida.getexif().get(_ORIENTATION, 1) == 1
    assert sum(backfill.backfill(apply=True)["fixed"].values()) == 0


def test_un_key_sin_archivo_se_salta_sin_tumbar_el_recorrido(test_property, torcidas):
    properties_db.add_image(test_property["id"],
                            f"properties/{test_property['id']}/borrada.jpg",
                            "borrada.jpg", "image/jpeg")
    resumen = backfill.backfill(apply=False)
    assert resumen["missing"][backfill.PROPERTY_PHOTO] >= 1
    assert resumen["fixed"][backfill.PROPERTY_PHOTO] >= 1


def test_property_id_deja_fuera_lo_que_no_es_de_esa_propiedad(torcidas, otra_propiedad):
    completo = {key for _, key in backfill.collect_keys()}
    acotado = {key for _, key in backfill.collect_keys(property_id=otra_propiedad["id"])}

    assert acotado == {otra_propiedad["key"]}
    assert set(torcidas.values()) <= completo  # sin acotar sí salen todas
    assert not acotado & set(torcidas.values())

    resumen = backfill.backfill(apply=False, property_id=otra_propiedad["id"])
    assert resumen["fixed"][backfill.PROPERTY_PHOTO] == 1
    assert resumen["fixed"][backfill.PROVEEDOR_PHOTO] == 0


def test_property_id_de_una_propiedad_que_no_existe_se_queja(torcidas):
    with pytest.raises(properties_db.PropertyNotFound):
        backfill.collect_keys(property_id=999_999_999)


def test_una_escritura_que_falla_no_se_lleva_el_recorrido(torcidas, monkeypatch):
    def _revienta(key, content, content_type):
        raise RuntimeError("storage no disponible")

    monkeypatch.setattr(backfill.storage, "upload", _revienta)
    resumen = backfill.backfill(apply=True)

    assert sum(resumen["failed"].values()) == len(torcidas)  # las intentó todas
    assert sum(resumen["fixed"].values()) == 0
    for key in torcidas.values():
        assert _stored(key).getexif().get(_ORIENTATION, 1) == 6
