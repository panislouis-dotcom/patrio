"""Integration tests for /api/documents.

Two questions, in this order: does the right data reach the PDF, partitioned by
the right rule, and does each stage get presented with the figures it can
actually sostener — una vendida por su resultado realizado, una en renta por su
marca, una en desarrollo por su proyección."""
from unittest import mock

import pytest

from api.db import get_db, get_team_members
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


def _capture(client, path: str, body: dict | None = None) -> str:
    """The HTML the endpoint actually handed to the renderer — the only way to
    test what the *router* decided (partition, order, subject)."""
    seen = {}

    async def _render(html: str) -> bytes:
        seen["html"] = html
        return b"%PDF-stub"

    with mock.patch("api.routes.documents.render_to_pdf", new=_render):
        r = client.post(path, json=body)
    assert r.status_code == 200, r.text
    return seen["html"]


def _capture_favorites(client, *properties) -> str:
    """El prospecto que sale del endpoint con esas propiedades marcadas — la
    partición y el orden los decide el router, no el test."""
    for prop in properties:
        r = client.patch(f"/api/properties/{prop['id']}", json={"isFavorite": True})
        assert r.status_code == 200, r.text
    return _capture(client, "/api/documents/prospectus")


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


@pytest.fixture
def test_team():
    """Dos roles de liderazgo — insertados fuera de jerarquía, para que el orden
    del documento no pueda salir del id — más un ayudante que no debe aparecer."""
    members = [
        ("[TEST] Yierba Cantú", "lider_proyecto", "Coordina la cuadrilla en obra."),
        ("[TEST] Eduardo de la Garza", "director", "Cierra la obra a tiempo y en presupuesto."),
        ("[TEST] Juan Ayudante", "ayudante", "Apoyo en campo."),
    ]
    with get_db() as conn:
        ids = [conn.execute(
            "INSERT INTO team_members (name, role, notes) VALUES (%s, %s, %s) RETURNING id",
            m).fetchone()["id"] for m in members]
    yield ids
    with get_db() as conn:
        conn.execute("DELETE FROM team_members WHERE id = ANY(%s)", (ids,))


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
    assert _metric("$3.5M", "Inversión total") in html
    assert _metric("$2.5M", "Venta proyectada") in html
    assert "Valuación" not in html


def test_a_sold_property_reports_its_realized_result(client, sold_property):
    """Un activo vendido no se presume con la última marca: se presume con lo
    que se vendió, con la ganancia que dejó y con el plazo que tomó."""
    html = build_prospectus_html([sold_property], [], [], [])
    assert "Track Record · 01 · Resultado final" in html
    assert "Vendida · jul 2026" in html
    assert _metric("$3.5M", "Inversión total") in html
    assert _metric("$5.0M", "Precio de venta") in html
    # 5,000,000 - 3,480,000 = 1,520,000 sobre 3,480,000 = 43.7%
    assert _metric('$1.5M <small>43.7%</small>', "Ganancia realizada") in html
    # (5,000,000/3,480,000)^(12/18) - 1, de 2025-01 a 2026-07
    assert _metric("27.3%", "ROI real anual") in html
    assert _metric("18 meses", "Plazo real") in html


def test_a_sold_property_shows_no_projection_and_no_live_mark(client, sold_property):
    html = build_prospectus_html([sold_property], [], [], [])
    for label in ("Valuación actual", "ROI anual", "Ganancia no realizada %",
                  "Cap rate real s/ inversión", "Venta proyectada",
                  "ROI proy. anual", "Ganancia proyectada %",
                  "Cap rate proy. s/ inversión"):
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
    assert _metric("$6.0M", "Valuación · ene 2026") in html
    # (6,000,000 - 3,480,000) / 3,480,000
    assert _metric("72.4%", "Ganancia no realizada %") in html
    # 360,000 de renta anual sobre 3,480,000 invertidos
    assert _metric("10.3%", "Cap rate real s/ inversión") in html
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
    assert _metric("$3.5M", "Inversión total") in html


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
    # 216,000 de renta anual sobre 3,480,000 invertidos = 6.2%
    html = build_prospectus_html([], [], [], [get_property(test_property["id"])])
    assert _metric("6.2%", "Cap rate proy. s/ inversión") in html


def test_a_property_that_will_not_rent_has_no_cap_rate(client, test_property):
    client.post(f"/api/properties/{test_property['id']}/clear-fields",
                json={"fields": ["rentMonthlyProjected"]})
    p = get_property(test_property["id"])
    assert p["capRate"] is None
    assert _metric("—", "Cap rate proy. s/ inversión") in build_prospectus_html([], [], [], [p])


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
    como coleta, y su plazo real va como métrica.)"""
    html = build_prospectus_html([], [rented_property], [], [])
    assert f"Plazo real {rented_property['holdMonthsActual']} meses" in html
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
    assert _cover_item("10.3%", "Cap rate promedio")  in html  # 360,000 / 3,480,000


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

def test_team_is_rendered_from_the_database(client, desarrollo_property, test_team):
    _rented(client, desarrollo_property["id"], 30000, 6_000_000)
    html = _capture_favorites(client, desarrollo_property)
    assert "[TEST] Eduardo de la Garza" in html
    assert "Cierra la obra a tiempo y en presupuesto." in html
    assert '<div class="partner-role">Director</div>' in html


def test_team_shows_only_leadership(client, desarrollo_property, test_team):
    """El prospecto es un documento de inversionistas: van los responsables del
    proyecto, no la cuadrilla."""
    rented = _rented(client, desarrollo_property["id"], 30000, 6_000_000)
    html = build_prospectus_html([], [rented], [], [], team=get_team_members())
    assert "[TEST] Juan Ayudante" not in html
    assert "Ayudante" not in html
    assert "[TEST] Eduardo de la Garza" in html
    assert "[TEST] Yierba Cantú" in html


def test_team_is_ordered_by_hierarchy_not_by_id(client, desarrollo_property, test_team):
    """El líder se insertó primero; el director va antes en el documento."""
    rented = _rented(client, desarrollo_property["id"], 30000, 6_000_000)
    html = build_prospectus_html([], [rented], [], [], team=get_team_members())
    assert html.index("[TEST] Eduardo de la Garza") < html.index("[TEST] Yierba Cantú")


def test_team_block_is_omitted_without_members(client, desarrollo_property):
    rented = _rented(client, desarrollo_property["id"], 30000, 6_000_000)
    assert '<div class="partners' not in build_prospectus_html([], [rented], [], [], team=[])
