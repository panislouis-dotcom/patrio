"""Integration tests for /api/documents.

Two questions, in this order: does the right data reach the PDF, partitioned by
the right rule, and does each stage get presented with the figures it can
actually sostener — una vendida por su resultado realizado, una en renta por su
marca, una en desarrollo por su proyección."""
from unittest import mock

import pytest

from api.db import get_db
from api.lib.prospectus_html import build_prospectus_html
from api.properties_db import get_property


def _metric(value: str, label: str) -> str:
    return f'<div class="v">{value}</div><div class="l">{label}</div>'


def _metric_label(label: str) -> str:
    """Just the label of a card metric — the cover uses its own class, so this
    only matches inside a property card or the portfolio summary."""
    return f'<div class="l">{label}</div>'


def _cover_item(value: str, label: str) -> str:
    return f'<div class="vp-v">{value}</div><div class="vp-l">{label}</div>'


def _kv_row(label: str, value: str) -> str:
    return f'<td>{label}</td><td class="n">{value}</td>'


def _rented(client, property_id: int, rent_monthly_actual, valuation) -> dict:
    """Take a property all the way to en_renta — half of what the track record
    is made of."""
    r = client.post(f"/api/properties/{property_id}/transition", json={
        "to": "en_renta", "firstRentDate": "2026-03",
        "rentMonthlyActual": rent_monthly_actual, "currentValuation": valuation})
    assert r.status_code == 200, r.text
    return r.json()


def _sold(client, property_id: int, sale_price) -> dict:
    r = client.post(f"/api/properties/{property_id}/transition", json={
        "to": "vendida", "saleDate": "2026-07", "salePrice": sale_price})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(autouse=True)
def no_browser_for_planos():
    """Ningún test de este archivo dibuja planos de verdad.

    El endpoint llama a `plano_js.render_plan_sheets`, que lanza un Chromium real y
    carga el bundle de `make build-plano`. Falsearlo aquí, para TODOS los tests del
    archivo, es deliberado: si no, cada prospecto de esta suite arrancaría un
    navegador —lento— y dependería del estado del build.

    `test_plano_js.py` es el único que carga el bundle real en un navegador real. La
    división es a propósito: si aquél también falseara, un bundle roto pasaría todo
    en verde y nadie se enteraría hasta el PDF de un cliente."""
    async def _no_sheets(geometries: dict) -> dict:
        return {}

    with mock.patch("api.routes.documents.plano_js.render_plan_sheets", new=_no_sheets):
        yield


def _capture(client, path: str, body: dict | None = None, *,
             plan_sheets: dict | None = None,
             geometries_seen: dict | None = None) -> str:
    """The HTML the endpoint actually handed to the renderer — the only way to
    test what the *router* decided (partition, order, subject).

    `plan_sheets` inyecta las hojas que el navegador falso devuelve, por id de
    propiedad; `geometries_seen`, si se pasa, recibe el dict de geometrías que el
    router le entregó — que es la única forma de probar A QUIÉN le pidió planos."""
    seen = {}

    async def _render(html: str) -> bytes:
        seen["html"] = html
        return b"%PDF-stub"

    async def _sheets(geometries: dict) -> dict:
        if geometries_seen is not None:
            geometries_seen.update(geometries)
        return plan_sheets or {}

    with mock.patch("api.routes.documents.render_to_pdf", new=_render), \
            mock.patch("api.routes.documents.plano_js.render_plan_sheets", new=_sheets):
        r = client.post(path, json=body)
    assert r.status_code == 200, r.text
    return seen["html"]


def _capture_favorites(client, *properties, **kwargs) -> str:
    """El prospecto que sale del endpoint con esas propiedades marcadas — la
    partición y el orden los decide el router, no el test."""
    for prop in properties:
        r = client.patch(f"/api/properties/{prop['id']}", json={"isFavorite": True})
        assert r.status_code == 200, r.text
    return _capture(client, "/api/documents/prospectus", **kwargs)


