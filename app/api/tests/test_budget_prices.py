"""El precio que aprende una partida: mediana de lo pagado, rango, última vez, sesgo.

TODA ESTA SUITE ES SINTÉTICA A PROPÓSITO. La base real tiene 18 renglones, cero
cerrados y cero pagos, así que un endpoint que contesta sin explotar sobre una
tabla vacía no prueba absolutamente nada: la mediana, el rango, el sesgo y el
corte por proveedor solo se pueden ver contra historia construida a mano, y sin
ella todo esto pasaría en verde estando mal.

Lo que fija, en orden de gravedad:

  · LA SUGERENCIA SALE DE LO PAGADO, JAMÁS DE LO PRESUPUESTADO. Si se rompiera,
    el catálogo aprendería el número que él mismo puso y repetiría para siempre
    una suposición que alguien hizo una vez — y nada se vería roto, porque la
    cifra seguiría siendo plausible.
  · MEDIANA Y NO PROMEDIO. Con cuatro observaciones un renglón atípico mueve el
    promedio 900 pesos; la mediana no se entera. El caso de aquí abajo tiene el
    atípico puesto para que las dos respuestas no puedan confundirse.
  · LO QUE ENVENENA LA HISTORIA SE QUEDA FUERA, y son tres cosas distintas: el
    anticipo (pagos sin cierre), el cierre sin un peso pagado, y la plantilla,
    que es una intención y no una obra.
  · SIN HISTORIA LA RESPUESTA DICE QUÉ FALTA. Es el estado principal durante
    meses, no un borde: si nadie sabe que lo que falta es cerrar renglones con su
    cantidad real y sus pagos, la pantalla llena no llega nunca.
"""
from decimal import Decimal

import psycopg2
import pytest

from api.db import get_db


# ─── Utilería ─────────────────────────────────────────────────────────────────

def _dec(value) -> Decimal:
    return Decimal(str(value))


def _price(client, item_id: int) -> dict:
    r = client.get(f"/api/budget/catalog/items/{item_id}/price")
    assert r.status_code == 200, r.text
    return r.json()


