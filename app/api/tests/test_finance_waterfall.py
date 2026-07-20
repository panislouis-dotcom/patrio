from decimal import Decimal
from api.finance.waterfall import compute_waterfall


def _base():
    project = {"totalInvestment": 5_000_000, "currentValuation": 7_000_000,
               "holdMonthsActual": 12, "conclusionDate": "2026-06"}
    config = {"isrRate": 0.30, "investorRateAnnual": 0.12, "finderFeePct": 0.0,
              "directorPct": 0.0, "responsablePct": 0.0, "liderPct": 0.0,
              "maestroPct": 0.0, "ayudantePct": 0.0}
    return project, config


def test_waterfall_keys_and_decimal_types():
    project, config = _base()
    w = compute_waterfall(project, config, team=[], project_investors=[])
    for k in ("exitPrice", "investment", "grossProfit", "investorCuota",
              "operatorGross", "isr", "netProfit", "distributable",
              "activeTier", "months", "investorBreakdown", "scenarios"):
        assert k in w
    assert isinstance(w["grossProfit"], Decimal)
    # gross = 7M - 5M = 2M
    assert w["grossProfit"] == Decimal("2000000")


def test_waterfall_runs_on_decimal_inputs():
    """Simulates post-migration reads: money arrives as Decimal, must not raise."""
    project, config = _base()
    project["totalInvestment"] = Decimal("5000000.00")
    project["currentValuation"] = Decimal("7000000.00")
    w = compute_waterfall(project, config, team=[], project_investors=[
        {"status": "fondeado", "investorId": 1, "investorName": "A",
         "fundedAmount": Decimal("1000000.00"), "interestRateAnnual": 0.12},
    ])
    assert w["investorCuota"] == Decimal("120000.00")  # 1M*0.12*12/12
