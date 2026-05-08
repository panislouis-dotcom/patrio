import json
import base64
import os

import pytest

os.environ.setdefault("JWT_SECRET", "testsecret")
os.environ.setdefault("DATABASE_URL", os.environ.get("DATABASE_URL", ""))

from api.auth import create_access_token, hash_password, verify_password
from fastapi.testclient import TestClient
from api.main import app
from api.db import get_db

client = TestClient(app)

TEST_EMAIL = "authtest@refigan.com"
TEST_PW = "testpass123"


def test_hash_and_verify_password():
    hashed = hash_password("mysecret")
    assert verify_password("mysecret", hashed) is True
    assert verify_password("wrong", hashed) is False


def test_create_access_token_returns_string():
    token = create_access_token("user@example.com")
    assert isinstance(token, str)
    assert len(token.split(".")) == 3  # JWT has 3 parts


def test_token_contains_correct_email():
    token = create_access_token("user@example.com")
    payload_b64 = token.split(".")[1]
    # Pad base64 string
    payload_b64 += "=" * (-len(payload_b64) % 4)
    payload = json.loads(base64.b64decode(payload_b64))
    assert payload["sub"] == "user@example.com"


@pytest.fixture(autouse=True)
def seed_test_user():
    with get_db() as conn:
        conn.execute("DELETE FROM users WHERE email = %s", (TEST_EMAIL,))
        conn.execute(
            "INSERT INTO users (email, hashed_password) VALUES (%s, %s)",
            (TEST_EMAIL, hash_password(TEST_PW)),
        )
    yield
    with get_db() as conn:
        conn.execute("DELETE FROM users WHERE email = %s", (TEST_EMAIL,))


def test_login_returns_token():
    res = client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PW})
    assert res.status_code == 200
    assert "access_token" in res.json()


def test_login_wrong_password_returns_401():
    res = client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": "wrong"})
    assert res.status_code == 401


def test_login_unknown_email_returns_401():
    res = client.post("/api/auth/login", json={"email": "nobody@x.com", "password": "pw"})
    assert res.status_code == 401


def test_me_with_valid_token():
    token = client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PW}).json()["access_token"]
    res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["email"] == TEST_EMAIL


def test_me_without_token_returns_401():
    res = client.get("/api/auth/me")
    assert res.status_code == 401


def test_protected_route_without_token_returns_401():
    """Any previously open route must now require auth."""
    res = client.get("/api/team")
    assert res.status_code == 401


def test_protected_route_with_valid_token_returns_200():
    token = client.post(
        "/api/auth/login",
        json={"email": TEST_EMAIL, "password": TEST_PW}
    ).json()["access_token"]
    res = client.get("/api/team", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
