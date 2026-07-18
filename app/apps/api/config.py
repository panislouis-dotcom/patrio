"""
Centralized configuration with fail-fast validation.

All environment variables are read and validated here. Any other module
that needs config must import from this module — never call os.environ
directly outside this file.

The app will exit with a clear error message at startup if required
variables are missing or invalid. This is intentional: silent misconfiguration
causes subtle, hard-to-diagnose bugs in production.
"""
import os
import sys

from dotenv import load_dotenv

load_dotenv()


def _require(name: str, *, min_len: int = 1) -> str:
    val = os.environ.get(name, "").strip()
    if len(val) < min_len:
        print(
            f"\nFATAL: environment variable {name!r} is missing or too short "
            f"(need at least {min_len} characters).\n"
            f"Set it in your .env file and restart the application.\n",
            file=sys.stderr,
        )
        sys.exit(1)
    return val


def _optional(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


# ── Required ─────────────────────────────────────────────────────────────────

# PostgreSQL connection string — e.g. postgresql://user:pass@host:5432/dbname
DATABASE_URL: str = _require("DATABASE_URL")

# JWT signing secret — must be long and random; tokens are forgeable if this leaks
JWT_SECRET: str = _require("JWT_SECRET", min_len=32)

# ── Optional with safe defaults ───────────────────────────────────────────────

# Comma-separated list of allowed CORS origins
ALLOWED_ORIGINS: list[str] = [
    o for o in _optional("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o
]

# Admin user seeding — app boots fine without these; seed is skipped if either is absent
ADMIN_EMAIL: str = _optional("ADMIN_EMAIL")
ADMIN_PASSWORD_HASH: str = _optional("ADMIN_PASSWORD_HASH")
