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


# ── Scraper unit tests (mocked HTTP) ──────────────────────────────────────

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


# ── API endpoint tests (DB layer mocked) ──────────────────────────────────

def _make_client():
    from api.main import app
    return TestClient(app, raise_server_exceptions=False)


def _mock_signal(url="https://www.lamudi.com.mx/detalle/test-1"):
    return SignalRaw(portal="lamudi", url=url, title="Terreno Test", city="Monterrey", price=1500000)


def _all_scrapers_empty():
    """Context manager that mocks all 8 scrapers to return empty lists."""
    return (
        patch("api.routes.sonar.lamudi.scrape", return_value=[]),
        patch("api.routes.sonar.mitula.scrape", return_value=[]),
        patch("api.routes.sonar.icasas.scrape", return_value=[]),
        patch("api.routes.sonar.doorvel.scrape", return_value=[]),
        patch("api.routes.sonar.realtorcom.scrape", return_value=[]),
        patch("api.routes.sonar.inmuebles24.scrape", return_value=[]),
        patch("api.routes.sonar.mercadolibre.scrape", return_value=[]),
        patch("api.routes.sonar.vivanuncios.scrape", return_value=[]),
    )


def test_sonar_scan_returns_stats():
    p1, p2, p3, p4, p5, p6, p7, p8 = _all_scrapers_empty()
    with p1, p2, p3, p4, p5, p6, p7, p8, patch("api.routes.sonar.create_signal", return_value=None):
        r = _make_client().post("/api/sonar/scan")
    assert r.status_code == 200
    data = r.json()
    assert "scanned" in data
    assert "new" in data
    assert "portals" in data
    assert data["scanned"] == 8
    assert data["new"] == 0


def test_sonar_scan_counts_new_signals():
    sig = _mock_signal()
    mock_row = {"id": 1, "portal": "lamudi", "url": sig.url, "title": sig.title,
                "address": "", "city": "Monterrey", "price": 1500000, "sqm_land": 0,
                "raw_data": "", "status": "new", "prospect_id": None, "scraped_at": "2025-01-01"}
    with patch("api.routes.sonar.lamudi.scrape", return_value=[sig]), \
         patch("api.routes.sonar.mitula.scrape", return_value=[]), \
         patch("api.routes.sonar.icasas.scrape", return_value=[]), \
         patch("api.routes.sonar.doorvel.scrape", return_value=[]), \
         patch("api.routes.sonar.realtorcom.scrape", return_value=[]), \
         patch("api.routes.sonar.inmuebles24.scrape", return_value=[]), \
         patch("api.routes.sonar.mercadolibre.scrape", return_value=[]), \
         patch("api.routes.sonar.vivanuncios.scrape", return_value=[]), \
         patch("api.routes.sonar.create_signal", return_value=mock_row):
        r = _make_client().post("/api/sonar/scan")
    assert r.status_code == 200
    assert r.json()["new"] == 1


def test_sonar_scan_deduplicates():
    sig = _mock_signal()
    # Second insert returns None (duplicate URL constraint)
    with patch("api.routes.sonar.lamudi.scrape", return_value=[sig, sig]), \
         patch("api.routes.sonar.mitula.scrape", return_value=[]), \
         patch("api.routes.sonar.icasas.scrape", return_value=[]), \
         patch("api.routes.sonar.doorvel.scrape", return_value=[]), \
         patch("api.routes.sonar.realtorcom.scrape", return_value=[]), \
         patch("api.routes.sonar.inmuebles24.scrape", return_value=[]), \
         patch("api.routes.sonar.mercadolibre.scrape", return_value=[]), \
         patch("api.routes.sonar.vivanuncios.scrape", return_value=[]), \
         patch("api.routes.sonar.create_signal", side_effect=[{"id": 1, "status": "new"}, None]):
        r = _make_client().post("/api/sonar/scan")
    assert r.json()["new"] == 1


def test_get_signals_returns_list():
    with patch("api.routes.sonar.get_signals", return_value=[]):
        r = _make_client().get("/api/sonar/signals")
    assert r.status_code == 200
    assert r.json() == []


def test_dismiss_signal():
    mock_row = {"id": 5, "status": "dismissed"}
    with patch("api.routes.sonar.dismiss_signal", return_value=mock_row):
        r = _make_client().patch("/api/sonar/signals/5")
    assert r.status_code == 200
    assert r.json()["status"] == "dismissed"


def test_dismiss_missing_signal_returns_404():
    with patch("api.routes.sonar.dismiss_signal", return_value=None):
        r = _make_client().patch("/api/sonar/signals/99999")
    assert r.status_code == 404


def test_import_signal_creates_prospect():
    mock_signal = {"id": 3, "status": "imported", "url": "https://test.com"}
    mock_prospect = {"id": 1, "name": "Terreno Test"}
    with patch("api.routes.sonar.import_signal", return_value=(mock_signal, mock_prospect)):
        r = _make_client().post("/api/sonar/signals/3/import")
    assert r.status_code == 201
    data = r.json()
    assert data["signal"]["status"] == "imported"
    assert data["prospect"]["name"] == "Terreno Test"


def test_import_missing_signal_returns_404():
    with patch("api.routes.sonar.import_signal", return_value=(None, None)):
        r = _make_client().post("/api/sonar/signals/99999/import")
    assert r.status_code == 404