@pytest.fixture
def make_property(client):
    """Los casos de orden, portada y pool necesitan más de una propiedad, cada
    una con sus propios números. Base de inversión limpia de 1,000,000: sin
    costos de adquisición ni obra, para que cada cifra esperada se lea de la
    entrada sin intermediarios."""
    created: list[int] = []

    def _make(**fields) -> dict:
        r = client.post("/api/properties", json={
            "name": "[TEST] Otra Propiedad", "address": "Calle Dos 2", "city": "Monterrey",
            "purchasePrice": 1_000_000, "acquisitionCostPct": 0.0, "permitsCost": 0,
            "subdivisionCost": 0, "sqmLand": 300, "sqmConstruction": 0,
            "holdMonths": 12, "projectedSale": 2_000_000, **fields})
        assert r.status_code == 201, r.text
        created.append(r.json()["id"])
        return r.json()

    yield _make
    # El presupuesto sembrado va primero: su FK a properties es RESTRICT, no
    # CASCADE, porque es donde puede vivir captura manual.
    with get_db() as conn:
        for property_id in created:
            conn.execute("DELETE FROM budgets WHERE property_id = %s", (property_id,))
            conn.execute("DELETE FROM properties WHERE id = %s", (property_id,))


@pytest.fixture
def sold_property(client, desarrollo_property):
    """3,480,000 invertidos, vendida en 5,000,000 a 18 meses de la adquisición."""
    return _sold(client, desarrollo_property["id"], 5_000_000)


@pytest.fixture
def rented_property(client, make_property):
    """1,000,000 invertidos, 2 unidades, marcada en 3,000,000 y rentada en
    10,000 al mes."""
    prop = make_property(name="[TEST] Casa Rentada")
    for body in (
        {"to": "oferta"},
        {"to": "desarrollo", "acquisitionDate": "2025-01", "totalUnits": 2,
         "currentValuation": 2_000_000, "valuationDate": "2026-01"},
    ):
        r = client.post(f"/api/properties/{prop['id']}/transition", json=body)
        assert r.status_code == 200, r.text
    return _rented(client, prop["id"], 10_000, 3_000_000)


# ── Endpoints ────────────────────────────────────────────────────────────────

def test_prospectus_no_favorites_400(client):
    assert client.post("/api/documents/prospectus").status_code == 400


def test_prospectus_generates_pdf(client, test_property):
    client.patch(f"/api/properties/{test_property['id']}", json={"isFavorite": True})
    with mock.patch("api.routes.documents.render_to_pdf",
                    new_callable=mock.AsyncMock, return_value=b"%PDF-stub"):
        r = client.post("/api/documents/prospectus")
    assert r.status_code == 200
    assert "application/pdf" in r.headers["content-type"]


def test_term_sheet_needs_a_property_in_oferta(client, test_property):
    """The pool is `oferta`: a term sheet is raised against a deal the firm is
    actually bidding on."""
    r = client.post("/api/documents/term-sheet", json={
        "investor_name": "Jaime Gutierrez", "investment_amount": 500000})
    assert r.status_code == 400

    client.post(f"/api/properties/{test_property['id']}/transition", json={"to": "oferta"})
    with mock.patch("api.routes.documents.render_to_pdf",
                    new_callable=mock.AsyncMock, return_value=b"%PDF-stub"):
        r = client.post("/api/documents/term-sheet", json={
            "investor_name": "Jaime Gutierrez", "investment_amount": 500000})
    assert r.status_code == 200
    assert "application/pdf" in r.headers["content-type"]


