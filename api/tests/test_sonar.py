import sqlite3
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

SCHEMA_PATH = Path(__file__).parent.parent.parent / "data" / "schema.sql"


@pytest.fixture
def tmp_db(monkeypatch, tmp_path):
    db = tmp_path / "test.db"
    with sqlite3.connect(db) as conn:
        conn.executescript(SCHEMA_PATH.read_text())
    import api.db
    monkeypatch.setattr(api.db, "DB_PATH", db)
    return db


@pytest.fixture
def client(tmp_db):
    from api.main import app
    return TestClient(app)


# ── Scraper unit tests (mocked HTTP) ──────────────────────────────────────

def test_mercadolibre_scraper_returns_signals():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "results": [
            {"permalink": "https://mercadolibre.com/item/1", "title": "Terreno Monterrey", "price": 2000000},
            {"permalink": "https://mercadolibre.com/item/2", "title": "Lote NL", "price": 1500000},
        ]
    }
    with patch("httpx.get", return_value=mock_response):
        from scraper import mercadolibre
        signals = mercadolibre.scrape()
    assert len(signals) == 2
    assert signals[0].portal == "mercadolibre"
    assert signals[0].url == "https://mercadolibre.com/item/1"
    assert signals[0].price == 2000000


def test_mercadolibre_scraper_handles_empty():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"results": []}
    with patch("httpx.get", return_value=mock_response):
        from scraper import mercadolibre
        signals = mercadolibre.scrape()
    assert signals == []


def test_mercadolibre_scraper_handles_http_error():
    mock_response = MagicMock()
    mock_response.status_code = 500
    with patch("httpx.get", return_value=mock_response):
        from scraper import mercadolibre
        signals = mercadolibre.scrape()
    assert signals == []


def test_pincali_scraper_handles_http_error():
    mock_response = MagicMock()
    mock_response.status_code = 403
    with patch("httpx.get", return_value=mock_response):
        from scraper import pincali
        signals = pincali.scrape()
    assert signals == []


def test_pincali_scraper_handles_empty_html():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = "<html><body><p>No listings</p></body></html>"
    with patch("httpx.get", return_value=mock_response):
        from scraper import pincali
        signals = pincali.scrape()
    assert signals == []


# ── API endpoint tests ─────────────────────────────────────────────────────

def test_sonar_scan_returns_stats(client):
    # Mock all scrapers to return empty (no real HTTP)
    with patch("scraper.mercadolibre.scrape", return_value=[]), \
         patch("scraper.pincali.scrape", return_value=[]), \
         patch("scraper.inmuebles24.scrape", return_value=[]), \
         patch("scraper.doorvel.scrape", return_value=[]), \
         patch("scraper.nuroa.scrape", return_value=[]):
        r = client.post("/api/sonar/scan")
    assert r.status_code == 200
    data = r.json()
    assert "scanned" in data
    assert "new" in data
    assert "errors" in data
    assert data["scanned"] == 5
    assert data["new"] == 0


def test_sonar_scan_counts_new_signals(client):
    from scraper.base import SignalRaw
    mock_signal = SignalRaw(
        portal="mercadolibre",
        url="https://ml.com/test-1",
        title="Test Terreno",
        city="Monterrey",
        price=1500000,
    )
    with patch("scraper.mercadolibre.scrape", return_value=[mock_signal]), \
         patch("scraper.pincali.scrape", return_value=[]), \
         patch("scraper.inmuebles24.scrape", return_value=[]), \
         patch("scraper.doorvel.scrape", return_value=[]), \
         patch("scraper.nuroa.scrape", return_value=[]):
        r = client.post("/api/sonar/scan")
    assert r.status_code == 200
    assert r.json()["new"] == 1


def test_sonar_scan_deduplicates(client):
    from scraper.base import SignalRaw
    mock_signal = SignalRaw(portal="ml", url="https://ml.com/dup", title="Dup", city="Monterrey")
    with patch("scraper.mercadolibre.scrape", return_value=[mock_signal]), \
         patch("scraper.pincali.scrape", return_value=[mock_signal]), \
         patch("scraper.inmuebles24.scrape", return_value=[]), \
         patch("scraper.doorvel.scrape", return_value=[]), \
         patch("scraper.nuroa.scrape", return_value=[]):
        r = client.post("/api/sonar/scan")
    assert r.json()["new"] == 1  # Only one inserted despite appearing twice


def test_get_signals_returns_list(client):
    r = client.get("/api/sonar/signals")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_get_signals_filter_by_status(client):
    # Seed a signal first via scan
    from scraper.base import SignalRaw
    sig = SignalRaw(portal="ml", url="https://ml.com/filter-test", title="Filter Test", city="Monterrey")
    with patch("scraper.mercadolibre.scrape", return_value=[sig]), \
         patch("scraper.pincali.scrape", return_value=[]), \
         patch("scraper.inmuebles24.scrape", return_value=[]), \
         patch("scraper.doorvel.scrape", return_value=[]), \
         patch("scraper.nuroa.scrape", return_value=[]):
        client.post("/api/sonar/scan")
    r = client.get("/api/sonar/signals?status=new")
    assert r.status_code == 200
    assert any(s["url"] == "https://ml.com/filter-test" for s in r.json())


def test_dismiss_signal(client):
    # Seed a signal
    from scraper.base import SignalRaw
    sig = SignalRaw(portal="ml", url="https://ml.com/dismiss-test", title="Dismiss Me", city="Monterrey")
    with patch("scraper.mercadolibre.scrape", return_value=[sig]), \
         patch("scraper.pincali.scrape", return_value=[]), \
         patch("scraper.inmuebles24.scrape", return_value=[]), \
         patch("scraper.doorvel.scrape", return_value=[]), \
         patch("scraper.nuroa.scrape", return_value=[]):
        client.post("/api/sonar/scan")
    signals = client.get("/api/sonar/signals?status=new").json()
    signal_id = signals[0]["id"]
    r = client.patch(f"/api/sonar/signals/{signal_id}")
    assert r.status_code == 200
    assert r.json()["status"] == "dismissed"


def test_dismiss_missing_signal_returns_404(client):
    r = client.patch("/api/sonar/signals/99999")
    assert r.status_code == 404


def test_import_signal_creates_prospect(client):
    from scraper.base import SignalRaw
    sig = SignalRaw(portal="ml", url="https://ml.com/import-test", title="Import Me", city="Monterrey", price=2000000)
    with patch("scraper.mercadolibre.scrape", return_value=[sig]), \
         patch("scraper.pincali.scrape", return_value=[]), \
         patch("scraper.inmuebles24.scrape", return_value=[]), \
         patch("scraper.doorvel.scrape", return_value=[]), \
         patch("scraper.nuroa.scrape", return_value=[]):
        client.post("/api/sonar/scan")
    signals = client.get("/api/sonar/signals?status=new").json()
    signal_id = signals[0]["id"]
    r = client.post(f"/api/sonar/signals/{signal_id}/import")
    assert r.status_code == 201
    data = r.json()
    assert "signal" in data
    assert "prospect" in data
    assert data["signal"]["status"] == "imported"
    assert data["prospect"]["name"] == "Import Me"


def test_import_missing_signal_returns_404(client):
    r = client.post("/api/sonar/signals/99999/import")
    assert r.status_code == 404
