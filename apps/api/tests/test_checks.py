from api.checks import run_checks, Issue

def _base() -> dict:
    """A valid prospect — no issues expected."""
    return {
        "id": 1, "name": "Test", "latitude": 25.68, "longitude": -100.33,
        "landPrice": 3000000, "sqmLand": 100, "roi": 0.25,
        "holdMonths": 18,
        "constructionOverhead": 1.3, "constructionCostPerSqm": 6000,
        "rentMonthly": 20000, "acquisitionCostPct": 0.06, "profit": 1000000,
    }

def test_no_issues_on_valid_prospect():
    assert run_checks(_base()) == []

def test_error_on_zero_latitude():
    p = _base(); p["latitude"] = 0
    issues = run_checks(p)
    assert any(i.field == "latitude" and i.severity == "error" for i in issues)

def test_error_on_zero_longitude():
    p = _base(); p["longitude"] = 0
    issues = run_checks(p)
    assert any(i.field == "longitude" and i.severity == "error" for i in issues)

def test_error_on_zero_land_price():
    p = _base(); p["landPrice"] = 0
    assert any(i.severity == "error" for i in run_checks(p))

def test_error_on_zero_sqm_land():
    p = _base(); p["sqmLand"] = 0
    assert any(i.field == "sqmLand" and i.severity == "error" for i in run_checks(p))

def test_error_on_negative_roi():
    p = _base(); p["roi"] = -0.05
    assert any(i.field == "roi" and i.severity == "error" for i in run_checks(p))

def test_error_on_low_overhead():
    p = _base(); p["constructionOverhead"] = 0.9
    assert any(i.field == "constructionOverhead" and i.severity == "error" for i in run_checks(p))

def test_warning_on_zero_construction_cost():
    p = _base(); p["constructionCostPerSqm"] = 0
    assert any(i.field == "constructionCostPerSqm" and i.severity == "warning" for i in run_checks(p))

def test_warning_on_zero_rent():
    p = _base(); p["rentMonthly"] = 0
    assert any(i.field == "rentMonthly" and i.severity == "warning" for i in run_checks(p))

def test_warning_on_high_acquisition_cost():
    p = _base(); p["acquisitionCostPct"] = 0.12
    assert any(i.field == "acquisitionCostPct" and i.severity == "warning" for i in run_checks(p))

def test_warning_on_low_profit():
    p = _base(); p["profit"] = 400000
    assert any(i.field == "profit" and i.severity == "warning" for i in run_checks(p))
