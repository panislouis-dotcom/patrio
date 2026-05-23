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

# ── Shared fixtures ───────────────────────────────────────────────────────────
import pytest
from fastapi.testclient import TestClient
from api.db import get_db


@pytest.fixture(autouse=True)
def bypass_auth():
    from api.main import app
    from api.auth import get_current_user
    app.dependency_overrides[get_current_user] = lambda: {"id": 1, "email": "test@test.com"}
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def client():
    from api.main import app
    return TestClient(app)


@pytest.fixture
def test_prospect(client):
    r = client.post("/api/prospects", json={
        "name": "[TEST] Lote Prueba",
        "address": "Calle Test 123, Monterrey",
        "city": "Monterrey",
        "status": "evaluating",
        "holdMonths": 18,
        "rentMonthly": 18000,
    })
    assert r.status_code == 201
    prospect = r.json()
    yield prospect
    with get_db() as conn:
        conn.execute("DELETE FROM analysis_snapshots WHERE prospect_id = %s", (prospect["id"],))
        conn.execute("DELETE FROM prospects WHERE id = %s", (prospect["id"],))


@pytest.fixture
def test_project(client):
    r = client.post("/api/projects", json={
        "name": "[TEST] Edificio Prueba",
        "type": "ground_up",
        "address": "Av. Test 100, Monterrey",
        "city": "Monterrey",
        "status": "construction",
        "totalUnits": 4,
        "acquisitionDate": "2025-01",
        "conclusionDate": "2026-06",
        "totalInvestment": 5000000,
        "currentValuation": 5000000,
        "valuationDate": "2026-01",
    })
    assert r.status_code == 201
    project = r.json()
    yield project
    with get_db() as conn:
        conn.execute("DELETE FROM profit_split_config WHERE project_id = %s", (project["id"],))
        conn.execute("DELETE FROM projects WHERE id = %s", (project["id"],))


@pytest.fixture
def test_project_image(test_project):
    """Insert a fake image row (no filesystem dependency) and clean up after."""
    with get_db() as conn:
        row = conn.execute(
            "INSERT INTO project_images (project_id, file_path, file_name, content_type)"
            " VALUES (%s, %s, %s, %s) RETURNING id",
            (test_project['id'], f"projects/{test_project['id']}/fake.jpg", 'fake.jpg', 'image/jpeg'),
        ).fetchone()
    image_id = row['id']
    yield {'id': image_id, 'project_id': test_project['id']}
    with get_db() as conn:
        conn.execute("DELETE FROM project_images WHERE id = %s", (image_id,))
