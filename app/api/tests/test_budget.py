"""El presupuesto de obra: la suma manda, el overhead no se repite, «otros» resta.

Tres reglas y las tres tienen la misma forma de falla — se rompen sin que nada
se vea roto, solo con números más grandes o más chicos que parecen plausibles:

  · La suma del presupuesto ES el costo de obra, en TODA etapa y sin ramas.
  · El overhead se aplicó una vez, al sembrar, y vive dentro del importe.
    Aplicarlo de nuevo inflaría 30% cada costo de obra.
  · «Otros, por detallar» es un RESIDUO: detallar reparte el costo, no lo crea,
    así que el total no se mueve.
"""
from decimal import Decimal

import pytest

from api import budget_db
from api.db import get_db


def _get(client, property_id: int) -> dict:
    r = client.get(f"/api/properties/{property_id}")
    assert r.status_code == 200, r.text
    return r.json()


def _budget(client, property_id: int) -> dict:
    r = client.get(f"/api/properties/{property_id}/budget")
    assert r.status_code == 200, r.text
    return r.json()


def _residual(budget: dict) -> dict:
    return next(line for line in budget["lines"] if line["isResidual"])


def _line_by_id(budget: dict, line_id: int) -> dict:
    return next(line for line in budget["lines"] if line["id"] == line_id)


def _add(client, property_id: int, **body) -> dict:
    r = client.post(f"/api/properties/{property_id}/budget/lines", json={
        "chapterName": "Albañilería", "name": "Partida", "unit": "m2", **body})
    assert r.status_code == 201, r.text
    return r.json()


def _dec(value) -> Decimal:
    return Decimal(str(value))


# ── La calculadora, y el overhead que se aplica una sola vez ─────────────────

def test_the_calculator_applies_the_overhead_exactly_once():
    """200 m² × 9,000 × 1.3 = 2,340,000, no 3,042,000. La calculadora es el
    ÚNICO lugar donde el multiplicador entra, y entra al producir el importe del
    primer renglón — de ahí en adelante el importe es el hecho."""
    assert budget_db.calculator_estimate(200, 9_000, 1.3) == Decimal("2340000.0")


def test_an_absent_overhead_costs_the_assumed_thirty_percent():
    """Vacío no es «sin sobrecosto»: es el supuesto del sistema, el mismo ×1.3
    que la migración 028 aplicó al sembrar. Que la calculadora y la siembra
    resuelvan igual es lo que permitió que el cambio de fuente no moviera un
    peso en ninguna de las 18 propiedades."""
    assert budget_db.calculator_estimate(120, 1_000) == Decimal("156000.0")
    assert budget_db.calculator_estimate(120, 1_000, None) == Decimal("156000.0")


def test_a_captured_zero_overhead_is_no_surcharge_not_no_construction():
    """El overhead es un MULTIPLICADOR, así que un 0 capturado es identidad 1 y
    nunca ×0 — multiplicar por cero borraría la obra que alguien sí capturó. La
    UI escribe 0 para un campo vacío tan seguido como el NULL."""
    assert budget_db.calculator_estimate(120, 1_000, 0) == Decimal("120000")
    assert budget_db.overhead_factor(0) == Decimal(1)
    assert budget_db.overhead_factor(1.3) == Decimal("1.3")


def test_an_overhead_below_one_is_refused_because_indirect_costs_never_cheapen():
    """La misma regla que hace que el 0 sea identidad dice qué hacer con el 0.5, y
    dice que no: un multiplicador de indirectos suma o no suma, jamás resta. El
    0.5 se teclea queriendo decir «50% de indirectos» —que es 1.5— y aplicado tal
    cual dejaría la obra a la mitad.

    El mensaje trae el número correcto porque el rechazo tiene que poder
    resolverse sin adivinar cuál de las dos convenciones espera el sistema."""
    with pytest.raises(budget_db.BudgetError) as rechazo:
        budget_db.overhead_factor(0.5)
    assert "1.5" in str(rechazo.value)

    # Y el negativo por la misma puerta: antes llegaba hasta el CHECK del renglón
    # como un 500 mudo, porque un importe negativo no se puede guardar.
    with pytest.raises(budget_db.BudgetError):
        budget_db.calculator_estimate(200, 9_000, -1)


# ── Una propiedad nace con su presupuesto ───────────────────────────────────

