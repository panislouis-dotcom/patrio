"""The metric contract, status by status.

Solo se gatea por etapa lo que AFIRMA PROPIEDAD: la marca viva y el resultado de
venta. El expediente — el desglose de costos, lo que ese desglose prometió y el
yield de cada renta — se computa en toda etapa y sale None cuando le faltan
insumos, que es la misma respuesta pero derivada del dato y no del estado.

El punto entero de la consolidación es que ninguno de los grupos degrade a un
cero fabricado. Estas pruebas leen la API y no el módulo de dominio, porque el
contrato es lo que el cliente ve.
"""
from decimal import Decimal

from api.db import get_db
from api.finance import underwriting

# El expediente. Sin ventana: aparece cuando sus insumos están, en la etapa que sea.
RECORD = ("acquisitionCosts", "acquisitionTotal", "constructionBudgeted",
          "constructionCostPerSqm",
          "purchasePricePerSqm", "investmentPerSqm", "salePerSqm",
          "projectedProfit", "projectedRoi", "projectedRoiTotal", "capRate", "rentAnnual")
# El yield de la renta COBRADA. Va aparte porque su insumo aparece más tarde: una
# propiedad en desarrollo tiene todo el resto del expediente y no tiene esto.
RECORD_RENT = ("capRateActual", "rentAnnualActual")
# Los dos grupos gateados, y los dos gatean una afirmación de propiedad.
MARK = ("unrealizedGain", "unrealizedGainPct", "roi")
EXIT = ("realizedGain", "realizedGainPct", "realizedRoi")


def _get(client, property_id: int) -> dict:
    r = client.get(f"/api/properties/{property_id}")
    assert r.status_code == 200, r.text
    return r.json()


