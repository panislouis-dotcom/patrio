"""Integration tests for /api/users routes."""
import pytest
from api.db import get_db
from api.auth import hash_password


@pytest.fixture
def self_user_id():
    """Ensure a user with the bypass-auth email exists in the DB, yield its id."""
    with get_db() as conn:
        conn.execute(
            "INSERT INTO users (email, hashed_password) VALUES (%s, %s) ON CONFLICT (email) DO NOTHING",
            ("test@test.com", hash_password("testpass123")),
        )
        row = conn.execute("SELECT id FROM users WHERE email = 'test@test.com'").fetchone()
    uid = dict(row)["id"]
    yield uid
    with get_db() as conn:
        conn.execute("DELETE FROM users WHERE id = %s", (uid,))


@pytest.fixture
def test_user(client):
    """Create a fresh test user, yield it, then delete."""
    r = client.post("/api/users", json={"email": "newuser-test@refigan.com", "password": "secure1234"})
    assert r.status_code == 201
    user = r.json()
    yield user
    with get_db() as conn:
        conn.execute("DELETE FROM users WHERE id = %s", (user["id"],))


def test_list_users(client):
    r = client.get("/api/users")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_create_user(client, test_user):
    assert "id" in test_user
    assert test_user["email"] == "newuser-test@refigan.com"


def test_create_user_duplicate_email_409(client, test_user):
    r = client.post("/api/users", json={"email": "newuser-test@refigan.com", "password": "secure1234"})
    assert r.status_code == 409


def test_create_user_short_password_422(client):
    r = client.post("/api/users", json={"email": "shortpw@refigan.com", "password": "short"})
    assert r.status_code == 422


def test_patch_user_self(client, self_user_id):
    r = client.patch(f"/api/users/{self_user_id}", json={"password": "newpassword123"})
    assert r.status_code == 200


def test_patch_user_self_deactivate_400(client, self_user_id):
    r = client.patch(f"/api/users/{self_user_id}", json={"isActive": False})
    assert r.status_code == 400


def test_patch_other_user_non_admin_403(client, test_user):
    # bypass_auth returns test@test.com (not admin, not the target user)
    r = client.patch(f"/api/users/{test_user['id']}", json={"isActive": True})
    assert r.status_code == 403


def test_patch_other_user_admin_200(client, test_user):
    from api.main import app
    from api.auth import get_current_user
    from api.config import ADMIN_EMAIL
    app.dependency_overrides[get_current_user] = lambda: {"id": 99, "email": ADMIN_EMAIL}
    try:
        r = client.patch(f"/api/users/{test_user['id']}", json={"isActive": True})
        assert r.status_code == 200
    finally:
        app.dependency_overrides[get_current_user] = lambda: {"id": 1, "email": "test@test.com"}


def test_delete_self_400(client, self_user_id):
    r = client.delete(f"/api/users/{self_user_id}")
    assert r.status_code == 400


def test_delete_other_user_non_admin_403(client, test_user):
    # bypass_auth returns test@test.com (not admin, not the target user)
    r = client.delete(f"/api/users/{test_user['id']}")
    assert r.status_code == 403


def test_delete_other_user_admin_204(client, test_user):
    from api.main import app
    from api.auth import get_current_user
    from api.config import ADMIN_EMAIL
    app.dependency_overrides[get_current_user] = lambda: {"id": 99, "email": ADMIN_EMAIL}
    try:
        r = client.delete(f"/api/users/{test_user['id']}")
        assert r.status_code == 204
        # fixture teardown will be a no-op
    finally:
        app.dependency_overrides[get_current_user] = lambda: {"id": 1, "email": "test@test.com"}


def test_delete_nonexistent_404(client):
    r = client.delete("/api/users/999999")
    assert r.status_code == 404


def test_requires_auth(client, anonymous):
    r = client.get("/api/users")
    assert r.status_code == 401