def test_a_new_property_is_born_with_its_budget(client, test_property):
    """La fila «Otros, por detallar» YA es el presupuesto, desde `prospecto`.
    Que nazca con la propiedad es lo que hace que nunca haya un momento en que
    el costo de obra cambie de fuente: no hay traspaso que diseñar."""
    budget = _budget(client, test_property["id"])
    assert len(budget["lines"]) == 1
    residual = _residual(budget)
    assert residual["name"] == budget_db.RESIDUAL_NAME
    # 200 m² × 9,000 × 1.3 del fixture, con el overhead ya adentro.
    assert _dec(residual["budgetedAmount"]) == Decimal("2340000")
    assert _dec(test_property["constructionBudgeted"]) == Decimal("2340000")


def test_a_property_is_not_born_with_its_work_shrunk_in_silence(client):
    """El caso donde la regla se paga: la calculadora corre al dar de alta y su
    resultado se queda dentro de «Otros, por detallar» para siempre. Un 0.5
    aceptado ahí no produce un número raro que alguien note — produce una obra a
    mitad de precio que se ve perfectamente plausible, y que ya no se corrige
    arreglando el campo.

    La propiedad tampoco nace a medias: el estimado se calcula ANTES de abrir la
    transacción, así que el rechazo no deja fila que limpiar."""
    encogida = "[TEST] Obra Encogida"
    r = client.post("/api/properties", json={
        "name": encogida, "address": "Calle Test 1", "city": "Monterrey",
        "purchasePrice": 1_000_000, "sqmConstruction": 200,
        "constructionCostPerSqm": 9_000, "constructionOverhead": 0.5})

    assert r.status_code == 422, r.text
    assert "1.5" in r.json()["error"]["message"]
    with get_db() as conn:
        sobrevivientes = conn.execute(
            "SELECT count(*) AS n FROM properties WHERE name = %s", (encogida,)
        ).fetchone()["n"]
    assert sobrevivientes == 0, "un alta rechazada no deja propiedad a medias"


def test_the_budget_is_the_cost_of_work_in_every_stage(client, desarrollo_property):
    """Sin compuerta de etapa: el presupuesto acompaña a la propiedad como el
    desglose de costos, no como una herramienta que se abre en Desarrollo."""
    for body in ({"to": "en_renta", "firstRentDate": "2026-03", "rentMonthlyActual": 20_000},
                 {"to": "vendida", "saleDate": "2026-07", "salePrice": 5_000_000}):
        r = client.post(f"/api/properties/{desarrollo_property['id']}/transition", json=body)
        assert r.status_code == 200, r.text
        assert _dec(r.json()["constructionBudgeted"]) == Decimal("2340000")
        assert _dec(r.json()["totalInvestment"]) == Decimal("3480000")
    assert client.get(
        f"/api/properties/{desarrollo_property['id']}/budget").status_code == 200


def test_the_budget_feeds_the_investment_and_nothing_multiplies_it(client, test_property):
    """La prueba de la trampa, dicha con números: el presupuesto sube 660,000 y
    la inversión sube exactamente 660,000. Si algún factor sobreviviera, subiría
    858,000."""
    before = _dec(test_property["totalInvestment"])
    r = client.put(f"/api/properties/{test_property['id']}/budget/total",
                   json={"amount": 3_000_000})
    assert r.status_code == 200, r.text
    assert _dec(r.json()["property"]["constructionBudgeted"]) == Decimal("3000000")
    assert _dec(r.json()["property"]["totalInvestment"]) == before + Decimal("660000")


# ── «Otros» es un residuo ───────────────────────────────────────────────────

def test_detailing_moves_cost_out_of_others_without_moving_the_total(client, test_property):
    """Detallar distribuye costo, no lo crea. 500,000 de cocina salen de los
    2,340,000 sin detallar; el total y la inversión no se mueven un peso."""
    total_antes = _dec(test_property["totalInvestment"])
    r = _add(client, test_property["id"], name="Cocina", quantity=1, unitPrice=500_000)

    assert _dec(_residual(r["budget"])["budgetedAmount"]) == Decimal("1840000")
    assert _dec(r["property"]["constructionBudgeted"]) == Decimal("2340000")
    assert _dec(r["property"]["totalInvestment"]) == total_antes
    assert r["budgetIncrease"] == 0


