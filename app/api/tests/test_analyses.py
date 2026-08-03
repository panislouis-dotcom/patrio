"""Integration tests for /api/analyses routes."""
import pytest
from unittest import mock
from api.db import get_db


@pytest.fixture(autouse=True)
def analysis_zones():
    """Ensure the fallback zone exists so the analyzer does not crash on zone lookup."""
    with get_db() as conn:
        conn.execute(
            "INSERT INTO zones (name) VALUES ('monterrey_general') ON CONFLICT (name) DO NOTHING"
        )
    yield
    with get_db() as conn:
        conn.execute("DELETE FROM zones WHERE name = 'monterrey_general'")


def _mock_analysis_patches():
    return (
        mock.patch("api.analyzer.find_comparables", return_value=([], None)),
        mock.patch("api.analyzer.get_remodel_cost", return_value=None),
    )


def test_post_analysis_returns_snapshot(client, test_property):
    p1, p2 = _mock_analysis_patches()
    with p1, p2:
        r = client.post("/api/analyses", json={"propertyId": test_property["id"]})
    assert r.status_code == 201
    data = r.json()
    assert "id" in data
    assert data["propertyId"] == test_property["id"]


def test_get_analysis_by_id(client, test_property):
    p1, p2 = _mock_analysis_patches()
    with p1, p2:
        create_r = client.post("/api/analyses", json={"propertyId": test_property["id"]})
    assert create_r.status_code == 201
    snapshot_id = create_r.json()["id"]

    r = client.get(f"/api/analyses/{snapshot_id}")
    assert r.status_code == 200
    assert r.json()["id"] == snapshot_id


def test_list_analyses_all(client, test_property):
    p1, p2 = _mock_analysis_patches()
    with p1, p2:
        client.post("/api/analyses", json={"propertyId": test_property["id"]})
    r = client.get("/api/analyses")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_list_analyses_by_property(client, test_property):
    p1, p2 = _mock_analysis_patches()
    with p1, p2:
        create_r = client.post("/api/analyses", json={"propertyId": test_property["id"]})
    snapshot_id = create_r.json()["id"]

    r = client.get(f"/api/analyses?property_id={test_property['id']}")
    assert r.status_code == 200
    ids = [a["id"] for a in r.json()]
    assert snapshot_id in ids


def test_a_snapshot_records_the_assumptions_it_was_computed_with(client, test_property):
    """El snapshot se documenta como registro inmutable de una corrida. Si sus
    supuestos no viajan con él, NPV e IRR se publican como resultados de un
    modelo cuyos parámetros no se pueden auditar."""
    p1, p2 = _mock_analysis_patches()
    with p1, p2:
        r = client.post("/api/analyses", json={"propertyId": test_property["id"]})
    assert r.status_code == 201, r.text
    snap = r.json()
    assert snap["transactionCostPct"] == pytest.approx(0.08)
    assert snap["listingHaircut"] == pytest.approx(0.06)
    assert snap["discountRate"] == pytest.approx(0.10)
    # El financiamiento mueve financingCosts del flip, así que se guarda aunque
    # no haya renta que analizar.
    assert snap["financiamientoPct"] == pytest.approx(0.60)
    assert snap["tasaInteresCredito"] == pytest.approx(0.13)
    assert snap["plazoCreditoMeses"] == 240
    assert snap["gastosOperativosPct"] == pytest.approx(0.30)


def test_the_assumptions_sent_by_the_form_are_the_ones_used(client, test_property):
    p1, p2 = _mock_analysis_patches()
    with p1, p2:
        r = client.post("/api/analyses", json={
            "propertyId": test_property["id"],
            "transactionCostPct": 0.05, "listingHaircut": 0.10, "discountRate": 0.15,
            "financiamientoPct": 0.0, "gastosOperativosPct": 0.25,
        })
    assert r.status_code == 201, r.text
    snap = r.json()
    assert snap["transactionCostPct"] == pytest.approx(0.05)
    assert snap["listingHaircut"] == pytest.approx(0.10)
    assert snap["discountRate"] == pytest.approx(0.15)
    # Sin financiamiento no hay costo financiero: el supuesto llega al cálculo,
    # no solo a la columna.
    assert float(snap["financingCosts"]) == 0
    assert float(snap["transactionCosts"]) == pytest.approx(float(snap["purchasePrice"]) * 0.05)