def _advance(client, property_id: int, **body) -> dict:
    r = client.post(f"/api/properties/{property_id}/transition", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _all_none(prop: dict, keys) -> bool:
    return all(prop[k] is None for k in keys)


def _all_present(prop: dict, keys) -> bool:
    return all(prop[k] is not None for k in keys)


# ── Projection ───────────────────────────────────────────────────────────────

def test_prospecto_projects_and_has_realized_nothing(client, test_property):
    p = _get(client, test_property["id"])
    assert _all_present(p, RECORD)
    assert _all_none(p, MARK + EXIT)
    assert p["holdMonthsActual"] is None   # nothing is being held yet


def test_projection_matches_the_underwriting_engine(client, test_property):
    """The API's projection is finance.underwriting of the same inputs — the
    parity oracle that keeps the two from drifting."""
    p = _get(client, test_property["id"])
    inputs = {
        "purchase_price": 1_000_000, "acquisition_cost_pct": 0.065, "permits_cost": 50_000,
        "subdivision_cost": 25_000, "sqm_construction": 200,
        # Los 2,340,000 que el presupuesto sembró con la calculadora del alta:
        # 200 m² × 9,000 × 1.3, overhead ya adentro.
        "construction_budgeted": 2_340_000,
        "projected_sale": 2_500_000, "hold_months": 18, "rent_monthly_projected": 18_000,
        "sqm_land": 300,
    }
    expected = underwriting.metrics(inputs)
    assert Decimal(str(p["constructionBudgeted"])) == Decimal("2340000")
    for camel, snake in [
        ("totalInvestment", "total_investment"), ("acquisitionCosts", "acquisition_costs"),
        ("acquisitionTotal", "acquisition_total"), ("projectedProfit", "profit"),
        ("projectedRoi", "roi"), ("projectedRoiTotal", "roi_total"), ("capRate", "cap_rate"),
        ("purchasePricePerSqm", "purchase_price_per_sqm"), ("salePerSqm", "sale_per_sqm"),
        ("investmentPerSqm", "investment_per_sqm"), ("rentAnnual", "rent_annual"),
    ]:
        assert Decimal(str(p[camel])) == expected[snake], camel


def test_no_modeled_sale_means_no_projected_gain(client, test_property):
    """0 means "no modeled sale" everywhere in this domain. It must not print as
    a -100% loss, and the gain must be absent rather than negative."""
    with get_db() as conn:
        conn.execute("UPDATE properties SET projected_sale = 0 WHERE id = %s",
                     (test_property["id"],))
    p = _get(client, test_property["id"])
    assert p["projectedProfit"] is None
    assert p["projectedRoi"] is None
    assert p["projectedRoiTotal"] is None


def test_rent_absent_means_no_yield_never_zero(client, test_property):
    client.post(f"/api/properties/{test_property['id']}/clear-fields",
                json={"fields": ["rentMonthlyProjected"]})
    p = _get(client, test_property["id"])
    assert p["rentMonthlyProjected"] is None
    assert p["capRate"] is None
    assert p["rentAnnual"] is None


# ── Investment basis ─────────────────────────────────────────────────────────

def test_the_investment_is_always_the_breakdown(client, test_property):
    """Una sola resolución, así que el contrato no publica de dónde salió: no hay
    otro lugar del que pudiera salir."""
    p = _get(client, test_property["id"])
    assert Decimal(str(p["totalInvestment"])) == Decimal("3480000")
    assert "investmentBasis" not in p


def test_clearing_one_cost_subtracts_it_instead_of_breaking_the_basis(client, test_property):
    """Antes, vaciar uno de los cinco costos tumbaba el «desglose completo» y la
    base se caía al total tecleado (o a None). Ahora el componente ausente vale
    0 y la inversión es lo que queda: 3,480,000 − 50,000 de permisos."""
    client.post(f"/api/properties/{test_property['id']}/clear-fields",
                json={"fields": ["permitsCost"]})
    p = _get(client, test_property["id"])
    assert Decimal(str(p["totalInvestment"])) == Decimal("3430000")
    # …y toda cifra que divide entre la base la sigue, en vez de reportar un
    # total de una fuente y un por-m² de otra. 3,430,000 / 300 m² = 11,433.33.
    assert Decimal(str(p["investmentPerSqm"])) == Decimal("11433.33")


def test_an_all_in_total_is_captured_as_a_purchase_price(client, test_property):
    """La capacidad que reemplaza a la inversión tecleada: un total all-in se
    captura como precio de compra con el pct de adquisición en 0, y la base da
    ese total al peso. El 0 es lo que impide que el 6.5% por omisión le sume
    $617,500 a un número que ya venía completo."""
    client.patch(f"/api/properties/{test_property['id']}",
                 json={"purchasePrice": 9_500_000, "acquisitionCostPct": 0,
                       "permitsCost": 0, "subdivisionCost": 0, "sqmConstruction": 0})
    # La obra ya no se apaga tecleando un $/m² en 0: se apaga dejando el
    # presupuesto en 0, que es donde vive el costo de obra.
    client.put(f"/api/properties/{test_property['id']}/budget/total", json={"amount": 0})
    p = _get(client, test_property["id"])
    assert Decimal(str(p["totalInvestment"])) == Decimal("9500000")
    assert p["assumptions"]["acquisitionCostPct"]["source"] == "captured"


def test_an_empty_cost_stack_is_no_basis_at_all(client, test_property):
    """Cero no es una inversión de cero pesos: es que nadie capturó nada, y la
    ficha lo tiene que seguir pintando como «—»."""
    client.patch(f"/api/properties/{test_property['id']}",
                 json={"purchasePrice": 0, "permitsCost": 0, "subdivisionCost": 0,
                       "sqmConstruction": 0})
    client.put(f"/api/properties/{test_property['id']}/budget/total", json={"amount": 0})
    p = _get(client, test_property["id"])
    assert p["totalInvestment"] is None
    assert p["projectedProfit"] is None
    assert p["investmentPerSqm"] is None


# ── Realized ─────────────────────────────────────────────────────────────────

def test_desarrollo_marks_the_valuation_against_the_money_in(client, desarrollo_property):
    p = _get(client, desarrollo_property["id"])
    assert _all_present(p, RECORD)     # the model is still live
    assert _all_present(p, MARK)
    assert _all_none(p, EXIT)
    # 4,000,000 valuation over the 3,480,000 breakdown total
    assert Decimal(str(p["unrealizedGain"])) == Decimal("520000")
    assert Decimal(str(p["unrealizedGainPct"])) == Decimal("0.1494")
    assert p["holdMonthsActual"] > 0


def test_the_mark_is_annualized_against_its_own_valuation_date(client, desarrollo_property):
    """Compra 2025-01, valuación 2026-01: doce meses exactos, así que el ROI
    anualizado ES el total (+14.94%) y no una fracción de él.

    El plazo real sigue corriendo — hoy son más de doce meses — y esa es
    justamente la diferencia: antes el numerador era de enero y el denominador
    llegaba a hoy, así que la cifra bajaba sola cada mes sin que nadie tocara un
    dato. Ahora numerador y reloj cierran el mismo día, como el ROI realizado ya
    cerraba ambos en la fecha de venta."""
    p = _get(client, desarrollo_property["id"])
    assert Decimal(str(p["roi"])) == Decimal("0.1494")
    assert Decimal(str(p["unrealizedGainPct"])) == Decimal("0.1494")
    assert p["holdMonthsActual"] > 12


def test_an_undated_valuation_is_taken_at_its_word_and_says_so(client, desarrollo_property):
    """Sin fecha de corte no hay contra qué congelar: una valuación sin fecha
    afirma ser de hoy, se le toma la palabra, y la propiedad carga la advertencia
    de que le falta. El ROI cambia porque el periodo cambia — que es exactamente
    la prueba de que el periodo lo pone la fecha de la valuación."""
    client.post(f"/api/properties/{desarrollo_property['id']}/clear-fields",
                json={"fields": ["valuationDate"]})
    p = _get(client, desarrollo_property["id"])
    assert Decimal(str(p["roi"])) != Decimal("0.1494")
    assert any(i["field"] == "valuationDate" and "fecha de corte" in i["message"]
               for i in p["issues"])


def test_unrealized_gain_pct_is_none_not_zero_when_uncomputable(client, desarrollo_property):
    """The doctrine that gives this its own test: 0 reads as "broke even", which
    is a claim. Absence has to look like absence."""
    with get_db() as conn:
        conn.execute(
            "UPDATE properties SET purchase_price = NULL, permits_cost = NULL,"
            " subdivision_cost = NULL, sqm_construction = NULL WHERE id = %s",
            (desarrollo_property["id"],))
    client.put(f"/api/properties/{desarrollo_property['id']}/budget/total", json={"amount": 0})
    p = _get(client, desarrollo_property["id"])
    assert p["totalInvestment"] is None
    assert p["unrealizedGainPct"] is None
    assert p["unrealizedGain"] is None


def test_en_renta_keeps_projecting_and_marking(client, desarrollo_property):
    p = _advance(client, desarrollo_property["id"], to="en_renta",
                 firstRentDate="2026-03", rentMonthlyActual=20000, currentValuation=4_200_000)
    assert _all_present(p, RECORD)
    assert _all_present(p, MARK + RECORD_RENT)
    assert _all_none(p, EXIT)
    # La proyección sigue contestando por la renta estimada (18,000/mes)…
    assert Decimal(str(p["capRate"])) == Decimal("0.0621")   # 216,000 / 3,480,000
    # …y el realizado por la cobrada (20,000/mes), sin que una pise a la otra.
    assert Decimal(str(p["rentMonthlyProjected"])) == Decimal("18000")
    assert Decimal(str(p["capRateActual"])) == Decimal("0.069")  # 240,000 / 3,480,000


# ── Exit ─────────────────────────────────────────────────────────────────────

def test_vendida_reports_its_exit_and_stops_marking(client, desarrollo_property):
    """A sold property is a terminal fact, not a live mark: the valuation it was
    carried at stops being reported. Lo que NO se apaga es el plan (el test que
    sigue) — apagarlo era apagar la mitad de cada pareja."""
    p = _advance(client, desarrollo_property["id"], to="vendida",
                 saleDate="2026-07", salePrice=5_000_000)
    assert _all_none(p, MARK)
    assert _all_present(p, EXIT)
    # 5,000,000 out over 3,480,000 in
    assert Decimal(str(p["realizedGain"])) == Decimal("1520000")
    assert Decimal(str(p["realizedGainPct"])) == Decimal("0.4368")


def test_the_projection_survives_the_sale_so_the_pair_can_be_read(client, desarrollo_property):
    """El par plan-vs-resultado es lo que el modelo promete, y solo sirve si se
    puede leer completo. La proyección se apagaba al vender — es decir, en el
    momento exacto en que se volvía comprobable — y con ella se iba la única
    forma de contestar «¿le atinamos?».

    Se proyectaron 2,500,000 sobre una base de 3,480,000 y se vendió en
    5,000,000: el plan perdía 980,000 y la venta ganó 1,520,000. Los dos números
    tienen que estar en la misma respuesta."""
    p = _advance(client, desarrollo_property["id"], to="vendida",
                 saleDate="2026-07", salePrice=5_000_000)
    assert _all_present(p, RECORD)
    assert Decimal(str(p["projectedProfit"])) == Decimal("-980000")
    assert Decimal(str(p["projectedRoiTotal"])) == Decimal("-0.2816")
    assert Decimal(str(p["realizedGain"])) == Decimal("1520000")


def test_the_breakdown_of_a_sold_property_adds_up_to_its_own_total(client, desarrollo_property):
    """Las cinco barras del DESGLOSE son claves del expediente, y al apagarse en
    la venta la ficha pintaba un desglose cuyas partes visibles sumaban 70% de su
    propio total. Un desglose que esconde el 30% del capital es peor que ninguno.

    1,000,000 de compra + 65,000 de costos de adquisición + 50,000 de permisos +
    25,000 de subdivisión + 2,340,000 de obra = 3,480,000."""
    p = _advance(client, desarrollo_property["id"], to="vendida",
                 saleDate="2026-07", salePrice=5_000_000)
    bars = ["purchasePrice", "acquisitionCosts", "permitsCost", "subdivisionCost",
            "constructionBudgeted"]
    assert sum(Decimal(str(p[k])) for k in bars) == Decimal(str(p["totalInvestment"]))
    assert Decimal(str(p["totalInvestment"])) == Decimal("3480000")


def test_the_exit_hold_stops_at_the_sale(client, desarrollo_property):
    """acquisition 2025-01 → sale 2026-07 is 18 months, and stays 18 months
    however long ago that was: a closed deal's clock does not keep running."""
    p = _advance(client, desarrollo_property["id"], to="vendida",
                 saleDate="2026-07", salePrice=5_000_000)
    assert p["holdMonthsActual"] == 18
    expected = underwriting.gain_pct(Decimal("3480000"), Decimal("5000000"))
    assert Decimal(str(p["realizedGainPct"])) == expected


def test_the_capital_base_survives_the_sale(client, desarrollo_property):
    """It is the denominator of every realized figure — blanking it with the
    projection would leave realizedRoi unexplainable."""
    p = _advance(client, desarrollo_property["id"], to="vendida",
                 saleDate="2026-07", salePrice=5_000_000)
    assert Decimal(str(p["totalInvestment"])) == Decimal("3480000")


def test_an_archived_prospect_keeps_the_projection_it_was_archived_with(client, test_property):
    """Archivar saca la propiedad del inventario activo; no le cambia un dato.
    Sin ventana de métricas, `archivada` era la única etapa que no contestaba
    nada — y se archiva precisamente para poder volver a mirarla.

    Lo que sí muere es el score: una propiedad archivada dejó de competir."""
    before = _get(client, test_property["id"])
    p = _advance(client, test_property["id"], to="archivada")
    assert _all_present(p, RECORD)
    assert p["projectedRoi"] == before["projectedRoi"]
    assert p["totalInvestment"] == before["totalInvestment"]
    # No compró nada y nadie la valuó: la marca sigue vacía por falta de datos,
    # no por falta de ventana. Y nunca hubo venta que reportar.
    assert _all_none(p, MARK + EXIT)
    assert p["score"] is None


def test_an_archived_development_keeps_the_mark_it_was_archived_with(client, desarrollo_property):
    """La marca es de quien es dueño, y archivar no vende: la propiedad sigue
    siendo suya y su última valuación sigue siendo su última valuación."""
    before = _get(client, desarrollo_property["id"])
    p = _advance(client, desarrollo_property["id"], to="archivada")
    assert _all_present(p, RECORD + MARK)
    assert p["unrealizedGain"] == before["unrealizedGain"]
    assert p["roi"] == before["roi"]
    assert _all_none(p, EXIT)


# ── Score ────────────────────────────────────────────────────────────────────

def test_score_exists_only_before_the_purchase(client, test_property):
    assert _get(client, test_property["id"])["score"] is not None
    p = _advance(client, test_property["id"], to="oferta")
    assert p["score"] is not None
    p = _advance(client, test_property["id"], to="desarrollo", acquisitionDate="2025-01",
                 totalUnits=4, currentValuation=4_000_000)
    assert p["score"] is None


def test_score_is_a_percentile_over_the_pre_purchase_cohort(client, test_property):
    """Alone in the cohort a property ties with itself on every weight, which is
    the 50th percentile — not 0 and not 100."""
    with get_db() as conn:
        conn.execute("DELETE FROM property_status_events WHERE property_id IN"
                     " (SELECT id FROM properties WHERE status IN ('prospecto','oferta')"
                     "  AND id <> %s)", (test_property["id"],))
        conn.execute("DELETE FROM properties WHERE status IN ('prospecto', 'oferta')"
                     " AND id <> %s", (test_property["id"],))
    assert _get(client, test_property["id"])["score"] == 50


def test_the_listing_and_the_detail_agree_on_the_score(client, test_property):
    listed = next(p for p in client.get("/api/properties").json()
                  if p["id"] == test_property["id"])
    assert listed["score"] == _get(client, test_property["id"])["score"]


# ── Lo que la Fase A vino a arreglar ─────────────────────────────────────────

def test_a_captured_purchase_price_is_not_inflated(client):
    """El precio de un anuncio es el precio de COMPRA del inmueble completo. Una
    propiedad dada de alta con ese precio y sin obra a ejecutar vale ese precio
    más sus costos de adquisición, y nada más: lo ya construido no se vuelve a
    cobrar. Antes el modelo le sumaba los m² construidos del anuncio."""
    r = client.post("/api/properties", json={
        "name": "[TEST] Casa Construida", "address": "Calle Cuatro 4", "city": "Monterrey",
        "purchasePrice": 4_000_000, "sqmLand": 200,
    })
    assert r.status_code == 201, r.text
    p = r.json()
    try:
        assert Decimal(str(p["totalInvestment"])) == Decimal("4260000")   # 4,000,000 × 1.065
        assert Decimal(str(p["constructionBudgeted"])) == Decimal("0")
        assert Decimal(str(p["acquisitionCosts"])) == Decimal("260000")
    finally:
        client.delete(f"/api/properties/{p['id']}")


def test_the_real_rent_does_not_overwrite_the_estimated_one(client, desarrollo_property):
    """El par que el modelo promete: se proyectaron 18,000 y se cobran 25,000.
    Antes la transición pisaba la estimación con lo cobrado y la comparación
    dejaba de existir en el momento exacto en que empezaba a valer algo."""
    p = _advance(client, desarrollo_property["id"], to="en_renta",
                 firstRentDate="2026-03", rentMonthlyActual=25_000)
    assert Decimal(str(p["rentMonthlyProjected"])) == Decimal("18000")
    assert Decimal(str(p["rentMonthlyActual"])) == Decimal("25000")
    assert Decimal(str(p["rentAnnual"])) == Decimal("216000")        # lo proyectado
    assert Decimal(str(p["rentAnnualActual"])) == Decimal("300000")  # lo cobrado


def test_an_assumption_says_whether_anybody_chose_it(client, test_property):
    """El plazo del fixture está capturado, y los costos de adquisición también.
    Vaciar uno lo devuelve al supuesto del modelo — mismo número que antes tenía
    escondido, ahora con su origen a la vista."""
    p = _get(client, test_property["id"])
    assert p["assumptions"]["acquisitionCostPct"] == {"value": 0.065, "source": "captured"}

    client.post(f"/api/properties/{test_property['id']}/clear-fields",
                json={"fields": ["acquisitionCostPct"]})
    p = _get(client, test_property["id"])
    assert p["assumptions"]["acquisitionCostPct"] == {"value": 0.065, "source": "default"}
    # El supuesto sigue moviendo dinero, que es justamente por lo que hay que verlo.
    assert Decimal(str(p["totalInvestment"])) == Decimal("3480000")


def test_a_new_property_assumes_nothing_it_can_be_asked_about(client):
    """Recién capturada, una propiedad no ha elegido supuestos: los tres salen
    como del modelo. Su inversión ya resuelve del desglose desde el minuto uno —
    2,000,000 × 1.065 por el 6.5% supuesto — porque los otros cuatro costos
    nacen en 0 y un componente ausente vale 0."""
    r = client.post("/api/properties", json={
        "name": "[TEST] Recién Capturada", "address": "Calle Cinco 5", "city": "Monterrey",
        "purchasePrice": 2_000_000,
    })
    p = r.json()
    try:
        assert {k: v["source"] for k, v in p["assumptions"].items()} == {
            "acquisitionCostPct": "default",
            "holdMonths": "default",
        }
        assert Decimal(str(p["totalInvestment"])) == Decimal("2130000")
    finally:
        client.delete(f"/api/properties/{p['id']}")