def test_undetailing_gives_the_cost_back_to_others(client, test_property):
    """Quitar el detalle es lo contrario de ponerlo, así que tampoco mueve el
    total: el importe vuelve al residuo de donde salió."""
    created = _add(client, test_property["id"], name="Cocina", quantity=1, unitPrice=500_000)
    line_id = created["line"]["id"]
    r = client.delete(f"/api/properties/{test_property['id']}/budget/lines/{line_id}")
    assert r.status_code == 200, r.text
    r = r.json()
    assert _dec(_residual(r["budget"])["budgetedAmount"]) == Decimal("2340000")
    assert _dec(r["property"]["constructionBudgeted"]) == Decimal("2340000")


def test_raising_a_detailed_line_lowers_others_by_the_same_amount(client, test_property):
    created = _add(client, test_property["id"], name="Cocina", quantity=1, unitPrice=500_000)
    r = client.patch(
        f"/api/properties/{test_property['id']}/budget/lines/{created['line']['id']}",
        json={"unitPrice": 900_000})
    assert r.status_code == 200, r.text
    r = r.json()
    assert _dec(_residual(r["budget"])["budgetedAmount"]) == Decimal("1440000")
    assert _dec(r["property"]["constructionBudgeted"]) == Decimal("2340000")


def test_others_is_never_typed_by_hand(client, test_property):
    """Convertir una resta determinista en una segunda captura es donde nace el
    descuadre: el residuo tendría dos verdades, la tecleada y la que se deduce
    del total."""
    residual_id = _residual(_budget(client, test_property["id"]))["id"]
    r = client.patch(
        f"/api/properties/{test_property['id']}/budget/lines/{residual_id}",
        json={"unitPrice": 9_000_000})
    assert r.status_code == 422
    assert "se calcula solo" in r.json()["error"]["message"]
    assert _dec(_get(client, test_property["id"])["constructionBudgeted"]) == Decimal("2340000")


def test_others_is_not_renamed_either(client, test_property):
    """Su capítulo, su nombre y su unidad los pone el sistema. Un residuo
    renombrado seguiría restando bien, pero dejaría de leerse como lo que es."""
    residual_id = _residual(_budget(client, test_property["id"]))["id"]
    r = client.patch(
        f"/api/properties/{test_property['id']}/budget/lines/{residual_id}",
        json={"name": "Imprevistos"})
    assert r.status_code == 422


def test_detailing_does_not_shave_fractions_off_the_total(client, test_property):
    """`cantidad × precio` puede traer cinco decimales y el importe del residuo
    se guarda en dos. Restando en crudo, cada partida dejaba hasta medio centavo
    tirado y cincuenta partidas movían el total un cuarto de peso — una fuga que
    nadie pidió y que ninguna cifra publicada delataría, porque todo se imprime
    en pesos enteros."""
    for i in range(50):
        _add(client, test_property["id"], name=f"Partida {i}",
             quantity=1.5, unitPrice=100.01)          # 150.015 exactos
    with get_db() as conn:
        total = conn.execute(
            "SELECT sum(l.quantity * l.unit_price) AS t FROM budget_lines l"
            "  JOIN budgets b ON b.id = l.budget_id WHERE b.property_id = %s",
            (test_property["id"],)).fetchone()["t"]
    assert _dec(total) == Decimal("2340000")


def test_others_is_never_deleted(client, test_property):
    residual_id = _residual(_budget(client, test_property["id"]))["id"]
    r = client.delete(f"/api/properties/{test_property['id']}/budget/lines/{residual_id}")
    assert r.status_code == 422
    assert "no se borra" in r.json()["error"]["message"]


def test_detail_beyond_the_total_grows_the_budget_and_says_so(client, test_property):
    """Si el detalle rebasa el total, «otros» llega a 0 y el total SÍ crece. Eso
    es aumentar el presupuesto, no detallarlo, y las dos operaciones tienen que
    poder distinguirse: la respuesta reporta cuánto creció en vez de dejar que
    el costo de obra suba en silencio."""
    r = _add(client, test_property["id"], name="Estructura", quantity=1, unitPrice=3_000_000)
    assert _dec(_residual(r["budget"])["budgetedAmount"]) == Decimal("0")
    assert _dec(r["property"]["constructionBudgeted"]) == Decimal("3000000")
    assert _dec(r["budgetIncrease"]) == Decimal("660000")


