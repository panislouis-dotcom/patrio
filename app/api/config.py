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


def _optional_int(name: str, default: int, *, minimum: int = 1) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        val = int(raw)
    except ValueError:
        print(
            f"\nFATAL: environment variable {name!r} must be an integer (got {raw!r}).\n",
            file=sys.stderr,
        )
        sys.exit(1)
    if val < minimum:
        print(
            f"\nFATAL: environment variable {name!r} must be >= {minimum} (got {val}).\n",
            file=sys.stderr,
        )
        sys.exit(1)
    return val


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

# ── Database connection pool ──────────────────────────────────────────────────
# Sync route handlers run in FastAPI's anyio threadpool (default 40 threads), so
# up to ~40 requests can reach the pool at once. maxconn caps concurrent DB
# connections; get_db() blocks (rather than 500s) when the pool is saturated.
# Keep DB_POOL_MAX * replicas comfortably under Postgres max_connections (100,
# shared across apps on the CNPG cluster).
DB_POOL_MIN: int = _optional_int("DB_POOL_MIN", 1)
DB_POOL_MAX: int = _optional_int("DB_POOL_MAX", 20)
