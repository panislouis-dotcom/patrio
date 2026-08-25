"""El backfill de orientación, contra todas las fuentes que guarda la base.

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

from api import db_proveedores, process_db, properties_db, renders_db, storage
from api.db import get_db

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
def proceso_de_la_propiedad(test_property):
    """Un proceso corriendo sobre la propiedad: plantilla, paso e instancia.

    Borrar la plantilla se lleva por delante nodos, instancias y los archivos de
    ambos —todos cuelgan de ella con ON DELETE CASCADE—, así que es lo único que
    hay que deshacer.
    """
    template = process_db.create_template({"name": "[TEST] Backfill proceso"})
    node = process_db.create_node(
        {"templateId": template["id"], "name": "[TEST] Paso", "sortOrder": 0})
    instance = process_db.create_instance({
        "name": "[TEST] Obra", "startDate": "2026-01-01",
        "templateId": template["id"], "propertyId": test_property["id"]})
    yield {"template": template, "node": node, "instance": instance}
    process_db.delete_template(template["id"])


@pytest.fixture
def torcidas(test_property, proceso_de_la_propiedad):
    """Una imagen sin corregir en cada una de las procedencias."""
    pid = test_property["id"]
    photo = properties_db.add_image(
        pid, f"properties/{pid}/backfill-foto.jpg", "foto.jpg", "image/jpeg")
    reference_key = f"properties/{pid}/floorplan/backfill-ref.jpg"
    properties_db.set_geometry(pid, expected_revision=0, geometry={
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

    # Estas dos sí suben el contenido ellas mismas, por eso van fuera del ciclo.
    node_file = process_db.create_node_file(
        proceso_de_la_propiedad["node"]["id"], proceso_de_la_propiedad["instance"]["id"],
        "obra-terminada.jpg", "image/jpeg", "evidence", content)
    instance_file = process_db.create_instance_file(
        proceso_de_la_propiedad["instance"]["id"], "acta.jpg", "image/jpeg", content)
    keys[backfill.NODE_FILE] = node_file["filePath"]
    keys[backfill.INSTANCE_FILE] = instance_file["filePath"]

    yield keys
    for key in keys.values():
        storage.delete(key)
    db_proveedores.delete_proveedor(proveedor["id"])


@pytest.fixture
def referencia_de_plantilla(proceso_de_la_propiedad):
    """Una foto de referencia del paso: cuelga del nodo de la plantilla, no de la
    instancia, y por eso no es de ninguna propiedad en particular."""
    archivo = process_db.create_node_file(
        proceso_de_la_propiedad["node"]["id"], None,
        "referencia.jpg", "image/jpeg", "reference", _torcida())
    yield archivo["filePath"]
    process_db.delete_node_file(archivo["id"])


@pytest.fixture
def factura_pdf(proceso_de_la_propiedad):
    """La evidencia de un paso no siempre es una foto: la factura pagada llega en
    PDF por la misma ruta y termina en la misma tabla."""
    content = b"%PDF-1.4\nfactura pagada\n%%EOF\n"
    archivo = process_db.create_node_file(
        proceso_de_la_propiedad["node"]["id"], proceso_de_la_propiedad["instance"]["id"],
        "factura.pdf", "application/pdf", "evidence", content)
    yield {"key": archivo["filePath"], "content": content}
    process_db.delete_node_file(archivo["id"])


@pytest.fixture
def tarea_suelta():
    """Una tarea que no es de ninguna propiedad —de una vez, sin plantilla— con su
    archivo torcido: acotar a una propiedad tiene que dejarla fuera."""
    instance = process_db.create_instance(
        {"name": "[TEST] Tarea suelta", "startDate": "2026-01-01"})
    archivo = process_db.create_instance_file(
        instance["id"], "suelta.jpg", "image/jpeg", _torcida())
    yield archivo["filePath"]
    process_db.delete_instance_file(archivo["id"])
    with get_db() as conn:
        conn.execute("DELETE FROM process_instances WHERE id = %s", (instance["id"],))


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


def test_el_recorrido_encuentra_todas_las_procedencias(torcidas):
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


def test_property_id_deja_fuera_lo_que_no_es_de_esa_propiedad(torcidas, otra_propiedad,
                                                              tarea_suelta):
    completo = {key for _, key in backfill.collect_keys()}
    acotado = {key for _, key in backfill.collect_keys(property_id=otra_propiedad["id"])}

    assert acotado == {otra_propiedad["key"]}  # la tarea sin propiedad, tampoco
    assert set(torcidas.values()) | {tarea_suelta} <= completo  # sin acotar sí salen todas
    assert not acotado & set(torcidas.values())

    resumen = backfill.backfill(apply=False, property_id=otra_propiedad["id"])
    assert resumen["fixed"][backfill.PROPERTY_PHOTO] == 1
    assert resumen["fixed"][backfill.PROVEEDOR_PHOTO] == 0


def test_property_id_alcanza_los_procesos_de_la_propiedad_pero_no_los_de_la_plantilla(
        test_property, torcidas, referencia_de_plantilla):
    """La evidencia se subió corriendo el proceso SOBRE esta propiedad, así que
    acotar a ella tiene que alcanzarla. La foto de referencia no: cuelga del nodo
    de la plantilla, que la corren todas las propiedades y no es de ninguna."""
    acotado = {key for _, key in backfill.collect_keys(property_id=test_property["id"])}

    assert {torcidas[backfill.NODE_FILE], torcidas[backfill.INSTANCE_FILE]} <= acotado
    assert referencia_de_plantilla not in acotado
    assert referencia_de_plantilla in {key for _, key in backfill.collect_keys()}


def test_property_id_de_una_propiedad_que_no_existe_se_queja(torcidas):
    with pytest.raises(properties_db.PropertyNotFound):
        backfill.collect_keys(property_id=999_999_999)


def test_la_factura_en_pdf_se_revisa_y_sale_intacta(torcidas, factura_pdf):
    """Los archivos de proceso no son sólo imágenes. Un PDF no hay que apartarlo
    —el normalizador lo devuelve igual—, pero tampoco puede contar como algo que
    se corrigió ni como algo que falló."""
    resumen = backfill.backfill(apply=True)

    assert storage.stream(factura_pdf["key"])[0] == factura_pdf["content"]
    assert resumen["checked"][backfill.NODE_FILE] == 2  # la foto de obra y la factura
    assert resumen["fixed"][backfill.NODE_FILE] == 1    # sólo la foto
    assert resumen["failed"][backfill.NODE_FILE] == 0
    assert resumen["missing"][backfill.NODE_FILE] == 0


def test_una_escritura_que_falla_no_se_lleva_el_recorrido(torcidas, monkeypatch):
    def _revienta(key, content, content_type):
        raise RuntimeError("storage no disponible")

    monkeypatch.setattr(backfill.storage, "upload", _revienta)
    resumen = backfill.backfill(apply=True)

    assert sum(resumen["failed"].values()) == len(torcidas)  # las intentó todas
    assert sum(resumen["fixed"].values()) == 0
    for key in torcidas.values():
        assert _stored(key).getexif().get(_ORIENTATION, 1) == 6