def test_raising_the_total_is_its_own_operation(client, test_property):
    """Aumentar el presupuesto sin tocar una sola partida detallada: el residuo
    absorbe la diferencia y el detalle se queda donde estaba."""
    _add(client, test_property["id"], name="Cocina", quantity=1, unitPrice=500_000)
    r = client.put(f"/api/properties/{test_property['id']}/budget/total",
                   json={"amount": 4_000_000})
    assert r.status_code == 200, r.text
    r = r.json()
    assert _dec(_residual(r["budget"])["budgetedAmount"]) == Decimal("3500000")
    assert _dec(r["property"]["constructionBudgeted"]) == Decimal("4000000")


def test_the_total_cannot_drop_below_what_is_already_detailed(client, test_property):
    _add(client, test_property["id"], name="Cocina", quantity=1, unitPrice=500_000)
    r = client.put(f"/api/properties/{test_property['id']}/budget/total",
                   json={"amount": 100_000})
    assert r.status_code == 422
    assert "detallados en partidas" in r.json()["error"]["message"]


# ── Las tres cifras, y las dos que no redefinen la inversión ────────────────

def test_committed_and_paid_are_absent_until_somebody_captures_them(client, test_property):
    """Nadie firmó nada todavía no es «$0 comprometido»: un cero ahí se leería
    como un hecho. Vacío se imprime «—», no $0."""
    p = _get(client, test_property["id"])
    assert p["constructionCommitted"] is None
    assert p["constructionPaid"] is None
    assert p["constructionCommittedVariance"] is None
    assert p["constructionPaidVariance"] is None


def test_committing_and_paying_never_redefine_the_investment(client, test_property):
    """Lo que la obra va a costar y lo que ya se pagó de ella son dos preguntas
    distintas. Solo el PLAN alimenta la inversión total; comprometer y pagar
    generan métricas propias y no mueven la base de capital."""
    inversion = _dec(test_property["totalInvestment"])
    created = _add(client, test_property["id"], name="Cocina", quantity=1, unitPrice=500_000)
    line_id = created["line"]["id"]

    r = client.patch(f"/api/properties/{test_property['id']}/budget/lines/{line_id}",
                     json={"committedAmount": 620_000})
    assert r.status_code == 200, r.text
    r = r.json()
    assert _dec(r["property"]["constructionCommitted"]) == Decimal("620000")
    assert _dec(r["property"]["constructionCommittedVariance"]) == Decimal("-1720000")
    assert _dec(r["property"]["totalInvestment"]) == inversion

    r = client.post(f"/api/properties/{test_property['id']}/budget/lines/{line_id}/payments",
                    json={"amount": 300_000, "paidOn": "2026-05-10"})
    assert r.status_code == 201, r.text
    r = client.post(f"/api/properties/{test_property['id']}/budget/lines/{line_id}/payments",
                    json={"amount": 250_000, "paidOn": "2026-06-10"})
    assert r.status_code == 201, r.text
    r = r.json()
    assert _dec(r["property"]["constructionPaid"]) == Decimal("550000")
    assert _dec(r["property"]["constructionBudgeted"]) == Decimal("2340000")
    assert _dec(r["property"]["totalInvestment"]) == inversion


def test_the_variance_is_shown_and_the_plan_is_not_corrected(client, test_property):
    """Pagar de más es lo normal en obra, no la excepción. El presupuestado no
    se corrige solo para que empate: el presupuesto era un plan, el pago es un
    hecho, y la información útil es la brecha."""
    created = _add(client, test_property["id"], name="Cocina", quantity=1, unitPrice=500_000)
    line_id = created["line"]["id"]
    r = client.post(f"/api/properties/{test_property['id']}/budget/lines/{line_id}/payments",
                    json={"amount": 620_000})
    assert r.status_code == 201, r.text
    r = r.json()
    assert _dec(r["line"]["budgetedAmount"]) == Decimal("500000")
    assert _dec(r["line"]["paidAmount"]) == Decimal("620000")
    assert _dec(r["line"]["paidVariance"]) == Decimal("120000")


# ── Vaciar una celda es decir null, y decir null tiene que llegar ───────────

