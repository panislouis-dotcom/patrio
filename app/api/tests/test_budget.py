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

from .conftest import _delete_property


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
    que la migración 032 aplicó al sembrar. Que la calculadora y la siembra
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
    # 620,000 firmados contra los 500,000 planeados DE ESE RENGLÓN. No contra los
    # 2,340,000 del presupuesto entero: eso diría cuánto falta por comprometer.
    assert _dec(r["property"]["constructionCommittedVariance"]) == Decimal("120000")
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


def test_the_committed_variance_only_measures_what_has_been_signed(client, test_property):
    """La cifra que Ed mira todos los días durante una obra, y la que estaba
    contestando otra pregunta.

    «Comprometido vs presupuesto» promete «en qué difiere lo que firmé de lo que
    planeé». Restando el presupuesto ENTERO decía «cuánto falta por comprometer»:
    se encendía en cuanto cualquier renglón tuviera compromiso, arrancaba en casi
    todo el presupuesto por definición y solo se movía hacia cero conforme se
    firmaba lo demás. Con una sola partida firmada en cero llegó a publicar
    −$4,095,000 de una obra que nadie había contratado.

    Los cuatro estados, y en ninguno se mueve porque falte firmar cosas."""
    cocina = _add(client, test_property["id"], name="Cocina",
                  quantity=1, unitPrice=500_000)["line"]["id"]
    fachada = _add(client, test_property["id"], name="Fachada",
                   quantity=1, unitPrice=300_000)["line"]["id"]

    # (1) Nada firmado: la variación no existe. Un 0 diría «va justo al plan».
    assert _get(client, test_property["id"])["constructionCommittedVariance"] is None

    # (2) Uno por DEBAJO de su plan: 450,000 contra 500,000.
    r = client.patch(f"/api/properties/{test_property['id']}/budget/lines/{cocina}",
                     json={"committedAmount": 450_000})
    assert _dec(r.json()["property"]["constructionCommittedVariance"]) == Decimal("-50000")

    # (3) Uno por ENCIMA: 380,000 contra 300,000. La brecha es la suma de las dos
    # y no la de un presupuesto que todavía tiene 1,540,000 sin contratar.
    r = client.patch(f"/api/properties/{test_property['id']}/budget/lines/{fachada}",
                     json={"committedAmount": 380_000})
    assert _dec(r.json()["property"]["constructionCommittedVariance"]) == Decimal("30000")

    # (4) Todo firmado. Se ajusta el total a lo detallado para que no quede
    # residuo —el remanente no se contrata, se detalla— y ahí las dos lecturas
    # coinciden: cuando no falta nada por firmar, comparar contra lo firmado y
    # comparar contra el presupuesto entero son la misma resta.
    r = client.put(f"/api/properties/{test_property['id']}/budget/total",
                   json={"amount": 800_000})
    assert r.status_code == 200, r.text
    p = r.json()["property"]
    assert _dec(p["constructionBudgeted"]) == Decimal("800000")
    assert _dec(p["constructionCommittedVariance"]) == Decimal("30000")
    assert (_dec(p["constructionCommittedVariance"])
            == _dec(p["constructionCommitted"]) - _dec(p["constructionBudgeted"]))


def test_the_total_variance_is_the_sum_of_the_lines_that_have_one(client, test_property):
    """La propiedad que vuelve cuadrable la pantalla: cada renglón ya publicaba su
    variación contra su propio importe, y el total tiene que ser esa suma. Cuando
    el total se restaba contra el presupuesto entero, la columna sumaba una cosa y
    el renglón de totales decía otra — sin que ninguno de los dos estuviera mal
    por separado, que es la peor forma de estar mal."""
    for name, price, committed in (("Cocina", 500_000, 450_000),
                                   ("Fachada", 300_000, 380_000),
                                   ("Jardín", 200_000, None)):
        line_id = _add(client, test_property["id"], name=name,
                       quantity=1, unitPrice=price)["line"]["id"]
        if committed is not None:
            client.patch(f"/api/properties/{test_property['id']}/budget/lines/{line_id}",
                         json={"committedAmount": committed})

    budget = _budget(client, test_property["id"])
    suma = sum(_dec(line["committedVariance"]) for line in budget["lines"]
               if line["committedVariance"] is not None)

    assert suma == Decimal("30000")
    assert _dec(_get(client, test_property["id"])["constructionCommittedVariance"]) == suma


