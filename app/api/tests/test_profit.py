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


def test_requires_auth(client, anonymous):
    assert client.get("/api/profit/template").status_code == 401
