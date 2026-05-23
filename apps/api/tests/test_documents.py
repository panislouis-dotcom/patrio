"""Integration tests for /api/documents routes. This endpoint has no auth."""
from unittest import mock


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
