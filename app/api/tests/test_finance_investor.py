from decimal import Decimal
from api.finance import investor as inv


def test_cuota_matches_view_formula():
    # 1_000_000 * 0.12 * 18/12 = 180_000.00
    assert inv.cuota(1_000_000, 0.12, 18) == Decimal("180000.00")


def test_expected_return():
    assert inv.expected_return(1_000_000, 0.12, 18) == Decimal("1180000.00")


def test_return_pct():
    assert inv.return_pct(0.12, 18) == Decimal("18.00")


def test_hold_months_active_uses_today():
    import datetime as _dt
    assert inv.hold_months(_dt.date(2025, 1, 1), None, today=_dt.date(2026, 1, 1)) == 12


def test_hold_months_with_conclusion():
    import datetime as _dt
    assert inv.hold_months(_dt.date(2025, 1, 1), _dt.date(2026, 7, 1)) == 18


def test_hold_months_is_zero_before_the_acquisition():
    """Nothing has been held, so nothing has accrued."""
    assert inv.hold_months(None, None) == 0


def test_totals_sums_positions():
    positions = [{"fundedAmount": 100, "committedAmount": 50, "interestedAmount": 25},
                 {"fundedAmount": 200, "committedAmount": None, "interestedAmount": 75}]
    t = inv.totals(positions)
    assert t == {"totalFunded": Decimal("300"), "totalCommitted": Decimal("50"),
                 "totalInterested": Decimal("100")}
