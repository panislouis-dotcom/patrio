"""Unit tests for pure functions in api.profit_db — no DB, no HTTP."""
from api.profit_db import compute_waterfall, compute_bonus_tier

_PROJECT = {"totalInvestment": 3_000_000, "currentValuation": 3_000_000, "holdMonthsActual": 12}
_CONFIG = {"exitPrice": 5_000_000, "isrRate": 0.30}
_TEAM: list = []

EXPECTED_KEYS = {
    "exitPrice", "investment", "grossProfit", "investorCuota",
    "operatorGross", "isr", "netProfit", "distributable",
    "activeTier", "months", "investorBreakdown", "scenarios",
}


def test_waterfall_returns_expected_keys():
    result = compute_waterfall(_PROJECT, _CONFIG, _TEAM)
    assert EXPECTED_KEYS.issubset(result.keys())


def test_waterfall_gross_profit_math():
    result = compute_waterfall(_PROJECT, _CONFIG, _TEAM)
    assert result["grossProfit"] == 5_000_000 - 3_000_000


def test_waterfall_isr_applied():
    result = compute_waterfall(_PROJECT, _CONFIG, _TEAM)
    if result["operatorGross"] > 0:
        assert abs(float(result["isr"]) - float(result["operatorGross"]) * 0.30) < 1.0


def test_waterfall_zero_exit_no_crash():
    config = {**_CONFIG, "exitPrice": 0}
    result = compute_waterfall(_PROJECT, config, _TEAM)
    assert result["grossProfit"] <= 0


def test_waterfall_scenarios_present():
    result = compute_waterfall(_PROJECT, _CONFIG, _TEAM)
    assert set(result["scenarios"].keys()) == {"sin_bono", "bono_25", "bono_50"}


def test_bonus_tier_50_early():
    config = {"plannedEndDate": "2026-06-30", "bufferDays": 30, "actualEndDate": "2026-05-01"}
    assert compute_bonus_tier(config) == 0.50


def test_bonus_tier_25_on_time():
    # actual is between (planned - buffer) and (planned - buffer//2)
    config = {"plannedEndDate": "2026-06-30", "bufferDays": 30, "actualEndDate": "2026-06-05"}
    assert compute_bonus_tier(config) == 0.25


def test_bonus_tier_0_late():
    config = {"plannedEndDate": "2026-06-30", "bufferDays": 30, "actualEndDate": "2026-07-10"}
    assert compute_bonus_tier(config) == 0.0


def test_bonus_tier_none_missing_dates():
    assert compute_bonus_tier({}) is None
    assert compute_bonus_tier({"plannedEndDate": "2026-06-30"}) is None  # no bufferDays
