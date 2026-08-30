"""El presupuesto de obra: el total es la suma de sus renglones, y nada más.

Tres reglas y las tres tienen la misma forma de falla — se rompen sin que nada
se vea roto, solo con números más grandes o más chicos que parecen plausibles:

  · La suma del presupuesto ES el costo de obra, en TODA etapa y sin ramas.
  · El overhead se aplicó una vez, al dar de alta, y vive dentro del importe.
    Aplicarlo de nuevo inflaría 30% cada costo de obra.
  · NINGÚN CAMPO DE LA FICHA MUEVE EL PRESUPUESTO. Ni los m², ni el $/m², ni los
    dos juntos. Se mueve moviendo renglones, y de ninguna otra forma.

La tercera es la que este archivo vigila con más tests, porque es la que ya se
rompió dos veces: la 033 desató la liga viva y `67e05bf` la volvió a atar, y en
el intermedio corregir un metraje de 200 a 220 m² repreciaba un 10% los trece
capítulos que alguien había cotizado con proveedor.
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


# El renglón con el que nace toda propiedad capturada con la calculadora: el
# estimado paramétrico del fixture, 200 m² × $9,000 × 1.3. Es un renglón NORMAL
# —se edita, se renombra y se borra— y aquí se localiza por su nombre, que es la
# única marca que lleva, porque es la única que necesita: decir de dónde salió.
ESTIMADO = "Estimado inicial · 200 m² × $9,000/m² × 1.3"
ESTIMADO_MXN = Decimal("2340000")


def _estimate(budget: dict) -> dict:
    return next(line for line in budget["lines"] if line["name"] == ESTIMADO)


def _estimate_of(budget: dict, sqm, cost_per_sqm) -> dict:
    """El renglón de estimado que la calculadora habría escrito con esos dos
    insumos. Se localiza por nombre porque el nombre ES la cuenta."""
    nombre = budget_db.estimate_line_name(sqm, cost_per_sqm, 1)
    return next(line for line in budget["lines"] if line["name"] == nombre)


def _de(name: str, property_name: str, escalado: bool = False) -> str:
    """El nombre con el que un estimado llega a OTRA obra: el suyo, más de quién
    es, y —si la proporcional le movió el importe— que su cuenta ya no da su
    cifra. Ver `budget_db._copied_name`."""
    nota = budget_db.SCALED_NOTE if escalado else ""
    return f"{name} (de «{property_name}»{nota})"


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
    """Un renglón normal YA es el presupuesto, desde `prospecto`. Que nazca con
    la propiedad es lo que hace que nunca haya un momento en que el costo de
    obra cambie de fuente: no hay traspaso que diseñar.

    EL NOMBRE LLEVA LA CUENTA QUE LO PRODUJO, y es la única memoria que queda de
    ella: los tres insumos corrieron una vez y se olvidaron. Sin eso, dentro de
    un mes nadie podría contestar si $2,340,000 fue una cotización o una regla
    de tres."""
    budget = _budget(client, test_property["id"])
    assert len(budget["lines"]) == 1
    estimado = budget["lines"][0]
    assert estimado["name"] == ESTIMADO == budget_db.estimate_line_name(200, 9_000, 1.3)
    assert estimado["chapterName"] == budget_db.ESTIMATE_CHAPTER
    # 200 m² × 9,000 × 1.3 del fixture, con el overhead ya adentro.
    assert _dec(estimado["budgetedAmount"]) == ESTIMADO_MXN
    assert _dec(test_property["constructionBudgeted"]) == ESTIMADO_MXN


def test_a_property_captured_without_the_calculator_is_born_with_an_empty_budget(client):
    """Un presupuesto vacío es LEGAL, y es la primera vez que lo es. Sin metraje
    ni $/m² no hay nada que estimar, y un renglón de $0 llamado «Estimado
    inicial · 0 m² × $0/m²» no diría nada que el presupuesto vacío no diga ya —
    solo habría que borrarlo a mano en cada alta.

    `constructionBudgeted = 0` es un número, no un faltante: la inversión total
    lo suma y la comisión de obra lo multiplica, las dos sin una rama nueva."""
    r = client.post("/api/properties", json={
        "name": "[TEST] Sin Calculadora", "address": "Calle Vacía 1",
        "city": "Monterrey", "purchasePrice": 1_000_000})
    assert r.status_code == 201, r.text
    prop = r.json()
    try:
        assert _budget(client, prop["id"])["lines"] == []
        assert _dec(prop["constructionBudgeted"]) == Decimal("0")
        # 1,000,000 × 1.065 + 0 de obra: la base se calcula, no se rompe.
        assert _dec(prop["totalInvestment"]) == Decimal("1065000")
        assert prop["constructionFee"] is not None
    finally:
        client.delete(f"/api/properties/{prop['id']}")


def test_a_property_is_not_born_with_its_work_shrunk_in_silence(client):
    """El caso donde la regla se paga: la calculadora corre UNA vez, al dar de
    alta, y su resultado se queda dentro de un renglón para siempre. Un 0.5
    aceptado ahí no produce un número raro que alguien note — produce una obra a
    mitad de precio que se ve perfectamente plausible, y que ya no se corrige
    arreglando el campo, porque el campo dejó de multiplicar nada.

    La propiedad tampoco nace a medias: el rechazo sube desde dentro de la
    transacción que insertó la fila, y `get_db()` la revierte entera."""
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
    r = _add(client, test_property["id"], name="Estructura", quantity=1, unitPrice=660_000)
    assert _dec(r["property"]["constructionBudgeted"]) == ESTIMADO_MXN + Decimal("660000")
    assert _dec(r["property"]["totalInvestment"]) == before + Decimal("660000")


# ── El total es la suma de sus renglones ────────────────────────────────────
#
# La entrega entera, dicha en cuatro tests. Antes «Otros, por detallar» absorbía
# cada partida que se capturaba, así que detallar no movía el total y la
# varianza contra el estimado se borraba en silencio: una cotización que llegaba
# $45,000 arriba se la comía el remanente. Ahora el total se mueve, y ese
# movimiento ES el hallazgo.

def test_adding_a_line_raises_the_total_by_exactly_its_amount(client, test_property):
    """500,000 de cocina suben el presupuesto 500,000 y la inversión 500,000.
    Ni un peso más —no hay overhead que se vuelva a aplicar— ni uno menos —no hay
    renglón que los absorba—."""
    total_antes = _dec(test_property["totalInvestment"])
    r = _add(client, test_property["id"], name="Cocina", quantity=1, unitPrice=500_000)

    assert _dec(r["property"]["constructionBudgeted"]) == ESTIMADO_MXN + Decimal("500000")
    assert _dec(r["property"]["totalInvestment"]) == total_antes + Decimal("500000")
    # El estimado se quedó exactamente donde estaba: nadie lo recalculó.
    assert _dec(_estimate(r["budget"])["budgetedAmount"]) == ESTIMADO_MXN


def test_deleting_a_line_lowers_the_total_by_exactly_its_amount(client, test_property):
    """Y al revés, con la misma exactitud."""
    created = _add(client, test_property["id"], name="Cocina", quantity=1, unitPrice=500_000)
    line_id = created["line"]["id"]
    r = client.delete(f"/api/properties/{test_property['id']}/budget/lines/{line_id}")
    assert r.status_code == 200, r.text
    r = r.json()
    assert _dec(r["property"]["constructionBudgeted"]) == ESTIMADO_MXN
    assert _dec(_estimate(r["budget"])["budgetedAmount"]) == ESTIMADO_MXN


def test_raising_a_line_raises_the_total_by_the_difference(client, test_property):
    """Subir una partida de 500,000 a 900,000 sube el total 400,000. Antes bajaba
    el residuo esos 400,000 y el total no se enteraba — que es exactamente la
    señal que se perdía: que el supuesto de $/m² iba corto."""
    created = _add(client, test_property["id"], name="Cocina", quantity=1, unitPrice=500_000)
    r = client.patch(
        f"/api/properties/{test_property['id']}/budget/lines/{created['line']['id']}",
        json={"unitPrice": 900_000})
    assert r.status_code == 200, r.text
    assert _dec(r.json()["property"]["constructionBudgeted"]) == (
        ESTIMADO_MXN + Decimal("900000"))


def test_the_total_does_not_shave_fractions_off_the_lines(client, test_property):
    """`cantidad × precio` puede traer cinco decimales —la cantidad lleva tres y
    el precio dos— y el total se publica en pesos y centavos. 50 partidas de
    150.015 exactos suman 7,500.75 y ni un centavo se queda tirado en el camino.

    Antes esta prueba vigilaba la resta del residuo, donde el redondeo doble
    movía el total un cuarto de peso sin que nadie lo hubiera pedido. Ya no hay
    resta; queda la suma, y tiene que cerrar igual."""
    for i in range(50):
        _add(client, test_property["id"], name=f"Partida {i}",
             quantity=1.5, unitPrice=100.01)          # 150.015 exactos
    with get_db() as conn:
        total = conn.execute(
            "SELECT sum(l.quantity * l.unit_price) AS t FROM budget_lines l"
            "  JOIN budgets b ON b.id = l.budget_id WHERE b.property_id = %s",
            (test_property["id"],)).fetchone()["t"]
    assert _dec(total) == ESTIMADO_MXN + Decimal("7500.750")


# ── El renglón del estimado es un renglón y nada más ────────────────────────
#
# Las tres guardas que tenía el residuo —no se teclea, no se renombra, no se
# borra— existían para proteger una resta. Sin resta que proteger, sobran las
# tres: «todas se hagan de la misma manera».

def test_the_estimate_line_is_typed_by_hand_like_any_other(client, test_property):
    """Corregir a mano el estimado grueso es la operación normal, no un ataque a
    la contabilidad: alguien mira el número que salió de m² × $/m² y sabe que va
    corto. Antes eran 422."""
    estimado_id = _estimate(_budget(client, test_property["id"]))["id"]
    r = client.patch(
        f"/api/properties/{test_property['id']}/budget/lines/{estimado_id}",
        json={"unitPrice": 9_000_000})
    assert r.status_code == 200, r.text
    assert _dec(r.json()["property"]["constructionBudgeted"]) == Decimal("9000000")


def test_the_estimate_line_is_renamed_like_any_other(client, test_property):
    """Su nombre dice de dónde salió, y por eso el sistema lo escribe. Pero es un
    nombre, no un identificador: en cuanto alguien lo detalla deja de ser un
    estimado y tiene derecho a llamarse como lo que es."""
    estimado_id = _estimate(_budget(client, test_property["id"]))["id"]
    r = client.patch(
        f"/api/properties/{test_property['id']}/budget/lines/{estimado_id}",
        json={"name": "Imprevistos"})
    assert r.status_code == 200, r.text
    assert _line_by_id(r.json()["budget"], estimado_id)["name"] == "Imprevistos"


def test_the_last_line_can_be_deleted_and_the_budget_stays_at_zero(client, test_property):
    """Un presupuesto sin renglones suma $0, y $0 es un número. Antes «Otros» no
    se podía borrar —el mecanismo lo necesitaba vivo para tener de dónde restar—
    y esa era la parte de la regla que sobraba."""
    estimado_id = _estimate(_budget(client, test_property["id"]))["id"]
    r = client.delete(f"/api/properties/{test_property['id']}/budget/lines/{estimado_id}")
    assert r.status_code == 200, r.text
    r = r.json()
    assert r["budget"]["lines"] == []
    assert _dec(r["property"]["constructionBudgeted"]) == Decimal("0")
    # Y la ficha sigue contestando: la obra en 0 no rompe la base de capital.
    p = _get(client, test_property["id"])
    assert _dec(p["totalInvestment"]) == Decimal("1140000")   # 1,000,000×1.065 + 50k + 25k
    assert p["constructionFee"] is not None


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
    created = _add(client, test_property["id"], name="Cocina", quantity=1, unitPrice=500_000)
    line_id = created["line"]["id"]
    # Se lee DESPUÉS de capturar la partida: detallar sí mueve la inversión —el
    # presupuesto es la suma de sus renglones—. Lo que esta prueba fija es que
    # comprometer y pagar no la mueven más.
    inversion = _dec(created["property"]["totalInvestment"])

    r = client.patch(f"/api/properties/{test_property['id']}/budget/lines/{line_id}",
                     json={"committedAmount": 620_000})
    assert r.status_code == 200, r.text
    r = r.json()
    assert _dec(r["property"]["constructionCommitted"]) == Decimal("620000")
    # 620,000 firmados contra los 500,000 planeados DE ESE RENGLÓN. No contra los
    # 2,840,000 del presupuesto entero: eso diría cuánto falta por comprometer.
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
    assert _dec(r["property"]["constructionBudgeted"]) == ESTIMADO_MXN + Decimal("500000")
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
    # y no la de un presupuesto que todavía tiene 2,340,000 sin contratar.
    r = client.patch(f"/api/properties/{test_property['id']}/budget/lines/{fachada}",
                     json={"committedAmount": 380_000})
    assert _dec(r.json()["property"]["constructionCommittedVariance"]) == Decimal("30000")

    # (4) Todo firmado. Se borra el renglón del estimado —lo que queda son las
    # dos partidas contratadas, 800,000— y ahí las dos lecturas coinciden: cuando
    # no falta nada por firmar, comparar contra lo firmado y comparar contra el
    # presupuesto entero son la misma resta.
    estimado_id = _estimate(_budget(client, test_property["id"]))["id"]
    r = client.delete(f"/api/properties/{test_property['id']}/budget/lines/{estimado_id}")
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


# ── Dos $/m² con dos nombres: el capturado y el derivado ────────────────────
#
# `constructionCostPerSqm` es el SUPUESTO —lo que alguien tecleó, su columna— y
# `budgetedCostPerSqm` es el DERIVADO —presupuesto ÷ metraje—. Hasta el
# 2026-08-30 los dos compartían nombre siendo dos cosas distintas: la columna no
# se escribía y el derivado salía publicado con su nombre. Se enseñan juntos,
# rotulados, y ninguno es el relevo del otro: una comparación sólo es honesta
# mientras ninguno de los dos sea el fallback del que falta.

def test_the_budgeted_cost_per_sqm_is_derived_from_the_budget(client, test_property):
    """2,340,000 entre 200 m² = 11,700/m². Es el precio unitario COMPUESTO, con
    los indirectos ya dentro, que es justo lo que un desglose por partidas no
    tiene y por eso se calcula en vez de teclearse."""
    assert _dec(test_property["budgetedCostPerSqm"]) == Decimal("11700.00")
    r = _add(client, test_property["id"], name="Estructura",
             quantity=1, unitPrice=1_660_000)      # total 4,000,000
    assert _dec(r["property"]["budgetedCostPerSqm"]) == Decimal("20000.00")


def test_the_captured_cost_per_sqm_is_its_own_column_and_stays_put(client, test_property):
    """El supuesto es del que lo capturó: se guarda tal cual y NADIE lo deriva
    encima. Viene del alta en 9,000 —el insumo de la calculadora— y ahí sigue,
    mientras el derivado dice 11,700 porque el estimado trae el 1.3 adentro.

    Que los dos números difieran es el punto: uno es lo que se supuso y el otro
    lo que el presupuesto de verdad dice. Cuando compartían nombre, esa
    diferencia era imposible de ver."""
    assert _dec(test_property["constructionCostPerSqm"]) == Decimal("9000.00")
    assert _dec(test_property["budgetedCostPerSqm"]) == Decimal("11700.00")


def test_without_metres_there_is_no_budgeted_cost_per_sqm(client, test_property):
    """Dividir entre cero no da «$0/m²»: no da nada. El capturado sí sobrevive —
    es un supuesto, no un cociente— y ahí se ve que son dos cosas distintas."""
    client.post(f"/api/properties/{test_property['id']}/clear-fields",
                json={"fields": ["sqmConstruction"]})
    p = _get(client, test_property["id"])
    assert p["budgetedCostPerSqm"] is None
    assert _dec(p["constructionCostPerSqm"]) == Decimal("9000.00")


# ── EDITAR LA FICHA NO MUEVE EL PRESUPUESTO ─────────────────────────────────
#
# El defecto que motivó todo este trabajo, y los tres caminos por los que se
# llegaba a él. Cada uno tiene su test nombrado por su caso, porque los tres
# fallaban distinto y el tercero era el grave: corregir el metraje derivaba la
# tasa vigente del total actual y la volvía a aplicar, repreciando trece
# capítulos cotizados con proveedor sin que nada en la pantalla lo dijera.
#
# Los tres afirman lo mismo: el presupuesto queda IDÉNTICO, al peso.

def test_editing_the_cost_per_sqm_alone_does_not_move_the_budget(client, test_property):
    """Primer camino: llega $/m² solo. Antes corría la calculadora contra el
    metraje de la fila y reescribía el total — 200 × 99,000 = 19,800,000."""
    r = client.patch(f"/api/properties/{test_property['id']}",
                     json={"constructionCostPerSqm": 99_000})
    assert r.status_code == 200, r.text
    assert _dec(r.json()["constructionBudgeted"]) == ESTIMADO_MXN
    # Y sí se guardó: es una columna, y el supuesto nuevo es el que se enseña.
    assert _dec(r.json()["constructionCostPerSqm"]) == Decimal("99000.00")
    assert _dec(r.json()["budgetedCostPerSqm"]) == Decimal("11700.00")


def test_editing_both_metres_and_cost_per_sqm_does_not_move_the_budget(client, test_property):
    """Segundo camino: los dos en el mismo PATCH. Antes 300 × 10,000 =
    3,000,000."""
    r = client.patch(f"/api/properties/{test_property['id']}",
                     json={"sqmConstruction": 300, "constructionCostPerSqm": 10_000})
    assert r.status_code == 200, r.text
    assert r.json()["sqmConstruction"] == 300
    assert _dec(r.json()["constructionCostPerSqm"]) == Decimal("10000.00")
    assert _dec(r.json()["constructionBudgeted"]) == ESTIMADO_MXN
    # El derivado SÍ se mueve, y debe: cambió el divisor. 2,340,000 ÷ 300.
    assert _dec(r.json()["budgetedCostPerSqm"]) == Decimal("7800.00")


def test_editing_the_metres_alone_does_not_move_the_budget(client, test_property):
    """TERCER CAMINO, EL GRAVE. Corregir el metraje de 200 a 300 m² no toca un
    peso del presupuesto — ni siquiera de los renglones que nadie cotizó.

    Antes derivaba la tasa vigente del total actual (2,340,000 ÷ 200 = 11,700) y
    la volvía a aplicar contra el metraje nuevo: 300 × 11,700 = 3,510,000, un
    50% más de obra por corregir una medida. Con trece capítulos cotizados a
    mano, los trece se repreciaban."""
    detalle = _add(client, test_property["id"], chapterName="Carpintería",
                   name="Clósets", quantity=1, unitPrice=180_000)["line"]["id"]
    antes = _budget(client, test_property["id"])

    r = client.patch(f"/api/properties/{test_property['id']}",
                     json={"sqmConstruction": 300})
    assert r.status_code == 200, r.text
    assert r.json()["sqmConstruction"] == 300
    assert _dec(r.json()["constructionBudgeted"]) == ESTIMADO_MXN + Decimal("180000")

    # Renglón por renglón, no sólo el total: repreciar proporcionalmente habría
    # dejado el total distinto Y cada importe distinto.
    despues = _budget(client, test_property["id"])
    assert ([(l["name"], l["budgetedAmount"]) for l in despues["lines"]]
            == [(l["name"], l["budgetedAmount"]) for l in antes["lines"]])
    assert _dec(_line_by_id(despues, detalle)["budgetedAmount"]) == Decimal("180000")


def test_editing_the_metres_of_a_property_with_no_budget_does_not_invent_one(
        client, test_property):
    """Con el presupuesto vacío, mover el metraje tampoco inventa obra: no hay
    tasa vigente que derivar ni fórmula que corra. 0 sigue siendo 0."""
    estimado_id = _estimate(_budget(client, test_property["id"]))["id"]
    client.delete(f"/api/properties/{test_property['id']}/budget/lines/{estimado_id}")
    r = client.patch(f"/api/properties/{test_property['id']}",
                     json={"sqmConstruction": 300, "constructionCostPerSqm": 12_000})
    assert r.status_code == 200, r.text
    assert _dec(r.json()["constructionBudgeted"]) == Decimal("0")
    assert _budget(client, test_property["id"])["lines"] == []


def test_the_cost_per_sqm_cannot_be_emptied_from_the_ficha(client, test_property):
    """Volvió a ser columna escribible, pero no entró a CLEARABLE_FIELDS: es un
    hecho capturado sin default al que volver, como la latitud. Se corrige
    tecleando otro número, no vaciándolo."""
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
        "Albañilería", "Instalaciones", budget_db.ESTIMATE_CHAPTER]


def test_renaming_a_chapter_renames_all_of_its_lines(client, test_property):
    _add(client, test_property["id"], chapterName="Albañileria", name="Muros")
    _add(client, test_property["id"], chapterName="Albañileria", name="Aplanados")
    r = client.patch(f"/api/properties/{test_property['id']}/budget/chapters/Albañileria",
                     json={"name": "Albañilería"})
    assert r.status_code == 200, r.text
    assert r.json()["budget"]["chapters"] == ["Albañilería", budget_db.ESTIMATE_CHAPTER]


def test_deleting_a_chapter_lowers_the_total_by_what_it_summed(client, test_property):
    """Borrar un capítulo es `delete_line` en bloque y significa lo mismo: se van
    sus renglones y el total baja lo que sumaban. Antes su costo volvía al
    residuo y el total no se movía."""
    _add(client, test_property["id"], chapterName="Albañilería", name="Muros",
         quantity=1, unitPrice=300_000)
    _add(client, test_property["id"], chapterName="Albañilería", name="Aplanados",
         quantity=1, unitPrice=200_000)
    r = client.delete(f"/api/properties/{test_property['id']}/budget/chapters/Albañilería")
    assert r.status_code == 200, r.text
    r = r.json()
    assert _detailed(r["budget"]) == {}
    assert _dec(r["property"]["constructionBudgeted"]) == ESTIMADO_MXN


def test_the_chapter_of_the_estimate_is_deleted_like_any_other(client, test_property):
    """«Otros» era donde vivía el remanente y no se renombraba ni se borraba. Es
    un capítulo como cualquiera: ahí aterriza el estimado sólo para que un
    presupuesto recién nacido y uno migrado se lean igual."""
    r = client.delete(
        f"/api/properties/{test_property['id']}/budget/chapters/{budget_db.ESTIMATE_CHAPTER}")
    assert r.status_code == 200, r.text
    assert r.json()["budget"]["lines"] == []
    assert _dec(r.json()["property"]["constructionBudgeted"]) == Decimal("0")


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
    """Los renglones por nombre, menos los que sembró el sistema.

    El estimado no es especial para el sistema —es un renglón como cualquiera— y
    se aparta aquí sólo para que cada test hable de lo que capturó él mismo. Se
    aparta por `seeded` y no por el nombre: copiado a otra propiedad el nombre
    pierde su aritmética (`_copied_name`), así que filtrar por texto dejaba
    entrar de vuelta al mismo renglón con otra cara."""
    return {line["name"]: line for line in budget["lines"] if not line["seeded"]}


def test_applying_a_whole_budget_copies_every_line_and_raises_the_total(
        client, test_property, origen):
    """Sin `chapters`: entran TODOS los renglones del origen y no queda renglón
    especial que dejar fuera. Antes el residuo del origen se quedaba en su obra
    —era un importe que el sistema recalculaba, no una partida—.

    El destino no traía más que su estimado inicial, así que ESE RENGLÓN SE
    REEMPLAZA: la cifra paramétrica se vuelve el desglose que la sustenta, y por
    eso no se salta ni uno. El estimado del origen —las dos obras se dieron de
    alta con 200 m² a $9,000 y 1.3, así que se llaman igual— ya no choca con
    nada, porque lo que chocaba se fue antes de copiar."""
    r = _apply(client, test_property["id"], origen["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()

    assert r["linesAdded"] == 4
    assert r["linesSkipped"] == 0
    assert set(_detailed(r["budget"])) == {"Hidráulica", "Eléctrica", "Piso cerámico"}
    assert _dec(r["property"]["constructionBudgeted"]) == ESTIMADO_MXN + Decimal("650000")


def test_only_the_chapters_asked_for_are_copied(client, test_property, origen):
    """Copiar UNA sección: llega lo de «Acabados» y nada de «Instalaciones». Un
    capítulo no es una entidad —es el nombre que copian sus renglones— así que
    copiar una sección es la misma copia con un WHERE.

    Y LA COPIA PARCIAL SUMA, NUNCA REEMPLAZA, aunque el destino no tenga más que
    su estimado. Reemplazar solo se sostiene cuando lo que llega SUSTITUYE al
    estimado, y una sección no sustituye a un presupuesto entero: cambiar los
    $2,340,000 estimados por los $150,000 de «Acabados» sería pérdida de datos
    con cara de función. Así que el estimado se queda y la sección se suma."""
    r = _apply(client, test_property["id"], origen["budgetId"], chapters=["Acabados"])
    assert r.status_code == 201, r.text
    r = r.json()

    assert r["linesAdded"] == 1
    assert r["linesSkipped"] == 0
    assert set(_detailed(r["budget"])) == {"Piso cerámico"}
    assert _dec(_estimate(r["budget"])["budgetedAmount"]) == ESTIMADO_MXN
    assert _dec(r["property"]["constructionBudgeted"]) == ESTIMADO_MXN + Decimal("150000")


def test_applying_the_same_source_twice_adds_nothing_the_second_time(
        client, test_property, origen):
    """La deduplicación, dicha como la vive quien copia a diez obras y no se
    acuerda de a cuáles ya les había copiado: la segunda pasada no duplica un
    solo renglón, y lo DICE — 0 agregados, 3 saltados — en vez de contestar
    «listo» como si hubiera hecho algo."""
    primera = _apply(client, test_property["id"], origen["budgetId"]).json()
    assert primera["linesAdded"] == 4

    # Y la segunda ya no reemplaza nada: el destino trae cuatro renglones, así
    # que la pregunta «¿aquí no ha trabajado nadie?» se contesta que no.
    r = _apply(client, test_property["id"], origen["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()

    assert r["linesAdded"] == 0
    assert r["linesSkipped"] == 4      # los tres detallados y el estimado
    assert len(_detailed(r["budget"])) == 3
    assert _dec(r["property"]["constructionBudgeted"]) == ESTIMADO_MXN + Decimal("650000")


def test_the_first_line_of_a_budget_created_on_the_fly_is_not_taken_for_seeded(
        client, test_property, origen):
    """EL CONTRAEJEMPLO QUE RETIRÓ LA DEDUCCIÓN POR RELOJ, fijado para que no
    vuelva.

    `_require_budget` crea el presupuesto al vuelo para propiedades que entraron
    fuera del API, y `create_line` envuelve esa creación y el INSERT del renglón
    en UN solo `with get_db()`. Con la procedencia deducida de `created_at`, el
    PRIMER renglón tecleado de esa propiedad heredaba la marca del presupuesto y
    se leía como sembrado: `apply` lo borraba en silencio.

    Hoy la procedencia se declara —`seeded` la pone solo `seed_estimate_line`—
    así que un renglón tecleado nace en FALSE aunque comparta transacción con su
    presupuesto, y ni la copia lo reemplaza ni el borrado se lo lleva."""
    pid = test_property["id"]
    with get_db() as conn:
        conn.execute("DELETE FROM budgets WHERE property_id = %s", (pid,))
    linea = _add(client, pid, chapterName="Clósets", name="Clósets cotizados",
                 unit="lote", quantity=1, unitPrice=950_000)["line"]["id"]
    with get_db() as conn:
        fila = conn.execute(
            "SELECT l.seeded, l.created_at = b.created_at AS mismas_marcas"
            "  FROM budget_lines l JOIN budgets b ON b.id = l.budget_id"
            " WHERE l.id = %s", (linea,)).fetchone()
    # La trampa vieja sigue ahí —comparten transacción— y ya no engaña a nadie.
    assert fila["mismas_marcas"] is True
    assert fila["seeded"] is False

    r = _apply(client, pid, origen["budgetId"])
    assert r.status_code == 201, r.text
    assert _line_by_id(r.json()["budget"], linea)["name"] == "Clósets cotizados"
    assert _dec(r.json()["property"]["constructionBudgeted"]) == (
        Decimal("950000") + ESTIMADO_MXN + Decimal("650000"))


def test_a_hand_typed_line_is_never_deleted_by_a_copy_even_if_it_is_the_only_one(
        client, test_property, origen):
    """EL ESPEJO DE LA RETENCIÓN, del lado que borra sin avisar.

    Un presupuesto cuyo ÚNICO renglón lo tecleó alguien —borró el estimado y
    capturó sus clósets en $950,000— no es «lo que sembró el sistema», aunque
    contarlo dé uno. `apply` lo borraría en silencio: no se lee como destructiva
    y no tiene paso de confirmación, así que aquí no hay red que lo detenga
    después. Lo separa el mismo hecho que retiene la propiedad: nadie marcó ese
    renglón como sembrado, así que `seeded` es FALSE por default de la columna.

    Se suma, no reemplaza, y el renglón sigue ahí con su importe."""
    pid = test_property["id"]
    estimado = _estimate(_budget(client, pid))["id"]
    client.delete(f"/api/properties/{pid}/budget/lines/{estimado}")
    propio = _add(client, pid, chapterName="Clósets", name="Clósets cotizados",
                  unit="lote", quantity=1, unitPrice=950_000)["line"]["id"]

    r = _apply(client, pid, origen["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()

    assert _line_by_id(r["budget"], propio)["name"] == "Clósets cotizados"
    assert _dec(_line_by_id(r["budget"], propio)["budgetedAmount"]) == Decimal("950000")
    assert _dec(r["property"]["constructionBudgeted"]) == (
        Decimal("950000") + ESTIMADO_MXN + Decimal("650000"))


def _source(client, budget_id: int) -> dict:
    r = client.get("/api/budget/sources?includeEmpty=true")
    assert r.status_code == 200, r.text
    return next(s for s in r.json() if s["id"] == budget_id)


def test_the_budget_says_of_itself_whether_a_proportional_copy_could_replace_it(
        client, test_property):
    """LA FILA QUE LA LISTA DE FUENTES NO PUEDE DAR: la de uno mismo.

    Empujar y jalar preguntan lo mismo desde puntas distintas. Empujando, el
    destino es otra obra y sale en `GET /api/budget/sources`. Jalando —«arranco
    desde X»— el destino es ESTE presupuesto, que es justo el que esa lista
    excluye a propósito, así que era el único que no tenía respuesta y el único
    que el usuario tiene enfrente.

    Mismos tres estados y la misma expresión. El vacío pesa más aquí: nacer
    vacío es el estado normal de una obra capturada sin calculadora."""
    pid = test_property["id"]
    assert _budget(client, pid)["replaceable"] is True

    linea = _add(client, pid, chapterName="Clósets", name="Clósets cotizados",
                 unit="lote", quantity=1, unitPrice=950_000)["line"]["id"]
    assert _budget(client, pid)["replaceable"] is False

    for l in _budget(client, pid)["lines"]:
        assert client.delete(
            f"/api/properties/{pid}/budget/lines/{l['id']}").status_code == 200
    vacio = _budget(client, pid)
    assert vacio["lines"] == []
    assert vacio["replaceable"] is True
    assert linea not in [l["id"] for l in vacio["lines"]]


def test_the_source_list_says_which_budgets_a_proportional_copy_could_replace(
        client, test_property, origen):
    """`replaceable` EXISTE PARA QUE LA PANTALLA NO OFREZCA LO QUE EL SERVIDOR
    RECHAZA. La proporcional exige un destino que no tenga más que su estimado
    sembrado, y en un empuje los destinos son OTRAS propiedades: su contenido no
    está en la pantalla, así que el cliente no puede contestarlo solo.

    Los tres estados, y el vacío es el que había que decidir a propósito:

    - Sólo su estimado sembrado → `true`. Hay qué sustituir y nada que perder.
    - Con algo tecleado → `false`. Lo mismo que retiene la propiedad al borrarla:
      una sola regla, tres lectores.
    - VACÍO → `true`. Cero renglones no es más que el estimado, es menos, y el
      reemplazo sería un DELETE sin filas seguido de la copia. Es además el caso
      que `includeEmpty` existe para enseñar —los destinos de empuje— donde un
      presupuesto vacío es el blanco más reemplazable que hay."""
    pid = test_property["id"]
    propio = _budget(client, pid)["id"]

    assert _source(client, propio)["replaceable"] is True
    assert _source(client, origen["budgetId"])["replaceable"] is False

    _add(client, pid, chapterName="Clósets", name="Clósets cotizados",
         unit="lote", quantity=1, unitPrice=950_000)
    assert _source(client, propio)["replaceable"] is False

    for linea in _budget(client, pid)["lines"]:
        assert client.delete(
            f"/api/properties/{pid}/budget/lines/{linea['id']}").status_code == 200
    vacio = _source(client, propio)
    assert vacio["lineCount"] == 0
    assert vacio["replaceable"] is True


@pytest.fixture
def origen_sin_detalle(client):
    """Una obra cuyo presupuesto es SÓLO el estimado que le sembró la calculadora.

    Con métricas distintas a las del `test_property` a propósito: 150 m² a
    $10,000 contra 200 m² a $9,000 × 1.3, para que el renglón copiado se
    distinga del que ya estaba por su solo nombre."""
    r = client.post("/api/properties", json={
        "name": "[TEST] Obra Sin Detalle", "address": "Calle Sin Detalle 1",
        "city": "Monterrey", "purchasePrice": 1_000_000, "sqmConstruction": 150,
        "constructionCostPerSqm": 10_000, "constructionOverhead": 1})
    assert r.status_code == 201, r.text
    prop = r.json()
    yield {"propertyId": prop["id"], "budgetId": _budget(client, prop["id"])["id"]}
    _delete_property(prop["id"])


def test_copying_a_source_that_is_only_its_estimate_leaves_the_destination_replaceable(
        client, test_property, origen_sin_detalle, origen):
    """`seeded` VIAJA CON LA COPIA, y eso tiene una consecuencia que hay que ver.

    Copiar de una obra que no ha detallado nada trae un solo renglón, y trae su
    marca: el destino queda con UN renglón sembrado, o sea sigue leyéndose como
    intacto —se borra, y el siguiente `apply` lo reemplaza en vez de sumarle—.

    Es lo correcto, no un descuido. Lo que se copió es un estimado paramétrico,
    no obra cotizada; nadie tecleó una partida aquí, y volver a copiar cuesta un
    clic. Tratarlo como trabajo capturado retendría la propiedad para siempre por
    algo que el sistema mismo escribió dos veces —la regresión que `seeded` vino
    a cerrar—, sólo que con un rodeo.

    Y EL NOMBRE LLEGA ATRIBUIDO: la fuente es de 150 m² y esta obra de 200, así
    que el renglón dice de quién es esa cuenta (ver `_copied_name`). Sin eso, un
    nombre que afirma metros ajenos es un cálculo sobre un edificio que no es el
    del lector; recortado, un importe sin manera de explicarse."""
    pid = test_property["id"]
    assert len(_budget(client, pid)["lines"]) == 1

    assert _apply(client, pid, origen_sin_detalle["budgetId"]).status_code == 201
    lineas = _budget(client, pid)["lines"]
    assert len(lineas) == 1
    assert lineas[0]["name"] == _de("Estimado inicial · 150 m² × $10,000/m²",
                                    "[TEST] Obra Sin Detalle")
    assert _dec(lineas[0]["budgetedAmount"]) == Decimal("1500000")
    assert lineas[0]["seeded"] is True

    # Sigue intacto: el siguiente copiado REEMPLAZA lo copiado, no le suma.
    assert _apply(client, pid, origen["budgetId"]).status_code == 201
    despues = _budget(client, pid)["lines"]
    assert not any(_dec(l["budgetedAmount"]) == Decimal("1500000") for l in despues)
    assert _dec(_get(client, pid)["constructionBudgeted"]) == (
        ESTIMADO_MXN + Decimal("650000"))


def test_the_replace_branch_removes_without_reporting_it_and_can_run_again(
        client, test_property, origen_sin_detalle, origen):
    """LO QUE EL REEMPLAZO QUITA NO SE REPORTA, y encadenarlo no acumula.

    La respuesta trae `linesAdded` y `linesSkipped` y nada para lo quitado —hay
    un renglón menos que antes y ningún número lo dice—. Es a propósito: lo único
    que esta rama puede quitar es un renglón que escribió el propio sistema, así
    que no hay pérdida que reportar, y darle un campo obligaría a la pantalla a
    explicarla. Se fija aquí para que el siguiente que lo note lo lea como una
    decisión y no como un olvido.

    Y como la marca viaja con la copia, la rama vuelve a abrirse: el segundo
    `apply` sustituye lo que copió el primero en vez de sumárselo. Dos copias
    seguidas dejan un presupuesto, no dos estimados encimados."""
    pid = test_property["id"]
    inicial = _estimate(_budget(client, pid))["id"]

    r = _apply(client, pid, origen_sin_detalle["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()
    assert (r["linesAdded"], r["linesSkipped"]) == (1, 0)
    assert set(r) == {"line", "budget", "property", "budgetIncrease",
                      "linesAdded", "linesSkipped"}
    # Entró uno y se fue otro: el conteo no lo dice y el presupuesto sí.
    assert [l["id"] for l in r["budget"]["lines"]] != [inicial]
    assert len(r["budget"]["lines"]) == 1

    # Otra vez, y sigue siendo uno: lo copiado antes se reemplaza, no se suma.
    r = _apply(client, pid, origen_sin_detalle["budgetId"]).json()
    assert r["linesAdded"] == 1
    assert len(r["budget"]["lines"]) == 1

    # Hasta que entra trabajo tecleado: ahí la rama se cierra y se suma. Entran
    # los cuatro del origen, su estimado incluido: viene atribuido a SU obra, así
    # que no choca con el que ya estaba aquí —atribuido a la otra—. Dos estimados
    # ajenos de obras distintas son dos renglones distintos, que es lo correcto:
    # son dos cuentas sobre dos edificios.
    _add(client, pid, chapterName="Clósets", name="Clósets cotizados",
         unit="lote", quantity=1, unitPrice=950_000)
    r = _apply(client, pid, origen["budgetId"]).json()
    assert (r["linesAdded"], r["linesSkipped"]) == (4, 0)
    assert len(r["budget"]["lines"]) == 6


def test_a_copied_estimate_never_carries_another_propertys_arithmetic(
        client, test_property, origen_sin_detalle):
    """LA CUENTA EN EL NOMBRE SÓLO VALE DENTRO DE LA OBRA QUE DESCRIBE.

    La fuente es de 150 m² a $10,000 y esta obra de 200 a $9,000. Si el nombre
    viajara literal, alguien abriría SU presupuesto y leería un cálculo sobre un
    edificio que no es el suyo —aritmética impecable y sobre otra propiedad, que
    es la peor clase de dato correcto—. Cruzando de propiedad se queda sin
    cuenta; el importe, que sí es lo que se copió, no se toca."""
    pid = test_property["id"]
    assert _apply(client, pid, origen_sin_detalle["budgetId"]).status_code == 201

    copiado = _budget(client, pid)["lines"][0]
    assert copiado["name"] == _de("Estimado inicial · 150 m² × $10,000/m²",
                                  "[TEST] Obra Sin Detalle")
    assert _dec(copiado["budgetedAmount"]) == Decimal("1500000")
    # Y el original no se movió: copiar lee, no reescribe la obra de al lado.
    origen_linea = _budget(client, origen_sin_detalle["propertyId"])["lines"][0]
    assert origen_linea["name"] == "Estimado inicial · 150 m² × $10,000/m²"


def test_the_attribution_is_written_once_even_copying_a_copy(
        client, test_property, origen_sin_detalle, destino):
    """A → B → C SE QUEDA CON «(de «A»)», y esa es la respuesta verdadera: la
    aritmética de ese nombre son los metros de A, nunca los de B.

    Que sea idempotente no es elegancia, es requisito: EL NOMBRE ES LA LLAVE DE
    LA DEDUP. Si cada salto encadenara otra atribución, el mismo renglón tendría
    un texto distinto en cada obra y el segundo `apply` dejaría de reconocerlo —
    se copiaría otra vez, y otra—."""
    a, b, c = origen_sin_detalle["propertyId"], test_property["id"], destino["id"]
    esperado = _de("Estimado inicial · 150 m² × $10,000/m²", "[TEST] Obra Sin Detalle")

    assert _apply(client, b, origen_sin_detalle["budgetId"]).status_code == 201
    assert _budget(client, b)["lines"][0]["name"] == esperado

    assert _apply(client, c, _budget(client, b)["id"]).status_code == 201
    en_c = next(l for l in _budget(client, c)["lines"] if l["seeded"])
    assert en_c["name"] == esperado          # sin «(de «…»)» encadenado
    assert en_c["name"].count("(de «") == 1

    # Y por eso vuelve a deduplicar. Se le teclea algo a C para cerrarle la rama
    # del reemplazo —si no, el segundo apply borraría y volvería a copiar, que es
    # otra cosa— y ahí se ve: el mismo renglón se reconoce y se salta.
    _add(client, c, chapterName="Clósets", name="Clósets cotizados",
         unit="lote", quantity=1, unitPrice=950_000)
    r = _apply(client, c, _budget(client, b)["id"]).json()
    assert r["linesSkipped"] == 1
    assert r["linesAdded"] == 0
    assert len([l for l in r["budget"]["lines"] if l["name"] == esperado]) == 1


def test_a_scaled_estimate_says_so_because_its_own_arithmetic_stopped_adding_up(
        client, test_property, origen_sin_detalle):
    """EL NOMBRE Y EL IMPORTE SE AFIRMAN JUNTOS, porque el defecto era que se
    contradecían mientras cada uno por su lado se veía bien.

    La fuente es de 150 m² × $10,000 = $1,500,000; esta obra tenía $2,340,000 y
    la proporcional dimensiona a eso, así que el renglón aterriza con $2,340,000
    y una cuenta en el nombre que da $1,500,000. Dividir entre los 150 m² del
    origen saca $15,600/m², una tarifa que no tuvo ninguna de las dos.

    El dinero está bien —$2,340,000 es exactamente lo que la proporcional
    promete— y por eso el arreglo no toca la cifra: el renglón dice que se
    ajustó. La versión directa de este mismo par vive arriba, sin la nota,
    porque ahí la cuenta sí da el importe."""
    pid = test_property["id"]
    r = _apply_proporcional(client, pid, origen_sin_detalle["budgetId"])
    assert r.status_code == 201, r.text

    lineas = _budget(client, pid)["lines"]
    assert len(lineas) == 1
    assert lineas[0]["name"] == _de("Estimado inicial · 150 m² × $10,000/m²",
                                    "[TEST] Obra Sin Detalle", escalado=True)
    assert _dec(lineas[0]["budgetedAmount"]) == ESTIMADO_MXN
    assert _dec(_get(client, pid)["constructionBudgeted"]) == ESTIMADO_MXN


def test_a_copied_estimate_does_not_hold_the_property_back_either(
        client, test_property, origen_sin_detalle):
    """La otra cara de lo mismo, por la puerta del borrado: un estimado que llegó
    copiado tampoco es trabajo capturado, así que la propiedad se sigue
    borrando."""
    pid = test_property["id"]
    assert _apply(client, pid, origen_sin_detalle["budgetId"]).status_code == 201
    assert client.delete(f"/api/properties/{pid}").status_code == 204


def test_copying_a_detailed_budget_does_protect_the_destination(
        client, test_property, origen):
    """Y el caso benigno, que es el que se da casi siempre: copiar un presupuesto
    DETALLADO deja al destino protegido, con marcas o sin ellas.

    Del origen viaja también su propio estimado sembrado, pero da igual: son
    cuatro renglones y `count(l.id) <= 1` ya falla. La marca sólo decide el caso
    de un renglón solo."""
    pid = test_property["id"]
    assert _apply(client, pid, origen["budgetId"]).status_code == 201
    assert len(_budget(client, pid)["lines"]) > 1

    r = client.delete(f"/api/properties/{pid}")
    assert r.status_code == 422, r.text
    assert "renglones capturados" in r.json()["error"]["message"]


def test_a_budget_with_work_of_its_own_is_added_to_and_never_replaced(
        client, test_property, origen):
    """EL OTRO LADO DEL REEMPLAZO, que es donde vive la garantía: basta UN
    renglón tecleado para que la copia deje de reemplazar y vuelva a sumar.

    Reemplazar es cambiar el estimado por el desglose que lo sustenta, y eso
    solo es cierto mientras el estimado sea lo ÚNICO que hay. En cuanto alguien
    capturó algo, la copia no tiene manera de saber qué parte del presupuesto
    venía a sustituir —y borrar de más sería tirar trabajo real, en silencio—,
    así que no borra nada: los renglones se suman y el total sube con ellos.
    Aquí el destino queda en su estimado + su partida + los cuatro del origen,
    su estimado incluido: cuatro copiados y ninguno saltado. El del origen ya no
    choca con el de acá porque cruzó de propiedad y llegó atribuido —«… (de «[TEST]
    Obra Origen»)», ver `_copied_name`—. Antes se saltaban por gemelos, pero eran
    gemelos de casualidad: este fixture y el destino traen las mismas métricas.
    Con métricas distintas los nombres ya diferían y entraban los dos."""
    _add(client, test_property["id"], chapterName="Albañilería", name="Muros",
         quantity=1, unitPrice=400_000)

    r = _apply(client, test_property["id"], origen["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()

    # El estimado del destino sigue ahí, con su cuenta y su importe intactos.
    assert (r["linesAdded"], r["linesSkipped"]) == (4, 0)
    assert _dec(_estimate(r["budget"])["budgetedAmount"]) == ESTIMADO_MXN
    ajeno = next(l for l in r["budget"]["lines"]
                 if l["name"] == _de(ESTIMADO, "[TEST] Obra Origen"))
    assert _dec(ajeno["budgetedAmount"]) == ESTIMADO_MXN
    assert _dec(r["property"]["constructionBudgeted"]) == (
        ESTIMADO_MXN + Decimal("400000") + Decimal("650000") + ESTIMADO_MXN)


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

    assert r["linesAdded"] == 4        # los tres del origen menos la padeada, más su estimado
    assert r["linesSkipped"] == 1      # la eléctrica padeada, y sólo ella
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
    assert r["linesAdded"] == 3        # las otras dos del origen, más su estimado
    assert r["linesSkipped"] == 1      # la hidráulica con dinero, y sólo ella

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


def test_copying_into_an_empty_budget_lands_exactly_what_came_in(client, test_property, origen):
    """Copiar sube el total lo que suman los renglones copiados, ni un peso más.
    Con el presupuesto del destino vacío se ve al desnudo: entran los cuatro del
    origen —los tres detallados y su estimado— y el total ES su suma.

    Antes copiar salía del residuo y no movía el total, salvo cuando lo rebasaba;
    ese excedente se reportaba aparte en `budgetIncrease`. Ya no hay dos casos."""
    estimado_id = _estimate(_budget(client, test_property["id"]))["id"]
    client.delete(f"/api/properties/{test_property['id']}/budget/lines/{estimado_id}")

    r = _apply(client, test_property["id"], origen["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()
    assert (r["linesAdded"], r["linesSkipped"]) == (4, 0)
    assert _dec(r["property"]["constructionBudgeted"]) == ESTIMADO_MXN + Decimal("650000")


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
#     origen:   200,000 (lote) + 150,000 (m²) + 50,000 (fija) = 400,000 capturado
#               + su estimado, 100 m² × $16,500 = 1,650,000  →  total 2,050,000
#     destino:  200 m² × $20,250 = T = 4,050,000, su renglón de estimado al alta
#     factor = (4,050,000 − 50,000) / (2,050,000 − 50,000) = 2
#
# El estimado del origen entra al denominador igual que antes entraba su residuo,
# y por la misma razón: es alcance que esa obra carga y que la que copia la forma
# quiere heredar. Lo único que cambió es que ahora es un renglón con nombre.
COSTO_POR_M2 = 20_250
OBJETIVO = Decimal("4050000")


@pytest.fixture
def modelo(client):
    """La obra de la que se copia la forma: una partida de suma alzada, una
    medida en m² y una fija, para que cada regla del escalado tenga su renglón."""
    r = client.post("/api/properties", json={
        "name": "[TEST] Obra Modelo", "address": "Calle Modelo 1", "city": "Monterrey",
        "purchasePrice": 1_000_000, "sqmConstruction": 100,
        "constructionCostPerSqm": 16_500, "constructionOverhead": 1})
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
    calculadora lo escribió como un renglón al dar de alta la obra y desde
    entonces vive en el presupuesto, donde el servidor lo lee."""
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
    """Una obra sin costo de obra capturado —sin metraje ni $/m² no hay estimado
    que sembrar, así que su presupuesto nace vacío—. Hoy 2 de las 5 reales están
    así, y por eso el rechazo tiene que ser legible, no un borde."""
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


