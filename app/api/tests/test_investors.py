"""Integration tests for /api/investors and /api/properties/{id}/investors."""
from decimal import Decimal

import pytest

from api.db import get_db


@pytest.fixture
def test_investor(client):
    r = client.post("/api/investors", json={"name": "[TEST] Investor", "email": "test-inv@refigan.com"})
    assert r.status_code == 201
    inv = r.json()
    yield inv
    with get_db() as conn:
        conn.execute("DELETE FROM property_investors WHERE investor_id = %s", (inv["id"],))
        conn.execute("DELETE FROM investors WHERE id = %s", (inv["id"],))


def test_list_investors(client):
    r = client.get("/api/investors")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_create_investor(client, test_investor):
    assert "id" in test_investor
    assert test_investor["name"] == "[TEST] Investor"


def test_get_investor_by_id(client, test_investor):
    r = client.get(f"/api/investors/{test_investor['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == test_investor["id"]


def test_put_investor(client, test_investor):
    r = client.put(f"/api/investors/{test_investor['id']}", json={"name": "[TEST] Updated Investor"})
    assert r.status_code == 200
    assert r.json()["name"] == "[TEST] Updated Investor"


def test_delete_investor(client, test_investor):
    assert client.delete(f"/api/investors/{test_investor['id']}").status_code == 204


def test_delete_nonexistent_404(client):
    assert client.delete("/api/investors/999999").status_code == 404


def test_requires_auth(client, anonymous):
    assert client.get("/api/investors").status_code == 401


# ── Per-property positions ───────────────────────────────────────────────────

def test_list_property_investors_empty(client, desarrollo_property):
    r = client.get(f"/api/properties/{desarrollo_property['id']}/investors")
    assert r.status_code == 200
    assert r.json() == []


def test_add_investor_to_property(client, desarrollo_property, test_investor):
    r = client.post(f"/api/properties/{desarrollo_property['id']}/investors", json={
        "investorId": test_investor["id"],
        "fundedAmount": 500_000,
    })
    assert r.status_code == 201, r.text
    assert "id" in r.json()


def test_delete_property_investment(client, desarrollo_property, test_investor):
    add = client.post(f"/api/properties/{desarrollo_property['id']}/investors", json={
        "investorId": test_investor["id"]})
    assert add.status_code == 201
    r = client.delete(
        f"/api/properties/{desarrollo_property['id']}/investors/{add.json()['id']}")
    assert r.status_code == 204


def test_the_funnel_opens_at_oferta(client, test_property, test_investor):
    """You raise money for a deal you are bidding on, not for one you are still
    evaluating."""
    body = {"investorId": test_investor["id"]}
    r = client.post(f"/api/properties/{test_property['id']}/investors", json=body)
    assert r.status_code == 422

    client.post(f"/api/properties/{test_property['id']}/transition", json={"to": "oferta"})
    r = client.post(f"/api/properties/{test_property['id']}/investors", json=body)
    assert r.status_code == 201, r.text


# ── El embudo se lee del dinero ──────────────────────────────────────────────

def test_the_funnel_stage_is_derived_from_the_money(client, desarrollo_property, test_investor):
    """Interesado → comprometido → fondeado no es un campo aparte que el
    formulario pueda contradecir: es una lectura de los tres montos."""
    def add(**amounts):
        r = client.post(f"/api/properties/{desarrollo_property['id']}/investors",
                        json={"investorId": test_investor["id"], **amounts})
        assert r.status_code == 201, r.text
        return r.json()["status"]

    assert add(interestedAmount=800_000) == "interesado"
    assert add(interestedAmount=800_000, committedAmount=500_000) == "comprometido"
    assert add(committedAmount=500_000, fundedAmount=500_000) == "fondeado"


def test_a_client_cannot_declare_a_stage_its_money_contradicts(client, desarrollo_property,
                                                               test_investor):
    """Mandar 500k fondeados y llamarle "interesado" guardaba esa mentira."""
    r = client.post(f"/api/properties/{desarrollo_property['id']}/investors", json={
        "investorId": test_investor["id"], "status": "interesado", "fundedAmount": 500_000})
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "fondeado"


def test_raising_the_committed_amount_moves_the_position_forward(client, desarrollo_property,
                                                                 test_investor):
    """"Comprometido" era inalcanzable: el formulario mandaba 0 siempre. Ahora
    subir el monto mueve la etapa sola, sin que nadie tenga que declararla."""
    pid = desarrollo_property["id"]
    add = client.post(f"/api/properties/{pid}/investors",
                      json={"investorId": test_investor["id"], "interestedAmount": 800_000})
    assert add.json()["status"] == "interesado"
    investment_id = add.json()["id"]

    up = client.put(f"/api/properties/{pid}/investors/{investment_id}",
                    json={"committedAmount": 500_000})
    assert up.status_code == 200, up.text
    assert up.json()["status"] == "comprometido"
    assert float(up.json()["interestedAmount"]) == 800_000  # el monto anterior sobrevive

    funded = client.put(f"/api/properties/{pid}/investors/{investment_id}",
                        json={"fundedAmount": 500_000})
    assert funded.json()["status"] == "fondeado"


def test_a_position_that_loses_its_money_walks_back_down_the_funnel(client, desarrollo_property,
                                                                    test_investor):
    pid = desarrollo_property["id"]
    add = client.post(f"/api/properties/{pid}/investors",
                      json={"investorId": test_investor["id"], "fundedAmount": 500_000})
    up = client.put(f"/api/properties/{pid}/investors/{add.json()['id']}",
                    json={"fundedAmount": 0, "committedAmount": 500_000})
    assert up.json()["status"] == "comprometido"


def test_investors_on_a_missing_property_is_404(client, test_investor):
    r = client.post("/api/properties/999999999/investors",
                    json={"investorId": test_investor["id"]})
    assert r.status_code == 404


def test_position_metrics_match_the_finance_module(client, desarrollo_property, test_investor):
    """The API's position metrics equal finance.investor of the same position —
    the parity oracle left behind when the project_investor_metrics view died."""
    from api.investor_db import get_property_investors
    from api.finance import investor as fin_investor

    with get_db() as conn:
        conn.execute(
            """INSERT INTO property_investors (property_id, investor_id, status, funded_amount,
                   interest_rate_annual, investment_date)
               VALUES (%s,%s,'fondeado',1000000,0.12,'2025-01-01')""",
            (desarrollo_property["id"], test_investor["id"]))
        row = conn.execute(
            "SELECT acquisition_date, sale_date, first_rent_date FROM properties WHERE id=%s",
            (desarrollo_property["id"],)).fetchone()

    # The money is in from the acquisition until the work concludes — and for a
    # property still in desarrollo that has not happened, so it runs to today.
    hold = fin_investor.hold_months(row["acquisition_date"],
                                    row["sale_date"] or row["first_rent_date"])
    position = next(p for p in get_property_investors(desarrollo_property["id"])
                    if p["investorId"] == test_investor["id"])
    assert position["holdMonths"] == hold
    assert Decimal(str(position["interestAmount"])) == fin_investor.cuota(1000000, 0.12, hold)
    assert Decimal(str(position["expectedReturn"])) == fin_investor.expected_return(1000000, 0.12, hold)
    assert Decimal(str(position["returnPct"])) == fin_investor.return_pct(0.12, hold)