def test_a_null_empties_the_cell_instead_of_being_ignored(client, test_property):
    """Al revés que en la ficha, aquí un null VIAJA y significa «quítalo». El
    selector de proveedor tiene «— Sin proveedor», y elegirlo tiene que quitar
    el proveedor: descartar ese null dejaba el dato en la base con la pantalla
    diciendo que ya no estaba, sin error y sin pista, hasta que alguien recarga
    y el proveedor viejo reaparece."""
    with get_db() as conn:
        supplier_id = conn.execute(
            "INSERT INTO proveedores (name) VALUES ('[TEST] Proveedor Presupuesto')"
            " RETURNING id").fetchone()["id"]
    created = _add(client, test_property["id"], name="Cocina", quantity=1, unitPrice=500_000,
                   supplierId=supplier_id, committedAmount=480_000,
                   committedOn="2026-05-01", actualQuantity=1.2)
    line_id = created["line"]["id"]
    assert created["line"]["supplierId"] == supplier_id

    for field in ("supplierId", "committedAmount", "committedOn", "actualQuantity"):
        r = client.patch(f"/api/properties/{test_property['id']}/budget/lines/{line_id}",
                         json={field: None})
        assert r.status_code == 200, r.text
        assert _line_by_id(r.json()["budget"], line_id)[field] is None, field

    # Y sigue vacío al releer: lo que se ve en pantalla es lo que quedó guardado.
    assert _line_by_id(_budget(client, test_property["id"]), line_id)["supplierId"] is None
    with get_db() as conn:
        conn.execute("DELETE FROM proveedores WHERE id = %s", (supplier_id,))


def test_a_zero_commitment_is_not_the_same_as_no_commitment(client, test_property):
    """La razón por la que el vaciado no se puede resolver con un centinela:
    firmar en cero es un hecho, y confundirlo con «no se ha firmado» borraría la
    distinción que esta capa cuida en todas partes."""
    created = _add(client, test_property["id"], name="Cocina", quantity=1, unitPrice=500_000)
    line_id = created["line"]["id"]
    r = client.patch(f"/api/properties/{test_property['id']}/budget/lines/{line_id}",
                     json={"committedAmount": 0})
    assert _dec(r.json()["property"]["constructionCommitted"]) == Decimal("0")
    assert _dec(r.json()["property"]["constructionCommittedVariance"]) == Decimal("-2340000")

    r = client.patch(f"/api/properties/{test_property['id']}/budget/lines/{line_id}",
                     json={"committedAmount": None})
    assert r.json()["property"]["constructionCommitted"] is None
    assert r.json()["property"]["constructionCommittedVariance"] is None


def test_what_is_not_sent_is_not_touched(client, test_property):
    """`exclude_unset`, no `exclude_none`: un PATCH describe solo lo que cambió,
    así que las celdas ausentes del cuerpo se quedan como estaban."""
    created = _add(client, test_property["id"], name="Cocina", quantity=1,
                   unitPrice=500_000, committedAmount=480_000)
    line_id = created["line"]["id"]
    r = client.patch(f"/api/properties/{test_property['id']}/budget/lines/{line_id}",
                     json={"unitPrice": 600_000})
    line = _line_by_id(r.json()["budget"], line_id)
    assert _dec(line["committedAmount"]) == Decimal("480000")
    assert _dec(line["budgetedAmount"]) == Decimal("600000")


def test_a_not_nullable_cell_is_refused_with_its_reason(client, test_property):
    """En estos un vacío no es un vaciado: es un renglón roto. La columna es NOT
    NULL, así que sin el rechazo el 422 legible llegaría como un 500 mudo."""
    created = _add(client, test_property["id"], name="Cocina", quantity=1, unitPrice=500_000)
    line_id = created["line"]["id"]
    for field, fragmento in (("name", "necesita un nombre"),
                             ("chapterName", "vive en un capítulo"),
                             ("unit", "necesita una unidad"),
                             ("quantity", "se pone en 0"),
                             ("unitPrice", "se pone en 0")):
        r = client.patch(f"/api/properties/{test_property['id']}/budget/lines/{line_id}",
                         json={field: None})
        assert r.status_code == 422, f"{field}: {r.text}"
        assert fragmento in r.json()["error"]["message"], field


def test_an_emptied_text_cell_is_refused_the_same_as_a_null(client, test_property):
    """`""` no es `None`, y los tres de texto llevan CHECK (<> '') además de NOT
    NULL: hay DOS formas de vaciarlos y las dos tienen que rebotar aquí. La
    cadena vacía es la que se cuela sin querer —seleccionar el nombre, borrarlo
    y hacer clic en otro lado— y llegaba hasta el CHECK, donde el 422 legible se
    volvía el 500 mudo que esta guarda existe para evitar."""
    created = _add(client, test_property["id"], name="Cocina", quantity=1, unitPrice=500_000)
    line_id = created["line"]["id"]
    for field, fragmento in (("name", "necesita un nombre"),
                             ("chapterName", "vive en un capítulo"),
                             ("unit", "necesita una unidad")):
        for vacio in ("", "   "):
            r = client.patch(f"/api/properties/{test_property['id']}/budget/lines/{line_id}",
                             json={field: vacio})
            assert r.status_code == 422, f"{field}={vacio!r}: {r.text}"
            assert fragmento in r.json()["error"]["message"], field


