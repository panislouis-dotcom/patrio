"""
CLI to create a user in the database.

Usage:
    python -m api.create_user user@example.com mysecretpassword
"""
import sys
import os
from dotenv import load_dotenv

load_dotenv()

from api.db import get_db
from api.auth import hash_password


def create_user(email: str, password: str) -> None:
    hashed = hash_password(password)
    with get_db() as conn:
        conn.execute(
            "INSERT INTO users (email, hashed_password) VALUES (%s, %s)",
            (email, hashed),
        )
    print(f"User created: {email}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python -m api.create_user <email> <password>")
        sys.exit(1)
    create_user(sys.argv[1], sys.argv[2])
