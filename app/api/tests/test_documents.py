"""Integration tests for /api/documents routes. This endpoint has no auth."""
from unittest import mock

import pytest

from api.db import get_db, get_project, get_prospect, get_team_members
from api.lib.prospectus_html import build_prospectus_html


def _operating(project_id: int, rent_monthly, valuation=6000000) -> dict:
    """Renting project whose valuation differs from its investment, so a cap rate
    off the valuation (the PDF's old private formula) reads differently from one
    off the investment (the API's)."""
    with get_db() as conn:
        conn.execute(
            "UPDATE projects SET status='operating', rent_monthly=%s, current_valuation=%s"
            " WHERE id=%s", (rent_monthly, valuation, project_id))
    return get_project(project_id)


def _metric(value: str, label: str) -> str:
    return f'<div class="v">{value}</div><div class="l">{label}</div>'


def _cover_item(value: str, label: str) -> str:
    return f'<div class="vp-v">{value}</div><div class="vp-l">{label}</div>'


def _kv_row(label: str, value: str) -> str:
    return f'<td>{label}</td><td class="n">{value}</td>'


def _cap_rate_metric(value: str, label: str = "Cap rate") -> str:
    return _metric(value, label)


@pytest.fixture
def other_project(client):
    """A second project, so the cover averages can be tested over more than one."""
    r = client.post("/api/projects", json={
        "name": "[TEST] Segundo Edificio",
        "type": "ground_up",
        "address": "Av. Test 200, Monterrey",
        "city": "Monterrey",
        "status": "construction",
        "totalUnits": 6,
        "acquisitionDate": "2025-01",
        "conclusionDate": "2026-06",
        "totalInvestment": 4000000,
        "currentValuation": 4000000,
        "valuationDate": "2026-01",
    })
    assert r.status_code == 201
    project = r.json()
    yield project
    with get_db() as conn:
        conn.execute("DELETE FROM profit_split_config WHERE project_id = %s", (project["id"],))
        conn.execute("DELETE FROM projects WHERE id = %s", (project["id"],))


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


def test_prospectus_no_favorites_400(client):
    r = client.post("/api/documents/prospectus")
    assert r.status_code == 400


def test_prospectus_generates_pdf(client, test_prospect):
    client.patch(f"/api/prospects/{test_prospect['id']}", json={"isFavorite": True})
    with mock.patch(
        "api.routes.documents.render_to_pdf",
        new_callable=mock.AsyncMock,
        return_value=b"%PDF-stub",
    ):
        r = client.post("/api/documents/prospectus")
    assert r.status_code == 200
    assert "application/pdf" in r.headers["content-type"]


def test_term_sheet_no_evaluating_400(client):
    r = client.post("/api/documents/term-sheet", json={
        "investor_name": "Jaime Gutierrez",
        "investment_amount": 500000,
    })
    assert r.status_code == 400


def test_term_sheet_generates_pdf(client, test_prospect):
    with mock.patch(
        "api.routes.documents.render_to_pdf",
        new_callable=mock.AsyncMock,
        return_value=b"%PDF-stub",
    ):
        r = client.post("/api/documents/term-sheet", json={
            "investor_name": "Jaime Gutierrez",
            "investment_amount": 500000,
        })
    assert r.status_code == 200
    assert "application/pdf" in r.headers["content-type"]


def test_term_sheet_by_prospect_id(client, test_prospect):
    with mock.patch(
        "api.routes.documents.render_to_pdf",
        new_callable=mock.AsyncMock,
        return_value=b"%PDF-stub",
    ):
        r = client.post("/api/documents/term-sheet", json={
            "investor_name": "Jaime Gutierrez",
            "investment_amount": 500000,
            "prospect_id": test_prospect["id"],
        })
    assert r.status_code == 200
    assert "application/pdf" in r.headers["content-type"]


def test_term_sheet_invalid_prospect_id_400(client):
    r = client.post("/api/documents/term-sheet", json={
        "investor_name": "Jaime Gutierrez",
        "investment_amount": 500000,
        "prospect_id": 999999,
    })
    assert r.status_code == 400


