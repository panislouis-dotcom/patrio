"""CRUD and images on /api/properties. The lifecycle lives in
test_property_lifecycle, the numbers in test_property_metrics."""
from api import properties_db
from api.db import get_db

from .conftest import _delete_property


def test_nothing_clearable_is_unwritable():
    """Vaciar solo tiene sentido sobre algo que se captura, así que lo vaciable
    es un subconjunto de lo escribible. Un campo que se puede vaciar pero no
    escribir es una fila de la ficha con un botón ✕ que solo puede producir un
    422 — que es exactamente lo que quedó a medio camino cuando el costo de obra
    pasó a ser la suma del presupuesto y sus dos insumos dejaron de capturarse.

    La prueba vive aquí, sobre los frozensets, y no en el espejo del cliente:
    esto es una invariante entre dos listas de Python y tiene que romperse en
    pytest, no en otra suite y en otro lenguaje."""
    assert properties_db.CLEARABLE_FIELDS <= properties_db.WRITABLE_FIELDS, (
        sorted(properties_db.CLEARABLE_FIELDS - properties_db.WRITABLE_FIELDS))


def test_list_returns_the_property(client, test_property):
    r = client.get("/api/properties")
    assert r.status_code == 200
    assert any(p["id"] == test_property["id"] for p in r.json())


def test_detail_carries_the_whole_contract(client, test_property):
    p = client.get(f"/api/properties/{test_property['id']}").json()
    for field in ("id", "name", "status", "score", "issues", "images",
                  "totalInvestment", "projectedRoi", "capRate",
                  "latitude", "longitude", "milestones"):
        assert field in p, f"Missing field: {field}"
    assert isinstance(p["milestones"], dict)
    assert isinstance(p["issues"], list)


def test_missing_property_is_404(client):
    assert client.get("/api/properties/999999999").status_code == 404


def test_create_starts_in_prospecto(client):
    r = client.post("/api/properties", json={
        "name": "[TEST] Alta mínima",
        "address": "Calle Ejemplo 1",
        "city": "Monterrey",
    })
    assert r.status_code == 201, r.text
    created = r.json()
    try:
        assert created["status"] == "prospecto"
        # Los cinco costos nacen en 0, así que la pila suma 0 y la base es «—»:
        # una propiedad sin nada capturado no ha invertido cero pesos, no ha
        # invertido nada, y el contrato tiene que poder decir la diferencia.
        assert created["totalInvestment"] is None
        assert created["holdMonths"] == 12
    finally:
        _delete_property(created["id"])


def test_create_cannot_choose_its_status(client):
    r = client.post("/api/properties", json={
        "name": "[TEST] Alta con status",
        "address": "Calle Ejemplo 2",
        "city": "Monterrey",
        "status": "vendida",
    })
    assert r.status_code == 201
    try:
        assert r.json()["status"] == "prospecto"
    finally:
        _delete_property(r.json()["id"])


def test_delete(client, test_property):
    assert client.delete(f"/api/properties/{test_property['id']}").status_code == 204
    assert client.get(f"/api/properties/{test_property['id']}").status_code == 404


def test_delete_missing_property_is_404(client):
    assert client.delete("/api/properties/999999999").status_code == 404


def test_deleting_a_property_cascades_its_process_instances(client, test_property):
    """Un proceso ligado cae con la propiedad: borrarla es una acción explícita,
    y sus instancias —con estados, comentarios y archivos, que ya cascadean por
    FK— se van con ella. (El presupuesto capturado, el reparto y las señales
    siguen reteniendo; eso no cambia.)"""
    pid = test_property["id"]
    with get_db() as conn:
        conn.execute(
            "INSERT INTO process_instances (name, start_date, status, property_id)"
            " VALUES (%s, CURRENT_DATE, 'active', %s)",
            ("[TEST] tarea que cae con la propiedad", pid),
        )
    assert client.delete(f"/api/properties/{pid}").status_code == 204
    assert client.get(f"/api/properties/{pid}").status_code == 404
    with get_db() as conn:
        n = conn.execute(
            "SELECT count(*) AS n FROM process_instances WHERE property_id = %s", (pid,),
        ).fetchone()["n"]
    assert n == 0


def test_delete_blocked_by_captured_budget_work_is_422_with_the_reason(client, test_property):
    """El presupuesto de obra está en la familia de RESTRICT, no en la de CASCADE:
    lleva captura manual —cantidades medidas, precios negociados, pagos— y perder
    eso en un borrado mudo es perder trabajo real. Se rechaza y se dice qué la
    retiene, que es lo que le permite a alguien decidir tirarlo a propósito."""
    pid = test_property["id"]
    r = client.post(f"/api/properties/{pid}/budget/lines", json={
        "chapterName": "Albañilería", "name": "Muros", "unit": "m2",
        "quantity": 100, "unitPrice": 900})
    assert r.status_code == 201, r.text
    r = client.delete(f"/api/properties/{pid}")
    assert r.status_code == 422
    assert r.json()["error"]["message"] == (
        "No se puede eliminar la propiedad porque tiene un presupuesto de obra.")
    assert client.get(f"/api/properties/{pid}").status_code == 200


