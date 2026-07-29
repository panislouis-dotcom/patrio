"""Integration tests for /api/documents routes. This endpoint has no auth."""
from unittest import mock

from api.db import get_db, get_project, get_prospect
from api.lib.prospectus_html import build_prospectus_html


def _operating(project_id: int, rent_monthly) -> dict:
    """Renting project whose valuation differs from its investment, so a cap rate
    off the valuation (the PDF's old private formula) reads differently from one
    off the investment (the API's)."""
    with get_db() as conn:
        conn.execute(
            "UPDATE projects SET status='operating', rent_monthly=%s, current_valuation=6000000"
            " WHERE id=%s", (rent_monthly, project_id))
    return get_project(project_id)


def _cap_rate_metric(value: str, label: str = "Cap rate") -> str:
    return f'<div class="v">{value}</div><div class="l">{label}</div>'


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