def test_the_listing_haircut_reaches_the_comparables(client, test_property):
    """El castigo anuncio→venta no era un parámetro: era un default de
    find_comparables que nadie podía tocar."""
    captured = {}

    def _spy(*args, **kwargs):
        captured.update(kwargs)
        return ([], None)

    with mock.patch("api.analyzer.find_comparables", side_effect=_spy), \
            mock.patch("api.analyzer.get_remodel_cost", return_value=None):
        r = client.post("/api/analyses",
                        json={"propertyId": test_property["id"], "listingHaircut": 0.12})
    assert r.status_code == 201, r.text
    assert captured["listing_haircut"] == pytest.approx(0.12)


def test_the_ten_year_metrics_travel_under_the_name_the_view_reads(client, test_property):
    """`npv_10yr` sale del serializador como `npv10Yr` (title-case por tramo).
    La vista lo leía como `npv10yr` y publicaba "—" con el número calculado y
    guardado — el renglón nunca se pudo encender. Este test fija el nombre."""
    p1, p2 = _mock_analysis_patches()
    with p1, p2:
        r = client.post("/api/analyses", json={
            "propertyId": test_property["id"], "rentaMensualEstimada": 25_000})
    assert r.status_code == 201, r.text
    snap = r.json()
    assert "npv10Yr" in snap and "irr10YrPct" in snap
    assert snap["npv10Yr"] is not None
    assert snap["irr10YrPct"] is not None


# ── El costo de obra entra una sola vez ──────────────────────────────────────

def test_the_analyzer_does_not_add_the_property_s_own_construction_budget(client, test_property):
    """Hay dos modelos de obra —el presupuesto de la propiedad y el precio de
    zona del analizador— y sumarlos contaría dos veces el mismo peso. El
    analizador corre su escenario propio: su costo total es compra + SU
    remodelación + transacción + financiamiento, y nada más."""
    with mock.patch("api.analyzer.find_comparables", return_value=([], None)), \
            mock.patch("api.analyzer.get_remodel_cost",
                       return_value={"cost_per_m2_mxn": 10_000, "updated_at": None}):
        r = client.post("/api/analyses", json={"propertyId": test_property["id"]})
    assert r.status_code == 201, r.text
    snap = r.json()
    # La propiedad presupuesta 200 m² × $9,000 × 1.3 = $2,340,000 de obra. El
    # analizador cotiza los mismos 200 m² a su propio precio de zona.
    assert float(snap["remodelCostEstimate"]) == 200 * 10_000
    assert float(snap["totalCost"]) == pytest.approx(
        float(snap["purchasePrice"]) + float(snap["remodelCostEstimate"])
        + float(snap["transactionCosts"]) + float(snap["financingCosts"]))


def test_a_property_with_no_planned_works_is_not_charged_a_ground_up_build(client, test_property):
    """Desde la 025, `sqm_construction` son los metros de obra A EJECUTAR: 0
    significa comprar y quedarse. Antes se leía como "es un lote pelón" y el
    analizador cambiaba solo a obra nueva sobre TODO el terreno — el escenario
    más caro posible, que nadie pidió."""
    from api.db import get_db
    with get_db() as conn:
        conn.execute("UPDATE properties SET sqm_construction = 0 WHERE id = %s",
                     (test_property["id"],))
    with mock.patch("api.analyzer.find_comparables", return_value=([], None)), \
            mock.patch("api.analyzer.get_remodel_cost",
                       return_value={"cost_per_m2_mxn": 10_000, "updated_at": None}):
        r = client.post("/api/analyses", json={"propertyId": test_property["id"]})
    assert r.status_code == 201, r.text
    snap = r.json()
    assert float(snap["remodelCostEstimate"]) == 0
    assert snap["interventionLevel"] == "media"  # la elección del usuario se respeta
    assert any("Sin metros de obra capturados" in w for w in snap["dataQualityWarnings"])


def test_a_ground_up_scenario_is_asked_for_by_name(client, test_property):
    """Quien quiera valorar construir de cero lo elige en el formulario, y
    entonces sí se mide sobre el terreno."""
    from api.db import get_db
    with get_db() as conn:
        conn.execute("UPDATE properties SET sqm_construction = 0 WHERE id = %s",
                     (test_property["id"],))
    with mock.patch("api.analyzer.find_comparables", return_value=([], None)), \
            mock.patch("api.analyzer.get_remodel_cost",
                       return_value={"cost_per_m2_mxn": 10_000, "updated_at": None}):
        r = client.post("/api/analyses", json={
            "propertyId": test_property["id"], "interventionLevel": "obra_nueva"})
    assert r.status_code == 201, r.text
    # 300 m² de terreno × $10,000
    assert float(r.json()["remodelCostEstimate"]) == 300 * 10_000


def test_post_missing_property_id_422(client):
    r = client.post("/api/analyses", json={})
    assert r.status_code == 422


def test_requires_auth(client, anonymous):
    r = client.get("/api/analyses")
    assert r.status_code == 401
