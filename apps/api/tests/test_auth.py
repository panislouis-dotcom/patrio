import json
import base64
import os

import pytest

os.environ.setdefault("JWT_SECRET", "testsecret")

from api.auth import create_access_token, hash_password, verify_password


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