def test_prospectus_prints_the_api_cap_rate(test_project):
    """The ficha prints what the API computed — no hardcoded rents in the PDF layer."""
    # 30,000*12 over the fixture's stored 5,000,000 investment = 7.2%
    project = _operating(test_project["id"], 30000)
    assert _cap_rate_metric("7.2%") in build_prospectus_html([project], [])


def test_prospectus_cap_rate_is_a_dash_without_rent(test_project):
    project = _operating(test_project["id"], None)
    assert project["capRate"] is None
    assert _cap_rate_metric("—") in build_prospectus_html([project], [])


def test_development_project_prints_projected_cap_rate(test_project):
    """A pre-obra project with rent shows its yield labeled as projected —
    same API formula, honest label (behavior merged from main's ece7a73)."""
    with get_db() as conn:
        conn.execute(
            "UPDATE projects SET status='en_proceso', rent_monthly=30000 WHERE id=%s",
            (test_project["id"],))
    project = get_project(test_project["id"])
    html = build_prospectus_html([project], [])
    assert _cap_rate_metric("7.2%", "Cap rate proy.") in html


def test_opportunity_prints_the_prospect_cap_rate(test_prospect):
    with get_db() as conn:
        conn.execute(
            """UPDATE prospects SET land_price=1000000, acquisition_cost_pct=0.065,
                   permits_cost=50000, subdivision_cost=25000, sqm_construction=200,
                   construction_cost_per_sqm=9000, construction_overhead=1.3,
                   rent_monthly=18000 WHERE id=%s""", (test_prospect["id"],))
    # 216,000 rent over 3,480,000 invested = 6.21%
    assert _cap_rate_metric("6.2%") in build_prospectus_html([], [get_prospect(test_prospect["id"])])


def test_opportunity_cap_rate_is_a_dash_without_rent(test_prospect):
    """A prospect that will not rent has no cap rate — the card must not print 0.0%."""
    with get_db() as conn:
        conn.execute("UPDATE prospects SET land_price=1000000, rent_monthly=0 WHERE id=%s",
                     (test_prospect["id"],))
    prospect = get_prospect(test_prospect["id"])
    assert prospect["capRate"] is None
    assert _cap_rate_metric("—") in build_prospectus_html([], [prospect])


# ── Portada: cada cifra sale de los proyectos operando ───────────────────────

def test_cover_sums_the_operating_units(test_project, other_project):
    """Unidades en renta = suma real de unidades operando (4 + 6), no un 23 fijo."""
    a = _operating(test_project["id"], 30000)
    b = _operating(other_project["id"], 20000, valuation=5000000)
    html = build_prospectus_html([a, b], [])
    assert _cover_item("10", "Unidades en renta") in html


def test_cover_averages_the_api_roi_and_cap_rate(test_project, other_project):
    """Promedio simple del ROI anualizado y del cap rate que ya calculó el API.
    ROI: 13.7% (5M→6M) y 17.1% (4M→5M) en 17 meses → 15.4%.
    Cap rate: 360,000/5M = 7.2% y 240,000/4M = 6.0% → 6.6%."""
    a = _operating(test_project["id"], 30000)
    b = _operating(other_project["id"], 20000, valuation=5000000)
    assert (float(a["roi"]), float(b["roi"])) == (0.1373, 0.1706)
    html = build_prospectus_html([a, b], [])
    assert _cover_item("15.4%", "ROI promedio") in html
    assert _cover_item("6.6%", "Cap rate promedio") in html
    assert "anualizado, sobre inversión" in html


def test_cover_is_dashes_without_operating_projects(test_project):
    """Sin nada operando no hay unidades, ROI ni cap rate que presumir."""
    html = build_prospectus_html([get_project(test_project["id"])], [])
    assert _cover_item("—", "Unidades en renta") in html
    assert _cover_item("—", "ROI promedio") in html
    assert _cover_item("—", "Cap rate promedio") in html


# ── Fichas ───────────────────────────────────────────────────────────────────