def test_a_seeded_budget_does_not_block_the_delete(client, test_property):
    """Desde que TODA propiedad nace con presupuesto, retener por su sola
    existencia habría dejado el borrado inservible: ninguna propiedad se podría
    borrar nunca. Lo que retiene es lo que alguien CAPTURÓ —una partida, un
    proveedor, un compromiso, un pago—, no la fila que puso el sistema."""
    pid = test_property["id"]
    assert client.get(f"/api/properties/{pid}/budget").json()["lines"]
    assert client.delete(f"/api/properties/{pid}").status_code == 204
    assert client.get(f"/api/properties/{pid}").status_code == 404


def test_quality_reports_issues_per_property(client, test_property):
    r = client.get("/api/quality")
    assert r.status_code == 200
    entry = next(p for p in r.json() if p["id"] == test_property["id"])
    assert set(entry) == {"id", "name", "status", "issues"}


def test_requires_auth(client, anonymous):
    assert client.get("/api/properties").status_code == 401


# ── Images ───────────────────────────────────────────────────────────────────

def test_image_type_defaults_to_antes(client, test_property_image):
    with get_db() as conn:
        row = conn.execute("SELECT image_type FROM property_images WHERE id = %s",
                           (test_property_image["id"],)).fetchone()
    assert row["image_type"] == "antes"


def test_image_type_can_be_changed(client, test_property, test_property_image):
    for kind in ("despues", "antes"):
        r = client.patch(
            f"/api/properties/{test_property['id']}/images/{test_property_image['id']}",
            json={"image_type": kind})
        assert r.status_code == 200, r.text
        assert r.json()["imageType"] == kind


def test_unknown_image_type_is_422(client, test_property, test_property_image):
    r = client.patch(
        f"/api/properties/{test_property['id']}/images/{test_property_image['id']}",
        json={"image_type": "unknown"})
    assert r.status_code == 422


def test_general_image_type_is_422(client, test_property, test_property_image):
    r = client.patch(
        f"/api/properties/{test_property['id']}/images/{test_property_image['id']}",
        json={"image_type": "general"})
    assert r.status_code == 422


def test_image_type_on_a_missing_image_is_404(client, test_property):
    r = client.patch(f"/api/properties/{test_property['id']}/images/999999999",
                     json={"image_type": "antes"})
    assert r.status_code == 404


def test_images_come_back_on_the_property(client, test_property, test_property_image):
    images = client.get(f"/api/properties/{test_property['id']}").json()["images"]
    assert [i["id"] for i in images] == [test_property_image["id"]]


def _three_images(property_id: int) -> list[int]:
    """Tres fotos «antes» de la misma propiedad. Se van solas con ella: la FK de
    property_images a properties es ON DELETE CASCADE."""
    return [properties_db.add_image(property_id, f"properties/{property_id}/{n}.jpg",
                                    f"{n}.jpg", "image/jpeg")["id"]
            for n in range(3)]


def test_reorder_renumbers_sort_order_in_the_given_order(client, test_property):
    a, b, c = _three_images(test_property["id"])
    r = client.put(f"/api/properties/{test_property['id']}/images/reorder",
                   json={"image_ids": [c, a, b]})
    assert r.status_code == 200, r.text
    assert [(i["id"], i["sortOrder"]) for i in r.json()] == [(c, 0), (a, 1), (b, 2)]


def test_reorder_survives_the_round_trip(client, test_property):
    """El orden nuevo tiene que salir igual de una lectura fresca, no solo de la
    respuesta del PUT: es la prueba de que quedó en la base y no en memoria."""
    a, b, c = _three_images(test_property["id"])
    client.put(f"/api/properties/{test_property['id']}/images/reorder",
               json={"image_ids": [b, c, a]})
    images = client.get(f"/api/properties/{test_property['id']}").json()["images"]
    assert [i["id"] for i in images] == [b, c, a]


def test_reorder_missing_one_image_is_422(client, test_property):
    a, b, _c = _three_images(test_property["id"])
    r = client.put(f"/api/properties/{test_property['id']}/images/reorder",
                   json={"image_ids": [b, a]})
    assert r.status_code == 422


def test_reorder_with_a_foreign_image_is_422(client, test_property):
    a, b, _c = _three_images(test_property["id"])
    r = client.put(f"/api/properties/{test_property['id']}/images/reorder",
                   json={"image_ids": [a, b, 999999999]})
    assert r.status_code == 422


def test_reorder_repeating_an_image_is_422(client, test_property):
    """El conjunto coincide pero la lista no es una permutación: repetir una foto
    dejaría un sort_order sin dueño y a otra foto fuera del orden pedido."""
    a, b, c = _three_images(test_property["id"])
    r = client.put(f"/api/properties/{test_property['id']}/images/reorder",
                   json={"image_ids": [a, a, b, c]})
    assert r.status_code == 422


def test_reorder_on_a_missing_property_is_404(client):
    r = client.put("/api/properties/999999999/images/reorder", json={"image_ids": []})
    assert r.status_code == 404
