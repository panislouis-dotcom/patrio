"""Migration 020 — money is NUMERIC(14,2), metric views are gone, and the
comparables.price_per_m2 generated column recomputes off the NUMERIC price."""
from decimal import Decimal
from api.db import get_db


def test_large_money_roundtrips_exactly():
    """A value above float4's 16,777,216 limit survives round-trip (it would lose
    precision as REAL)."""
    with get_db() as conn:
        row = conn.execute(
            """INSERT INTO projects (name, type, address, city, status, total_units, url,
                   latitude, longitude, acquisition_date, conclusion_date,
                   total_investment, current_valuation, valuation_date)
               VALUES ('[TEST] Big','ground_up','x','y','construction',1,'http://x',
                   25.6,-100.3,'2025-01','2026-01-01',
                   22333444.55, 19888777.66, '2026-01')
               RETURNING total_investment, current_valuation""").fetchone()
        assert row["total_investment"] == Decimal("22333444.55")
        assert row["current_valuation"] == Decimal("19888777.66")
        conn.execute("DELETE FROM projects WHERE name='[TEST] Big'")


def test_metric_views_are_dropped():
    with get_db() as conn:
        row = conn.execute(
            "SELECT to_regclass('public.prospect_metrics') AS pm, "
            "to_regclass('public.project_investor_metrics') AS pim").fetchone()
    assert row["pm"] is None
    assert row["pim"] is None


def test_comparables_price_per_m2_recomputes_from_numeric():
    with get_db() as conn:
        row = conn.execute(
            """INSERT INTO comparables (address, m2, price, listing_url, source_portal, listed_at)
               VALUES ('[TEST] comp', 150, 3000000, 'http://x', 'other', now())
               RETURNING price_per_m2""").fetchone()
        assert row["price_per_m2"] == Decimal("20000.00")
        conn.execute("DELETE FROM comparables WHERE address='[TEST] comp'")
