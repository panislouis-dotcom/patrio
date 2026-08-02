"""The lifecycle: which moves are legal, what each stage demands before it will
accept a property, and the fact that every move leaves a trace.

The API has to reject before the UPDATE reaches PostgreSQL — a 422 with a
sentence, never the trigger's 500. Every illegal case here asserts the status
code *and* that the row did not move.
"""
from api.db import get_db
from api.properties_db import ALLOWED_TRANSITIONS


def _transition(client, property_id, **body):
    return client.post(f"/api/properties/{property_id}/transition", json=body)


def _status(property_id: int) -> str:
    with get_db() as conn:
        return conn.execute("SELECT status FROM properties WHERE id = %s",
                            (property_id,)).fetchone()["status"]


def _events(property_id: int) -> list[dict]:
    with get_db() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM property_status_events WHERE property_id = %s ORDER BY id",
            (property_id,)).fetchall()]


# ── Legal moves ──────────────────────────────────────────────────────────────

def test_creation_is_recorded_as_the_first_event(client, test_property):
    events = _events(test_property["id"])
    assert len(events) == 1
    assert events[0]["from_status"] is None
    assert events[0]["to_status"] == "prospecto"


def test_prospecto_to_oferta_needs_a_modeled_exit(client, test_property):
    r = _transition(client, test_property["id"], to="oferta")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "oferta"


def test_the_gate_accepts_the_missing_input_in_the_body(client, test_property):
    """An oferta must model its exit; supplying it in the transition is enough."""
    client.post(f"/api/properties/{test_property['id']}/clear-fields",
                json={"fields": ["projectedSale"]})
    assert _transition(client, test_property["id"], to="oferta").status_code == 422
    r = _transition(client, test_property["id"], to="oferta", projectedSale=2_500_000)
    assert r.status_code == 200, r.text
    assert float(r.json()["projectedSale"]) == 2_500_000


def test_every_transition_writes_its_event(client, desarrollo_property):
    events = _events(desarrollo_property["id"])
    assert [(e["from_status"], e["to_status"]) for e in events] == [
        (None, "prospecto"), ("prospecto", "oferta"), ("oferta", "desarrollo")]


def test_the_event_carries_its_date_and_note(client, test_property):
    r = _transition(client, test_property["id"], to="oferta",
                    effectiveOn="2026-05-04", notes="Oferta presentada.")
    assert r.status_code == 200, r.text
    event = _events(test_property["id"])[-1]
    assert str(event["effective_on"]) == "2026-05-04"
    assert event["notes"] == "Oferta presentada."


def test_the_event_records_who_moved_it(client, test_property):
    """created_by resolves from the authenticated email — the only identity both
    auth paths carry (an API key's own id is not a user id)."""
    from api.db import get_db
    _transition(client, test_property["id"], to="oferta")
    with get_db() as conn:
        actor = conn.execute(
            "SELECT u.email FROM property_status_events e JOIN users u ON u.id = e.created_by"
            " WHERE e.property_id = %s AND e.to_status = 'oferta'",
            (test_property["id"],)).fetchone()
    assert actor is not None and actor["email"] == "test@test.com"


def test_desarrollo_can_flip_straight_to_vendida(client, desarrollo_property):
    """A flip never rents; the lifecycle must not force it through en_renta."""
    r = _transition(client, desarrollo_property["id"], to="vendida",
                    saleDate="2026-07", salePrice=5_000_000)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "vendida"


# ── Illegal moves ────────────────────────────────────────────────────────────

def test_skipping_a_stage_is_refused_before_the_database(client, test_property):
    r = _transition(client, test_property["id"], to="desarrollo",
                    acquisitionDate="2025-01", totalUnits=4, currentValuation=4_000_000)
    assert r.status_code == 422, r.text
    assert "prospecto" in r.json()["error"]["message"]
    assert _status(test_property["id"]) == "prospecto"


def test_vendida_is_terminal(client, desarrollo_property):
    _transition(client, desarrollo_property["id"], to="vendida",
                saleDate="2026-07", salePrice=5_000_000)
    r = _transition(client, desarrollo_property["id"], to="archivada")
    assert r.status_code == 422
    assert _status(desarrollo_property["id"]) == "vendida"


def test_archivada_is_terminal(client, test_property):
    _transition(client, test_property["id"], to="archivada")
    r = _transition(client, test_property["id"], to="oferta")
    assert r.status_code == 422
    assert _status(test_property["id"]) == "archivada"


def test_desarrollo_refuses_a_property_with_no_investment_base(client, test_property):
    _transition(client, test_property["id"], to="oferta")
    client.post(f"/api/properties/{test_property['id']}/clear-fields",
                json={"fields": ["landPrice"]})
    r = _transition(client, test_property["id"], to="desarrollo",
                    acquisitionDate="2025-01", totalUnits=4, currentValuation=4_000_000)
    assert r.status_code == 422
    assert "inversión" in r.json()["error"]["message"].lower()
    assert _status(test_property["id"]) == "oferta"


def test_en_renta_refuses_a_rent_of_zero(client, desarrollo_property):
    """NULL means "not captured" and a stored rent is always positive — 0 is
    neither, so it is rejected rather than silently stored."""
    r = _transition(client, desarrollo_property["id"], to="en_renta",
                    firstRentDate="2026-03", rentMonthly=0, currentValuation=4_000_000)
    assert r.status_code == 422
    assert _status(desarrollo_property["id"]) == "desarrollo"


def test_a_sale_cannot_precede_the_purchase(client, desarrollo_property):
    """A cross-field CHECK the API mirrors, so the answer is a sentence and not
    a constraint violation."""
    r = _transition(client, desarrollo_property["id"], to="vendida",
                    saleDate="2024-01", salePrice=5_000_000)
    assert r.status_code == 422
    assert "anterior" in r.json()["error"]["message"]
    assert _status(desarrollo_property["id"]) == "desarrollo"


