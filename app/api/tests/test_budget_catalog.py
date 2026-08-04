"""El catálogo que aprende: copia al instanciar, baja lógica, promoción curada.

Lo que fija esta suite es lo que se rompe sin verse roto. En orden de gravedad:

  · EDITAR EL CATÁLOGO NO MUEVE UN PRESUPUESTO YA CAPTURADO. Es el invariante
    central de la fase. Si se rompiera, corregir el nombre de una partida en 2027
    cambiaría el presupuesto de una propiedad vendida en 2026 —una cifra que un
    inversionista ya leyó— y nada se pondría rojo.
  · LA PROMOCIÓN RELIGA HACIA ATRÁS, y al religar no reescribe un solo carácter
    de lo capturado. Sin el religado la partida nace al catálogo sin historia y
    el módulo tarda tres obras más en servir; con un religado que reescriba, el
    remedio sería peor que la enfermedad.
  · LA BAJA LÓGICA NO CORTA LA PROCEDENCIA. Apagar una partida deja de ofrecerla;
    no puede desconectar los renglones que ya la citan, que son la única forma de
    saber que tres obras hablaban de lo mismo.
"""
from decimal import Decimal

import pytest

from api.db import get_db


# ─── Utilería ─────────────────────────────────────────────────────────────────

def _dec(value) -> Decimal:
    return Decimal(str(value))


def _budget(client, property_id: int) -> dict:
    r = client.get(f"/api/properties/{property_id}/budget")
    assert r.status_code == 200, r.text
    return r.json()


def _line_by_id(budget: dict, line_id: int) -> dict:
    return next(line for line in budget["lines"] if line["id"] == line_id)


def _residual(budget: dict) -> dict:
    return next(line for line in budget["lines"] if line["isResidual"])


