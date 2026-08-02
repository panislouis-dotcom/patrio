"""Integration tests for /api/documents.

Fase 2 keeps this at "the data reaching the PDF is the right data, partitioned
by the right rule" — the presentation pass is Fase 4."""
from unittest import mock

import pytest

from api.db import get_db, get_team_members
from api.lib.prospectus_html import build_prospectus_html
from api.properties_db import get_property


def _metric(value: str, label: str) -> str:
    return f'<div class="v">{value}</div><div class="l">{label}</div>'


def _cover_item(value: str, label: str) -> str:
    return f'<div class="vp-v">{value}</div><div class="vp-l">{label}</div>'


def _kv_row(label: str, value: str) -> str:
    return f'<td>{label}</td><td class="n">{value}</td>'


def _rented(client, property_id: int, rent_monthly, valuation) -> dict:
    """Take a property all the way to en_renta — the state the track record is
    made of."""
    r = client.post(f"/api/properties/{property_id}/transition", json={
        "to": "en_renta", "firstRentDate": "2026-03",
        "rentMonthly": rent_monthly, "currentValuation": valuation})
    assert r.status_code == 200, r.text
    return r.json()


def _sold(client, property_id: int, sale_price) -> dict:
    r = client.post(f"/api/properties/{property_id}/transition", json={
        "to": "vendida", "saleDate": "2026-07", "salePrice": sale_price})
    assert r.status_code == 200, r.text
    return r.json()


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

def test_the_track_record_is_what_rents_or_sold(client, desarrollo_property):
    rented = _rented(client, desarrollo_property["id"], 30000, 6_000_000)
    html = build_prospectus_html([rented], [], [])
    assert "Track Record · 01" in html
    assert "En Desarrollo" not in html


def test_a_property_under_construction_shows_only_its_projection(client, desarrollo_property):
    """Pre-obra la valuación puede ser el costo mismo; la ficha proyectada no la
    toca, porque esa igualdad no es un avalúo que alguien haya hecho."""
    html = build_prospectus_html([], [get_property(desarrollo_property["id"])], [])
    assert "En Desarrollo · 01" in html
    assert _metric("$3.5M", "Inversión total") in html
    assert _metric("$2.5M", "Venta proyectada") in html
    assert "Valuación" not in html


def test_a_sold_property_reports_its_realized_result(client, desarrollo_property):
    """Un activo vendido no se presume con la última marca: se presume con lo
    que se vendió, y con el ROI que eso significó."""
    sold = _sold(client, desarrollo_property["id"], 5_000_000)
    html = build_prospectus_html([sold], [], [])
    assert _metric("$5.0M", "Venta · jul 2026") in html
    assert _metric("43.7%", "Plusvalía") in html   # (5,000,000-3,480,000)/3,480,000


def test_the_opportunity_card_prints_the_projection(client, test_property):
    """Los tres renglones de costo suman exactamente la Inversión total:
    propiedad 1,000,000 + adquisición 65,000 + desarrollo 2,415,000 = 3,480,000."""
    p = get_property(test_property["id"])
    html = build_prospectus_html([], [], [p])
    assert _kv_row("Precio propiedad", "$1,000,000") in html
    assert _kv_row("Costos de adquisición", "$65,000") in html
    assert _kv_row("Inversión desarrollo", "$2,415,000") in html
    assert _metric("$3.5M", "Inversión total") in html


def test_an_opportunity_without_a_modeled_sale_has_no_estimated_gain(client, test_property):
    """Sin venta modelada no hay ganancia estimada — antes se imprimía un -100%
    inventado."""
    client.post(f"/api/properties/{test_property['id']}/clear-fields",
                json={"fields": ["projectedSale"]})
    p = get_property(test_property["id"])
    assert p["projectedRoiTotal"] is None
    html = build_prospectus_html([], [], [p])
    assert _metric("—", "Ganancia est.") in html
    assert _metric("—", "Venta proyectada") in html
    assert "-100" not in html


def test_the_opportunity_cap_rate_comes_from_the_api(client, test_property):
    # 216,000 de renta anual sobre 3,480,000 invertidos = 6.2%
    html = build_prospectus_html([], [], [get_property(test_property["id"])])
    assert _metric("6.2%", "Cap rate") in html


def test_a_property_that_will_not_rent_has_no_cap_rate(client, test_property):
    client.post(f"/api/properties/{test_property['id']}/clear-fields",
                json={"fields": ["rentMonthly"]})
    p = get_property(test_property["id"])
    assert p["capRate"] is None
    assert _metric("—", "Cap rate") in build_prospectus_html([], [], [p])


# ── Portada ──────────────────────────────────────────────────────────────────

def test_the_cover_counts_and_averages_the_track_record(client, desarrollo_property):
    """Unidades, ROI y cap rate salen de lo que ya opera — nada fijo."""
    rented = _rented(client, desarrollo_property["id"], 30000, 6_000_000)
    html = build_prospectus_html([rented], [], [])
    assert _cover_item("4", "Unidades en renta") in html
    assert _cover_item("10.3%", "Cap rate promedio") in html  # 360,000 / 3,480,000


def test_the_cover_is_dashes_without_a_track_record(client, desarrollo_property):
    html = build_prospectus_html([], [get_property(desarrollo_property["id"])], [])
    assert _cover_item("—", "Unidades en renta") in html
    assert _cover_item("—", "ROI promedio") in html
    assert _cover_item("—", "Cap rate promedio") in html


# ── Equipo ───────────────────────────────────────────────────────────────────

def test_team_is_rendered_from_the_database(client, desarrollo_property, test_team):
    _rented(client, desarrollo_property["id"], 30000, 6_000_000)
    client.patch(f"/api/properties/{desarrollo_property['id']}", json={"isFavorite": True})

    captured = {}

    async def _capture(html: str) -> bytes:
        captured["html"] = html
        return b"%PDF-stub"

    with mock.patch("api.routes.documents.render_to_pdf", new=_capture):
        r = client.post("/api/documents/prospectus")
    assert r.status_code == 200
    assert "[TEST] Eduardo de la Garza" in captured["html"]
    assert "Cierra la obra a tiempo y en presupuesto." in captured["html"]
    assert '<div class="partner-role">Director</div>' in captured["html"]


def test_team_shows_only_leadership(client, desarrollo_property, test_team):
    """El prospecto es un documento de inversionistas: van los responsables del
    proyecto, no la cuadrilla."""
    rented = _rented(client, desarrollo_property["id"], 30000, 6_000_000)
    html = build_prospectus_html([rented], [], [], team=get_team_members())
    assert "[TEST] Juan Ayudante" not in html
    assert "Ayudante" not in html
    assert "[TEST] Eduardo de la Garza" in html
    assert "[TEST] Yierba Cantú" in html


def test_team_is_ordered_by_hierarchy_not_by_id(client, desarrollo_property, test_team):
    """El líder se insertó primero; el director va antes en el documento."""
    rented = _rented(client, desarrollo_property["id"], 30000, 6_000_000)
    html = build_prospectus_html([rented], [], [], team=get_team_members())
    assert html.index("[TEST] Eduardo de la Garza") < html.index("[TEST] Yierba Cantú")


def test_team_block_is_omitted_without_members(client, desarrollo_property):
    rented = _rented(client, desarrollo_property["id"], 30000, 6_000_000)
    assert '<div class="partners' not in build_prospectus_html([rented], [], [], team=[])