def test_a_transition_on_a_missing_property_is_404(client):
    assert _transition(client, 999_999_999, to="oferta").status_code == 404


def test_an_unknown_target_status_is_rejected_by_the_schema(client, test_property):
    assert _transition(client, test_property["id"], to="operating").status_code == 422


def test_the_graph_matches_the_database_trigger():
    """The API's table is a mirror of migration 024's trigger, not a second
    opinion. If the two ever disagree the user gets a 500, so the shape is
    pinned here."""
    assert ALLOWED_TRANSITIONS == {
        "prospecto": frozenset({"oferta", "archivada"}),
        "oferta": frozenset({"desarrollo", "archivada"}),
        "desarrollo": frozenset({"en_renta", "vendida", "archivada"}),
        "en_renta": frozenset({"vendida", "archivada"}),
        "vendida": frozenset(),
        "archivada": frozenset(),
    }


# ── PATCH cannot move the lifecycle or empty a field ─────────────────────────

def test_patch_cannot_change_status(client, test_property):
    r = client.patch(f"/api/properties/{test_property['id']}", json={"status": "desarrollo"})
    assert r.status_code == 200            # unknown keys are simply not writable
    assert r.json()["status"] == "prospecto"
    assert _status(test_property["id"]) == "prospecto"


def test_patch_cannot_clear_a_field(client, test_property):
    r = client.patch(f"/api/properties/{test_property['id']}", json={"rentMonthly": None})
    assert r.status_code == 200
    assert float(r.json()["rentMonthly"]) == 18000


def test_patch_updates_what_it_is_given(client, test_property):
    r = client.patch(f"/api/properties/{test_property['id']}", json={"name": "[TEST] Renombrada"})
    assert r.status_code == 200
    assert r.json()["name"] == "[TEST] Renombrada"


def test_patch_cannot_break_the_stage_it_is_in(client, desarrollo_property):
    r = client.patch(f"/api/properties/{desarrollo_property['id']}",
                     json={"acquisitionDate": "2027-01", "firstRentDate": "2026-01"})
    assert r.status_code == 422


# ── clear-fields ─────────────────────────────────────────────────────────────

def test_clear_fields_empties_an_allowlisted_column(client, test_property):
    r = client.post(f"/api/properties/{test_property['id']}/clear-fields",
                    json={"fields": ["rentMonthly", "holdMonths"]})
    assert r.status_code == 200, r.text
    assert r.json()["rentMonthly"] is None
    assert r.json()["holdMonths"] is None


def test_clear_fields_refuses_anything_off_the_allowlist(client, test_property):
    for field in ("status", "name", "city", "latitude", "createdAt"):
        r = client.post(f"/api/properties/{test_property['id']}/clear-fields",
                        json={"fields": [field]})
        assert r.status_code == 422, field
        assert "no vaciables" in r.json()["error"]["message"]


def test_clear_fields_will_not_strand_a_property_in_its_stage(client, desarrollo_property):
    """acquisitionDate is clearable — on a prospecto. On a property already in
    desarrollo it is the thing that makes the stage true."""
    r = client.post(f"/api/properties/{desarrollo_property['id']}/clear-fields",
                    json={"fields": ["acquisitionDate"]})
    assert r.status_code == 422
    assert "adquisición" in r.json()["error"]["message"]


def test_clear_fields_still_allows_fixing_an_unrelated_field(client, desarrollo_property):
    """A row that already fails a rule must stay editable, or SQL is the only
    way out of a bad record."""
    with get_db() as conn:
        conn.execute("UPDATE properties SET current_valuation = NULL WHERE id = %s",
                     (desarrollo_property["id"],))
    r = client.post(f"/api/properties/{desarrollo_property['id']}/clear-fields",
                    json={"fields": ["holdMonths"]})
    assert r.status_code == 200, r.text


# ── Listing ──────────────────────────────────────────────────────────────────

def test_archived_properties_are_hidden_by_default(client, test_property):
    _transition(client, test_property["id"], to="archivada")
    listed = client.get("/api/properties").json()
    assert not any(p["id"] == test_property["id"] for p in listed)
    with_archived = client.get("/api/properties?include_archived=true").json()
    assert any(p["id"] == test_property["id"] for p in with_archived)


def test_status_filter(client, test_property):
    ids = [p["id"] for p in client.get("/api/properties?status=prospecto").json()]
    assert test_property["id"] in ids
    ids = [p["id"] for p in client.get("/api/properties?status=vendida").json()]
    assert test_property["id"] not in ids


def test_favorite_and_city_filters(client, test_property):
    client.patch(f"/api/properties/{test_property['id']}", json={"isFavorite": True})
    ids = [p["id"] for p in client.get("/api/properties?is_favorite=true&city=monterrey").json()]
    assert test_property["id"] in ids


def test_roi_filter_reads_the_stage_appropriate_return(client, test_property):
    """projectedRoi for this prospecto is 0.2000 (3,480,000 → 4,000,000 over 18
    months would be lower; the fixture's 2,500,000 exit is a loss), so filtering
    above it excludes the row and below it includes it."""
    roi = float(client.get(f"/api/properties/{test_property['id']}").json()["projectedRoi"])
    included = [p["id"] for p in client.get(f"/api/properties?min_roi={roi - 0.01}").json()]
    excluded = [p["id"] for p in client.get(f"/api/properties?min_roi={roi + 0.01}").json()]
    assert test_property["id"] in included
    assert test_property["id"] not in excluded
