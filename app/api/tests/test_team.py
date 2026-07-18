"""Integration tests for /api/team routes."""
import pytest
from api.db import get_db


@pytest.fixture
def test_team_member(client):
    r = client.post("/api/team", json={"name": "[TEST] Member", "role": "maestro", "email": "test-member@refigan.com"})
    assert r.status_code == 201
    member = r.json()
    yield member
    with get_db() as conn:
        conn.execute("DELETE FROM team_members WHERE id = %s", (member["id"],))


def test_get_team_returns_list(client):
    r = client.get("/api/team")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_create_team_member(client, test_team_member):
    assert "id" in test_team_member
    assert test_team_member["name"] == "[TEST] Member"
    assert test_team_member["role"] == "maestro"


def test_patch_team_member(client, test_team_member):
    r = client.patch(f"/api/team/{test_team_member['id']}", json={"name": "[TEST] Updated"})
    assert r.status_code == 200
    assert r.json()["name"] == "[TEST] Updated"


def test_delete_team_member(client, test_team_member):
    r = client.delete(f"/api/team/{test_team_member['id']}")
    assert r.status_code == 204
    # fixture teardown will try the same DELETE — it's a no-op


def test_delete_nonexistent_404(client):
    r = client.delete("/api/team/999999")
    assert r.status_code == 404


def test_requires_auth(client):
    from api.main import app
    from api.auth import get_current_user
    app.dependency_overrides.clear()
    try:
        r = client.get("/api/team")
        assert r.status_code == 401
    finally:
        app.dependency_overrides[get_current_user] = lambda: {"id": 1, "email": "test@test.com"}