def test_the_term_sheet_picks_the_best_offer(client, make_property):
    """Dentro del pool gana el mayor ROI proyectado; fuera del pool nadie
    compite. El prospecto tiene el mejor ROI de los tres (400% contra 100%) y
    aun así no sale: no es un trato al que la firma se haya comprometido."""
    lead = make_property(name="[TEST] Prospecto Brillante", projectedSale=5_000_000)
    weak = make_property(name="[TEST] Oferta Floja", projectedSale=1_100_000)
    strong = make_property(name="[TEST] Oferta Fuerte", projectedSale=2_000_000)
    for prop in (weak, strong):
        r = client.post(f"/api/properties/{prop['id']}/transition", json={"to": "oferta"})
        assert r.status_code == 200, r.text
    assert get_property(lead["id"])["projectedRoi"] > get_property(strong["id"])["projectedRoi"]

    html = _capture(client, "/api/documents/term-sheet", {
        "investor_name": "Jaime Gutierrez", "investment_amount": 500000})
    assert "[TEST] Oferta Fuerte" in html
    assert "[TEST] Oferta Floja" not in html
    assert "[TEST] Prospecto Brillante" not in html


def test_the_term_sheet_refuses_a_property_without_a_term(client, test_property):
    """Sin plazo capturado los tres escenarios de rendimiento serían inventados:
    antes se imprimían 12 meses que nadie modeló."""
    r = client.post(f"/api/properties/{test_property['id']}/clear-fields",
                    json={"fields": ["holdMonths"]})
    assert r.status_code == 200, r.text
    r = client.post("/api/documents/term-sheet", json={
        "investor_name": "Jaime Gutierrez", "investment_amount": 500000,
        "property_id": test_property["id"]})
    assert r.status_code == 400


def test_term_sheet_by_property_id(client, test_property):
    with mock.patch("api.routes.documents.render_to_pdf",
                    new_callable=mock.AsyncMock, return_value=b"%PDF-stub"):
        r = client.post("/api/documents/term-sheet", json={
            "investor_name": "Jaime Gutierrez", "investment_amount": 500000,
            "property_id": test_property["id"]})
    assert r.status_code == 200


def test_term_sheet_invalid_property_id_400(client):
    r = client.post("/api/documents/term-sheet", json={
        "investor_name": "Jaime Gutierrez", "investment_amount": 500000,
        "property_id": 999999})
    assert r.status_code == 400


# ── Partition by status ──────────────────────────────────────────────────────

def test_the_track_record_is_what_rents_or_sold(client, sold_property, rented_property):
    html = _capture_favorites(client, sold_property, rented_property)
    assert "Track Record · 01 · Resultado final" in html
    assert "Track Record · 02 · En renta" in html
    assert "En Desarrollo" not in html


def test_the_track_record_opens_with_what_it_closed(client, sold_property, rented_property):
    """Una venta cerrada va antes que una marca, aunque la marca presuma más:
    la rentada trae 200% de ganancia no realizada contra 43.7% de la vendida."""
    assert rented_property["unrealizedGainPct"] > sold_property["realizedGainPct"]
    html = build_prospectus_html([sold_property], [rented_property], [], [])
    assert html.index("[TEST] Lote Prueba") < html.index("[TEST] Casa Rentada")


def test_the_offer_leads_the_opportunity_section(client, test_property, make_property):
    """La oferta es el trato al que la firma ya se comprometió: encabeza aunque
    el prospecto se haya capturado antes (y las favoritas llegan por id)."""
    offer = make_property(name="[TEST] Oferta Firme")
    r = client.post(f"/api/properties/{offer['id']}/transition", json={"to": "oferta"})
    assert r.status_code == 200, r.text
    html = _capture_favorites(client, test_property, offer)
    assert html.index("[TEST] Oferta Firme") < html.index("[TEST] Lote Prueba")


def test_a_property_under_construction_shows_only_its_projection(client, desarrollo_property):
    """Pre-obra la valuación puede ser el costo mismo; la ficha proyectada no la
    toca, porque esa igualdad no es un avalúo que alguien haya hecho."""
    html = build_prospectus_html([], [], [get_property(desarrollo_property["id"])], [])
    assert "En Desarrollo · 01" in html
    # Los dos escenarios de salida se calculan siempre, sin exit_strategy
    # capturado: venta 5% de 2,500,000 proyectada + terreno/obra, renta 3
    # meses de 18,000 proyectada + terreno/obra.
    assert _metric('$3.5M <small>V $4.0M · R $3.9M c/comisiones</small>', "Inversión sin comisiones") in html
    assert _metric("$2.5M", "Venta proyectada") in html
    assert "Valuación" not in html