def _chapter(client, name="[TEST] Acabados") -> dict:
    r = client.post("/api/budget/catalog/chapters", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def _item(client, chapter_id: int, name: str, unit: str = "m2") -> dict:
    r = client.post("/api/budget/catalog/items", json={
        "chapterId": chapter_id, "name": name, "unit": unit})
    assert r.status_code == 201, r.text
    return r.json()


def _property(client, name: str) -> dict:
    """Una obra más. La historia de precios se cuenta por OBRAS distintas, así
    que casi nada de lo que esta suite mide se ve con una sola."""
    r = client.post("/api/properties", json={
        "name": name, "address": f"{name} 1", "city": "Monterrey",
        "purchasePrice": 1_000_000, "sqmConstruction": 100,
        "constructionCostPerSqm": 5_000, "constructionOverhead": 1})
    assert r.status_code == 201, r.text
    return r.json()


def _supplier(client, name: str, rating_calidad: int) -> dict:
    r = client.post("/api/proveedores", json={"name": name, "status": "activo"})
    assert r.status_code == 201, r.text
    proveedor = r.json()
    r = client.patch(f"/api/proveedores/{proveedor['id']}",
                     json={"ratingCalidad": rating_calidad})
    assert r.status_code == 200, r.text
    return r.json()


def _line(client, property_id: int, item_id: int, **body) -> int:
    r = client.post(f"/api/properties/{property_id}/budget/lines",
                    json={"itemId": item_id, **body})
    assert r.status_code == 201, r.text
    return r.json()["line"]["id"]


def _pay(client, property_id: int, line_id: int, amount) -> None:
    r = client.post(f"/api/properties/{property_id}/budget/lines/{line_id}/payments",
                    json={"amount": amount})
    assert r.status_code == 201, r.text


def _close(line_id: int, actual_quantity, closed_at: str) -> None:
    """Cierra el renglón por SQL porque todavía no hay endpoint que lo haga: el
    gatillo de `closed_at` es una pregunta abierta del diseño (¿al recibir el
    trabajo, al marcar el último pago como finiquito?). Mientras no se conteste,
    la historia de precios no se puede llenar desde la aplicación — pero la
    lectura sí se puede fijar, y es lo que esta suite hace."""
    with get_db() as conn:
        conn.execute(
            "UPDATE budget_lines SET actual_quantity = %s, closed_at = %s WHERE id = %s",
            (actual_quantity, closed_at, line_id))


def _observe(client, property_id: int, item_id: int, *, budgeted_unit_price,
             quantity, actual_quantity, paid, closed_at, supplier_id=None) -> int:
    """Una observación completa: presupuestada, pagada y cerrada. Es la única
    forma en que un renglón entra a la historia, y las tres partes hacen falta."""
    line_id = _line(client, property_id, item_id, quantity=quantity,
                    unitPrice=budgeted_unit_price, supplierId=supplier_id)
    _pay(client, property_id, line_id, paid)
    _close(line_id, actual_quantity, closed_at)
    return line_id


def _scrap(property_id: int) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM budgets WHERE property_id = %s", (property_id,))
        conn.execute("DELETE FROM properties WHERE id = %s", (property_id,))


@pytest.fixture(autouse=True)
def rastro_limpio():
    """Lo de prueba se recoge en el orden en que el esquema lo permite: las obras
    (que se llevan sus presupuestos, renglones y pagos), luego las partidas —un
    capítulo con partidas no se borra— y al final los proveedores."""
    yield
    with get_db() as conn:
        conn.execute("DELETE FROM budgets WHERE property_id IS NULL AND name LIKE '[TEST]%%'")
        conn.execute(
            "DELETE FROM budget_items WHERE name LIKE '%%[TEST]%%'"
            "   OR chapter_id IN (SELECT id FROM budget_chapters WHERE name LIKE '[TEST]%%')")
        conn.execute("DELETE FROM budget_chapters WHERE name LIKE '[TEST]%%'")
        conn.execute("DELETE FROM proveedores WHERE name LIKE '[TEST]%%'")


@pytest.fixture
def partida(client) -> dict:
    """La partida del catálogo sobre la que se cuenta toda la historia."""
    return _item(client, _chapter(client)["id"], "[TEST] Piso cerámico")


@pytest.fixture
def obras(client):
    """Tres obras más, para que haya de dónde sacar observaciones independientes."""
    props = [_property(client, f"[TEST] Obra {n}") for n in ("Dos", "Tres", "Cuatro")]
    yield props
    for prop in props:
        _scrap(prop["id"])


# Cuatro obras cerradas de la misma partida. Los números están escogidos para que
# la mediana y el promedio no puedan confundirse, y para que el presupuestado sea
# reconociblemente distinto de lo pagado en las cuatro:
#
#   obra   presupuestado/u   cantidad real   pagado    pagado/u
#   ────────────────────────────────────────────────────────────
#   1          $1,000            40 m²      $48,000     $1,200
#   2          $1,000            50 m²      $65,000     $1,300
#   3            $900            30 m²      $33,000     $1,100
#   4          $1,000            10 m²      $50,000     $5,000  ← el atípico
#
#   mediana = (1,200 + 1,300) / 2 = $1,250        promedio = $2,150
#
# El atípico es el caso real de la partida contratada con material incluido, y es
# exactamente lo que un promedio no aguanta.
HISTORIA = (
    dict(budgeted_unit_price=1_000, quantity=40, actual_quantity=40,
         paid=48_000, closed_at="2026-01-10"),
    dict(budgeted_unit_price=1_000, quantity=50, actual_quantity=50,
         paid=65_000, closed_at="2026-02-14"),
    dict(budgeted_unit_price=900, quantity=30, actual_quantity=30,
         paid=33_000, closed_at="2026-03-20"),
    dict(budgeted_unit_price=1_000, quantity=10, actual_quantity=10,
         paid=50_000, closed_at="2026-04-05"),
)

MEDIANA_PAGADA = Decimal("1250")
PROMEDIO_PAGADO = Decimal("2150")


@pytest.fixture
def historia(client, test_property, obras, partida):
    """Las cuatro observaciones de arriba, una por obra."""
    props = [test_property, *obras]
    for prop, observacion in zip(props, HISTORIA):
        _observe(client, prop["id"], partida["id"], **observacion)
    return {"item": partida, "properties": props}


# ── La sugerencia: mediana de lo PAGADO ────────────────────────────────────

def test_the_suggested_price_is_the_median_of_what_was_paid(client, historia):
    """La mediana, y no el promedio. Con cuatro observaciones el atípico de
    $5,000 mueve el promedio a $2,150 —una cifra que nadie pagó nunca por un m²
    normal y que arruinaría el siguiente presupuesto— mientras que la mediana se
    queda en los $1,250 que sí describen la partida."""
    precio = _price(client, historia["item"]["id"])

    assert _dec(precio["suggestedUnitPrice"]) == MEDIANA_PAGADA
    assert _dec(precio["suggestedUnitPrice"]) != PROMEDIO_PAGADO
    assert (_dec(precio["minUnitPrice"]), _dec(precio["maxUnitPrice"])) == (
        Decimal("1100"), Decimal("5000"))
    assert (precio["observations"], precio["properties"]) == (4, 4)
    assert precio["propertiesNeeded"] == 0
    assert (precio["name"], precio["unit"]) == ("[TEST] Piso cerámico", "m2")


def test_the_suggestion_never_comes_from_what_was_budgeted(client, historia):
    """El bucle de autoconfirmación que este endpoint existe para no tener.

    Las cuatro obras se presupuestaron a $1,000/m² (una a $900) y se pagaron
    entre $1,100 y $5,000. Si la sugerencia leyera lo presupuestado saldría
    $1,000 —el número que alguien supuso una vez— y el catálogo lo repetiría para
    siempre sin tocar la realidad ni una vez."""
    precio = _price(client, historia["item"]["id"])

    mediana_presupuestada = Decimal("1000")   # tres a $1,000 y una a $900
    assert _dec(precio["suggestedUnitPrice"]) != mediana_presupuestada
    assert _dec(precio["suggestedUnitPrice"]) == MEDIANA_PAGADA
    # Lo presupuestado se lee, pero solo para una cosa: compararse.
    assert precio["bias"]["observations"] == 4


def test_the_last_observation_names_the_work_and_the_supplier(client, historia,
                                                              test_property, obras):
    """«Última vez: abr-2026 · Obra Cuatro · Acabados del Norte · $5,000». Un
    precio sin procedencia no se puede discutir con nadie; con ella, quien
    captura sabe si el número que está viendo viene de la obra que se parece a la
    suya o de la que no."""
    proveedor = _supplier(client, "[TEST] Acabados del Norte", rating_calidad=5)
    ultima = obras[-1]
    with get_db() as conn:
        conn.execute("UPDATE budget_lines SET supplier_id = %s"
                     "  WHERE item_id = %s AND budget_id IN"
                     "        (SELECT id FROM budgets WHERE property_id = %s)",
                     (proveedor["id"], historia["item"]["id"], ultima["id"]))

    last = _price(client, historia["item"]["id"])["lastObservation"]

    assert last["closedAt"].startswith("2026-04-05")
    assert last["propertyId"] == ultima["id"]
    assert last["propertyName"] == ultima["name"]
    assert last["supplierName"] == "[TEST] Acabados del Norte"
    assert _dec(last["unitPrice"]) == Decimal("5000")
    assert _dec(last["budgetedUnitPrice"]) == Decimal("1000")
    assert (_dec(last["actualQuantity"]), _dec(last["paidAmount"])) == (
        Decimal("10"), Decimal("50000"))


# ── El sesgo: cómo se equivoca quien presupuesta ────────────────────────────

def test_the_bias_says_how_the_budget_systematically_misses(client, historia):
    """El entregable de más valor de la fase, y no un adorno del precio unitario:
    un precio dice cuánto cuesta algo, el sesgo dice cómo se equivoca quien
    presupuesta — y eso se corrige una vez y mejora todos los presupuestos que
    vengan.

    Las desviaciones relativas de las cuatro observaciones son −8.33%, −16.67%,
    −23.08% y −80%; su mediana es (−0.230769… + −0.181818…) / 2 = −0.2063. En las
    cuatro el presupuesto quedó ABAJO de lo pagado, que es lo que vuelve el
    número accionable: 4 de 4 es una costumbre, 2 de 4 sería ruido."""
    bias = _price(client, historia["item"]["id"])["bias"]

    assert _dec(bias["medianDeltaPct"]) == Decimal("-0.2063")
    assert (bias["sameDirection"], bias["observations"]) == (4, 4)


def test_a_budget_that_misses_in_both_directions_is_not_a_habit(client, test_property,
                                                                obras, partida):
    """«3 de 4» y «4 de 4» no dicen lo mismo, y por eso el conteo viaja junto al
    porcentaje. Aquí lo pagado es siempre $1,000/m² y lo presupuestado va
    +20%, +10%, +5% y −30%: la mediana de las desviaciones es +7.5%, pero solo
    tres de las cuatro fueron en esa dirección."""
    for prop, presupuestado in zip([test_property, *obras], (1_200, 1_100, 1_050, 700)):
        _observe(client, prop["id"], partida["id"], budgeted_unit_price=presupuestado,
                 quantity=10, actual_quantity=10, paid=10_000, closed_at="2026-05-01")

    precio = _price(client, partida["id"])

    assert _dec(precio["suggestedUnitPrice"]) == Decimal("1000")
    assert _dec(precio["bias"]["medianDeltaPct"]) == Decimal("0.0750")
    assert (precio["bias"]["sameDirection"], precio["bias"]["observations"]) == (3, 4)


def test_a_line_nobody_priced_does_not_become_a_bias_of_minus_one_hundred(
        client, test_property, partida):
    """Un renglón se captura celda por celda, así que nacer sin precio unitario
    es normal —queda en 0— y contarlo diría «el presupuesto quedó 100% abajo».
    Es la clase de número que parece plausible y no lo es: no hubo presupuesto
    con qué comparar. Lo pagado sí se cuenta: se pagó de verdad."""
    _observe(client, test_property["id"], partida["id"], budgeted_unit_price=0,
             quantity=10, actual_quantity=10, paid=12_000, closed_at="2026-05-01")

    precio = _price(client, partida["id"])

    assert _dec(precio["suggestedUnitPrice"]) == Decimal("1200")
    assert precio["observations"] == 1
    assert precio["bias"] is None


# ── Lo que envenena la historia y se queda fuera ────────────────────────────

def test_an_advance_payment_is_not_a_price(client, test_property, partida):
    """La pieza de la que depende todo: sin `closed_at`, $30,000 pagados pueden
    ser un anticipo o el costo final y nada los distingue. Contarlos aprendería
    precios sistemáticamente bajos sin que nada se viera roto — y aquí, además,
    la respuesta dice que ese renglón existe y qué le falta."""
    line_id = _line(client, test_property["id"], partida["id"],
                    quantity=40, unitPrice=1_000)
    _pay(client, test_property["id"], line_id, 30_000)

    precio = _price(client, partida["id"])

    assert precio["observations"] == 0
    assert precio["suggestedUnitPrice"] is None
    assert precio["pending"] == {"lines": 1, "openLines": 1, "paidButOpen": 1,
                                 "closedWithoutPayment": 0}


def test_a_closed_line_cannot_exist_without_its_real_quantity(client, test_property,
                                                              partida):
    """El otro cierre que envenenaría la mediana no puede llegar: el esquema no
    deja cerrar sin cantidad real, porque sin ella no hay precio unitario que
    calcular —solo un monto pagado dividido entre nada."""
    line_id = _line(client, test_property["id"], partida["id"],
                    quantity=40, unitPrice=1_000)
    _pay(client, test_property["id"], line_id, 44_000)

    with pytest.raises(psycopg2.errors.CheckViolation) as rechazo:
        with get_db() as conn:
            conn.execute("UPDATE budget_lines SET closed_at = now(), actual_quantity = NULL"
                         " WHERE id = %s", (line_id,))
    assert "budget_lines_closed_needs_actual_quantity" in str(rechazo.value)

    assert _price(client, partida["id"])["observations"] == 0


def test_a_closed_line_without_a_peso_paid_is_not_an_observation(client, test_property,
                                                                 partida):
    """Cerrado y sin pagos no es «costó $0»: es que no se ha capturado lo que se
    pagó. Un cero ahí se metería a la mediana como un precio real."""
    line_id = _line(client, test_property["id"], partida["id"],
                    quantity=40, unitPrice=1_000)
    _close(line_id, 40, "2026-03-01")

    precio = _price(client, partida["id"])

    assert precio["observations"] == 0
    assert precio["suggestedUnitPrice"] is None
    assert precio["pending"]["closedWithoutPayment"] == 1


def test_a_template_line_is_an_intention_not_an_observation(client, test_property,
                                                            partida):
    """Una plantilla es un presupuesto sin propiedad — un plan, no una obra. Sus
    renglones no describen nada que haya pasado, así que aunque alguien los
    cerrara y les anotara pagos no pueden entrar a la historia de precios."""
    _observe(client, test_property["id"], partida["id"], budgeted_unit_price=1_000,
             quantity=40, actual_quantity=40, paid=48_000, closed_at="2026-01-10")
    r = client.post("/api/budget/templates", json={
        "name": "[TEST] Plantilla", "fromBudgetId": _budget_id(test_property["id"])})
    assert r.status_code == 201, r.text
    template_line = next(line for line in r.json()["lines"]
                         if line["itemId"] == partida["id"])

    with get_db() as conn:
        conn.execute("UPDATE budget_lines SET actual_quantity = 40, closed_at = now()"
                     " WHERE id = %s", (template_line["id"],))
        conn.execute("INSERT INTO budget_line_payments (line_id, amount) VALUES (%s, %s)",
                     (template_line["id"], 200_000))

    precio = _price(client, partida["id"])

    assert precio["observations"] == 1, "la plantilla no es una observación"
    assert _dec(precio["suggestedUnitPrice"]) == Decimal("1200")


def _budget_id(property_id: int) -> int:
    with get_db() as conn:
        return conn.execute("SELECT id FROM budgets WHERE property_id = %s",
                            (property_id,)).fetchone()["id"]


# ── El estado vacío, que es el estado principal ─────────────────────────────

def test_without_history_the_answer_says_what_is_missing(client, partida):
    """Así va a contestar durante meses, y por eso no puede ser un `null` mudo.
    La forma completa con las cifras en `null`, los contadores en cero y las
    obras que faltan es lo que deja que la pantalla explique qué hay que capturar
    en vez de quedarse callada."""
    precio = _price(client, partida["id"])

    assert precio["observations"] == 0 and precio["properties"] == 0
    assert precio["propertiesNeeded"] == 3
    assert precio["suggestedUnitPrice"] is None
    assert precio["minUnitPrice"] is None and precio["maxUnitPrice"] is None
    assert precio["lastObservation"] is None
    assert precio["bias"] is None
    assert precio["bySupplier"] == []
    assert precio["pending"] == {"lines": 0, "openLines": 0, "paidButOpen": 0,
                                 "closedWithoutPayment": 0}


def test_the_pending_lines_say_exactly_what_to_capture(client, test_property, obras,
                                                       partida):
    """Dos obras ya usan la partida y ninguna ha cerrado. Lo accionable no es «no
    hay datos»: es que hay dos renglones abiertos, uno de ellos ya con pagos, y
    que cerrarlos con su cantidad real es lo que convierte esto en historia."""
    for prop in (test_property, obras[0]):
        _line(client, prop["id"], partida["id"], quantity=40, unitPrice=1_000)
    line_id = _line(client, obras[1]["id"], partida["id"], quantity=10, unitPrice=1_000)
    _pay(client, obras[1]["id"], line_id, 5_000)

    precio = _price(client, partida["id"])

    assert precio["pending"] == {"lines": 3, "openLines": 3, "paidButOpen": 1,
                                 "closedWithoutPayment": 0}
    assert precio["propertiesNeeded"] == 3


def test_the_history_counts_works_and_not_lines(client, test_property, partida):
    """Dos renglones cerrados en la MISMA obra son dos observaciones, pero una
    sola negociación: el precio sale de la misma conversación con el mismo
    proveedor el mismo mes. Por eso lo que falta se cuenta en obras."""
    for closed_at, paid in (("2026-01-10", 48_000), ("2026-01-11", 52_000)):
        _observe(client, test_property["id"], partida["id"], budgeted_unit_price=1_000,
                 quantity=40, actual_quantity=40, paid=paid, closed_at=closed_at)

    precio = _price(client, partida["id"])

    assert (precio["observations"], precio["properties"]) == (2, 1)
    assert precio["propertiesNeeded"] == 2
    # La cifra se publica desde la primera observación: es lo que de verdad se
    # pagó, y callarla no la haría más cierta. Lo que la respuesta no hace es
    # presentarla como si tres obras la respaldaran.
    assert _dec(precio["suggestedUnitPrice"]) == Decimal("1250")   # (1,200 + 1,300) / 2


# ── El corte por proveedor ──────────────────────────────────────────────────

def test_the_supplier_cut_answers_who_charges_less_among_those_who_work_well(
        client, test_property, obras, partida):
    """La pregunta de negociación completa, que ninguna de las dos cifras
    contesta sola: el más barato puede ser al que hay que volver a llamar.

    Aquí «Barato» cobró $1,100/m² con calidad 2 y «Norte» $1,200 y $1,300 —
    mediana $1,250— con calidad 5. La respuesta los ordena por precio y trae la
    calificación al lado para que quien negocia vea el intercambio, en vez de
    esconderlo detrás de un solo número."""
    barato = _supplier(client, "[TEST] Barato", rating_calidad=2)
    norte = _supplier(client, "[TEST] Norte", rating_calidad=5)
    plan = (
        (test_property, norte, 48_000),      # $1,200/m²
        (obras[0], norte, 52_000),           # $1,300/m²
        (obras[1], barato, 44_000),          # $1,100/m²
    )
    for prop, proveedor, paid in plan:
        _observe(client, prop["id"], partida["id"], budgeted_unit_price=1_000,
                 quantity=40, actual_quantity=40, paid=paid, closed_at="2026-02-01",
                 supplier_id=proveedor["id"])
    # Y una cuarta obra sin proveedor capturado: cuenta para la mediana general
    # —se pagó de verdad— pero no aparece en el corte, porque «sin proveedor» no
    # es alguien con quien se pueda negociar la próxima.
    _observe(client, obras[2]["id"], partida["id"], budgeted_unit_price=1_000,
             quantity=40, actual_quantity=40, paid=60_000, closed_at="2026-02-02")

    precio = _price(client, partida["id"])
    cut = precio["bySupplier"]

    assert [c["supplierName"] for c in cut] == ["[TEST] Barato", "[TEST] Norte"]
    assert _dec(cut[0]["medianUnitPrice"]) == Decimal("1100")
    assert _dec(cut[1]["medianUnitPrice"]) == Decimal("1250")
    assert [c["ratingCalidad"] for c in cut] == [2, 5]
    assert [(c["observations"], c["properties"]) for c in cut] == [(1, 1), (2, 2)]
    assert precio["observations"] == 4, "la obra sin proveedor sí cuenta para la mediana"


def test_an_item_that_is_not_in_the_catalog_has_no_price(client):
    r = client.get("/api/budget/catalog/items/999999999/price")
    assert r.status_code == 404, r.text
