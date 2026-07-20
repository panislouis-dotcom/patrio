from api.db import _camel_to_snake, RAW_FIELDS


def test_camel_to_snake_simple():
    assert _camel_to_snake("sqmLand") == "sqm_land"


def test_camel_to_snake_multi():
    assert _camel_to_snake("acquisitionCostPct") == "acquisition_cost_pct"


def test_camel_to_snake_single():
    assert _camel_to_snake("name") == "name"


def test_raw_fields_contains_expected():
    assert "latitude" in RAW_FIELDS
    assert "landPrice" in RAW_FIELDS
    assert "constructionOverhead" in RAW_FIELDS
    assert "holdMonths" in RAW_FIELDS
    assert len(RAW_FIELDS) == 21


def test_parse_project_roi_decimal_safe(client, test_project):
    from api.db import get_project
    p = get_project(test_project["id"])
    assert "roi" in p and "unrealizedGain" in p and "unrealizedGainPct" in p
