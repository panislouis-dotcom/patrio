import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from scraper.base import SignalRaw


@pytest.fixture(autouse=True)
def mock_sonar_db():
    """Prevent sonar SSE tests from hitting the real DB."""
    with patch("api.routes.sonar.sonar_db.create_scan", return_value=1), \
         patch("api.routes.sonar.sonar_db.upsert_signal", return_value=1), \
         patch("api.routes.sonar.sonar_db.link_signals_to_scan"), \
         patch("api.routes.sonar.sonar_db.complete_scan"):
        yield


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
        r = _make_client().post("/api/sonar/run", json={})
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
                    title="Terreno Test", price=1_500_000)
    p1, p2, p3, p4, p5, p6 = _all_scrapers_empty()
    with p1, p2, p3, p4, p5, p6:
        with patch("api.routes.sonar.lamudi.scrape", return_value=[sig]):
            r = _make_client().post("/api/sonar/run", json={})

    events = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
    complete = next(e for e in events if e["type"] == "complete")
    assert complete["found"] == 1
    signal_dict = complete["signals"][0]
    assert signal_dict["url"] == sig.url
    assert "municipioCve" in signal_dict


def test_sonar_run_with_cves():
    """cves field is accepted in request body."""
    import json
    sig = SignalRaw(portal="lamudi", url="https://lamudi.com.mx/test-zone",
                    title="Terreno San Pedro", municipio_cve="19019", price=2_000_000)
    p1, p2, p3, p4, p5, p6 = _all_scrapers_empty()
    with p1, p2, p3, p4, p5, p6:
        with patch("api.routes.sonar.lamudi.scrape", return_value=[sig]):
            r = _make_client().post("/api/sonar/run", json={"cves": ["19019"]})

    events = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
    complete = next(e for e in events if e["type"] == "complete")
    assert complete["signals"][0]["municipioCve"] == "19019"


def test_sonar_run_drops_low_price_signals():
    """Signals with 0 < price < 100k are discarded."""
    import json
    bad = SignalRaw(portal="lamudi", url="https://lamudi.com.mx/bad",
                    title="Bad listing", price=5_000)
    p1, p2, p3, p4, p5, p6 = _all_scrapers_empty()
    with p1, p2, p3, p4, p5, p6:
        with patch("api.routes.sonar.lamudi.scrape", return_value=[bad]):
            r = _make_client().post("/api/sonar/run", json={})

    events = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
    complete = next(e for e in events if e["type"] == "complete")
    assert complete["found"] == 0
    assert complete["skipped"] == 1


# ── Zone detection unit tests ─────────────────────────────────────────────────

def test_detect_cve_does_not_match_san_pedro_la_paz():
    """Generic 'san pedro' no longer falsely maps to San Pedro Garza García."""
    from scraper.zones import detect_cve
    assert detect_cve("San Pedro La Paz, Estado de México") == ""
    assert detect_cve("Predio en San Pedro Cholula, Puebla") == ""


def test_detect_cve_matches_specific_spgg_terms():
    """Specific SPGG terms still resolve correctly."""
    from scraper.zones import detect_cve
    assert detect_cve("Fraccionamiento en San Pedro Garza García, NL") == "19019"
    assert detect_cve("Terreno en SPGG, Monterrey") == "19019"
    assert detect_cve("Garza García NL") == "19019"


def test_resolve_cve_from_nominatim():
    """Nominatim-based CVE lookup returns correct CVE for known municipios."""
    from scraper.zones import resolve_cve_from_nominatim
    assert resolve_cve_from_nominatim("Nuevo León", "San Pedro Garza García") == "19019"
    assert resolve_cve_from_nominatim("Nuevo León", "Monterrey") == "19039"
    assert resolve_cve_from_nominatim("Estado de México", "San Pedro La Paz") == ""
    assert resolve_cve_from_nominatim("Puebla", "San Pedro Cholula") == ""


def test_sonar_run_signal_includes_state_name_field():
    """stateName field is present in complete event signals."""
    import json
    sig = SignalRaw(portal="lamudi", url="https://lamudi.com.mx/test-state",
                    title="Terreno Test", price=1_500_000)
    p1, p2, p3, p4, p5, p6 = _all_scrapers_empty()
    with p1, p2, p3, p4, p5, p6:
        with patch("api.routes.sonar.lamudi.scrape", return_value=[sig]):
            r = _make_client().post("/api/sonar/run", json={})

    events = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
    complete = next(e for e in events if e["type"] == "complete")
    assert "stateName" in complete["signals"][0]


# ── Round 2: state_hint geocoding + out-of-zone deletion ─────────────────────

def test_state_to_slug():
    """state_to_slug returns correct URL slug for a known CVE."""
    from scraper.zones import state_to_slug
    assert state_to_slug("19019") == "nuevo-leon"
    assert state_to_slug("19039") == "nuevo-leon"


def test_geocode_with_state_hint_appends_state_to_query():
    """When state_hint is given and not in address, query is augmented."""
    from unittest.mock import MagicMock, patch
    from api.geo import geocode

    mock_loc = MagicMock()
    mock_loc.latitude = 25.6
    mock_loc.longitude = -100.4
    mock_loc.raw = {"address": {"state": "Nuevo León", "county": "Monterrey"}}

    captured = {}
    def fake_geocode(query, **kwargs):
        captured["query"] = query
        return mock_loc

    with patch("api.geo._get_geolocator") as mock_geo:
        mock_geo.return_value.geocode = fake_geocode
        geocode("La Paz, NL", state_hint="Nuevo León")

    assert "Nuevo León" in captured["query"]
    assert "México" in captured["query"]


def test_geocode_one_deletes_wrong_state_signal():
    """_geocode_one deletes a signal when geocoded state != state_hint."""
    with patch("api.routes.sonar.geo.geocode",
               return_value=(24.1, -110.3, "", "Baja California Sur", "La Paz")), \
         patch("api.routes.sonar.sonar_db.delete_signal") as mock_delete, \
         patch("api.routes.sonar.sonar_db.update_signal_geo") as mock_update:
        from api.routes.sonar import _geocode_one
        _geocode_one(99, "La Paz, NL", state_hint="Nuevo León")

    mock_delete.assert_called_once_with(99)
    mock_update.assert_not_called()


def test_geocode_one_keeps_correct_state_signal():
    """_geocode_one updates geo when geocoded state matches state_hint."""
    with patch("api.routes.sonar.geo.geocode",
               return_value=(25.65, -100.29, "Del Valle", "Nuevo León", "San Pedro Garza García")), \
         patch("api.routes.sonar.sonar_db.delete_signal") as mock_delete, \
         patch("api.routes.sonar.sonar_db.update_signal_geo") as mock_update:
        from api.routes.sonar import _geocode_one
        _geocode_one(42, "San Pedro Garza García, NL", state_hint="Nuevo León")

    mock_delete.assert_not_called()
    mock_update.assert_called_once()


# ── /api/sonar/import ─────────────────────────────────────────────────────────

def test_sonar_import_captures_a_property_in_prospecto():
    captured = {"id": 42, "name": "Terreno Test", "status": "prospecto"}
    with patch("api.routes.sonar.create_property", return_value=captured) as create:
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
    assert r.json()["property"] == captured
    # Only what the portal gave us: the rest comes from the capture defaults, so
    # the importer cannot drift from the form.
    assert create.call_args.args[0] == {
        "name": "Terreno Test", "address": "Col. San Pedro", "city": "Monterrey",
        "url": "https://lamudi.com.mx/test-1", "latitude": 0.0, "longitude": 0.0,
        "sqmLand": 300.0, "landPrice": 1_500_000,
    }