def test_operating_card_prints_the_api_roi_and_plusvalia(test_project):
    """ROI anual = CAGR del API (5M→6M en 17 meses = 13.7%); plusvalía = 20%.
    La valuación lleva su fecha de corte (valuationDate 2026-01)."""
    project = _operating(test_project["id"], 30000)
    html = build_prospectus_html([project], [])
    assert _metric("13.7%", "ROI anual") in html
    assert _metric("20.0%", "Plusvalía") in html
    assert _metric("$6.0M", "Valuación · ene 2026") in html


def test_valuation_label_drops_the_date_when_it_is_unusable(test_project):
    """valuation_date es texto libre: si no se puede leer como YYYY-MM la ficha
    se queda con la etiqueta simple, sin un '·' colgando ni una fecha inventada."""
    _operating(test_project["id"], 30000)
    with get_db() as conn:
        conn.execute("UPDATE projects SET valuation_date='sin fecha' WHERE id=%s",
                     (test_project["id"],))
    html = build_prospectus_html([get_project(test_project["id"])], [])
    assert _metric("$6.0M", "Valuación actual") in html
    assert "Valuación ·" not in html


def test_development_card_never_reads_the_stored_valuation(test_project):
    """Un proyecto en obra nace con valuación = costo. Esa igualdad no es un
    avalúo: la ficha proyectada no la toca y sin underwriting muestra '—'."""
    project = get_project(test_project["id"])
    assert project["currentValuation"] == project["totalInvestment"]
    assert project["unrealizedGainPct"] == 0
    html = build_prospectus_html([project], [])
    assert _metric("—", "ROI anual proy.") in html
    assert _metric("—", "Plusvalía proy.") in html
    assert _metric("—", "Venta proyectada") in html  # projected_sale NULL, no "$0"
    assert "Valuación" not in html
    assert "0.0%" not in html


def test_development_card_prints_the_underwriting_projection(test_project):
    """Con underwriting capturado la ficha proyectada cita la venta modelada:
    inversión 3,480,000 → venta 6,000,000 en 18 meses = 43.8% anual / 72.4% total."""
    with get_db() as conn:
        conn.execute(
            """UPDATE projects SET land_price=1000000, acquisition_cost_pct=0.065,
                   permits_cost=50000, subdivision_cost=25000, sqm_construction=200,
                   construction_cost_per_sqm=9000, construction_overhead=1.3,
                   projected_sale=6000000, hold_months=18, current_valuation=3480000
               WHERE id=%s""", (test_project["id"],))
    project = get_project(test_project["id"])
    assert float(project["totalInvestment"]) == 3480000
    html = build_prospectus_html([project], [])
    assert _metric("$3.5M", "Inversión total") in html
    assert _metric("$6.0M", "Venta proyectada") in html
    assert _metric("43.8%", "ROI anual proy.") in html
    assert _metric("72.4%", "Plusvalía proy.") in html
    assert "0.0%" not in html  # la plusvalía valuación/costo (0%) no se imprime


def test_sold_projects_are_not_shown_as_development(test_project):
    """'exited' es un negocio cerrado, no una obra en curso."""
    with get_db() as conn:
        conn.execute("UPDATE projects SET status='exited' WHERE id=%s", (test_project["id"],))
    html = build_prospectus_html([get_project(test_project["id"])], [])
    assert "En Desarrollo" not in html
    assert "[TEST] Edificio Prueba" not in html


# ── Oportunidad ──────────────────────────────────────────────────────────────

def _underwrite(prospect_id: int, projected_sale) -> dict:
    with get_db() as conn:
        conn.execute(
            """UPDATE prospects SET land_price=1000000, acquisition_cost_pct=0.065,
                   permits_cost=50000, subdivision_cost=25000, sqm_construction=200,
                   construction_cost_per_sqm=9000, construction_overhead=1.3,
                   projected_sale=%s, hold_months=18 WHERE id=%s""",
            (projected_sale, prospect_id))
    return get_prospect(prospect_id)


def test_opportunity_gain_comes_from_the_api_roi_total(test_prospect):
    """La ganancia estimada y el renglón 'ROI proyectado' son el mismo número
    del API: (6,000,000 - 3,480,000) / 3,480,000 = 72.4%."""
    prospect = _underwrite(test_prospect["id"], 6000000)
    assert float(prospect["roiTotal"]) == 0.7241
    html = build_prospectus_html([], [prospect])
    assert _metric('$2.5M <small>72.4%</small>', "Ganancia est.") in html
    assert _kv_row("ROI proyectado", "72.4%") in html