def test_the_paid_variance_compares_only_the_lines_that_have_been_paid(client, test_property):
    """El mismo defecto y la misma corrección, pero aquí era peor: una obra a
    medio pagar publicaba una brecha del tamaño de lo que le falta, que solo
    significa «todavía no termina».

    Queda una ambigüedad más chica que esta cifra no puede resolver sola: contra
    su renglón, un anticipo se ve igual que un pago final barato. Eso lo distingue
    `closed_at` —la misma pieza de la que depende la historia de precios— y
    mientras no exista forma de cerrar un renglón, esta variación se lee «de lo
    pagado hasta hoy», no «de lo que costó»."""
    cocina = _add(client, test_property["id"], name="Cocina",
                  quantity=1, unitPrice=500_000)["line"]["id"]
    _add(client, test_property["id"], name="Fachada", quantity=1, unitPrice=300_000)

    r = client.post(f"/api/properties/{test_property['id']}/budget/lines/{cocina}/payments",
                    json={"amount": 300_000})
    assert r.status_code == 201, r.text
    p = r.json()["property"]

    # 300,000 pagados contra los 500,000 planeados de ESE renglón. Contra el
    # presupuesto entero serían −2,040,000, casi todo «lo que aún no se paga».
    assert _dec(p["constructionPaidVariance"]) == Decimal("-200000")
    assert _dec(p["constructionPaid"]) == Decimal("300000")

    # Y el que ya se pasó del plan lo dice en positivo, sin que el resto del
    # presupuesto sin pagar lo esconda.
    r = client.post(f"/api/properties/{test_property['id']}/budget/lines/{cocina}/payments",
                    json={"amount": 260_000})
    assert _dec(r.json()["property"]["constructionPaidVariance"]) == Decimal("60000")


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
    # Firmar en cero un renglón de 500,000 es ir 500,000 abajo del plan EN ESE
    # RENGLÓN. Comparado contra el presupuesto entero eran −2,340,000, que es la
    # cifra que la verificación en vivo destapó: aritmética correcta, pregunta
    # equivocada.
    assert _dec(r.json()["property"]["constructionCommittedVariance"]) == Decimal("-500000")

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


def test_the_cost_per_sqm_cannot_be_captured_as_a_column_but_still_recomputes_the_budget(
        client, test_property):
    """No volvió a ser una columna —vaciarlo se sigue rechazando, como
    cualquier campo que un PATCH no reconoce— pero escribirlo YA NO es un
    no-op: mientras el presupuesto siga intacto, mover $/m² vuelve a correr la
    misma calculadora que sembró el presupuesto al nacer, salvo que aquí NO
    aplica overhead: es una edición directa, no un alta, y quien teclea $/m²
    aquí ya está viendo un presupuesto real, no proponiendo un estimado
    grueso. 200 m² × 99,000 = 19,800,000, sin multiplicador."""
    r = client.patch(f"/api/properties/{test_property['id']}",
                     json={"constructionCostPerSqm": 99_000})
    assert r.status_code == 200, r.text
    assert _dec(r.json()["constructionBudgeted"]) == Decimal("19800000")
    assert _dec(r.json()["constructionCostPerSqm"]) == Decimal("99000.00")

    r = client.post(f"/api/properties/{test_property['id']}/clear-fields",
                    json={"fields": ["constructionCostPerSqm"]})
    assert r.status_code == 422


def test_the_cost_per_sqm_alone_recomputes_against_the_metres_already_on_file(
        client, test_property):
    """No hace falta reenviar el m² si ya está guardado: 200 (de la ficha) ×
    15,000 = 3,000,000, sin overhead."""
    r = client.patch(f"/api/properties/{test_property['id']}",
                     json={"constructionCostPerSqm": 15_000})
    assert r.status_code == 200, r.text
    assert _dec(r.json()["constructionBudgeted"]) == Decimal("3000000")


def test_the_metres_and_the_cost_per_sqm_can_arrive_in_the_same_patch(client, test_property):
    """Los dos datos pueden llegar juntos, como en el alta: 300 × 10,000 =
    3,000,000, y el m² nuevo también se guarda."""
    r = client.patch(f"/api/properties/{test_property['id']}",
                     json={"sqmConstruction": 300, "constructionCostPerSqm": 10_000})
    assert r.status_code == 200, r.text
    assert r.json()["sqmConstruction"] == 300
    assert _dec(r.json()["constructionBudgeted"]) == Decimal("3000000")


def test_the_metres_alone_recompute_the_budget_against_the_rate_already_in_force(
        client, test_property):
    """No hace falta reteclear $/m² para que el m² lo mueva: 200 m² ya
    presupuestados en 2,340,000 dan una tasa de 11,700/m², y mandar solo
    sqmConstruction=300 la vuelve a aplicar — 300 × 11,700 = 3,510,000. Es la
    misma calculadora, del otro lado: antes «los 2 datos» exigía traer ambos
    en el mismo PATCH; ahora basta con que uno de los dos ya esté vigente."""
    r = client.patch(f"/api/properties/{test_property['id']}",
                     json={"sqmConstruction": 300})
    assert r.status_code == 200, r.text
    assert r.json()["sqmConstruction"] == 300
    assert _dec(r.json()["constructionBudgeted"]) == Decimal("3510000")


