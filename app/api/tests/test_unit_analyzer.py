"""Unit tests for pure functions in api.analyzer — no DB, no HTTP."""
from datetime import datetime, timezone

from api.analyzer import _haversine_km, _irr_newton, _npv, compute_confidence


def test_haversine_same_point():
    assert _haversine_km(19.0, -99.0, 19.0, -99.0) == 0.0


def test_haversine_known_distance():
    # Monterrey city hall to a point ~1 km north
    d = _haversine_km(25.6866, -100.3161, 25.6956, -100.3161)
    assert abs(d - 1.0) < 0.15


def test_haversine_symmetry():
    a, b = 25.6866, -100.3161
    c, d = 25.7200, -100.2800
    assert _haversine_km(a, b, c, d) == _haversine_km(c, d, a, b)


def test_npv_zero_rate():
    assert _npv(0.0, [-100.0, 110.0]) == 10.0


def test_npv_discounts_correctly():
    # NPV at 10% of [-100, 110] = -100 + 110/1.1 = 0
    result = _npv(0.10, [-100.0, 110.0])
    assert abs(result) < 0.01


def test_irr_simple():
    # -100 + 110/(1+r) = 0 → r = 0.10
    result = _irr_newton([-100.0, 110.0])
    assert result is not None
    assert abs(result - 0.10) < 0.001


def test_irr_multi_period():
    result = _irr_newton([-1000.0, 200.0, 200.0, 200.0, 200.0, 200.0, 200.0])
    assert result is not None
    assert 0.0 < result < 1.0


def test_irr_no_sign_change_returns_none():
    # All positive cash flows — no sign change, no valid IRR
    result = _irr_newton([100.0, 100.0, 100.0])
    assert result is None


def test_confidence_zero_comps():
    score, _, _ = compute_confidence(0, False, None, None)
    # 0 comps (0pts) + no remodel match (5pts) + no freshness (0pts) + no dispersion (0pts) = 5
    assert score < 10


def test_confidence_full_score():
    updated = datetime.now(timezone.utc)
    score, _, _ = compute_confidence(10, True, updated, [1000.0, 1050.0, 980.0])
    assert score > 60


def test_confidence_bounds():
    cases = [
        (0, False, None, None),
        (1, False, None, None),
        (5, True, datetime.now(timezone.utc), [500.0, 520.0]),
        (10, True, datetime.now(timezone.utc), [1000.0, 800.0, 1200.0]),
    ]
    for args in cases:
        score, _, _ = compute_confidence(*args)
        assert 0 <= score <= 100, f"score {score} out of bounds for args {args}"


def test_confidence_returns_tuple():
    result = compute_confidence(3, True, datetime.now(timezone.utc), [1000.0, 1010.0])
    assert isinstance(result, tuple)
    assert len(result) == 3
    score, notes, warnings = result
    assert isinstance(score, int)
    assert isinstance(notes, str)
    assert isinstance(warnings, list)
