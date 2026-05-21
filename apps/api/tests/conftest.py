import os
import shutil
import subprocess
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
    os.environ.get("TEST_DATABASE_URL")
    or _env.get("TEST_DATABASE_URL")
    or "postgresql://postgres:postgres@localhost:5432/refigan_test"
)
os.environ["DATABASE_URL"] = _TEST_URL
os.environ.setdefault("JWT_SECRET", "test-secret-key-for-unit-tests-minimum-32-chars")

_DB_DIR = Path(__file__).parent.parent.parent.parent / "db"


def _with_sslmode_disable(url: str) -> str:
    sep = "&" if "?" in url else "?"
    return url if "sslmode" in url else f"{url}{sep}sslmode=disable"


def _docker_url(url: str) -> str:
    """Rewrite localhost → host.docker.internal and ensure sslmode=disable."""
    url = url.replace("localhost", "host.docker.internal").replace(
        "127.0.0.1", "host.docker.internal"
    )
    return _with_sslmode_disable(url)


def _run_dbmate(db_url: str) -> None:
    """Run dbmate up — local binary if available, otherwise docker run."""
    dbmate_bin = shutil.which("dbmate")
    if dbmate_bin:
        cmd = [
            dbmate_bin,
            "--url", _with_sslmode_disable(db_url),
            "--migrations-dir", str(_DB_DIR / "migrations"),
            "--no-dump-schema",
            "up",
        ]
    else:
        cmd = [
            "docker", "run", "--rm",
            "-e", f"DATABASE_URL={_docker_url(db_url)}",
            "-v", f"{_DB_DIR}:/db",
            "ghcr.io/amacneil/dbmate:latest",
            "--no-dump-schema", "up",
        ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"dbmate up failed:\n{result.stderr}\n{result.stdout}")


# ── Bootstrap: create refigan_test and run migrations (idempotent) ───────────
def _bootstrap_test_db() -> None:
    db_name = _TEST_URL.rsplit("/", 1)[1]
    _TEST_MARKERS = ("_test", "test_", "-test")
    if not any(m in db_name for m in _TEST_MARKERS):
        raise RuntimeError(
            f"conftest: refusing to DROP DATABASE '{db_name}' — "
            f"name does not contain any of {_TEST_MARKERS}. "
            "Set TEST_DATABASE_URL to a database with '_test' in its name."
        )
    admin_url = _TEST_URL.rsplit("/", 1)[0] + "/postgres"

    conn = psycopg2.connect(admin_url)
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    cur = conn.cursor()
    cur.execute(f'DROP DATABASE IF EXISTS "{db_name}"')
    cur.execute(f'CREATE DATABASE "{db_name}"')
    conn.close()

    _run_dbmate(_TEST_URL)


_bootstrap_test_db()