def _add(client, property_id: int, **body) -> dict:
    r = client.post(f"/api/properties/{property_id}/budget/lines", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _chapter(client, name="[TEST] Acabados", **body) -> dict:
    r = client.post("/api/budget/catalog/chapters", json={"name": name, **body})
    assert r.status_code == 201, r.text
    return r.json()


def _item(client, chapter_id: int, name: str, unit: str = "m2", **body) -> dict:
    r = client.post("/api/budget/catalog/items", json={
        "chapterId": chapter_id, "name": name, "unit": unit, **body})
    assert r.status_code == 201, r.text
    return r.json()


def _property(client, name: str) -> dict:
    """Otra propiedad, para lo que solo se ve con varias obras: la frecuencia de
    la cola y el religado hacia atrás."""
    r = client.post("/api/properties", json={
        "name": name, "address": f"{name} 1", "city": "Monterrey",
        "purchasePrice": 1_000_000, "sqmConstruction": 100,
        "constructionCostPerSqm": 5_000, "constructionOverhead": 1})
    assert r.status_code == 201, r.text
    return r.json()


def _scrap(property_id: int) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM budgets WHERE property_id = %s", (property_id,))
        conn.execute("DELETE FROM properties WHERE id = %s", (property_id,))


@pytest.fixture(autouse=True)
def catalogo_limpio():
    """Las partidas van antes que los capítulos: `budget_items.chapter_id` no
    lleva ON DELETE, que es el esquema diciendo que un capítulo con partidas no
    se borra. Aquí se borra de verdad porque es una base de pruebas; en la
    aplicación esa operación no existe.

    Las partidas se recogen también POR CAPÍTULO, no solo por su nombre: hay una
    prueba que necesita nombres reales sin prefijo —el prefijo infla la
    similitud de trigramas y taparía justo lo que esa prueba mide."""
    yield
    with get_db() as conn:
        conn.execute("DELETE FROM budgets WHERE property_id IS NULL AND name LIKE '[TEST]%%'")
        conn.execute(
            "DELETE FROM budget_items WHERE name LIKE '%%[TEST]%%'"
            "   OR chapter_id IN (SELECT id FROM budget_chapters WHERE name LIKE '[TEST]%%')")
        conn.execute("DELETE FROM budget_chapters WHERE name LIKE '[TEST]%%'")


@pytest.fixture
def otra_obra(client):
    prop = _property(client, "[TEST] Segunda Obra")
    yield prop
    _scrap(prop["id"])


# ── El invariante central: el catálogo no mueve presupuestos ────────────────

def test_editing_the_catalog_never_moves_a_captured_budget(client, test_property):
    """Instanciar COPIA. Después de eso el renglón es de la propiedad: renombrar
    la partida del catálogo, cambiarle la unidad y hasta moverla de capítulo no
    tocan ni el texto ni el importe de lo ya capturado.

    Es lo contrario de las plantillas de proceso, que se leen en vivo, y la
    diferencia es que aquí el objeto es dinero — con lectores fuera de la app.
    Mover retroactivamente un número que un inversionista ya vio es de otra clase
    de daño que renombrar una tarea."""
    chapter = _chapter(client)
    item = _item(client, chapter["id"], "[TEST] Piso cerámico", "m2")
    otro = _chapter(client, "[TEST] Instalaciones")

    created = _add(client, test_property["id"], itemId=item["id"], quantity=40, unitPrice=1_200)
    line_id = created["line"]["id"]
    assert _dec(created["line"]["budgetedAmount"]) == Decimal("48000")
    inversion = _dec(created["property"]["totalInvestment"])

    for body in ({"name": "[TEST] Piso cerámico 60x60"}, {"unit": "pza"},
                 {"chapterId": otro["id"]}, {"sortOrder": 7}):
        assert client.patch(f"/api/budget/catalog/items/{item['id']}",
                            json=body).status_code == 200
    assert client.patch(f"/api/budget/catalog/chapters/{chapter['id']}",
                        json={"name": "[TEST] Acabados finos"}).status_code == 200

    line = _line_by_id(_budget(client, test_property["id"]), line_id)
    assert (line["chapterName"], line["name"], line["unit"]) == (
        "[TEST] Acabados", "[TEST] Piso cerámico", "m2")
    assert _dec(line["budgetedAmount"]) == Decimal("48000")
    assert line["itemId"] == item["id"]

    p = client.get(f"/api/properties/{test_property['id']}").json()
    assert _dec(p["constructionBudgeted"]) == Decimal("2340000")
    assert _dec(p["totalInvestment"]) == inversion


def test_a_line_born_from_the_catalog_copies_the_catalog_text(client, test_property):
    """Con `itemId` manda el catálogo, aunque el cliente mande otro nombre. Es la
    deduplicación cobrando: quien aceptó «¿es la misma que X?» quiso decir que la
    partida es la del catálogo, y quedarse con las dos grafías partiría en dos la
    historia de precios que acaba de aceptar unir."""
    chapter = _chapter(client)
    item = _item(client, chapter["id"], "[TEST] Piso cerámico", "m2")
    created = _add(client, test_property["id"], itemId=item["id"],
                   chapterName="Lo que sea", name="Piso ceramico 60x60", unit="lote",
                   quantity=10, unitPrice=100)
    assert (created["line"]["chapterName"], created["line"]["name"],
            created["line"]["unit"]) == ("[TEST] Acabados", "[TEST] Piso cerámico", "m2")
    assert _dec(created["line"]["budgetedAmount"]) == Decimal("1000")


def test_attaching_provenance_to_an_existing_line_does_not_rewrite_it(client, test_property):
    """La otra mitad de la deduplicación: aceptar el aviso sobre algo YA
    capturado. Aquí manda lo capturado —al nacer no había nada que preservar,
    ahora sí— y lo único que cambia es a dónde apunta el renglón."""
    chapter = _chapter(client)
    item = _item(client, chapter["id"], "[TEST] Piso cerámico", "m2")
    created = _add(client, test_property["id"], chapterName="[TEST] Acabados",
                   name="[TEST] Piso ceramico 60x60", unit="m²", quantity=40, unitPrice=1_200)
    line_id = created["line"]["id"]

    r = client.patch(f"/api/properties/{test_property['id']}/budget/lines/{line_id}",
                     json={"itemId": item["id"]})
    assert r.status_code == 200, r.text
    line = _line_by_id(r.json()["budget"], line_id)
    assert line["itemId"] == item["id"]
    assert line["name"] == "[TEST] Piso ceramico 60x60"
    assert line["unit"] == "m²"
    assert _dec(line["budgetedAmount"]) == Decimal("48000")

    # Y se puede desdecir: «esto no era esa partida» tiene que poder decirse.
    r = client.patch(f"/api/properties/{test_property['id']}/budget/lines/{line_id}",
                     json={"itemId": None})
    assert _line_by_id(r.json()["budget"], line_id)["itemId"] is None


# ── Baja lógica: apagar no borra, y no corta la procedencia ─────────────────

def test_deactivating_an_item_keeps_the_provenance_of_what_cited_it(client, test_property):
    """La mitad que importa de la baja lógica. Los renglones conservan `itemId`,
    su texto y su importe: si apagar cortara la liga, la historia de precios
    perdería la única prueba de que tres obras hablaban de la misma partida."""
    chapter = _chapter(client)
    item = _item(client, chapter["id"], "[TEST] Piso cerámico", "m2")
    line_id = _add(client, test_property["id"], itemId=item["id"],
                   quantity=40, unitPrice=1_200)["line"]["id"]

    r = client.delete(f"/api/budget/catalog/items/{item['id']}")
    assert r.status_code == 200, r.text
    assert r.json()["isActive"] is False

    with get_db() as conn:
        row = conn.execute("SELECT id, name FROM budget_items WHERE id = %s",
                           (item["id"],)).fetchone()
    assert row is not None, "el catálogo no se borra, se apaga"

    line = _line_by_id(_budget(client, test_property["id"]), line_id)
    assert line["itemId"] == item["id"]
    assert _dec(line["budgetedAmount"]) == Decimal("48000")


def test_a_retired_item_is_not_used_in_new_work(client, test_property):
    """La otra mitad: deja de ofrecerse. Vale para estrenarla en un renglón nuevo
    y para colgarle uno viejo."""
    chapter = _chapter(client)
    item = _item(client, chapter["id"], "[TEST] Piso cerámico", "m2")
    line_id = _add(client, test_property["id"], chapterName="[TEST] Acabados",
                   name="[TEST] Muro")["line"]["id"]
    client.delete(f"/api/budget/catalog/items/{item['id']}")

    r = client.post(f"/api/properties/{test_property['id']}/budget/lines",
                    json={"itemId": item["id"]})
    assert r.status_code == 422
    assert "dada de baja" in r.json()["error"]["message"]

    r = client.patch(f"/api/properties/{test_property['id']}/budget/lines/{line_id}",
                     json={"itemId": item["id"]})
    assert r.status_code == 422


def test_a_deactivated_name_is_free_again_and_taking_it_back_is_refused(client):
    """La unicidad solo aplica entre los vivos —un capítulo apagado no debe
    secuestrar su nombre para siempre— y por eso reactivar es la puerta por la
    que se llega a un choque, que es la que se olvida."""
    primero = _chapter(client, "[TEST] Albañilería")
    r = client.post("/api/budget/catalog/chapters", json={"name": "[TEST] albañilería"})
    assert r.status_code == 422
    assert "Ya hay un capítulo activo" in r.json()["error"]["message"]

    client.delete(f"/api/budget/catalog/chapters/{primero['id']}")
    segundo = _chapter(client, "[TEST] Albañilería")
    assert segundo["id"] != primero["id"]

    r = client.patch(f"/api/budget/catalog/chapters/{primero['id']}", json={"isActive": True})
    assert r.status_code == 422


def test_the_catalog_reads_the_living_unless_it_is_asked_for_everything(client):
    chapter = _chapter(client)
    _item(client, chapter["id"], "[TEST] Piso cerámico")
    apagada = _item(client, chapter["id"], "[TEST] Duela")
    client.delete(f"/api/budget/catalog/items/{apagada['id']}")

    vivos = client.get("/api/budget/catalog").json()
    mio = next(c for c in vivos if c["id"] == chapter["id"])
    assert [i["name"] for i in mio["items"]] == ["[TEST] Piso cerámico"]

    todos = client.get("/api/budget/catalog?includeInactive=true").json()
    mio = next(c for c in todos if c["id"] == chapter["id"])
    assert len(mio["items"]) == 2

    client.delete(f"/api/budget/catalog/chapters/{chapter['id']}")
    assert all(c["id"] != chapter["id"] for c in client.get("/api/budget/catalog").json())


def test_emptying_a_catalog_cell_that_cannot_be_empty_says_why(client):
    """Un `null` en estas columnas no es un vaciado: es una fila rota. Sin el
    rechazo, dos de ellas dan el 500 mudo del esquema y la tercera es peor —
    `isActive: null` daría de baja la partida sin que nadie lo haya pedido."""
    chapter = _chapter(client)
    item = _item(client, chapter["id"], "[TEST] Piso cerámico")
    for body, fragmento in (({"name": None}, "necesita un nombre"),
                            ({"unit": None}, "necesita un nombre"),
                            ({"sortOrder": None}, "no se vacía"),
                            ({"isActive": None}, "no se vacía"),
                            ({"chapterId": None}, "vive en un capítulo")):
        r = client.patch(f"/api/budget/catalog/items/{item['id']}", json=body)
        assert r.status_code == 422, f"{body}: {r.text}"
        assert fragmento in r.json()["error"]["message"], body
    assert client.get("/api/budget/catalog").json()  # y la partida sigue viva
    capitulo = next(c for c in client.get("/api/budget/catalog").json()
                    if c["id"] == chapter["id"])
    assert [i["id"] for i in capitulo["items"]] == [item["id"]]


def test_every_item_response_carries_its_used_in_lines(client, test_property):
    """La misma forma al leer y al escribir, para que el cliente tenga UN tipo y
    no tenga que releer el catálogo entero después de crear una partida.

    `usedInLines` es la cifra que explica por qué el borrado físico no existe, así
    que es parte de lo que una partida ES — no un extra de la lista."""
    chapter = _chapter(client)
    item = _item(client, chapter["id"], "[TEST] Piso cerámico", "m2")
    assert item["usedInLines"] == 0

    _add(client, test_property["id"], itemId=item["id"], quantity=40, unitPrice=1_200)
    r = client.patch(f"/api/budget/catalog/items/{item['id']}", json={"sortOrder": 3})
    assert r.json()["usedInLines"] == 1
    r = client.delete(f"/api/budget/catalog/items/{item['id']}")
    assert r.json()["usedInLines"] == 1, "la baja no corta la procedencia, y lo dice"

    # Y coincide con lo que publica la lectura, que es de donde salía antes.
    capitulo = next(c for c in client.get("/api/budget/catalog?includeInactive=true").json()
                    if c["id"] == chapter["id"])
    assert next(i for i in capitulo["items"] if i["id"] == item["id"])["usedInLines"] == 1


def test_a_duplicate_item_in_the_same_chapter_is_refused_with_its_reason(client):
    """Dos veces la misma partida es la historia de precios partida en dos: el
    rechazo dice qué hacer en vez de dejar salir un 500 del índice único."""
    chapter = _chapter(client)
    _item(client, chapter["id"], "[TEST] Piso cerámico")
    r = client.post("/api/budget/catalog/items", json={
        "chapterId": chapter["id"], "name": "[TEST] piso cerámico", "unit": "m2"})
    assert r.status_code == 422
    assert "ya está en ese capítulo" in r.json()["error"]["message"]


# ── El renglón suelto, sin fricción ────────────────────────────────────────

def test_a_free_line_costs_nothing_and_touches_nothing_else(client, test_property):
    """El hueco que el sistema de procesos nunca llenó: allá, agregar algo a una
    obra obliga a editar la plantilla de TODAS, incluidas las terminadas. Aquí el
    renglón vive en su presupuesto, sin catálogo de por medio y sin tocar nada."""
    created = _add(client, test_property["id"], chapterName="[TEST] Imprevistos",
                   name="[TEST] Apuntalar la losa", unit="lote", quantity=1, unitPrice=80_000)
    assert created["line"]["itemId"] is None
    assert _dec(_residual(created["budget"])["budgetedAmount"]) == Decimal("2260000")
    assert _dec(created["property"]["constructionBudgeted"]) == Decimal("2340000")
    with get_db() as conn:
        assert conn.execute(
            "SELECT count(*) AS n FROM budget_items").fetchone()["n"] == 0


# ── Copiar: una operación, tres usos ───────────────────────────────────────

def test_applying_a_chapter_brings_the_skeleton_without_moving_a_peso(client, test_property):
    """El catálogo NO guarda precio, a propósito: aprenderlo de lo presupuestado
    sería repetir para siempre una suposición que alguien hizo una vez. Así que
    el esqueleto entra en cantidad 0 y precio 0, y el total no se mueve."""
    chapter = _chapter(client)
    for name in ("[TEST] Piso cerámico", "[TEST] Duela", "[TEST] Zoclo"):
        _item(client, chapter["id"], name)

    r = client.post(f"/api/properties/{test_property['id']}/budget/apply-chapter",
                    json={"chapterId": chapter["id"]})
    assert r.status_code == 201, r.text
    r = r.json()
    assert r["linesAdded"] == 3
    assert _dec(r["property"]["constructionBudgeted"]) == Decimal("2340000")
    assert _dec(_residual(r["budget"])["budgetedAmount"]) == Decimal("2340000")
    copiados = [l for l in r["budget"]["lines"] if l["chapterName"] == "[TEST] Acabados"]
    assert len(copiados) == 3
    assert all(l["itemId"] is not None and _dec(l["budgetedAmount"]) == 0 for l in copiados)

    # Repetirlo no duplica: `item_id` da identidad exacta.
    r = client.post(f"/api/properties/{test_property['id']}/budget/apply-chapter",
                    json={"chapterId": chapter["id"]})
    assert r.json()["linesAdded"] == 0
    assert len([l for l in r.json()["budget"]["lines"]
                if l["chapterName"] == "[TEST] Acabados"]) == 3


def test_copying_is_one_operation_used_three_times(client, test_property, otra_obra):
    """Guardar ésta como plantilla, arrancar otra obra desde la plantilla, y
    arrancar desde la obra directamente. Los tres caminos son `copy_lines`, y por
    eso los tres dejan lo mismo."""
    _add(client, test_property["id"], chapterName="[TEST] Albañilería",
         name="[TEST] Muros", unit="m2", quantity=100, unitPrice=900)
    _add(client, test_property["id"], chapterName="[TEST] Albañilería",
         name="[TEST] Aplanados", unit="m2", quantity=200, unitPrice=300)
    origen = _budget(client, test_property["id"])

    r = client.post("/api/budget/templates", json={
        "name": "[TEST] Remodelación casa antigua", "fromBudgetId": origen["id"]})
    assert r.status_code == 201, r.text
    plantilla = r.json()
    # El orden de captura se conserva —capítulo, `sortOrder`, id— porque un
    # presupuesto se lee como se escribió, no en alfabético.
    assert [l["name"] for l in plantilla["lines"]] == ["[TEST] Muros", "[TEST] Aplanados"]
    assert _dec(plantilla["lines"][0]["budgetedAmount"]) == Decimal("90000")

    for source in (plantilla["id"], origen["id"]):
        r = client.post(f"/api/properties/{otra_obra['id']}/budget/apply",
                        json={"budgetId": source})
        assert r.status_code == 201, r.text
        assert r.json()["linesAdded"] == 2

    nombres = sorted(l["name"] for l in _budget(client, otra_obra["id"])["lines"]
                     if not l["isResidual"])
    assert nombres == ["[TEST] Aplanados", "[TEST] Aplanados", "[TEST] Muros", "[TEST] Muros"]


def test_a_template_leaves_out_the_residual_and_the_whole_execution(client, test_property):
    """El residuo es el remanente de SU obra, no una partida: llevárselo a una
    plantilla lo convertiría en un renglón de $2.3M que después le come el
    residuo a la obra siguiente. Y proveedor, comprometido y pagos se quedan
    también: una plantilla es la forma de un plan, no el contrato de nadie."""
    with get_db() as conn:
        supplier_id = conn.execute(
            "INSERT INTO proveedores (name) VALUES ('[TEST] Proveedor Catálogo')"
            " RETURNING id").fetchone()["id"]
    created = _add(client, test_property["id"], chapterName="[TEST] Albañilería",
                   name="[TEST] Muros", unit="m2", quantity=100, unitPrice=900,
                   supplierId=supplier_id, committedAmount=95_000, committedOn="2026-05-01")
    client.post(f"/api/properties/{test_property['id']}/budget/lines/"
                f"{created['line']['id']}/payments", json={"amount": 40_000})

    origen = _budget(client, test_property["id"])
    plantilla = client.post("/api/budget/templates", json={
        "name": "[TEST] Obra nueva", "fromBudgetId": origen["id"]}).json()

    assert len(plantilla["lines"]) == 1, "el residuo no se copia"
    linea = plantilla["lines"][0]
    assert linea["name"] == "[TEST] Muros"
    assert _dec(linea["budgetedAmount"]) == Decimal("90000")
    assert linea["supplierId"] is None
    assert linea["committedAmount"] is None
    assert linea["paidAmount"] is None
    assert linea["isResidual"] is False

    with get_db() as conn:
        conn.execute("DELETE FROM proveedores WHERE id = %s", (supplier_id,))


def test_applying_a_template_detail_does_not_move_the_total(client, test_property, otra_obra):
    """Copiar es detallar, no aumentar: los renglones que entran salen del
    residuo, igual que si se hubieran tecleado uno por uno."""
    _add(client, otra_obra["id"], chapterName="[TEST] Albañilería", name="[TEST] Muros",
         unit="m2", quantity=100, unitPrice=900)
    origen = _budget(client, otra_obra["id"])
    antes = _dec(client.get(f"/api/properties/{test_property['id']}").json()["totalInvestment"])

    r = client.post(f"/api/properties/{test_property['id']}/budget/apply",
                    json={"budgetId": origen["id"]}).json()
    assert _dec(_residual(r["budget"])["budgetedAmount"]) == Decimal("2250000")
    assert _dec(r["property"]["constructionBudgeted"]) == Decimal("2340000")
    assert _dec(r["property"]["totalInvestment"]) == antes
    assert r["budgetIncrease"] == 0


def test_a_budget_is_not_copied_over_itself(client, test_property):
    budget_id = _budget(client, test_property["id"])["id"]
    r = client.post(f"/api/properties/{test_property['id']}/budget/apply",
                    json={"budgetId": budget_id})
    assert r.status_code == 422
    assert "sobre sí mismo" in r.json()["error"]["message"]


def test_a_property_budget_is_not_a_template(client, test_property):
    """Una plantilla es un presupuesto sin propiedad; el de una obra no se lee ni
    se borra por la puerta de las plantillas."""
    budget_id = _budget(client, test_property["id"])["id"]
    assert client.get(f"/api/budget/templates/{budget_id}").status_code == 422
    assert client.delete(f"/api/budget/templates/{budget_id}").status_code == 422
    assert _budget(client, test_property["id"])["id"] == budget_id


def test_two_templates_cannot_share_a_name(client):
    client.post("/api/budget/templates", json={"name": "[TEST] Obra nueva"})
    r = client.post("/api/budget/templates", json={"name": "[TEST] obra nueva"})
    assert r.status_code == 422
    assert "Ya hay una plantilla" in r.json()["error"]["message"]


def _sources(client, **params) -> list[dict]:
    r = client.get("/api/budget/sources", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_the_sources_list_answers_where_can_i_copy_from(client, test_property, otra_obra):
    """«¿Qué plantillas administro?» y «¿de dónde puedo copiar?» son dos
    preguntas. `apply` siempre aceptó el id de cualquier presupuesto —plantilla u
    obra, que para copiar son lo mismo— pero sin esta lista «arrancar desde otra
    obra» era una capacidad que nadie podía encontrar."""
    _add(client, otra_obra["id"], chapterName="[TEST] Albañilería", name="[TEST] Muros",
         unit="m2", quantity=100, unitPrice=900)
    plantilla = client.post("/api/budget/templates", json={
        "name": "[TEST] Obra nueva",
        "fromBudgetId": _budget(client, otra_obra["id"])["id"]}).json()

    fuentes = {f["id"]: f for f in _sources(client)}
    obra = fuentes[_budget(client, otra_obra["id"])["id"]]
    assert obra["propertyId"] == otra_obra["id"]
    # El presupuesto de una obra no tiene nombre propio: hereda el de su
    # propiedad, que es lo que hay que enseñar en el selector.
    assert obra["name"] == otra_obra["name"]
    assert (obra["lineCount"], _dec(obra["total"])) == (1, Decimal("90000"))
    assert fuentes[plantilla["id"]]["propertyId"] is None

    # Las plantillas van primero: es un `optgroup`, no un orden que el cliente
    # tenga que deducir.
    orden = [f["propertyId"] is None for f in _sources(client)]
    assert orden == sorted(orden, reverse=True)


def test_a_source_counts_only_what_it_would_actually_copy(client, test_property, otra_obra):
    """El residuo no se copia, así que contarlo prometería un renglón que nunca
    llega. Y una obra apenas capturada es SOLO su residuo: sin el filtro, el
    selector serían dieciocho renglones en cero con las dos obras útiles
    perdidas entre ellos."""
    assert all(f["id"] != _budget(client, otra_obra["id"])["id"] for f in _sources(client)), \
        "una obra sin detallar no es una respuesta a «de dónde copio»"

    _add(client, otra_obra["id"], chapterName="[TEST] Albañilería", name="[TEST] Muros",
         unit="m2", quantity=100, unitPrice=900)
    fuente = next(f for f in _sources(client)
                  if f["id"] == _budget(client, otra_obra["id"])["id"])
    # Su presupuesto tiene DOS renglones —el residuo y el detallado— y solo uno
    # se copia.
    assert len(_budget(client, otra_obra["id"])["lines"]) == 2
    assert fuente["lineCount"] == 1


def test_a_property_is_not_offered_as_a_source_to_itself(client, test_property):
    """`apply` ya lo rechaza con un 422; ofrecerlo en el selector sería hacer que
    el usuario descubra la regla chocando con ella."""
    _add(client, test_property["id"], chapterName="[TEST] Albañilería", name="[TEST] Muros",
         unit="m2", quantity=100, unitPrice=900)
    propio = _budget(client, test_property["id"])["id"]
    assert any(f["id"] == propio for f in _sources(client))
    assert all(f["id"] != propio
               for f in _sources(client, excludePropertyId=test_property["id"]))


def test_a_template_is_listed_deleted_and_leaves_nothing_behind(client, test_property):
    plantilla = client.post("/api/budget/templates", json={
        "name": "[TEST] Adecuación de local",
        "fromBudgetId": _budget(client, test_property["id"])["id"]}).json()
    listada = next(t for t in client.get("/api/budget/templates").json()
                   if t["id"] == plantilla["id"])
    # En la lista el conteo se llama `lineCount`; `lines` es el arreglo de
    # renglones del detalle. Un mismo nombre con dos tipos se paga en el cliente.
    assert listada["lineCount"] == len(plantilla["lines"])
    assert "lines" not in listada

    assert client.delete(f"/api/budget/templates/{plantilla['id']}").status_code == 200
    assert client.get(f"/api/budget/templates/{plantilla['id']}").status_code == 404


# ── La promoción: religa hacia atrás, y no reescribe nada ──────────────────

def test_promoting_relinks_the_history_backwards(client, test_property, otra_obra):
    """Lo que hace que la promoción valga. La partida no nace al catálogo en
    blanco: nace con todos los renglones equivalentes que ya existían
    apuntándole, que es la diferencia entre servir hoy y servir en tres obras."""
    for prop, price in ((test_property, 1_200), (otra_obra, 1_310)):
        _add(client, prop["id"], chapterName="[TEST] Acabados",
             name="[TEST] Piso cerámico", unit="m2", quantity=40, unitPrice=price)
    line_id = _add(client, test_property["id"], chapterName="[TEST] Acabados",
                   name="[TEST] Piso cerámico", unit="m2", quantity=10,
                   unitPrice=1_250)["line"]["id"]

    r = client.post("/api/budget/catalog/promote", json={"lineId": line_id})
    assert r.status_code == 201, r.text
    r = r.json()
    assert r["created"] is True
    assert r["relinked"] == 3
    assert r["item"]["name"] == "[TEST] Piso cerámico"

    # El capítulo que el renglón ya traía escrito, ahora existiendo en el catálogo.
    catalogo = client.get("/api/budget/catalog").json()
    capitulo = next(c for c in catalogo if c["id"] == r["item"]["chapterId"])
    assert capitulo["name"] == "[TEST] Acabados"
    assert next(i for i in capitulo["items"] if i["id"] == r["item"]["id"])["usedInLines"] == 3

    for prop in (test_property, otra_obra):
        for line in _budget(client, prop["id"])["lines"]:
            if line["name"] == "[TEST] Piso cerámico":
                assert line["itemId"] == r["item"]["id"]


def test_relinking_never_rewrites_what_was_captured(client, test_property, otra_obra):
    """El pago completo de la fase: dos grafías se vuelven UNA sola historia de
    precios sin tocar un carácter de lo que alguien escribió ni un peso de ningún
    presupuesto. Lo único que cambia es a dónde apuntan."""
    a = _add(client, test_property["id"], chapterName="[TEST] Acabados",
             name="[TEST] Piso Cerámico", unit="m²", quantity=40, unitPrice=1_200)
    b = _add(client, otra_obra["id"], chapterName="[TEST] Otro capítulo",
             name="[TEST] piso cerámico ", unit="pza", quantity=10, unitPrice=999)
    antes = _dec(a["property"]["totalInvestment"])

    r = client.post("/api/budget/catalog/promote",
                    json={"lineId": a["line"]["id"]}).json()
    assert r["relinked"] == 2

    uno = _line_by_id(_budget(client, test_property["id"]), a["line"]["id"])
    otro = _line_by_id(_budget(client, otra_obra["id"]), b["line"]["id"])
    assert (uno["name"], uno["unit"], uno["chapterName"]) == (
        "[TEST] Piso Cerámico", "m²", "[TEST] Acabados")
    assert (otro["name"], otro["unit"], otro["chapterName"]) == (
        "[TEST] piso cerámico ", "pza", "[TEST] Otro capítulo")
    assert _dec(otro["budgetedAmount"]) == Decimal("9990")
    assert uno["itemId"] == otro["itemId"] == r["item"]["id"]
    assert _dec(client.get(f"/api/properties/{test_property['id']}").json()[
        "totalInvestment"]) == antes


def test_promoting_into_an_existing_item_is_a_merge_not_a_duplicate(client,
                                                                    test_property, otra_obra):
    """Agregar al catálogo nunca fue el problema; juntar lo que se partió, sí.
    Con `itemId` la promoción no crea nada: liga el grupo a lo que ya existe."""
    chapter = _chapter(client)
    item = _item(client, chapter["id"], "[TEST] Piso cerámico", "m2")
    _add(client, test_property["id"], chapterName="[TEST] Acabados",
         name="[TEST] Piso ceramico 60x60", unit="m2", quantity=40, unitPrice=1_200)
    line_id = _add(client, otra_obra["id"], chapterName="[TEST] Acabados",
                   name="[TEST] Piso ceramico 60x60", unit="m2",
                   quantity=15, unitPrice=1_190)["line"]["id"]

    r = client.post("/api/budget/catalog/promote",
                    json={"lineId": line_id, "itemId": item["id"]})
    assert r.status_code == 201, r.text
    r = r.json()
    assert r["created"] is False
    assert r["item"]["id"] == item["id"]
    assert r["relinked"] == 2

    capitulo = next(c for c in client.get("/api/budget/catalog").json()
                    if c["id"] == chapter["id"])
    assert len(capitulo["items"]) == 1, "fusionar no deja una segunda partida"


def test_promoting_twice_lands_on_the_same_item(client, test_property):
    """Que ya exista no es un error: quien promueve está diciendo «esto es esa
    partida», y crear una segunda con el mismo nombre sería el duplicado que todo
    esto evita."""
    line_id = _add(client, test_property["id"], chapterName="[TEST] Acabados",
                   name="[TEST] Piso cerámico", unit="m2")["line"]["id"]
    primera = client.post("/api/budget/catalog/promote", json={"lineId": line_id}).json()

    otro = _add(client, test_property["id"], chapterName="[TEST] Acabados",
                name="[TEST] Piso cerámico", unit="m2")["line"]["id"]
    segunda = client.post("/api/budget/catalog/promote", json={"lineId": otro}).json()
    assert segunda["created"] is False
    assert segunda["item"]["id"] == primera["item"]["id"]


def test_the_residual_is_never_promoted(client, test_property):
    """«Otros, por detallar» existe en TODOS los presupuestos: promoverlo metería
    al catálogo el remanente, que no es una partida de nada."""
    residual_id = _residual(_budget(client, test_property["id"]))["id"]
    r = client.post("/api/budget/catalog/promote", json={"lineId": residual_id})
    assert r.status_code == 422
    assert "remanente" in r.json()["error"]["message"]


def test_a_line_that_already_has_provenance_is_not_promoted(client, test_property):
    chapter = _chapter(client)
    item = _item(client, chapter["id"], "[TEST] Piso cerámico", "m2")
    line_id = _add(client, test_property["id"], itemId=item["id"])["line"]["id"]
    r = client.post("/api/budget/catalog/promote", json={"lineId": line_id})
    assert r.status_code == 422
    assert "ya viene del catálogo" in r.json()["error"]["message"]


def test_promoting_into_a_chapter_the_curator_chooses(client, test_property):
    """El capítulo del renglón es lo que trae escrito, no una decisión revisada.
    Quien cura puede decir otro."""
    destino = _chapter(client, "[TEST] Acabados")
    line_id = _add(client, test_property["id"], chapterName="[TEST] Tecleado a la carrera",
                   name="[TEST] Piso cerámico", unit="m2")["line"]["id"]
    r = client.post("/api/budget/catalog/promote",
                    json={"lineId": line_id, "chapterId": destino["id"]}).json()
    assert r["item"]["chapterId"] == destino["id"]
    # Y el renglón conserva el capítulo con el que se capturó.
    assert _line_by_id(_budget(client, test_property["id"]),
                       line_id)["chapterName"] == "[TEST] Tecleado a la carrera"


# ── La cola de promoción ───────────────────────────────────────────────────

def _queue(client) -> list[dict]:
    r = client.get("/api/budget/catalog/promotion-queue?limit=50")
    assert r.status_code == 200, r.text
    return r.json()


def test_the_queue_orders_by_frequency_and_publishes_both_medians(client,
                                                                  test_property, otra_obra):
    """La máquina ordena. Por número de OBRAS antes que por número de renglones:
    la misma partida escrita cinco veces en una obra son cinco renglones de un
    mismo criterio; en tres obras son tres observaciones independientes."""
    for prop, price in ((test_property, 1_200), (otra_obra, 1_400)):
        _add(client, prop["id"], chapterName="[TEST] Acabados",
             name="[TEST] Piso cerámico", unit="m2", quantity=40, unitPrice=price)
    for price in (500, 700, 900):
        _add(client, test_property["id"], chapterName="[TEST] Albañilería",
             name="[TEST] Castillo ahogado", unit="ml", quantity=1, unitPrice=price)

    cola = {g["normalized"]: g for g in _queue(client)}
    piso, castillo = cola["[test] piso cerámico"], cola["[test] castillo ahogado"]

    assert (piso["usedInLines"], piso["properties"]) == (2, 2)
    assert (castillo["usedInLines"], castillo["properties"]) == (3, 1)
    orden = [g["normalized"] for g in _queue(client)]
    assert orden.index("[test] piso cerámico") < orden.index("[test] castillo ahogado")

    # (1,200 + 1,400) / 2 y la de tres, que es la de en medio.
    assert _dec(piso["medianBudgetedUnitPrice"]) == Decimal("1300.00")
    assert _dec(castillo["medianBudgetedUnitPrice"]) == Decimal("700.00")
    # Nada cerrado y pagado todavía: no hay precio aprendido, y decirlo en 0 sería
    # afirmar un precio que nadie observó.
    assert piso["medianPaidUnitPrice"] is None
    assert piso["paidObservations"] == 0
    assert piso["lineId"] and piso["chapters"] == ["[TEST] Acabados"]


def test_the_queue_learns_its_paid_median_only_from_closed_paid_work(client, test_property):
    """Los precios se aprenden de lo PAGADO, nunca de lo presupuestado: sugerir
    desde el presupuestado es un bucle de autoconfirmación que jamás toca la
    realidad. Y solo de lo CERRADO: contar un anticipo envenena la mediana en
    silencio con precios sistemáticamente bajos."""
    created = _add(client, test_property["id"], chapterName="[TEST] Acabados",
                   name="[TEST] Piso cerámico", unit="m2", quantity=40, unitPrice=1_200)
    line_id = created["line"]["id"]
    client.post(f"/api/properties/{test_property['id']}/budget/lines/{line_id}/payments",
                json={"amount": 30_000})

    grupo = next(g for g in _queue(client) if g["normalized"] == "[test] piso cerámico")
    assert grupo["medianPaidUnitPrice"] is None, "un anticipo no es un precio"

    with get_db() as conn:
        conn.execute("UPDATE budget_lines SET actual_quantity = 42, closed_at = now()"
                     " WHERE id = %s", (line_id,))
    grupo = next(g for g in _queue(client) if g["normalized"] == "[test] piso cerámico")
    assert _dec(grupo["medianPaidUnitPrice"]) == Decimal("714.29")   # 30,000 / 42
    assert grupo["paidObservations"] == 1
    assert _dec(grupo["medianBudgetedUnitPrice"]) == Decimal("1200.00")


def _save_as_template(client, property_id: int, name="[TEST] Obra nueva") -> dict:
    r = client.post("/api/budget/templates", json={
        "name": name, "fromBudgetId": _budget(client, property_id)["id"]})
    assert r.status_code == 201, r.text
    return r.json()


def test_a_template_copy_is_not_a_second_observation(client, test_property):
    """Guardar una obra como plantilla no es capturar la partida por segunda vez.

    La cola llegó a decir «1 OBRA · 2 RENGLONES» de una partida que existe en una
    sola obra: el segundo renglón era la copia que el sistema mismo hizo al
    guardar la plantilla. Es el mismo defecto que la vista de precios ya evita con
    `property_id IS NOT NULL` — una plantilla es una intención, no una
    observación— y ahora los dos lo evitan con el mismo predicado."""
    _add(client, test_property["id"], chapterName="[TEST] Acabados",
         name="[TEST] Piso cerámico", unit="m2", quantity=40, unitPrice=1_200)
    plantilla = _save_as_template(client, test_property["id"])
    assert len(plantilla["lines"]) == 1, "la copia sí existe: por eso podía contarse"

    grupo = next(g for g in _queue(client) if g["normalized"] == "[test] piso cerámico")
    assert (grupo["usedInLines"], grupo["properties"]) == (1, 1)


def test_a_stale_template_price_does_not_drag_the_median(client, test_property):
    """Y no es solo el conteo: la copia se queda con el precio que tenía el día
    que se guardó. Al subir el de la obra, la mediana de DOS sería 1,600 —un
    número plausible que nadie capturó nunca— contra los 2,000 que es el único
    precio que alguien puso."""
    created = _add(client, test_property["id"], chapterName="[TEST] Acabados",
                   name="[TEST] Piso cerámico", unit="m2", quantity=40, unitPrice=1_200)
    _save_as_template(client, test_property["id"])
    r = client.patch(
        f"/api/properties/{test_property['id']}/budget/lines/{created['line']['id']}",
        json={"unitPrice": 2_000})
    assert r.status_code == 200, r.text

    grupo = next(g for g in _queue(client) if g["normalized"] == "[test] piso cerámico")
    assert _dec(grupo["medianBudgetedUnitPrice"]) == Decimal("2000.00")


def test_the_suggestion_counts_real_work_not_template_copies(client, test_property):
    """«Ya lo tecleaste en 2 renglones» sobre algo tecleado una vez es afirmar una
    evidencia que no existe. El aviso sigue saliendo —el texto existe— pero el
    número que lo respalda cuenta obra real."""
    _add(client, test_property["id"], chapterName="[TEST] Acabados",
         name="[TEST] Piso cerámico", unit="m2", quantity=40, unitPrice=1_200)
    _save_as_template(client, test_property["id"])

    sugerencias = _suggest(client, "[TEST] Piso ceramico")
    assert len(sugerencias) == 1
    assert sugerencias[0]["usedInLines"] == 1


def test_a_partida_living_only_in_a_template_is_not_evidence(client, test_property):
    """El caso límite del mismo principio: si lo único que existe es la copia, no
    hay nada capturado que curar, y la cola no lo propone."""
    created = _add(client, test_property["id"], chapterName="[TEST] Acabados",
                   name="[TEST] Piso cerámico", unit="m2", quantity=40, unitPrice=1_200)
    _save_as_template(client, test_property["id"])
    assert client.delete(f"/api/properties/{test_property['id']}/budget/lines/"
                         f"{created['line']['id']}").status_code == 200

    assert all(g["normalized"] != "[test] piso cerámico" for g in _queue(client))
    assert _suggest(client, "[TEST] Piso cerámico") == []


def test_relinking_still_reaches_the_template(client, test_property):
    """Donde la regla NO aplica, y la distinción parece la misma pero no lo es:
    religar no cuenta, apunta. Un renglón de plantilla sin procedencia produce,
    en cada obra que arranque de esa plantilla, otro renglón suelto que vuelve a
    la cola — dejarlo fuera del religado fabricaría el trabajo que la promoción
    existe para ahorrar."""
    created = _add(client, test_property["id"], chapterName="[TEST] Acabados",
                   name="[TEST] Piso cerámico", unit="m2", quantity=40, unitPrice=1_200)
    plantilla = _save_as_template(client, test_property["id"])

    r = client.post("/api/budget/catalog/promote",
                    json={"lineId": created["line"]["id"]}).json()
    assert r["relinked"] == 2, "la obra y la copia de la plantilla"

    linea = client.get(f"/api/budget/templates/{plantilla['id']}").json()["lines"][0]
    assert linea["itemId"] == r["item"]["id"]


def test_the_residual_never_enters_the_queue(client, test_property):
    """Existe en todos los presupuestos: sin excluirlo encabezaría la cola para
    siempre, proponiendo curar el remanente."""
    assert all("por detallar" not in g["normalized"] for g in _queue(client))


def test_a_promoted_group_leaves_the_queue(client, test_property):
    line_id = _add(client, test_property["id"], chapterName="[TEST] Acabados",
                   name="[TEST] Piso cerámico", unit="m2")["line"]["id"]
    assert any(g["normalized"] == "[test] piso cerámico" for g in _queue(client))
    client.post("/api/budget/catalog/promote", json={"lineId": line_id})
    assert all(g["normalized"] != "[test] piso cerámico" for g in _queue(client))


# ── La deduplicación al escribir ───────────────────────────────────────────

def _suggest(client, name: str, **params) -> list[dict]:
    r = client.get("/api/budget/catalog/suggest", params={"name": name, **params})
    assert r.status_code == 200, r.text
    return [s for s in r.json() if s["name"].startswith("[TEST]")]


def test_the_suggestion_catches_the_three_ways_of_writing_the_same_thing(client):
    """El caso que el diseño nombra: «Piso cerámico», «Colocación piso cerámico»
    y «Piso ceramico 60x60» como tres partidas distintas dejarían la historia de
    precios partida en tres, y sin historia previa que importar el catálogo nunca
    llegaría a tener tres observaciones de nada."""
    chapter = _chapter(client)
    item = _item(client, chapter["id"], "[TEST] Piso cerámico", "m2")

    for tecleado in ("[TEST] Piso ceramico", "[TEST] Colocación piso cerámico",
                     "[TEST] Piso cerámico 60x60"):
        sugerencias = _suggest(client, tecleado)
        assert any(s["itemId"] == item["id"] for s in sugerencias), tecleado
        assert sugerencias[0]["source"] == "catalog"
        assert sugerencias[0]["chapterName"] == "[TEST] Acabados"


def test_an_unrelated_name_is_not_suggested(client):
    """Un aviso que salta con cualquier cosa se aprende a ignorar, y entonces
    deja de existir."""
    chapter = _chapter(client)
    _item(client, chapter["id"], "[TEST] Piso cerámico", "m2")
    assert _suggest(client, "[TEST] Impermeabilizante") == []


def test_the_suggestion_also_reads_the_free_lines(client, test_property, otra_obra):
    """La pieza sin la cual la deduplicación llega tarde. El catálogo arranca
    VACÍO y no hay presupuestos viejos que importar: mientras se forma, los
    renglones sueltos ya tecleados son la única memoria que existe, y buscar solo
    en el catálogo dejaría el aviso mudo justo en los meses en que el daño se
    hace."""
    for prop in (test_property, otra_obra):
        _add(client, prop["id"], chapterName="[TEST] Acabados",
             name="[TEST] Piso cerámico", unit="m2", quantity=40, unitPrice=1_200)

    sugerencias = _suggest(client, "[TEST] Piso ceramico 60x60")
    assert len(sugerencias) == 1
    assert sugerencias[0]["source"] == "lines"
    assert sugerencias[0]["itemId"] is None
    assert sugerencias[0]["usedInLines"] == 2, "las dos grafías, agrupadas"


def test_a_line_is_not_suggested_to_itself(client, test_property):
    line_id = _add(client, test_property["id"], chapterName="[TEST] Acabados",
                   name="[TEST] Piso cerámico", unit="m2")["line"]["id"]
    assert _suggest(client, "[TEST] Piso cerámico") != []
    assert _suggest(client, "[TEST] Piso cerámico", lineId=line_id) == []


def test_a_promoted_line_stops_being_suggested_as_loose_text(client, test_property):
    """Después de promover, la misma partida deja de proponerse dos veces: la del
    catálogo la reemplaza, que es el punto de curar."""
    line_id = _add(client, test_property["id"], chapterName="[TEST] Acabados",
                   name="[TEST] Piso cerámico", unit="m2")["line"]["id"]
    client.post("/api/budget/catalog/promote", json={"lineId": line_id})
    sugerencias = _suggest(client, "[TEST] Piso cerámico")
    assert [s["source"] for s in sugerencias] == ["catalog"]


def test_the_threshold_is_the_measured_one_and_not_the_pg_trgm_default(client):
    """El umbral es 0.45 y lo fija esta capa; pg_trgm trae 0.6.

    Con nombres REALES —sin el prefijo `[TEST]`, que puntúa alto por sí solo y
    tapa la diferencia— «Colocación de piso cerámico» contra «Piso cerámico» da
    0.583: por debajo del default y muy por encima de lo que separa un duplicado
    de un nombre ajeno. Si alguien quitara el `set_config`, el aviso se volvería
    más estricto en silencio y dejaría de cazar exactamente el caso que el diseño
    nombra — sin error, sin rojo, solo un catálogo que después de un año sigue
    partido en tres."""
    chapter = _chapter(client)
    item = _item(client, chapter["id"], "Piso cerámico", "m2")
    with get_db() as conn:
        medida = conn.execute(
            "SELECT round(word_similarity(%s, %s)::numeric, 3) AS w",
            ("Colocación de piso cerámico", "Piso cerámico")).fetchone()["w"]
    assert Decimal("0.45") <= medida < Decimal("0.6"), medida

    r = client.get("/api/budget/catalog/suggest",
                   params={"name": "Colocación de piso cerámico"})
    assert any(s["itemId"] == item["id"] for s in r.json()), r.text


def test_the_empty_query_suggests_nothing(client):
    """Sin nada tecleado no hay pregunta que hacer, y devolver el catálogo entero
    sería un aviso que nunca dice nada."""
    r = client.get("/api/budget/catalog/suggest?name=%20")
    assert r.status_code == 200
    assert r.json() == []