def test_the_new_line_is_held_to_the_same_rule_as_the_edit(client, test_property):
    """El alta validaba dos campos y la edición ninguno, y esa asimetría ERA el
    defecto: nada obligaba a las dos a decir lo mismo, así que `unit` quedó sin
    revisar de un lado y los tres del otro. Ahora es una sola guarda."""
    for field in ("chapterName", "name", "unit"):
        r = client.post(f"/api/properties/{test_property['id']}/budget/lines", json={
            "chapterName": "Albañilería", "name": "Muros", "unit": "m2", field: ""})
        assert r.status_code == 422, f"{field}: {r.text}"


def test_notes_may_be_blank_because_blank_is_what_no_note_looks_like(client, test_property):
    """El recorte de espacios NO aplica aquí, y la diferencia es la que dice su
    propia frase: las notas se dejan en blanco, no se vacían."""
    created = _add(client, test_property["id"], name="Cocina", quantity=1,
                   unitPrice=500_000, notes="revisar medidas")
    line_id = created["line"]["id"]
    r = client.patch(f"/api/properties/{test_property['id']}/budget/lines/{line_id}",
                     json={"notes": ""})
    assert r.status_code == 200, r.text
    assert _line_by_id(r.json()["budget"], line_id)["notes"] == ""


def test_a_payment_is_deleted_not_rewritten(client, test_property):
    created = _add(client, test_property["id"], name="Cocina", quantity=1, unitPrice=500_000)
    line_id = created["line"]["id"]
    r = client.post(f"/api/properties/{test_property['id']}/budget/lines/{line_id}/payments",
                    json={"amount": 620_000})
    payment_id = r.json()["line"]["payments"][0]["id"]
    r = client.delete(
        f"/api/properties/{test_property['id']}/budget/lines/{line_id}/payments/{payment_id}")
    assert r.status_code == 200, r.text
    assert r.json()["property"]["constructionPaid"] is None


# ── El costo por m² se deriva, ya no se captura ─────────────────────────────

def test_the_cost_per_sqm_is_derived_from_the_budget(client, test_property):
    """2,340,000 entre 200 m² = 11,700/m². Es el precio unitario COMPUESTO, con
    los indirectos ya dentro, que es justo lo que un desglose por partidas no
    tiene y por eso se calcula en vez de teclearse."""
    assert _dec(test_property["constructionCostPerSqm"]) == Decimal("11700.00")
    r = client.put(f"/api/properties/{test_property['id']}/budget/total",
                   json={"amount": 4_000_000})
    assert _dec(r.json()["property"]["constructionCostPerSqm"]) == Decimal("20000.00")


def test_without_metres_there_is_no_cost_per_sqm(client, test_property):
    """Dividir entre cero no da «$0/m²»: no da nada. Antes la columna podía
    publicar 6,000/m² sobre 0 m² de obra, que es un precio de nada."""
    client.post(f"/api/properties/{test_property['id']}/clear-fields",
                json={"fields": ["sqmConstruction"]})
    assert _get(client, test_property["id"])["constructionCostPerSqm"] is None


def test_the_cost_per_sqm_cannot_be_captured_any_more(client, test_property):
    """Dejó de ser insumo: escribirlo no hace nada y vaciarlo se rechaza. Se
    cambia el costo de obra por el presupuesto, que es donde vive."""
    r = client.patch(f"/api/properties/{test_property['id']}",
                     json={"constructionCostPerSqm": 99_000})
    assert r.status_code == 200
    assert _dec(r.json()["constructionCostPerSqm"]) == Decimal("11700.00")

    r = client.post(f"/api/properties/{test_property['id']}/clear-fields",
                    json={"fields": ["constructionCostPerSqm"]})
    assert r.status_code == 422


