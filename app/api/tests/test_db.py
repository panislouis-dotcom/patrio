from api.db import _camel_to_snake, _snake_to_camel
from api.properties_db import CLEARABLE_FIELDS, WRITABLE_FIELDS


def test_camel_to_snake_simple():
    assert _camel_to_snake("sqmLand") == "sqm_land"


def test_camel_to_snake_multi():
    assert _camel_to_snake("acquisitionCostPct") == "acquisition_cost_pct"


def test_camel_to_snake_single():
    assert _camel_to_snake("name") == "name"


def test_snake_to_camel_roundtrips_every_writable_field():
    for field in WRITABLE_FIELDS:
        assert _snake_to_camel(_camel_to_snake(field)) == field


def test_clearable_is_a_subset_of_writable_plus_lifecycle_facts():
    """Anything emptiable must be something the domain knows how to write back;
    otherwise clearing it would be a one-way door."""
    assert CLEARABLE_FIELDS <= WRITABLE_FIELDS


def test_status_is_writable_through_neither_door():
    assert "status" not in WRITABLE_FIELDS
    assert "status" not in CLEARABLE_FIELDS