def test_a_property_under_construction_shows_the_projected_hold_not_the_real_one(
        client, desarrollo_property):
    """Sin primera renta ni venta, holdMonthsActual cae a adquisición → hoy, que
    no dice nada del proyecto — solo cuánto hace que se compró. La coleta usa el
    plazo proyectado del underwriting en su lugar, como las demás cifras de esta
    tarjeta."""
    html = build_prospectus_html([], [], [get_property(desarrollo_property["id"])], [])
    assert "Plazo proyectado 18 meses" in html
    assert "Plazo real" not in html


def test_a_sold_property_reports_its_realized_result(client, sold_property):
    """Un activo vendido no se presume con la última marca: se presume con lo
    que se vendió, con la ganancia que dejó y con el plazo que tomó."""
    html = build_prospectus_html([sold_property], [], [], [])
    assert "Track Record · 01 · Resultado final" in html
    assert "Vendida · jul 2026" in html
    # Venta usa el precio de venta REAL (5,000,000), no la proyección: 5% de
    # 5,000,000 + terreno/obra. Solo venta aparece: renta es contrafactual —
    # esta propiedad nunca se rentó, aunque compute_fees() la calcule igual.
    assert _metric('$3.5M <small>V $4.1M c/comisiones</small>', "Inversión sin comisiones") in html
    assert "R $" not in html
    assert _metric("$5.0M", "Precio de venta") in html
    # 5,000,000 - 3,480,000 = 1,520,000 sobre 3,480,000 = 43.7%
    assert _metric('$1.5M <small>43.7%</small>', "Ganancia realizada") in html
    # (5,000,000/3,480,000)^(12/18) - 1, de 2025-01 a 2026-07
    assert _metric("27.3%", "ROI real anual") in html
    assert _metric("18 meses", "Plazo real") in html


def test_a_sold_property_shows_no_projection_and_no_live_mark(client, sold_property):
    html = build_prospectus_html([sold_property], [], [], [])
    for label in ("Valuación actual", "ROI anual", "Ganancia no realizada %",
                  "Venta proyectada", "ROI proy. anual", "Ganancia proyectada %",
                  "Cap rate proy. s/ venta"):
        assert _metric_label(label) not in html
    assert '<div class="l">Valuación · ' not in html
    # Ni con otro sufijo: ninguna tarjeta de una vendida lleva cap rate. (La
    # portada sí promedia uno, y usa su propia clase.)
    assert '<div class="l">Cap rate' not in html


def test_a_rented_property_reports_its_mark_with_the_valuation_date(client, desarrollo_property):
    """En renta sí hay marca viva, y va fechada: es una estimación con fecha de
    corte, no un hecho cerrado."""
    rented = _rented(client, desarrollo_property["id"], 30000, 6_000_000)
    html = build_prospectus_html([], [rented], [], [])
    assert "Track Record · 01 · En renta" in html
    # Solo renta aparece en la sub-línea de comisiones: venta es
    # contrafactual — esta propiedad nunca se vendió, aunque
    # compute_fees() la calcule igual con la venta proyectada
    # (2,500,000). Renta usa la renta REAL ya cobrada (30,000 x 3 meses +
    # terreno/obra = 3,971,000, que redondea igual que la venta a "$4.0M").
    # Este es el mismo bug que se corrigió en _sold_card(), en espejo.
    assert _metric('$3.5M <small>R $4.0M c/comisiones</small>', "Inversión sin comisiones") in html
    assert "V $" not in html
    assert _metric("$6.0M", "Valuación · ene 2026") in html
    # (6,000,000 - 3,480,000) / 3,480,000
    assert _metric("72.4%", "Ganancia no realizada %") in html
    # 360,000 de renta anual sobre 6,000,000 de valuación actual, no venta proyectada
    assert _metric("6.0%", "Cap rate") in html
    assert _metric_label("Precio de venta") not in html
    assert _metric_label("Ganancia realizada") not in html


