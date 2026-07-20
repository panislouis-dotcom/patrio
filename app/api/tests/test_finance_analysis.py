from api.finance.analysis import irr_newton, npv, monthly_payment, percentile, roi_cagr


def test_percentile_interpolates():
    assert percentile([10.0, 20.0, 30.0], 0.5) == 20.0


def test_npv_zero_rate_is_sum():
    assert npv(0.0, [-100.0, 50.0, 60.0]) == 10.0


def test_irr_newton_recovers_known_rate():
    # -100 now, +110 next period → 10% IRR
    r = irr_newton([-100.0, 110.0], guess=0.05)
    assert r is not None and abs(r - 0.10) < 1e-6


def test_monthly_payment_positive():
    assert monthly_payment(1_000_000, 0.13, 240) > 0


def test_roi_cagr_annualizes():
    # doubling over 12 months → 100% annualized
    assert abs(roi_cagr(100.0, 200.0, 12) - 1.0) < 1e-9


def test_roi_cagr_guards_return_none():
    assert roi_cagr(0.0, 200.0, 12) is None
    assert roi_cagr(100.0, 200.0, 0) is None