def test_the_overhead_is_not_part_of_the_contract_any_more(client, test_property):
    """Ni como columna ni como supuesto. Una cifra que la ficha muestra y que no
    mueve un peso es el defecto «NO SE USA» otra vez."""
    p = _get(client, test_property["id"])
    assert "constructionOverhead" not in p
    assert "constructionOverhead" not in p["assumptions"]


# ── Capítulos ───────────────────────────────────────────────────────────────

def test_a_chapter_is_the_name_its_lines_carry(client, test_property):
    _add(client, test_property["id"], chapterName="Albañilería", name="Muros")
    _add(client, test_property["id"], chapterName="Instalaciones", name="Hidráulica")
    assert _budget(client, test_property["id"])["chapters"] == [
        "Albañilería", "Instalaciones", budget_db.RESIDUAL_CHAPTER]


def test_renaming_a_chapter_renames_all_of_its_lines(client, test_property):
    _add(client, test_property["id"], chapterName="Albañileria", name="Muros")
    _add(client, test_property["id"], chapterName="Albañileria", name="Aplanados")
    r = client.patch(f"/api/properties/{test_property['id']}/budget/chapters/Albañileria",
                     json={"name": "Albañilería"})
    assert r.status_code == 200, r.text
    assert r.json()["budget"]["chapters"] == ["Albañilería", budget_db.RESIDUAL_CHAPTER]


def test_deleting_a_chapter_returns_its_cost_to_others(client, test_property):
    _add(client, test_property["id"], chapterName="Albañilería", name="Muros",
         quantity=1, unitPrice=300_000)
    _add(client, test_property["id"], chapterName="Albañilería", name="Aplanados",
         quantity=1, unitPrice=200_000)
    r = client.delete(f"/api/properties/{test_property['id']}/budget/chapters/Albañilería")
    assert r.status_code == 200, r.text
    r = r.json()
    assert _dec(_residual(r["budget"])["budgetedAmount"]) == Decimal("2340000")
    assert _dec(r["property"]["constructionBudgeted"]) == Decimal("2340000")


def test_the_residual_chapter_is_not_deleted(client, test_property):
    r = client.delete(
        f"/api/properties/{test_property['id']}/budget/chapters/{budget_db.RESIDUAL_CHAPTER}")
    assert r.status_code == 422


# ── Invariantes que sostienen la resta ──────────────────────────────────────

def test_every_property_has_exactly_one_residual(client, test_property):
    """La resta necesita saber de dónde restar. Cero residuos y el total crecería
    con cada partida; dos, y habría dos restas compitiendo por el remanente."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT b.property_id, count(*) FILTER (WHERE l.is_residual) AS residuos"
            "  FROM budgets b JOIN budget_lines l ON l.budget_id = b.id"
            " WHERE b.property_id IS NOT NULL GROUP BY b.property_id"
        ).fetchall()
    assert rows, "no hay presupuestos que revisar"
    assert all(row["residuos"] == 1 for row in rows), [dict(r) for r in rows]


def test_a_second_residual_is_refused_by_the_database(client, test_property):
    from psycopg2 import IntegrityError
    with get_db() as conn:
        budget_id = conn.execute(
            "SELECT id FROM budgets WHERE property_id = %s", (test_property["id"],)
        ).fetchone()["id"]
        with pytest.raises(IntegrityError):
            conn.execute(
                "INSERT INTO budget_lines (budget_id, chapter_name, name, unit,"
                " quantity, unit_price, is_residual) VALUES (%s, 'Otros', 'Otro residuo',"
                " 'lote', 1, 1, TRUE)", (budget_id,))


def test_a_property_without_a_budget_still_answers_and_gets_one(client):
    """La invariante se sostiene sola frente a filas que entraron por fuera del
    API. Sin eso volvería la rama «si existe presupuesto», que es exactamente la
    disyunción que este diseño existe para no tener."""
    r = client.post("/api/properties", json={
        "name": "[TEST] Sin Presupuesto", "address": "Calle Seis 6", "city": "Monterrey",
        "purchasePrice": 1_000_000})
    prop = r.json()
    try:
        with get_db() as conn:
            conn.execute("DELETE FROM budgets WHERE property_id = %s", (prop["id"],))
        assert _dec(_get(client, prop["id"])["constructionBudgeted"]) == Decimal("0")
        assert len(_budget(client, prop["id"])["lines"]) == 1
    finally:
        client.delete(f"/api/properties/{prop['id']}")


def test_the_budget_of_a_missing_property_is_404(client):
    assert client.get("/api/properties/999999999/budget").status_code == 404