def test_the_opportunity_card_prints_the_projection(client, test_property):
    """Los tres renglones de costo suman exactamente la Inversión total:
    propiedad 1,000,000 + adquisición 65,000 + desarrollo 2,415,000 = 3,480,000."""
    p = get_property(test_property["id"])
    html = build_prospectus_html([], [], [], [p])
    assert _kv_row("Precio de compra", "$1,000,000") in html
    assert _kv_row("Costos de adquisición", "$65,000") in html
    assert _kv_row("Obra, permisos y subdivisión", "$2,415,000") in html
    # "Inversión sin comisiones" ya no es una celda de esta fila — pedido
    # explícito, reemplazada por el plazo de recuperación: 4,006,000 de
    # inversión con comisiones de venta / 18,000 de renta mensual = 222.6,
    # redondeado a 223 meses.
    assert _metric("223 meses", "Plazo de recuperación") in html
    assert '<div class="l">Inversión sin comisiones</div>' not in html
    # Terreno: 1,000,000 x 5%. Obra: 2,340,000 (presupuesto, con overhead ya
    # aplicado una sola vez) x 15%.
    assert _metric('$50K <small>5.0%</small>', "Comisión compra terreno") in html
    assert _metric('$351K <small>15.0%</small>', "Comisión de obra") in html
    # La comisión de salida no venía desglosada en ningún lado — a diferencia
    # de terreno y obra, aquí sí sale su propio $ por escenario. Venta: precio
    # proyectado 2,500,000 x 5%. Renta: 18,000 x 3 meses.
    assert _metric('$125K <small>5.0%</small>', "Comisión de salida · venta") in html
    assert _metric('$54K <small>3 meses</small>', "Comisión de salida · renta") in html
    # Y los totales quedan tal cual estaban — cada uno en su propia celda, sin
    # fundirse en una sola: 3,480,000 + 401,000 (terreno+obra) + comisión de
    # salida de cada escenario.
    assert _metric('$4.0M', "Inversión c/comisiones · venta") in html
    assert _metric('$3.9M', "Inversión c/comisiones · renta") in html
    assert "metric-wide" not in html


def test_the_opportunity_detail_shows_a_chosen_render_next_to_its_photo(client, test_property):
    """Un render elegido (isChosen) se imprime junto a la foto de la que nació,
    rotulado como propuesta — nunca disfrazado de foto real."""
    p = get_property(test_property["id"])
    p["images"] = [{"id": 7, "dataUri": "data:image/jpeg;base64,FOTO"}]
    p["renderHeads"] = [{"sourceImageId": 7, "isChosen": True, "floorId": None,
                         "sourceVariant": None, "dataUri": "data:image/jpeg;base64,AAAA"}]
    html = build_prospectus_html([], [], [], [p])
    assert "Fotos y propuesta" in html
    assert "data:image/jpeg;base64,AAAA" in html


def test_a_render_without_a_star_does_not_print_anywhere(client, test_property):
    p = get_property(test_property["id"])
    p["images"] = [{"id": 7, "dataUri": "data:image/jpeg;base64,FOTO"}]
    p["renderHeads"] = [{"sourceImageId": 7, "isChosen": False, "floorId": None,
                         "sourceVariant": None, "dataUri": "data:image/jpeg;base64,AAAA"}]
    html = build_prospectus_html([], [], [], [p])
    assert "Fotos y propuesta" not in html
    assert "data:image/jpeg;base64,AAAA" not in html