def test_the_metres_alone_do_nothing_when_there_is_no_rate_yet(client, test_property):
    """Sin presupuesto todavía (recién sembrado en 0), cambiar el m² no
    inventa una tasa de la nada: 0 ÷ cualquier metraje sigue siendo 0."""
    client.put(f"/api/properties/{test_property['id']}/budget/total", json={"amount": 0})
    r = client.patch(f"/api/properties/{test_property['id']}",
                     json={"sqmConstruction": 300})
    assert r.status_code == 200, r.text
    assert _dec(r.json()["constructionBudgeted"]) == Decimal("0")


def test_the_cost_per_sqm_alone_computes_nothing_without_metres(client, test_property):
    """«Se calcula solo cuando están los 2 datos»: sin m² capturado, mandar
    $/m² no mueve el presupuesto — no hay «$0/m²» ni obra fantasma."""
    client.post(f"/api/properties/{test_property['id']}/clear-fields",
                json={"fields": ["sqmConstruction"]})
    before = _dec(_get(client, test_property["id"])["constructionBudgeted"])
    r = client.patch(f"/api/properties/{test_property['id']}",
                     json={"constructionCostPerSqm": 99_000})
    assert r.status_code == 200, r.text
    assert _dec(r.json()["constructionBudgeted"]) == before


def test_the_cost_per_sqm_refuses_to_shrink_a_budget_that_already_has_detail(
        client, test_property):
    """La misma regla de FIJAR TOTAL: no se vale que $/m² borre en silencio lo
    que ya se detalló. 200 × 100 = 20,000, muy por debajo de los 500,000
    ya detallados en Cocina."""
    _add(client, test_property["id"], name="Cocina", quantity=1, unitPrice=500_000)
    r = client.patch(f"/api/properties/{test_property['id']}",
                     json={"constructionCostPerSqm": 100})
    assert r.status_code == 422
    assert "detallados en partidas" in r.json()["error"]["message"]


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


# ── Copiar de otro presupuesto ──────────────────────────────────────────────
#
# Aplicar un presupuesto sobre otro es la única puerta por la que entran
# renglones que nadie tecleó en esta obra, y por eso es donde se paga la regla
# central: LO QUE ESTA OBRA YA TIENE NO SE TOCA. Un renglón repetido se salta —
# nunca se actualiza— porque el de acá puede traer proveedor, comprometido,
# pagos o cierre, y pisarle el precio reescribiría dinero ya capturado sin que
# nada se vea roto: solo números distintos que parecen plausibles, la misma
# forma de falla que el resto de este archivo vigila.

@pytest.fixture
def origen(client):
    """Una obra con tres renglones en dos capítulos, para copiar de ella.

    Se borra con `_delete_property` y no con el DELETE del API: sus partidas
    detalladas son captura, y la ruta las retiene con un 422 a propósito."""
    r = client.post("/api/properties", json={
        "name": "[TEST] Obra Origen", "address": "Calle Origen 1", "city": "Monterrey",
        "purchasePrice": 1_000_000, "sqmConstruction": 200,
        "constructionCostPerSqm": 9_000, "constructionOverhead": 1.3})
    assert r.status_code == 201, r.text
    prop = r.json()
    for chapter, name, price in (("Instalaciones", "Hidráulica", 200_000),
                                 ("Instalaciones", "Eléctrica", 300_000),
                                 ("Acabados", "Piso cerámico", 150_000)):
        _add(client, prop["id"], chapterName=chapter, name=name, quantity=1, unitPrice=price)
    yield {"propertyId": prop["id"], "budgetId": _budget(client, prop["id"])["id"]}
    _delete_property(prop["id"])


def _apply(client, property_id: int, source_budget_id: int, **body):
    return client.post(f"/api/properties/{property_id}/budget/apply",
                       json={"budgetId": source_budget_id, **body})


def _detailed(budget: dict) -> dict:
    """Los renglones detallados por nombre — el residuo no es una partida."""
    return {line["name"]: line for line in budget["lines"] if not line["isResidual"]}


