"""Integration tests for /api/profit routes."""


def test_get_profit_template(client):
    r = client.get("/api/profit/template")
    assert r.status_code == 200
    assert "isrRate" in r.json()


def test_put_profit_template(client):
    r = client.put("/api/profit/template", json={"isrRate": 0.25})
    assert r.status_code == 200
    assert r.json()["isrRate"] == 0.25


def test_get_property_profit(client, desarrollo_property):
    r = client.get(f"/api/properties/{desarrollo_property['id']}/profit")
    assert r.status_code == 200
    assert {"config", "waterfall"} <= set(r.json())


def test_put_property_profit(client, desarrollo_property):
    r = client.put(f"/api/properties/{desarrollo_property['id']}/profit",
                   json={"exitPrice": 5_000_000.0})
    assert r.status_code == 200
    assert {"config", "waterfall"} <= set(r.json())


def test_put_then_get_property_profit(client, desarrollo_property):
    client.put(f"/api/properties/{desarrollo_property['id']}/profit",
               json={"exitPrice": 7_000_000.0})
    r = client.get(f"/api/properties/{desarrollo_property['id']}/profit")
    assert r.status_code == 200
    assert r.json()["config"]["exitPrice"] == 7_000_000.0


def test_the_waterfall_opens_at_desarrollo(client, test_property):
    """There is nothing to split before the money is committed."""
    assert client.get(f"/api/properties/{test_property['id']}/profit").status_code == 422


def test_a_sold_property_splits_on_its_sale_price(client, desarrollo_property):
    """Once there is a real exit the split runs on it, rather than on the last
    valuation somebody happened to record."""
    sold = client.post(f"/api/properties/{desarrollo_property['id']}/transition",
                       json={"to": "vendida", "saleDate": "2026-07", "salePrice": 6_000_000})
    assert sold.status_code == 200, sold.text
    waterfall = client.get(
        f"/api/properties/{desarrollo_property['id']}/profit").json()["waterfall"]
    assert float(waterfall["exitPrice"]) == 6_000_000


def test_profit_on_a_missing_property_is_404(client):
    assert client.get("/api/properties/999999999/profit").status_code == 404


# ── Los supuestos, de punta a punta ──────────────────────────────────────────

def test_a_property_without_investors_is_not_charged_an_invented_fee(client, desarrollo_property):
    """Sin capital fondeado registrado el reparto no fabrica una cuota al 12%
    sobre toda la inversión: dice que faltan inversionistas."""
    w = client.get(f"/api/properties/{desarrollo_property['id']}/profit").json()["waterfall"]
    assert float(w["investorCuota"]) == 0
    assert w["investorCapitalSource"] is None
    assert "investorCapital" in w["missingInputs"]
    # La ganancia del operador es la bruta íntegra.
    assert float(w["operatorGross"]) == float(w["grossProfit"])


def test_a_funded_investor_is_the_one_who_sets_the_fee(client, desarrollo_property):
    from api.db import get_db
    inv = client.post("/api/investors", json={"name": "[TEST] Fondeador"}).json()
    add = client.post(f"/api/properties/{desarrollo_property['id']}/investors",
                      json={"investorId": inv["id"], "fundedAmount": 1_000_000,
                            "interestRateAnnual": 0.12})
    assert add.status_code == 201, add.text
    w = client.get(f"/api/properties/{desarrollo_property['id']}/profit").json()["waterfall"]
    assert w["investorCapitalSource"] == "fondeado"
    assert float(w["investorCapital"]) == 1_000_000
    assert float(w["investorCuota"]) > 0
    with get_db() as conn:
        conn.execute("DELETE FROM property_investors WHERE investor_id = %s", (inv["id"],))
        conn.execute("DELETE FROM investors WHERE id = %s", (inv["id"],))


def test_the_waterfall_says_where_its_exit_price_came_from(client, desarrollo_property):
    pid = desarrollo_property["id"]
    assert client.get(f"/api/properties/{pid}/profit").json()["waterfall"]["exitPriceSource"] \
        == "valuacion"
    client.put(f"/api/properties/{pid}/profit", json={"exitPrice": 9_000_000.0})
    w = client.get(f"/api/properties/{pid}/profit").json()["waterfall"]
    assert w["exitPriceSource"] == "capturado"
    assert float(w["exitPrice"]) == 9_000_000


def test_the_team_bonus_can_be_switched_on_through_the_api(client, desarrollo_property):
    """Los tres escalones de bono existen porque uno puede encenderse: los tres
    campos que lo deciden se pueden escribir y el reparto los usa."""
    pid = desarrollo_property["id"]
    before = client.get(f"/api/properties/{pid}/profit").json()["waterfall"]
    assert before["activeTier"] is None
    assert set(before["bonusInputsMissing"]) == {"plannedEndDate", "bufferDays", "actualEndDate"}

    r = client.put(f"/api/properties/{pid}/profit", json={
        "plannedEndDate": "2026-06-30", "bufferDays": 30, "actualEndDate": "2026-05-01"})
    assert r.status_code == 200, r.text
    after = r.json()["waterfall"]
    assert float(after["activeTier"]) == 0.50
    assert after["bonusInputsMissing"] == []


def test_the_holding_period_is_the_property_s_own_before_it_is_a_default(client, desarrollo_property):
    """El plazo de la cuota no arranca en 12: usa el real y luego el proyectado."""
    w = client.get(f"/api/properties/{desarrollo_property['id']}/profit").json()["waterfall"]
    assert w["monthsSource"] == "real"
    r = client.put(f"/api/properties/{desarrollo_property['id']}/profit",
                   json={"investorMonths": 24})
    assert r.json()["waterfall"]["monthsSource"] == "capturado"
    assert r.json()["waterfall"]["months"] == 24


def test_requires_auth(client, anonymous):
    assert client.get("/api/profit/template").status_code == 401