def test_an_opportunity_without_a_modeled_sale_has_no_estimated_gain(client, test_property):
    """Sin venta modelada no hay ganancia estimada — antes se imprimía un -100%
    inventado."""
    client.post(f"/api/properties/{test_property['id']}/clear-fields",
                json={"fields": ["projectedSale"]})
    p = get_property(test_property["id"])
    assert p["projectedRoiTotal"] is None
    html = build_prospectus_html([], [], [], [p])
    assert _metric("—", "Ganancia proyectada") in html
    assert _metric("—", "Venta proyectada") in html
    assert "-100" not in html


def test_the_opportunity_cap_rate_comes_from_the_api(client, test_property):
    # 216,000 de renta anual sobre 2,500,000 de venta proyectada = 8.6%
    html = build_prospectus_html([], [], [], [get_property(test_property["id"])])
    assert _metric("8.6%", "Cap rate proy. s/ venta") in html


def test_a_property_that_will_not_rent_has_no_cap_rate(client, test_property):
    client.post(f"/api/properties/{test_property['id']}/clear-fields",
                json={"fields": ["rentMonthlyProjected"]})
    p = get_property(test_property["id"])
    assert p["capRate"] is None
    assert _metric("—", "Cap rate proy. s/ venta") in build_prospectus_html([], [], [], [p])


def test_the_document_translates_the_enums(client, make_property):
    """El prospecto lo lee un inversionista: 'Adaptive reuse' y 'Ground up' no
    son palabras de este negocio ni aparecen en ninguna otra pantalla. Y tipo de
    activo y estrategia son dos preguntas, así que salen las dos — antes una
    tapaba a la otra según la tarjeta."""
    prop = make_property(name="[TEST] Casa Reconvertida",
                         assetType="edificio", strategyType="adaptive_reuse")
    html = build_prospectus_html([], [], [], [get_property(prop["id"])])
    assert _kv_row("Tipo de activo", "Edificio") in html
    assert _kv_row("Estrategia", "Reconversión") in html
    for raw in ("adaptive_reuse", "Adaptive reuse", "Ground up", "Hold"):
        assert raw not in html


def test_the_card_subtitle_names_the_stretch_it_measures(client, rented_property):
    """`holdMonthsActual` se llama plazo real en la ficha y en la tabla; el
    documento no puede llamarlo «meses en cartera», que además sugiere que se
    cuentan desde otra cosa. (La tarjeta de una vendida usa el mes de la venta
    como coleta, y su plazo real va como métrica.)

    El número va literal y no leído del propio dict: adquirida en 2025-01 y
    rentada en 2026-03 son 14 meses, y así se queda. Contra la propia respuesta
    de la API la aserción pasaba dijera lo que dijera."""
    html = build_prospectus_html([], [rented_property], [], [])
    assert "Plazo real 14 meses" in html
    assert "en cartera" not in html


# ── Portada ──────────────────────────────────────────────────────────────────

def test_the_cover_counts_only_the_units_still_in_rent(client, sold_property, rented_property):
    """La vendida trae 4 unidades y la rentada 2. La portada dice "operando
    hoy": lo vendido dejó de operar para nosotros."""
    assert sold_property["totalUnits"] == 4 and rented_property["totalUnits"] == 2
    html = build_prospectus_html([sold_property], [rented_property], [], [])
    assert _cover_item("2", "Unidades en renta") in html


def test_the_cover_averages_the_cap_rate_of_what_it_rents(client, desarrollo_property):
    rented = _rented(client, desarrollo_property["id"], 30000, 6_000_000)
    html = build_prospectus_html([], [rented], [], [])
    assert _cover_item("6.0%", "Cap rate promedio")  in html  # 360,000 / 6,000,000 de valuación


def test_the_cover_roi_average_counts_what_was_sold(client, sold_property):
    """El ROI promedio es rendimiento entregado o marcado — el realizado de una
    vendida entra; el cap rate y las unidades, no (una vendida no renta)."""
    html = build_prospectus_html([sold_property], [], [], [])
    assert _cover_item("27.3%", "ROI promedio") in html
    assert _cover_item("—", "Unidades en renta") in html
    assert _cover_item("—", "Cap rate promedio") in html