def test_applying_a_whole_budget_copies_every_line_and_never_the_residual(
        client, test_property, origen):
    """El comportamiento de siempre, sin `chapters`: entran los tres renglones,
    el residuo del origen se queda en su obra y el total de ésta no se mueve —
    650,000 detallados salen de los 2,340,000 sin detallar."""
    r = _apply(client, test_property["id"], origen["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()

    assert r["linesAdded"] == 3
    assert r["linesSkipped"] == 0
    assert set(_detailed(r["budget"])) == {"Hidráulica", "Eléctrica", "Piso cerámico"}
    assert _dec(_residual(r["budget"])["budgetedAmount"]) == Decimal("1690000")
    assert _dec(r["property"]["constructionBudgeted"]) == Decimal("2340000")
    assert _dec(r["budgetIncrease"]) == Decimal("0")


def test_only_the_chapters_asked_for_are_copied(client, test_property, origen):
    """Copiar UNA sección: llega lo de «Acabados» y nada de «Instalaciones». Un
    capítulo no es una entidad —es el nombre que copian sus renglones— así que
    copiar una sección es la misma copia con un WHERE."""
    r = _apply(client, test_property["id"], origen["budgetId"], chapters=["Acabados"])
    assert r.status_code == 201, r.text
    r = r.json()

    assert r["linesAdded"] == 1
    assert r["linesSkipped"] == 0
    assert set(_detailed(r["budget"])) == {"Piso cerámico"}
    assert _dec(_residual(r["budget"])["budgetedAmount"]) == Decimal("2190000")


def test_applying_the_same_source_twice_adds_nothing_the_second_time(
        client, test_property, origen):
    """La deduplicación, dicha como la vive quien copia a diez obras y no se
    acuerda de a cuáles ya les había copiado: la segunda pasada no duplica un
    solo renglón, y lo DICE — 0 agregados, 3 saltados — en vez de contestar
    «listo» como si hubiera hecho algo."""
    primera = _apply(client, test_property["id"], origen["budgetId"]).json()
    assert primera["linesAdded"] == 3

    r = _apply(client, test_property["id"], origen["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()

    assert r["linesAdded"] == 0
    assert r["linesSkipped"] == 3
    assert len(_detailed(r["budget"])) == 3
    assert _dec(_residual(r["budget"])["budgetedAmount"]) == Decimal("1690000")
    assert _dec(r["property"]["constructionBudgeted"]) == Decimal("2340000")


def test_the_same_line_in_other_case_or_with_stray_spaces_is_still_the_same_line(
        client, test_property, origen):
    """«  instalación ELÉCTRICA » no entra si ya hay «Instalación eléctrica»: la
    comparación normaliza minúsculas y espacios de orilla, con el MISMO `_norm`
    con el que una plantilla decide si ya existe.

    Lo que NO hace es quitar acentos —fusionar «ceramico» con «cerámico» sería
    fusionar por máquina— y por eso el capítulo padeado y el limpio sí son el
    mismo, pero nada más por eso."""
    _add(client, test_property["id"], chapterName="Instalaciones",
         name="Instalación eléctrica", quantity=1, unitPrice=400_000)
    _add(client, origen["propertyId"], chapterName="  INSTALACIONES  ",
         name="  instalación ELÉCTRICA  ", quantity=1, unitPrice=900_000)

    r = _apply(client, test_property["id"], origen["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()

    assert r["linesAdded"] == 3
    assert r["linesSkipped"] == 1
    detalladas = _detailed(r["budget"])
    assert "  instalación ELÉCTRICA  " not in detalladas
    # Y el que ya estaba sigue con SU precio, no con el del origen.
    assert _dec(detalladas["Instalación eléctrica"]["budgetedAmount"]) == Decimal("400000")


def test_a_line_with_money_captured_is_skipped_and_left_untouched(
        client, test_property, origen):
    """La garantía central, con dinero encima: el renglón del destino trae
    proveedor firmado y un pago hecho, y el del origen trae otro precio. Se
    SALTA, no se actualiza.

    Actualizar habría sido igual de fácil de escribir y habría reescrito un
    contrato y un pago que ya ocurrieron, sin error y sin pista — el precio
    presupuestado quedaría en 200,000 contra un pago de 40,000 y una variación
    inventada. Lo que se copia es un plan; lo que ya tiene ejecución no es un
    plan que se pueda volver a proponer."""
    linea = _add(client, test_property["id"], chapterName="Instalaciones",
                 name="Hidráulica", quantity=1, unitPrice=100_000)["line"]["id"]
    client.patch(f"/api/properties/{test_property['id']}/budget/lines/{linea}",
                 json={"committedAmount": 90_000})
    r = client.post(f"/api/properties/{test_property['id']}/budget/lines/{linea}/payments",
                    json={"amount": 40_000, "paidOn": "2026-06-01"})
    assert r.status_code == 201, r.text

    r = _apply(client, test_property["id"], origen["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()
    assert r["linesAdded"] == 2
    assert r["linesSkipped"] == 1

    # Ni el renglón ni un peso de lo capturado se movieron: es la MISMA fila.
    hidraulica = _line_by_id(r["budget"], linea)
    assert hidraulica["name"] == "Hidráulica"
    assert _dec(hidraulica["unitPrice"]) == Decimal("100000")
    assert _dec(hidraulica["quantity"]) == Decimal("1")
    assert _dec(hidraulica["committedAmount"]) == Decimal("90000")
    assert [_dec(p["amount"]) for p in hidraulica["payments"]] == [Decimal("40000")]
    # Y no entró una segunda «Hidráulica» con el precio del origen.
    assert [line["name"] for line in r["budget"]["lines"]].count("Hidráulica") == 1
    assert _dec(r["property"]["constructionPaid"]) == Decimal("40000")


def test_copying_beyond_the_total_grows_the_budget_and_says_so(client, test_property, origen):
    """`budgetIncrease` se comporta igual que en toda escritura: copiar sale del
    residuo y no mueve el total, salvo cuando lo copiado lo rebasa — y entonces
    eso es aumentar el presupuesto, no detallarlo, y se reporta."""
    r = client.put(f"/api/properties/{test_property['id']}/budget/total",
                   json={"amount": 400_000})
    assert r.status_code == 200, r.text

    r = _apply(client, test_property["id"], origen["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()
    assert _dec(r["budgetIncrease"]) == Decimal("250000")     # 650,000 − 400,000
    assert _dec(_residual(r["budget"])["budgetedAmount"]) == Decimal("0")
    assert _dec(r["property"]["constructionBudgeted"]) == Decimal("650000")


def test_a_chapter_the_source_does_not_have_simply_contributes_nothing(
        client, test_property, origen):
    """Pedir un capítulo de más no es un error: se puede copiar «Acabados y
    Cimentación» a diez obras y que solo algunas tengan las dos. El conteo ya
    dice qué entró."""
    r = _apply(client, test_property["id"], origen["budgetId"],
               chapters=["Acabados", "Cimentación"])
    assert r.status_code == 201, r.text
    assert r.json()["linesAdded"] == 1
    assert set(_detailed(r.json()["budget"])) == {"Piso cerámico"}


def test_asking_only_for_chapters_that_do_not_exist_is_refused_with_the_ones_that_do(
        client, test_property, origen):
    """Cuando NINGUNO existe sí se rechaza, y ahí está la diferencia: el 201 que
    quedaría diría «0 agregados, 0 saltados», indistinguible de «ya lo tenías
    todo». El rechazo trae los capítulos que el origen sí tiene, que es lo que
    hace falta para corregirlo sin adivinar."""
    r = _apply(client, test_property["id"], origen["budgetId"], chapters=["Cimentación"])
    assert r.status_code == 422, r.text
    mensaje = r.json()["error"]["message"]
    assert "Cimentación" in mensaje
    assert "Acabados" in mensaje and "Instalaciones" in mensaje
    # Y no dejó nada a medias en el destino.
    assert _detailed(_budget(client, test_property["id"])) == {}


def test_an_empty_chapter_list_is_refused_instead_of_copying_nothing(
        client, test_property, origen):
    """`[]` no es `null`. Ausente significa «el presupuesto completo»; una lista
    vacía es un formulario mandado sin marcar nada, y copiar cero renglones en
    silencio sería contestar «listo» a algo que no se hizo."""
    r = _apply(client, test_property["id"], origen["budgetId"], chapters=[])
    assert r.status_code == 422, r.text
    assert "al menos uno" in r.json()["error"]["message"]


# ── Copiar proporcional ─────────────────────────────────────────────────────
#
# Copiar proporcional es copiar la FORMA del presupuesto de otra obra,
# dimensionada al costo de obra que el destino YA tiene: `T` es el total de su
# presupuesto, que nadie manda en el cuerpo porque ya está capturado. El desglose
# de la obra de al lado sirve; su tamaño no.
#
# Lo que esta suite fija es que la aritmética CIERRA —la suma final da
# exactamente T, no «T más lo que se acumuló redondeando»— y que lo que no
# escala no se movió. Las dos se rompen sin que nada se vea roto: un presupuesto
# con los permisos inflados al doble se ve igual de plausible que uno correcto.

# Los números están elegidos para que el factor dé EXACTAMENTE 2 y cada cifra se
# pueda verificar a mano:
#
#     origen:   200,000 (lote) + 150,000 (m²) + 50,000 (fija) = 400,000 detallado
#               total 2,050,000  →  residuo 1,650,000
#     destino:  200 m² × $20,250 = T = 4,050,000, sembrado por la ficha al alta
#     factor = (4,050,000 − 50,000) / (2,050,000 − 50,000) = 2
COSTO_POR_M2 = 20_250
OBJETIVO = Decimal("4050000")


@pytest.fixture
def modelo(client):
    """La obra de la que se copia la forma: una partida de suma alzada, una
    medida en m² y una fija, para que cada regla del escalado tenga su renglón."""
    r = client.post("/api/properties", json={
        "name": "[TEST] Obra Modelo", "address": "Calle Modelo 1", "city": "Monterrey",
        "purchasePrice": 1_000_000, "sqmConstruction": 100,
        "constructionCostPerSqm": 20_500, "constructionOverhead": 1})
    assert r.status_code == 201, r.text
    prop = r.json()
    _add(client, prop["id"], chapterName="Instalaciones", name="Hidráulica",
         unit="lote", quantity=1, unitPrice=200_000)
    _add(client, prop["id"], chapterName="Acabados", name="Piso cerámico",
         unit="m2", quantity=100, unitPrice=1_500)
    _add(client, prop["id"], chapterName="Trámites", name="Licencias",
         unit="lote", quantity=1, unitPrice=50_000, isProportional=False)
    yield {"propertyId": prop["id"], "budgetId": _budget(client, prop["id"])["id"]}
    _delete_property(prop["id"])


@pytest.fixture
def destino(client):
    """La obra a la que se copia: 200 m² a $20,250, o sea $4,050,000 de costo de
    obra ya capturado.

    Ese total ES el objetivo, y por eso el cuerpo de la copia no lo lleva: la
    ficha lo sembró al alta como `m² × $/m²` y desde entonces vive en el
    presupuesto, donde el servidor lo lee."""
    r = client.post("/api/properties", json={
        "name": "[TEST] Obra Destino", "address": "Calle Destino 1",
        "city": "Monterrey", "purchasePrice": 1_000_000, "sqmConstruction": 200,
        "constructionCostPerSqm": COSTO_POR_M2, "constructionOverhead": 1})
    assert r.status_code == 201, r.text
    prop = r.json()
    assert _dec(prop["constructionBudgeted"]) == OBJETIVO
    yield prop
    _delete_property(prop["id"])


@pytest.fixture
def sin_costo_de_obra(client):
    """Una obra sin costo de obra capturado — hoy 2 de las 5 reales están así, y
    por eso el rechazo tiene que ser legible, no un borde."""
    r = client.post("/api/properties", json={
        "name": "[TEST] Obra Sin Costo", "address": "Calle Sin 1",
        "city": "Monterrey", "purchasePrice": 1_000_000})
    assert r.status_code == 201, r.text
    prop = r.json()
    assert _dec(prop["constructionBudgeted"]) == Decimal("0")
    yield prop
    _delete_property(prop["id"])


def _apply_proporcional(client, property_id: int, source_budget_id: int, **body):
    return _apply(client, property_id, source_budget_id, proportional=True, **body)


def test_a_lump_sum_line_moves_its_price_and_not_its_quantity(
        client, destino, modelo):
    """En «lote» escala el PRECIO. El renglón se sigue leyendo «1 lote», solo más
    caro — escalar la cantidad daría «2 lote», que no significa nada, y dejaría
    sin sentido el precio unitario que la historia de precios publica."""
    r = _apply_proporcional(client, destino["id"], modelo["budgetId"])
    assert r.status_code == 201, r.text

    hidraulica = _detailed(r.json()["budget"])["Hidráulica"]
    assert _dec(hidraulica["unitPrice"]) == Decimal("400000")
    assert _dec(hidraulica["quantity"]) == Decimal("1")


def test_a_measured_line_moves_its_quantity_and_not_its_price(
        client, destino, modelo):
    """En m² escala la CANTIDAD: el precio por metro es un hecho de mercado que no
    cambia porque la casa sea más grande. Lo que cambia son los metros."""
    r = _apply_proporcional(client, destino["id"], modelo["budgetId"])
    assert r.status_code == 201, r.text

    piso = _detailed(r.json()["budget"])["Piso cerámico"]
    assert _dec(piso["quantity"]) == Decimal("200")
    assert _dec(piso["unitPrice"]) == Decimal("1500")
    assert _dec(piso["budgetedAmount"]) == Decimal("300000")


def test_a_line_that_does_not_grow_with_the_job_is_copied_untouched(
        client, destino, modelo):
    """La licencia cuesta lo que cuesta: la casa del doble de tamaño no paga dos
    permisos. Entra con su monto original y la marca VIAJA con la copia, así que
    el presupuesto nuevo ya sabe cuál no escala sin que nadie se lo vuelva a
    decir."""
    r = _apply_proporcional(client, destino["id"], modelo["budgetId"])
    assert r.status_code == 201, r.text

    licencias = _detailed(r.json()["budget"])["Licencias"]
    assert _dec(licencias["unitPrice"]) == Decimal("50000")
    assert _dec(licencias["quantity"]) == Decimal("1")
    assert licencias["isProportional"] is False
    assert _detailed(r.json()["budget"])["Hidráulica"]["isProportional"] is True


def test_the_copied_budget_adds_up_to_the_target_cost_exactly(
        client, destino, modelo):
    """LA PRUEBA DE QUE LA ARITMÉTICA CIERRA. El destino ya traía $4,050,000 de
    costo de obra, y el presupuesto sigue dando esa cifra al peso: fijas +
    escalado + residuo, sin un centavo de sobra ni de menos.

        50,000 + 400,000 + 300,000 + 3,300,000 = 4,050,000

    No es una coincidencia de estos números: el residuo se calcula al final como
    `objetivo − detallado`, así que absorbe hasta el último peso que el redondeo
    haya movido."""
    r = _apply_proporcional(client, destino["id"], modelo["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()

    assert r["linesAdded"] == 3
    assert _dec(r["property"]["constructionBudgeted"]) == OBJETIVO
    detalladas = sum(_dec(l["budgetedAmount"]) for l in _detailed(r["budget"]).values())
    assert detalladas == Decimal("750000")
    assert detalladas + _dec(_residual(r["budget"])["budgetedAmount"]) == OBJETIVO
    # Copiar reparte el costo de obra, no lo aumenta: el total quedó donde estaba.
    assert _dec(r["budgetIncrease"]) == Decimal("0")


def test_the_target_is_read_from_the_destination_and_never_received(
        client, destino, modelo):
    """EL OBJETIVO ES EL TOTAL DE ESTE PRESUPUESTO, LEÍDO AL MOMENTO DE COPIAR.
    Bajar el costo de obra a $2,050,000 —el mismo que el origen— deja el factor
    en 1, y los renglones entran con los importes de la otra obra sin que la
    petición cambie un carácter.

        factor = (2,050,000 − 50,000) / (2,050,000 − 50,000) = 1

    Es la prueba de que no quedó ningún costo objetivo viajando en el cuerpo: si
    lo hubiera, este mismo llamado seguiría dimensionando contra los $4,050,000
    viejos."""
    r = client.put(f"/api/properties/{destino['id']}/budget/total",
                   json={"amount": 2_050_000})
    assert r.status_code == 200, r.text

    r = _apply_proporcional(client, destino["id"], modelo["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()

    detalladas = _detailed(r["budget"])
    assert _dec(detalladas["Hidráulica"]["unitPrice"]) == Decimal("200000")
    assert _dec(detalladas["Piso cerámico"]["quantity"]) == Decimal("100")
    assert _dec(detalladas["Licencias"]["unitPrice"]) == Decimal("50000")
    assert _dec(_residual(r["budget"])["budgetedAmount"]) == Decimal("1650000")
    assert _dec(r["property"]["constructionBudgeted"]) == Decimal("2050000")


def test_the_destination_inherits_how_much_is_left_to_detail(
        client, destino, modelo):
    """El residuo del origen entra al denominador del factor, y por eso el destino
    hereda TAMBIÉN cuánto le falta por detallar: el modelo está detallado al 19.5%
    y el destino queda igual, con su residuo escalado por el mismo 2.

    Un origen 100% detallado dejaría el residuo del destino en cero por la misma
    aritmética, sin un caso especial."""
    r = _apply_proporcional(client, destino["id"], modelo["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()

    assert _dec(_residual(r["budget"])["budgetedAmount"]) == Decimal("3300000")
    origen = _budget(client, modelo["propertyId"])
    assert _dec(_residual(origen)["budgetedAmount"]) == Decimal("1650000")


def test_the_proportional_copy_still_skips_what_the_destination_already_has(
        client, destino, modelo):
    """La dedup no cambia con el modo: un renglón que ya está aquí se SALTA —no se
    escala, no se actualiza—. Es la misma garantía de siempre, y el factor no la
    toca: el de acá puede traer proveedor, comprometido o pagos, y escalarle el
    precio sería reescribir dinero ya capturado."""
    linea = _add(client, destino["id"], chapterName="Instalaciones",
                 name="Hidráulica", unit="lote", quantity=1,
                 unitPrice=100_000)["line"]["id"]

    r = _apply_proporcional(client, destino["id"], modelo["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()

    assert (r["linesAdded"], r["linesSkipped"]) == (2, 1)
    hidraulica = _line_by_id(r["budget"], linea)
    assert _dec(hidraulica["unitPrice"]) == Decimal("100000")   # ni escalado ni pisado
    # Y el total sigue dando el objetivo: el residuo cuadra lo que el saltado dejó.
    assert _dec(r["property"]["constructionBudgeted"]) == OBJETIVO


def test_the_direct_copy_does_not_scale_a_single_peso(client, test_property, modelo):
    """Sin pedir la copia proporcional no se mueve nada: los importes llegan tal
    cual y el total del destino sigue donde estaba, que es lo que copiar hizo
    siempre."""
    r = _apply(client, test_property["id"], modelo["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()

    detalladas = _detailed(r["budget"])
    assert _dec(detalladas["Hidráulica"]["unitPrice"]) == Decimal("200000")
    assert _dec(detalladas["Piso cerámico"]["quantity"]) == Decimal("100")
    assert _dec(detalladas["Licencias"]["unitPrice"]) == Decimal("50000")
    assert detalladas["Licencias"]["isProportional"] is False
    # El total no se movió: 400,000 detallados salieron del residuo de 2,340,000.
    assert _dec(r["property"]["constructionBudgeted"]) == Decimal("2340000")


def test_a_destination_without_a_cost_of_works_is_refused_and_sent_to_its_ficha(
        client, modelo, sin_costo_de_obra):
    """Sin costo de obra no hay a qué escalar: el factor daría 0 y la copia
    entera aterrizaría en importes en cero, que se ven capturados y no lo están.

    Hoy 2 de las 5 obras reales están así, o sea que faltar no es un borde, y el
    rechazo tiene que mandar al lugar donde SÍ se arregla: la ficha de la obra,
    con sus m² y su $/m². Aquí no se captura — este popup ya no tiene dónde."""
    r = _apply_proporcional(client, sin_costo_de_obra["id"], modelo["budgetId"])
    assert r.status_code == 422, r.text
    mensaje = r.json()["error"]["message"]
    assert sin_costo_de_obra["name"] in mensaje
    assert "costo de obra" in mensaje and "ficha" in mensaje
    # Y no dejó nada a medias en el destino.
    assert _detailed(_budget(client, sin_costo_de_obra["id"])) == {}


def test_a_target_that_does_not_fit_the_fixed_lines_is_refused_with_both_amounts(
        client, destino, modelo):
    """La guarda que impide un factor negativo, dicha con los dos números: con el
    costo de obra del destino en $40,000, las licencias solas cuestan $50,000 y
    ya no caben. Un factor negativo habría producido precios en negativo, que la
    base rechaza con un CHECK y un 500 mudo — o peor, habría cabido."""
    r = client.put(f"/api/properties/{destino['id']}/budget/total",
                   json={"amount": 40_000})
    assert r.status_code == 200, r.text

    r = _apply_proporcional(client, destino["id"], modelo["budgetId"])
    assert r.status_code == 422, r.text
    mensaje = r.json()["error"]["message"]
    assert "$50,000" in mensaje and "$40,000" in mensaje
    assert _detailed(_budget(client, destino["id"])) == {}


def test_the_mark_is_captured_on_the_line_and_not_on_the_copy(client, test_property):
    """«Los permisos no crecen con la obra» es verdad de la PARTIDA, no de una
    copia: se captura una vez, en su renglón, con el mismo autoguardado de celda
    que el resto de la tabla."""
    linea = _add(client, test_property["id"], name="Licencias")["line"]
    assert linea["isProportional"] is True

    r = client.patch(f"/api/properties/{test_property['id']}/budget/lines/{linea['id']}",
                     json={"isProportional": False})
    assert r.status_code == 200, r.text
    assert _line_by_id(r.json()["budget"], linea["id"])["isProportional"] is False

    r = client.patch(f"/api/properties/{test_property['id']}/budget/lines/{linea['id']}",
                     json={"isProportional": None})
    assert r.status_code == 422, r.text
    assert "no se vacía" in r.json()["error"]["message"]


# ── De dónde puedo copiar ───────────────────────────────────────────────────
#
# `apply` siempre aceptó el id de cualquier presupuesto, pero sin esta lista
# «arrancar desde otra obra» era una capacidad que nadie podía encontrar. Desde
# que murieron las plantillas es la lista COMPLETA de puntos de partida que no
# son captura manual, así que lo que deja fuera es tan importante como lo que
# trae.

def _sources(client, **params) -> list[dict]:
    r = client.get("/api/budget/sources", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_the_sources_list_is_jobs_and_only_jobs(client, test_property, origen):
    """Cada fuente es una obra: trae el nombre de SU propiedad —el presupuesto no
    tiene uno propio que pueda contradecirlo— y un `propertyId` que siempre es un
    número. El `null` que alguna vez significó «es una plantilla» ya no existe, y
    el cliente puede dejar de ramificar por él."""
    fuentes = _sources(client)
    assert fuentes, "el origen tiene tres renglones detallados: algo tiene que salir"
    assert all(f["propertyId"] is not None for f in fuentes)

    fuente = next(f for f in fuentes if f["id"] == origen["budgetId"])
    assert fuente["propertyId"] == origen["propertyId"]
    assert fuente["name"] == _get(client, origen["propertyId"])["name"]
    assert (fuente["lineCount"], _dec(fuente["total"])) == (3, Decimal("650000"))
    # `lineCount` es un NÚMERO aquí y `lines` es el arreglo en el detalle: un
    # mismo nombre con dos tipos se paga en el cliente.
    assert "lines" not in fuente


def test_a_source_counts_only_what_it_would_actually_copy(client, test_property, origen):
    """El residuo no se copia, así que contarlo prometería un renglón que nunca
    llega — y una obra apenas capturada es SOLO su residuo. Sin el filtro el
    selector serían dieciocho renglones en cero con las obras útiles perdidas
    entre ellos."""
    propio = _budget(client, test_property["id"])
    assert len(propio["lines"]) == 1 and propio["lines"][0]["isResidual"]
    assert all(f["id"] != propio["id"] for f in _sources(client)), \
        "una obra sin detallar no es una respuesta a «de dónde copio»"

    # El origen tiene CUATRO renglones —los tres detallados y su residuo— y solo
    # los tres viajan.
    assert len(_budget(client, origen["propertyId"])["lines"]) == 4
    assert next(f for f in _sources(client)
                if f["id"] == origen["budgetId"])["lineCount"] == 3


def test_a_budget_is_not_offered_as_a_source_to_itself(client, test_property, origen):
    """`apply` ya lo rechaza con un 422; ofrecerlo en el selector sería hacer que
    el usuario descubra la regla chocando con ella. La exclusión es por id de
    PRESUPUESTO (no de propiedad) desde el addendum 2026-08-24: así los
    escenarios de la misma obra sí se ofrecen."""
    assert any(f["id"] == origen["budgetId"] for f in _sources(client))
    assert all(f["id"] != origen["budgetId"]
               for f in _sources(client, excludeBudgetId=origen["budgetId"]))


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