def test_opportunity_financials_reconcile_with_the_total_investment(test_prospect):
    """Los tres renglones de costo suman exactamente la Inversión total de la
    tarjeta: propiedad 1,000,000 + adquisición 65,000 (1,000,000 × 6.5%) +
    desarrollo 2,415,000 = 3,480,000. El desarrollo es obra (2,340,000) +
    permisos (50,000) + subdivisión (25,000)."""
    prospect = _underwrite(test_prospect["id"], 6000000)
    components = (prospect["landPrice"], prospect["acquisitionCosts"],
                  prospect["totalInvestment"] - prospect["acquisitionTotal"])
    assert [float(c) for c in components] == [1000000, 65000, 2415000]
    assert sum(components) == prospect["totalInvestment"] == 3480000
    assert float(prospect["constructionTotal"]) + 50000 + 25000 == 2415000

    html = build_prospectus_html([], [prospect])
    assert _kv_row("Precio propiedad", "$1,000,000") in html
    assert _kv_row("Costos de adquisición", "$65,000") in html
    assert _kv_row("Inversión desarrollo", "$2,415,000") in html
    assert _metric("$3.5M", "Inversión total") in html  # el total que deben cuadrar
    assert "Precio terreno / m²" not in html
    assert "Venta / m²" not in html


def test_opportunity_hides_the_new_rows_when_there_is_nothing_to_show(test_prospect):
    """Sin precio de propiedad ni obra capturados los renglones desaparecen, no
    se imprimen en cero."""
    html = build_prospectus_html([], [get_prospect(test_prospect["id"])])
    assert "Precio propiedad" not in html
    assert "Costos de adquisición" not in html
    assert "Inversión desarrollo" not in html


def test_opportunity_without_a_modeled_sale_has_no_estimated_gain(test_prospect):
    """Un prospecto sólo de renta no tiene venta modelada: sin ROI total no hay
    ganancia estimada — antes se imprimía un -100% inventado."""
    prospect = _underwrite(test_prospect["id"], 0)
    assert prospect["roiTotal"] is None
    assert float(prospect["projectedSale"]) == 0  # la columna es NOT NULL
    html = build_prospectus_html([], [prospect])
    assert _metric("—", "Ganancia est.") in html
    assert _metric("—", "Venta proyectada") in html  # 0 = sin venta, no un precio
    assert "$0" not in html
    assert "-100" not in html
    assert "ROI proyectado" not in html


# ── Equipo ───────────────────────────────────────────────────────────────────

def test_team_is_rendered_from_the_database(client, test_project, test_team):
    """El bloque de socios sale de team_members — nombre completo, rol y nota."""
    _operating(test_project["id"], 30000)
    client.patch(f"/api/projects/{test_project['id']}", json={"isFavorite": True})

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


def test_team_shows_only_leadership(test_project, test_team):
    """El prospecto es un documento de inversionistas: van los responsables del
    proyecto, no la cuadrilla."""
    project = _operating(test_project["id"], 30000)
    html = build_prospectus_html([project], [], team=get_team_members())
    assert "[TEST] Juan Ayudante" not in html
    assert "Ayudante" not in html
    assert "[TEST] Eduardo de la Garza" in html
    assert "[TEST] Yierba Cantú" in html


def test_team_is_ordered_by_hierarchy_not_by_id(test_project, test_team):
    """El líder se insertó primero; el director va antes en el documento."""
    project = _operating(test_project["id"], 30000)
    html = build_prospectus_html([project], [], team=get_team_members())
    assert html.index("[TEST] Eduardo de la Garza") < html.index("[TEST] Yierba Cantú")
    assert html.index('<div class="partner-role">Director</div>') < html.index(
        '<div class="partner-role">Líder de Proyecto</div>')


def test_team_block_is_omitted_without_members(test_project):
    """Sin equipo capturado no se inventan socios."""
    project = _operating(test_project["id"], 30000)
    html = build_prospectus_html([project], [], team=[])
    assert '<div class="partners' not in html