def test_the_cover_is_dashes_without_a_track_record(client, desarrollo_property):
    html = build_prospectus_html([], [], [get_property(desarrollo_property["id"])], [])
    assert _cover_item("—", "Unidades en renta") in html
    assert _cover_item("—", "ROI promedio") in html
    assert _cover_item("—", "Cap rate promedio") in html


# ── Resumen de portafolio ────────────────────────────────────────────────────

def test_the_portfolio_summary_separates_sales_from_marks(client, sold_property, rented_property):
    """Capital 3,480,000 + 1,000,000 = 4,480,000. Ventas 5,000,000, marca
    3,000,000: ganancia 3,520,000 = 79%. Las dos cifras van en renglones
    distintos porque una ya se cobró y la otra es una estimación."""
    html = build_prospectus_html([sold_property], [rented_property], [], [])
    assert '<div class="kicker">Portafolio · vendidas y en renta</div>' in html
    assert _metric("2", "Propiedades") in html
    # Sin sub-línea de comisiones aquí: sumar "si todo se hubiera vendido" +
    # "si todo se hubiera rentado" en un track record mixto no es una cifra
    # real — ningún inversionista la pregunta, y mezclaría dinero realizado
    # con dinero hipotético en un solo número.
    assert _metric("$4.5M", "Capital invertido") in html
    assert _metric("$5.0M", "Ventas realizadas") in html
    assert _metric("$3.0M", "Valuación actual") in html
    assert _metric('$3.5M <small>79%</small>', "Ganancia del portafolio") in html


def test_the_portfolio_summary_names_only_the_stages_it_has(client, rented_property):
    html = build_prospectus_html([], [rented_property], [], [])
    assert '<div class="kicker">Portafolio · en renta</div>' in html
    assert _metric_label("Ventas realizadas") not in html
    assert "no un avalúo formal" in html


def test_the_portfolio_summary_calls_a_sale_realized(client, sold_property):
    html = build_prospectus_html([sold_property], [], [], [])
    assert '<div class="kicker">Portafolio · vendidas</div>' in html
    assert "precio de venta: resultado realizado" in html
    assert "no un avalúo formal" not in html


# ── Equipo ───────────────────────────────────────────────────────────────────

def test_the_prospectus_never_shows_a_team_block(client, desarrollo_property):
    """Pedido explícito: el prospecto de inversión no enseña quién trabaja en
    la firma. No hay bloque de equipo/socios que llenar — ni el nombre de la
    función ni el parámetro de team_members sobreviven en este archivo."""
    rented = _rented(client, desarrollo_property["id"], 30000, 6_000_000)
    html = build_prospectus_html([], [rented], [], [])
    assert '<div class="partners' not in html


# ── Empotrado de imágenes ────────────────────────────────────────────────────

def test_embed_image_list_sets_data_uri_from_storage(monkeypatch):
    from api.routes import documents

    monkeypatch.setattr(
        documents.storage, "stream",
        lambda path: (b"\x89PNG-fake-bytes", "image/png"))
    monkeypatch.setattr(
        documents, "_resize_for_pdf",
        lambda content, content_type: (content, content_type))

    images = [{"filePath": "renders/x.png"}]
    documents._embed_image_list(images)

    assert images[0]["dataUri"].startswith("data:image/png;base64,")


def test_embed_image_list_marks_failures_with_none_data_uri(monkeypatch):
    from api.routes import documents

    def _boom(path):
        raise FileNotFoundError(path)

    monkeypatch.setattr(documents.storage, "stream", _boom)
    images = [{"filePath": "renders/missing.png"}]
    documents._embed_image_list(images)
    assert images[0]["dataUri"] is None


# ── Página compañera de una oportunidad ──────────────────────────────────────

