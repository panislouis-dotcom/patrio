import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from scraper.base import SignalRaw


@pytest.fixture(autouse=True)
def bypass_auth():
    from api.main import app
    from api.auth import get_current_user
    app.dependency_overrides[get_current_user] = lambda: {"id": 1, "email": "test@test.com"}
    yield
    app.dependency_overrides.clear()


# ── Scraper unit tests (mocked HTTP) ──────────────────────────────────────────

def test_lamudi_scraper_returns_signals():
    cards_html = """
    <html><body>
      <div class="snippet js-snippet">
        <a href="/detalle/123">link</a>
        <h3>Terreno en Venta en San Pedro</h3>
        <span class="snippet__content__price">$ 2,500,000 MXN</span>
      </div>
      <div class="snippet js-snippet">
        <a href="/detalle/456">link</a>
        <h3>Lote en Monterrey</h3>
        <span class="snippet__content__price">$ 1,800,000 MXN</span>
      </div>
    </body></html>
    """
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = cards_html
    with patch("httpx.get", return_value=mock_response):
        from scraper import lamudi
        signals = lamudi.scrape()
    assert len(signals) == 2
    assert signals[0].portal == "lamudi"
    assert "San Pedro" in signals[0].title
    assert signals[0].price == 2500000.0


def test_lamudi_scraper_handles_http_error():
    mock_response = MagicMock()
    mock_response.status_code = 403
    with patch("httpx.get", return_value=mock_response):
        from scraper import lamudi
        signals = lamudi.scrape()
    assert signals == []


def test_lamudi_scraper_handles_empty_page():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = "<html><body></body></html>"
    with patch("httpx.get", return_value=mock_response):
        from scraper import lamudi
        signals = lamudi.scrape()
    assert signals == []


def test_lamudi_scraper_handles_missing_price():
    cards_html = """
    <html><body>
      <div class="snippet js-snippet">
        <a href="/detalle/789">link</a>
        <h3>Terreno sin precio</h3>
      </div>
    </body></html>
    """
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = cards_html
    with patch("httpx.get", return_value=mock_response):
        from scraper import lamudi
        signals = lamudi.scrape()
    assert len(signals) == 1
    assert signals[0].price == 0.0


# ── /api/sonar/run — SSE stream ───────────────────────────────────────────────

def _make_client():
    from api.main import app
    return TestClient(app, raise_server_exceptions=False)


def _all_scrapers_empty():
    return (
        patch("api.routes.sonar.lamudi.scrape", return_value=[]),
        patch("api.routes.sonar.icasas.scrape", return_value=[]),
        patch("api.routes.sonar.doorvel.scrape", return_value=[]),
        patch("api.routes.sonar.inmuebles24.scrape", return_value=[]),
        patch("api.routes.sonar.mercadolibre.scrape", return_value=[]),
        patch("api.routes.sonar.vivanuncios.scrape", return_value=[]),
    )


def test_sonar_run_streams_events():
    """SSE stream includes start and complete events even with no signals."""
    import json
    p1, p2, p3, p4, p5, p6 = _all_scrapers_empty()
    with p1, p2, p3, p4, p5, p6:
        r = _make_client().post("/api/sonar/run")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")

    events = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
    types = [e["type"] for e in events]
    assert "start" in types
    assert "complete" in types

    complete = next(e for e in events if e["type"] == "complete")
    assert complete["found"] == 0
    assert "signals" in complete


def test_sonar_run_includes_valid_signals():
    """Signals passing validation appear in the complete event."""
    import json
    sig = SignalRaw(portal="lamudi", url="https://lamudi.com.mx/test-1",
                    title="Terreno Test", city="Monterrey", price=1_500_000)
    p1, p2, p3, p4, p5, p6 = _all_scrapers_empty()
    with p1, p2, p3, p4, p5, p6:
        with patch("api.routes.sonar.lamudi.scrape", return_value=[sig]):
            r = _make_client().post("/api/sonar/run")

    events = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
    complete = next(e for e in events if e["type"] == "complete")
    assert complete["found"] == 1
    assert complete["signals"][0]["url"] == sig.url


def test_sonar_run_drops_low_price_signals():
    """Signals with 0 < price < 100k are discarded."""
    import json
    bad = SignalRaw(portal="lamudi", url="https://lamudi.com.mx/bad",
                    title="Bad listing", city="Monterrey", price=5_000)
    p1, p2, p3, p4, p5, p6 = _all_scrapers_empty()
    with p1, p2, p3, p4, p5, p6:
        with patch("api.routes.sonar.lamudi.scrape", return_value=[bad]):
            r = _make_client().post("/api/sonar/run")

    events = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
    complete = next(e for e in events if e["type"] == "complete")
    assert complete["found"] == 0
    assert complete["skipped"] == 1


# ── /api/sonar/import ─────────────────────────────────────────────────────────

def test_sonar_import_creates_prospect():
    mock_prospect = {"id": 42, "name": "Terreno Test", "status": "evaluating"}
    with patch("api.routes.sonar.create_prospect", return_value=mock_prospect):
        r = _make_client().post("/api/sonar/import", json={
            "url":      "https://lamudi.com.mx/test-1",
            "title":    "Terreno Test",
            "address":  "Col. San Pedro",
            "city":     "Monterrey",
            "price":    1_500_000,
            "sqmLand":  300.0,
            "portal":   "lamudi",
        })
    assert r.status_code == 201
    data = r.json()
    assert data["prospect"]["id"] == 42
    assert data["prospect"]["status"] == "evaluating"
