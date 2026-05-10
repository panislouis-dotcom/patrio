import os
import re
from pathlib import Path

import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

# ── Resolve env file ─────────────────────────────────────────────────────────
_env_file = Path(__file__).parent.parent.parent.parent / ".env"
_env: dict[str, str] = {}
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        if "=" in _line and not _line.startswith("#"):
            _k, _, _v = _line.partition("=")
            _env[_k.strip()] = _v.strip()

# ── Always use the test DB — never the dev DB ────────────────────────────────
_TEST_URL = (
    _env.get("TEST_DATABASE_URL")
    or "postgresql://postgres:postgres@localhost:5432/refigan_test"
)
os.environ["DATABASE_URL"] = _TEST_URL
os.environ.setdefault("JWT_SECRET", "test-secret-key-for-unit-tests-minimum-32-chars")


# ── Bootstrap: create refigan_test and apply schema (idempotent) ─────────────
def _split_sql(sql: str) -> list[str]:
    """Split a SQL file into individual statements, stripping leading comments."""
    stmts = []
    for chunk in re.split(r";\s*\n", sql):
        # Strip leading comment lines, keep the actual SQL
        lines = [ln for ln in chunk.splitlines() if not ln.strip().startswith("--")]
        stmt = "\n".join(lines).strip()
        if stmt:
            stmts.append(stmt)
    return stmts


def _bootstrap_test_db() -> None:
    db_name = _TEST_URL.rsplit("/", 1)[1]
    admin_url = _TEST_URL.rsplit("/", 1)[0] + "/postgres"
    schema_sql = (Path(__file__).parent.parent.parent.parent / "data" / "schema.sql").read_text()

    # Create DB if it doesn't exist
    conn = psycopg2.connect(admin_url)
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,))
    if not cur.fetchone():
        cur.execute(f'CREATE DATABASE "{db_name}"')
    conn.close()

    # Apply schema statement by statement (idempotent: IF NOT EXISTS / OR REPLACE)
    conn = psycopg2.connect(_TEST_URL)
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    cur = conn.cursor()
    for stmt in _split_sql(schema_sql):
        cur.execute(stmt)
    conn.close()


_bootstrap_test_db()
