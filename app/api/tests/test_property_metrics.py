"""The metric contract, status by status.

Three groups appear and disappear together — projection, realized, exit — and
the whole point of the consolidation is that none of them ever degrades into a
fabricated zero. These tests read the API, not the domain module, because the
contract is what the client sees.
"""
from decimal import Decimal

from api.db import get_db
from api.finance import underwriting

# Groups as the client sees them. A status either has the whole group or none of it.
PROJECTION = ("acquisitionCosts", "acquisitionTotal", "constructionBase", "constructionTotal",
              "landPricePerSqm", "investmentPerSqm", "salePerSqm",
              "projectedProfit", "projectedRoi", "projectedRoiTotal", "capRate", "rentAnnual")
REALIZED = ("unrealizedGain", "unrealizedGainPct", "roi")
EXIT = ("realizedGain", "realizedGainPct", "realizedRoi")


def _get(client, property_id: int) -> dict:
    r = client.get(f"/api/properties/{property_id}")
    assert r.status_code == 200, r.text
    return r.json()


def _advance(client, property_id: int, **body) -> dict:
    r = client.post(f"/api/properties/{property_id}/transition", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _all_none(prop: dict, keys) -> bool:
    return all(prop[k] is None for k in keys)


def _all_present(prop: dict, keys) -> bool:
    return all(prop[k] is not None for k in keys)


# ── Projection ───────────────────────────────────────────────────────────────

def test_prospecto_projects_and_has_realized_nothing(client, test_property):
    p = _get(client, test_property["id"])
    assert _all_present(p, PROJECTION)
    assert _all_none(p, REALIZED + EXIT)
    assert p["holdMonthsActual"] is None   # nothing is being held yet


def test_projection_matches_the_underwriting_engine(client, test_property):
    """The API's projection is finance.underwriting of the same inputs — the
    parity oracle that keeps the two from drifting."""
    p = _get(client, test_property["id"])
    inputs = {
        "land_price": 1_000_000, "acquisition_cost_pct": 0.065, "permits_cost": 50_000,
        "subdivision_cost": 25_000, "sqm_construction": 200,
        "construction_cost_per_sqm": 9_000, "construction_overhead": 1.3,
        "projected_sale": 2_500_000, "hold_months": 18, "rent_monthly": 18_000,
        "sqm_land": 300,
    }
    expected = underwriting.metrics(inputs)
    for camel, snake in [
        ("totalInvestment", "total_investment"), ("acquisitionCosts", "acquisition_costs"),
        ("acquisitionTotal", "acquisition_total"), ("constructionBase", "construction_base"),
        ("constructionTotal", "construction_total"), ("projectedProfit", "profit"),
        ("projectedRoi", "roi"), ("projectedRoiTotal", "roi_total"), ("capRate", "cap_rate"),
        ("landPricePerSqm", "land_price_per_sqm"), ("salePerSqm", "sale_per_sqm"),
        ("investmentPerSqm", "investment_per_sqm"), ("rentAnnual", "rent_annual"),
    ]:
        assert Decimal(str(p[camel])) == expected[snake], camel


def test_no_modeled_sale_means_no_projected_gain(client, test_property):
    """0 means "no modeled sale" everywhere in this domain. It must not print as
    a -100% loss, and the gain must be absent rather than negative."""
    with get_db() as conn:
        conn.execute("UPDATE properties SET projected_sale = 0 WHERE id = %s",
                     (test_property["id"],))
    p = _get(client, test_property["id"])
    assert p["projectedProfit"] is None
    assert p["projectedRoi"] is None
    assert p["projectedRoiTotal"] is None


def test_rent_absent_means_no_yield_never_zero(client, test_property):
    client.post(f"/api/properties/{test_property['id']}/clear-fields",
                json={"fields": ["rentMonthly"]})
    p = _get(client, test_property["id"])
    assert p["rentMonthly"] is None
    assert p["capRate"] is None
    assert p["rentAnnual"] is None


# ── Investment basis ─────────────────────────────────────────────────────────

def test_complete_breakdown_is_an_underwriting_basis(client, test_property):
    p = _get(client, test_property["id"])
    assert p["investmentBasis"] == "underwriting"
    assert Decimal(str(p["totalInvestment"])) == Decimal("3480000")


def test_an_incomplete_breakdown_falls_back_to_the_manual_total(client, test_property):
    """Clear one of the seven and the system can no longer recompute anything:
    the basis becomes whatever was typed in, and says so."""
    with get_db() as conn:
        conn.execute("UPDATE properties SET total_investment = 9000000 WHERE id = %s",
                     (test_property["id"],))
    client.post(f"/api/properties/{test_property['id']}/clear-fields",
                json={"fields": ["permitsCost"]})
    p = _get(client, test_property["id"])
    assert p["investmentBasis"] == "manual"
    assert Decimal(str(p["totalInvestment"])) == Decimal("9000000")
    # …and every figure that divides by the basis follows it, rather than
    # reporting a total from one source and a per-m² from another.
    assert Decimal(str(p["investmentPerSqm"])) == Decimal("30000.00")


def test_without_breakdown_or_total_there_is_no_basis(client, test_property):
    client.post(f"/api/properties/{test_property['id']}/clear-fields",
                json={"fields": ["landPrice"]})
    p = _get(client, test_property["id"])
    assert p["totalInvestment"] is None
    assert p["investmentBasis"] == "manual"
    assert p["projectedProfit"] is None


# ── Realized ─────────────────────────────────────────────────────────────────

def test_desarrollo_marks_the_valuation_against_the_money_in(client, desarrollo_property):
    p = _get(client, desarrollo_property["id"])
    assert _all_present(p, PROJECTION)     # the model is still live
    assert _all_present(p, REALIZED)
    assert _all_none(p, EXIT)
    # 4,000,000 valuation over the 3,480,000 breakdown total
    assert Decimal(str(p["unrealizedGain"])) == Decimal("520000")
    assert Decimal(str(p["unrealizedGainPct"])) == Decimal("0.1494")
    assert p["holdMonthsActual"] > 0


def test_unrealized_gain_pct_is_none_not_zero_when_uncomputable(client, desarrollo_property):
    """The doctrine that gives this its own test: 0 reads as "broke even", which
    is a claim. Absence has to look like absence."""
    with get_db() as conn:
        conn.execute(
            "UPDATE properties SET total_investment = NULL, land_price = NULL WHERE id = %s",
            (desarrollo_property["id"],))
    p = _get(client, desarrollo_property["id"])
    assert p["totalInvestment"] is None
    assert p["unrealizedGainPct"] is None
    assert p["unrealizedGain"] is None


def test_en_renta_keeps_projecting_and_marking(client, desarrollo_property):
    p = _advance(client, desarrollo_property["id"], to="en_renta",
                 firstRentDate="2026-03", rentMonthly=18000, currentValuation=4_200_000)
    assert _all_present(p, PROJECTION)
    assert _all_present(p, REALIZED)
    assert _all_none(p, EXIT)
    assert Decimal(str(p["capRate"])) == Decimal("0.0621")   # 216,000 / 3,480,000


# ── Exit ─────────────────────────────────────────────────────────────────────

def test_vendida_freezes_everything_into_the_exit_group(client, desarrollo_property):
    """A sold property is a terminal fact, not a live mark: the model it was
    bought on and the valuation it was carried at both stop being reported."""
    p = _advance(client, desarrollo_property["id"], to="vendida",
                 saleDate="2026-07", salePrice=5_000_000)
    assert _all_none(p, PROJECTION)
    assert _all_none(p, REALIZED)
    assert _all_present(p, EXIT)
    # 5,000,000 out over 3,480,000 in
    assert Decimal(str(p["realizedGain"])) == Decimal("1520000")
    assert Decimal(str(p["realizedGainPct"])) == Decimal("0.4368")


def test_the_exit_hold_stops_at_the_sale(client, desarrollo_property):
    """acquisition 2025-01 → sale 2026-07 is 18 months, and stays 18 months
    however long ago that was: a closed deal's clock does not keep running."""
    p = _advance(client, desarrollo_property["id"], to="vendida",
                 saleDate="2026-07", salePrice=5_000_000)
    assert p["holdMonthsActual"] == 18
    expected = underwriting.gain_pct(Decimal("3480000"), Decimal("5000000"))
    assert Decimal(str(p["realizedGainPct"])) == expected


def test_the_capital_base_survives_the_sale(client, desarrollo_property):
    """It is the denominator of every realized figure — blanking it with the
    projection would leave realizedRoi unexplainable."""
    p = _advance(client, desarrollo_property["id"], to="vendida",
                 saleDate="2026-07", salePrice=5_000_000)
    assert Decimal(str(p["totalInvestment"])) == Decimal("3480000")
    assert p["investmentBasis"] == "underwriting"


def test_archivada_reports_no_metrics_at_all(client, test_property):
    p = _advance(client, test_property["id"], to="archivada")
    assert _all_none(p, PROJECTION + REALIZED + EXIT)
    assert p["score"] is None


# ── Score ────────────────────────────────────────────────────────────────────

def test_score_exists_only_before_the_purchase(client, test_property):
    assert _get(client, test_property["id"])["score"] is not None
    p = _advance(client, test_property["id"], to="oferta")
    assert p["score"] is not None
    p = _advance(client, test_property["id"], to="desarrollo", acquisitionDate="2025-01",
                 totalUnits=4, currentValuation=4_000_000)
    assert p["score"] is None


def test_score_is_a_percentile_over_the_pre_purchase_cohort(client, test_property):
    """Alone in the cohort a property ties with itself on every weight, which is
    the 50th percentile — not 0 and not 100."""
    with get_db() as conn:
        conn.execute("DELETE FROM property_status_events WHERE property_id IN"
                     " (SELECT id FROM properties WHERE status IN ('prospecto','oferta')"
                     "  AND id <> %s)", (test_property["id"],))
        conn.execute("DELETE FROM properties WHERE status IN ('prospecto', 'oferta')"
                     " AND id <> %s", (test_property["id"],))
    assert _get(client, test_property["id"])["score"] == 50


def test_the_listing_and_the_detail_agree_on_the_score(client, test_property):
    listed = next(p for p in client.get("/api/properties").json()
                  if p["id"] == test_property["id"])
    assert listed["score"] == _get(client, test_property["id"])["score"]