def test_prospectus_shows_the_budget_chapters_for_an_opportunity(client, test_property):
    client.post(f"/api/properties/{test_property['id']}/budget/lines", json={
        "chapterName": "Albañilería", "name": "Cocina", "unit": "m2",
        "quantity": 1, "unitPrice": 500_000,
    })
    p = get_property(test_property["id"])

    from api.routes.documents import _embed_opportunity_extras
    _embed_opportunity_extras([p])
    html = build_prospectus_html([], [], [], [p])
    assert "Albañilería" in html
    assert "$500,000" in html  # la partida nueva
    assert "Otros" in html     # el residual sigue ahí


def test_prospectus_has_no_companion_section_without_plano_or_budget_beyond_residual(client, test_property):
    """El presupuesto SIEMPRE trae al menos el residual, así que la sección
    compañera SIEMPRE aparece para una propiedad recién nacida — es
    información real (el estimado grueso), no un placeholder. Esta prueba
    documenta esa expectativa en vez de asumir lo contrario.

    Ya no es una página propia (ver test_opportunity_detail_flows_right_after_the_note_not_a_new_page
    en test_prospectus_html.py) — vive en el mismo flujo que `_opportunity`,
    justo después de la nota. Los renders NO son parte de esta sección —
    viven en `_opportunity`, vía `renderHeads`
    (ver test_the_opportunity_detail_shows_a_chosen_render_next_to_its_photo)."""
    p = get_property(test_property["id"])
    from api.routes.documents import _embed_opportunity_extras
    _embed_opportunity_extras([p])
    html = build_prospectus_html([], [], [], [p])
    assert '<div class="opp-detail">' in html
    assert "Otros" in html  # el residual, no un plano
    assert "<svg" not in html
    assert "Renders" not in html


def test_prospectus_endpoint_enriches_the_opportunities_it_draws(client, test_property):
    """El enriquecimiento corre DENTRO del endpoint, sobre la misma lista que se
    dibuja. Llamar a _embed_opportunity_extras a mano no prueba eso: si el router
    enriqueciera una lista y pasara otra, todo lo de arriba seguiría en verde."""
    r = client.post(f"/api/properties/{test_property['id']}/budget/lines", json={
        "chapterName": "Albañilería", "name": "Cocina", "unit": "m2",
        "quantity": 1, "unitPrice": 500_000,
    })
    assert r.status_code in (200, 201), r.text
    html = _capture_favorites(client, test_property)
    assert '<div class="opp-detail">' in html
    assert "Albañilería" in html


def test_el_prospecto_dibuja_el_plano_de_una_oportunidad(client, test_property):
    """Una oportunidad con levantamiento imprime su plano en el detalle."""
    html = _capture_favorites(client, test_property, plan_sheets={
        test_property["id"]: [{"floorId": "abc", "variant": "original",
                               "floorName": "Planta Baja", "svg": "<svg>PLANO</svg>"}],
    })
    assert "PLANO" in html
    # El elemento, no la regla: `.plan-row` vive en la hoja de estilo siempre.
    assert '<div class="plan-row">' in html
    assert "Planta Baja" in html


def test_solo_las_oportunidades_reciben_planos(client, make_property, rented_property):
    """El plano solo entra a las páginas de oportunidad: es lo único a lo que un
    inversionista todavía puede entrar. Una vendida/en renta no lo pide."""
    opportunity = make_property(name="[TEST] Oferta Con Plano")
    r = client.post(f"/api/properties/{opportunity['id']}/transition", json={"to": "oferta"})
    assert r.status_code == 200, r.text

    geometries: dict = {}
    _capture_favorites(client, opportunity, rented_property, geometries_seen=geometries)
    assert set(geometries) == {opportunity["id"]}


def test_una_oportunidad_sin_geometria_no_rompe_el_prospecto(client, test_property):
    """render_plan_sheets devolviendo {} —bundle ausente, Chromium caído— deja el
    deck entero intacto, sin plano. Un PDF no se muere porque un plano no dibujó."""
    html = _capture_favorites(client, test_property, plan_sheets={})
    assert '<div class="plan-row">' not in html
    assert "[TEST] Lote Prueba" in html