def test_the_copied_lines_add_up_to_the_target_cost_exactly(client, destino, modelo):
    """LA PRUEBA DE QUE LA ARITMÉTICA CIERRA. Lo COPIADO suma exactamente los
    $4,050,000 que el destino traía de costo de obra, sin un centavo de sobra ni
    de menos:

        50,000 (fija) + 400,000 + 300,000 + 3,300,000 (el estimado escalado)

    Y EL TOTAL SE QUEDA EN T, porque el destino no tenía más que su estimado y
    el estimado es justo lo que este desglose viene a reemplazar. Sumarlo encima
    habría dado 2×T: un total que la propia aritmética del modo desmiente —el
    factor se calculó para que lo copiado sumara T— y que ningún renglón podría
    justificar. Antes el residuo llegaba al mismo número absorbiendo la
    diferencia; hoy llega porque lo que sobraba se fue."""
    r = _apply_proporcional(client, destino["id"], modelo["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()

    assert r["linesAdded"] == 4
    assert _dec(r["property"]["constructionBudgeted"]) == OBJETIVO
    assert (sum(_dec(l["budgetedAmount"]) for l in _detailed(r["budget"]).values())
            == Decimal("750000"))      # las tres capturadas; la cuarta es el estimado
    # Y el estimado que había en el destino ya no está: lo reemplazó el desglose.
    nombres = [l["name"] for l in _budget(client, destino["id"])["lines"]]
    assert budget_db.estimate_line_name(200, 20_250, 1) not in nombres


def test_the_target_is_read_from_the_destination_and_never_received(
        client, destino, modelo):
    """EL OBJETIVO ES EL TOTAL DE ESTE PRESUPUESTO, LEÍDO AL MOMENTO DE COPIAR.
    Bajar el costo de obra a $2,050,000 —el mismo que el origen— deja el factor
    en 1, y los renglones entran con los importes de la otra obra sin que la
    petición cambie un carácter.

        factor = (2,050,000 − 50,000) / (2,050,000 − 50,000) = 1

    Es la prueba de que no quedó ningún costo objetivo viajando en el cuerpo: si
    lo hubiera, este mismo llamado seguiría dimensionando contra los $4,050,000
    viejos.

    Corregirle el importe al estimado no lo vuelve otro renglón: sigue siendo lo
    único que hay y sigue siendo lo que el desglose reemplaza. La pregunta cuenta
    renglones y ejecución, no ediciones."""
    estimado_id = _estimate_of(_budget(client, destino["id"]), 200, 20_250)["id"]
    r = client.patch(f"/api/properties/{destino['id']}/budget/lines/{estimado_id}",
                     json={"unitPrice": 2_050_000})
    assert r.status_code == 200, r.text

    r = _apply_proporcional(client, destino["id"], modelo["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()

    copiadas = _detailed(r["budget"])
    assert _dec(copiadas["Hidráulica"]["unitPrice"]) == Decimal("200000")
    assert _dec(copiadas["Piso cerámico"]["quantity"]) == Decimal("100")
    assert _dec(copiadas["Licencias"]["unitPrice"]) == Decimal("50000")
    # Lo copiado suma el nuevo objetivo, no los $4,050,000 viejos, y como
    # reemplazó al estimado el total ES ese objetivo.
    assert _dec(r["property"]["constructionBudgeted"]) == Decimal("2050000")
    heredado = next(l for l in r["budget"]["lines"]
                    if l["name"] == _de(budget_db.estimate_line_name(100, 16_500, 1),
                                        "[TEST] Obra Modelo"))
    assert _dec(heredado["budgetedAmount"]) == Decimal("1650000")


def test_the_factor_is_computed_over_what_gets_copied_and_nothing_else(
        client, destino, modelo):
    """EL FACTOR SE CALCULA SOBRE LO QUE SE VA A COPIAR, no sobre el origen entero.

    Por la ruta esto es inalcanzable —`_require_replaceable` obliga a copiar el
    presupuesto completo en la proporcional— así que la invariante se afirma
    directo sobre la función, que es donde vive. Escrita con la versión anterior
    fallaba: las fijas se sumaban sobre los capítulos pedidos y lo escalable
    sobre el presupuesto completo, así que el denominador traía renglones que la
    copia nunca se iba a llevar y el factor salía chico. Nadie lo veía porque las
    dos puntas coinciden mientras `chapters` sea None.

    Aquí se pide sólo «Acabados»: $150,000 escalables y ni una fija. Para un
    objetivo de $300,000 el factor es exactamente 2, y sería otro si Hidráulica y
    Licencias —que no viajan— pesaran en la cuenta."""
    with get_db() as conn:
        origen_id = _budget(client, modelo["propertyId"])["id"]
        factor = budget_db._proportional_factor(
            conn, origen_id, ["Acabados"], Decimal("300000"))
    assert factor == Decimal(2)

    # Y sobre el presupuesto entero sigue dando lo de siempre: el objetivo menos
    # la fija, entre lo que sí escala.
    with get_db() as conn:
        completo = budget_db._proportional_factor(
            conn, origen_id, None, Decimal("4050000"))
    assert completo == (Decimal("4050000") - Decimal("50000")) / (
        Decimal("1650000") + Decimal("200000") + Decimal("150000"))


def test_the_proportional_copy_refuses_when_it_cannot_honour_its_own_target(
        client, destino, modelo):
    """LA OPERACIÓN QUE NO PUEDE CUMPLIR SU GARANTÍA DECLINA, no aproxima.

    El factor dimensiona lo copiado para que sume «lo que esta obra ya tenía
    presupuestado». Con renglones propios en el destino ese lugar está ocupado:
    lo copiado aterrizaría encima y el total quedaría en ≈2×T, un número que el
    objetivo del que salió el factor desmiente. Y con un capítulo suelto no hay
    reemplazo posible —una sección no sustituye a un presupuesto—, así que la
    proporcional tampoco aplica.

    La salida no es borrar de más para hacerse lugar: eso exigiría reconocer el
    estimado por su nombre, y un nombre lo teclea o lo renombra cualquiera. Se
    rechaza diciendo qué hacer, y la copia DIRECTA sigue disponible en los dos
    casos.

    Este rechazo ABSORBE la vieja prueba de deduplicación en modo proporcional
    («un renglón que ya está aquí se salta, no se escala»): esa garantía ya no
    se puede ni ejercer, porque donde la proporcional corre el destino tiene a
    lo más el estimado y se vacía antes de copiar. La protección del dinero
    capturado no se perdió —se volvió más fuerte—: en vez de escalar alrededor
    de lo capturado, la operación no corre."""
    # (a) capítulo suelto: no hay presupuesto que sustituir.
    r = _apply_proporcional(client, destino["id"], modelo["budgetId"],
                            chapters=["Acabados"])
    assert r.status_code == 422, r.text
    assert "capítulo suelto" in r.json()["error"]["message"]

    # (b) renglones propios: el lugar del objetivo ya está ocupado.
    _add(client, destino["id"], chapterName="Albañilería", name="Muros",
         quantity=1, unitPrice=400_000)
    r = _apply_proporcional(client, destino["id"], modelo["budgetId"])
    assert r.status_code == 422, r.text
    assert "ya tiene renglones capturados" in r.json()["error"]["message"]

    # Y en ese mismo estado la directa funciona: trae los importes del origen.
    r = _apply(client, destino["id"], modelo["budgetId"])
    assert r.status_code == 201, r.text
    assert _dec(r.json()["property"]["constructionBudgeted"]) == (
        OBJETIVO + Decimal("400000") + Decimal("2050000"))


def test_the_destination_inherits_how_much_is_left_to_detail(
        client, destino, modelo):
    """El estimado del origen entra al denominador del factor, y por eso el
    destino hereda TAMBIÉN cuánto le falta por detallar: el modelo está detallado
    al 19.5% y lo copiado queda igual, con el estimado escalado por el mismo 2.

    Un origen 100% detallado no traería ningún renglón de holgura, por la misma
    aritmética y sin un caso especial.

    Y AQUÍ SE VE EL NOMBRE COMPLETO, con sus tres piezas y por qué hacen falta
    las tres. La holgura heredada llega escalada —$1,650,000 × 2— así que un
    nombre armado con las métricas del destino diría «200 m² × $20,250/m²», que
    da otra cosa; uno recortado a «Estimado inicial» dejaría $3,300,000 sin
    explicación; y la cuenta del origen a secas invita a dividir entre 100 m² y
    sacar $33,000/m², una tarifa que no tuvo ninguna de las dos obras. Llega la
    cuenta del origen, de quién es, y que el importe se ajustó."""
    r = _apply_proporcional(client, destino["id"], modelo["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()

    heredado = next(l for l in r["budget"]["lines"]
                    if l["name"] == _de(budget_db.estimate_line_name(100, 16_500, 1),
                                        "[TEST] Obra Modelo", escalado=True))
    assert _dec(heredado["budgetedAmount"]) == Decimal("3300000")
    # Y el origen no se movió: copiar lee, no escribe en la obra de al lado.
    assert _dec(_estimate_of(_budget(client, modelo["propertyId"]), 100, 16_500)
                ["budgetedAmount"]) == Decimal("1650000")


def test_the_direct_copy_does_not_scale_a_single_peso(client, test_property, modelo):
    """Sin pedir la copia proporcional no se mueve nada: los importes llegan tal
    cual, sin un `round()` que le toque un centavo a un precio que nadie pidió
    escalar."""
    r = _apply(client, test_property["id"], modelo["budgetId"])
    assert r.status_code == 201, r.text
    r = r.json()

    detalladas = _detailed(r["budget"])
    assert _dec(detalladas["Hidráulica"]["unitPrice"]) == Decimal("200000")
    assert _dec(detalladas["Piso cerámico"]["quantity"]) == Decimal("100")
    assert _dec(detalladas["Licencias"]["unitPrice"]) == Decimal("50000")
    assert detalladas["Licencias"]["isProportional"] is False
    # Y el total es exactamente lo que traía el origen: el destino no tenía más
    # que su estimado y el desglose lo reemplazó. Aquí el modo directo SÍ mueve
    # el total —a 2,050,000 desde los 2,340,000 estimados— porque el desglose de
    # la otra obra vale lo que vale; dimensionarlo es lo que pide la proporcional.
    assert _dec(r["property"]["constructionBudgeted"]) == Decimal("2050000")


def test_a_destination_without_a_cost_of_works_is_refused_and_says_where_to_fix_it(
        client, modelo, sin_costo_de_obra):
    """Sin costo de obra no hay a qué escalar: el factor daría 0 y la copia
    entera aterrizaría en importes en cero, que se ven capturados y no lo están.

    Hoy 2 de las 5 obras reales están así, o sea que faltar no es un borde, y el
    rechazo tiene que mandar al lugar donde SÍ se arregla. Ese lugar ya no es la
    ficha —teclear m² y $/m² ahí no escribe un peso en el presupuesto— sino el
    presupuesto mismo: se captura un renglón, aunque sea el estimado grueso."""
    r = _apply_proporcional(client, sin_costo_de_obra["id"], modelo["budgetId"])
    assert r.status_code == 422, r.text
    mensaje = r.json()["error"]["message"]
    assert sin_costo_de_obra["name"] in mensaje
    assert "$0" in mensaje and "renglón" in mensaje
    assert "ficha" not in mensaje, "la ficha ya no siembra el presupuesto"
    # Y no dejó nada a medias en el destino.
    assert _budget(client, sin_costo_de_obra["id"])["lines"] == []


def test_a_target_that_does_not_fit_the_fixed_lines_is_refused_with_both_amounts(
        client, destino, modelo):
    """La guarda que impide un factor negativo, dicha con los dos números: con el
    costo de obra del destino en $40,000, las licencias solas cuestan $50,000 y
    ya no caben. Un factor negativo habría producido precios en negativo, que la
    base rechaza con un CHECK y un 500 mudo — o peor, habría cabido."""
    estimado_id = _estimate_of(_budget(client, destino["id"]), 200, 20_250)["id"]
    r = client.patch(f"/api/properties/{destino['id']}/budget/lines/{estimado_id}",
                     json={"unitPrice": 40_000})
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
    assert (fuente["lineCount"], _dec(fuente["total"])) == (
        4, ESTIMADO_MXN + Decimal("650000"))
    # `lineCount` es un NÚMERO aquí y `lines` es el arreglo en el detalle: un
    # mismo nombre con dos tipos se paga en el cliente.
    assert "lines" not in fuente


def test_a_source_counts_every_line_because_every_line_would_travel(
        client, test_property, origen):
    """`lineCount` es exactamente cuántos renglones van a aparecer. Antes contaba
    sólo lo detallado, porque el residuo no se copiaba y prometerlo habría sido
    prometer un renglón que nunca llegaba.

    Ahora todo viaja, y la consecuencia visible es que una obra apenas capturada
    SÍ aparece en el selector, con el 1 de su estimado. Es lo que de verdad
    ofrece: un renglón con un número real que la obra destino puede escalar."""
    propio = _budget(client, test_property["id"])
    assert len(propio["lines"]) == 1
    fuente_propia = next(f for f in _sources(client) if f["id"] == propio["id"])
    assert fuente_propia["lineCount"] == 1

    # El origen tiene CUATRO renglones —los tres detallados y su estimado— y los
    # cuatro viajan.
    assert len(_budget(client, origen["propertyId"])["lines"]) == 4
    assert next(f for f in _sources(client)
                if f["id"] == origen["budgetId"])["lineCount"] == 4


def test_a_budget_is_not_offered_as_a_source_to_itself(client, test_property, origen):
    """`apply` ya lo rechaza con un 422; ofrecerlo en el selector sería hacer que
    el usuario descubra la regla chocando con ella. La exclusión es por id de
    PRESUPUESTO (no de propiedad) desde el addendum 2026-08-24: así los
    escenarios de la misma obra sí se ofrecen."""
    assert any(f["id"] == origen["budgetId"] for f in _sources(client))
    assert all(f["id"] != origen["budgetId"]
               for f in _sources(client, excludeBudgetId=origen["budgetId"]))


# ── La invariante que queda ─────────────────────────────────────────────────

def test_a_property_without_a_budget_still_answers_and_gets_an_empty_one(client):
    """La invariante se sostiene sola frente a filas que entraron por fuera del
    API. Sin eso volvería la rama «si existe presupuesto», que es exactamente la
    disyunción que este diseño existe para no tener.

    NACE VACÍO, sin renglón fantasma: leer el presupuesto de una fila que entró
    por fuera no es una captura de nadie, y aquí no hay con qué llamar a la
    calculadora. Suma $0 y eso es un estado legítimo."""
    r = client.post("/api/properties", json={
        "name": "[TEST] Sin Presupuesto", "address": "Calle Seis 6", "city": "Monterrey",
        "purchasePrice": 1_000_000})
    prop = r.json()
    try:
        with get_db() as conn:
            conn.execute("DELETE FROM budgets WHERE property_id = %s", (prop["id"],))
        assert _dec(_get(client, prop["id"])["constructionBudgeted"]) == Decimal("0")
        assert _budget(client, prop["id"])["lines"] == []
    finally:
        client.delete(f"/api/properties/{prop['id']}")


def test_the_budget_of_a_missing_property_is_404(client):
    assert client.get("/api/properties/999999999/budget").status_code == 404
