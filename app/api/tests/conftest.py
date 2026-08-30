import os
import shutil
import subprocess
import sys
from pathlib import Path

import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

_ROOT = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(_ROOT / "scripts"))

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
    db_name = _TEST_URL.rsplit("/", 1)[1].split("?", 1)[0]
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


def _refuse_colliding_migrations() -> None:
    """Antes de migrar nada, no después.

    El bootstrap tira y rehace la base de prueba en cada sesión, así que una
    colisión de números la encuentra dbmate ANTES que cualquier prueba: la
    sesión entera muere en este archivo con un `duplicate key ...
    schema_migrations_pkey` enterrado en treinta líneas de log, y
    test_migrations_contract.py —que existe justamente para explicarlo— no
    alcanza a correr. Preguntando aquí, la primera línea que se lee dice qué
    pasó y qué hacer.
    """
    import check_migration_numbers

    queja = check_migration_numbers.problem()
    if queja:
        raise RuntimeError(f"conftest: {queja}")


_refuse_colliding_migrations()
_bootstrap_test_db()

# ── Shared fixtures ───────────────────────────────────────────────────────────
import pytest
from fastapi.testclient import TestClient
from api.db import get_db


def _test_user() -> dict:
    """A real row in `users`. The override has to stand in for a genuinely
    authenticated user: property_status_events.created_by is a foreign key, so a
    made-up id would fail on every transition."""
    with get_db() as conn:
        row = conn.execute(
            "INSERT INTO users (email, hashed_password, is_active) VALUES (%s, %s, TRUE)"
            " ON CONFLICT (email) DO UPDATE SET is_active = TRUE RETURNING id, email",
            ("test@test.com", "x"),
        ).fetchone()
    return {"id": row["id"], "email": row["email"]}


@pytest.fixture(autouse=True)
def bypass_auth():
    from api.main import app
    from api.auth import get_current_user
    user = _test_user()
    app.dependency_overrides[get_current_user] = lambda: user
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def anonymous(bypass_auth):
    """Drop the auth override for one test, then hand it straight back — so a
    "requires auth" case cannot leave the rest of the file unauthenticated."""
    from api.main import app
    from api.auth import get_current_user
    override = app.dependency_overrides.pop(get_current_user)
    yield
    app.dependency_overrides[get_current_user] = override


@pytest.fixture
def client():
    from api.main import app
    return TestClient(app)


def _delete_property(property_id: int) -> None:
    """Satellites first: their FKs to properties have no ON DELETE CASCADE."""
    with get_db() as conn:
        conn.execute("DELETE FROM budgets WHERE property_id = %s", (property_id,))
        conn.execute("DELETE FROM profit_split_config WHERE property_id = %s", (property_id,))
        conn.execute("DELETE FROM process_instances WHERE property_id = %s", (property_id,))
        conn.execute("UPDATE signals SET property_id = NULL WHERE property_id = %s", (property_id,))
        conn.execute("DELETE FROM properties WHERE id = %s", (property_id,))


def _set_budget(property_id: int, amount) -> None:
    """Deja el costo de obra de una propiedad en `amount`, con un solo renglón.

    El total del presupuesto es la suma de sus renglones y no hay ruta que fije
    un total —se retiró con el residuo—, así que dejarlo en una cifra concreta
    es capturar renglones. Las pruebas que usan esto no son del presupuesto: les
    hace falta UN número de obra y les da igual cómo esté desglosado, así que lo
    ponen por SQL en una fila y siguen con lo suyo. `0` deja el presupuesto
    vacío, que es un estado legítimo y suma exactamente 0.
    """
    with get_db() as conn:
        budget_id = conn.execute(
            "SELECT id FROM budgets WHERE property_id = %s AND plan_id IS NULL",
            (property_id,)).fetchone()["id"]
        conn.execute("DELETE FROM budget_lines WHERE budget_id = %s", (budget_id,))
        if amount:
            conn.execute(
                "INSERT INTO budget_lines (budget_id, chapter_name, name, unit,"
                "                          quantity, unit_price)"
                " VALUES (%s, 'Otros', 'Obra', 'lote', 1, %s)",
                (budget_id, amount))


# The complete cost breakdown of a property, for a CREATE and only a create.
#
# It used to say "a create or a transition", and that stopped being true when the
# cost of works became the budget's sum. `constructionCostPerSqm` IS writable —
# it is the assumption you captured, and a PATCH stores it — but writing it moves
# nothing: the pair only reaches the BUDGET through the calculator that seeds the
# first line, and only POST /api/properties runs it. `constructionOverhead` is
# not writable at all: it is an input to that one calculation and nothing else.
# Hand this dict to a PATCH or a transition and no budget line is born.
#
# 1,000,000×1.065 + 50,000 + 25,000 + 200×9,000×1.3 = 3,480,000, where the last
# term is the seeded budget and therefore `constructionBudgeted`.
UNDERWRITING = dict(
    purchasePrice=1_000_000, acquisitionCostPct=0.065, permitsCost=50_000,
    subdivisionCost=25_000, sqmConstruction=200, constructionCostPerSqm=9_000,
    constructionOverhead=1.3, sqmLand=300,
)


@pytest.fixture
def test_property(client):
    """A property at the start of its life: prospecto, fully underwritten."""
    r = client.post("/api/properties", json={
        "name": "[TEST] Lote Prueba",
        "address": "Calle Test 123, Monterrey",
        "city": "Monterrey",
        "holdMonths": 18,
        "rentMonthlyProjected": 18000,
        "projectedSale": 2_500_000,
        **UNDERWRITING,
    })
    assert r.status_code == 201, r.text
    prop = r.json()
    yield prop
    _delete_property(prop["id"])


@pytest.fixture
def desarrollo_property(client, test_property):
    """The same property once it has been bought — the first status that carries
    an acquisition, a valuation and a realized mark."""
    for body in (
        {"to": "oferta"},
        {"to": "desarrollo", "acquisitionDate": "2025-01", "totalUnits": 4,
         "currentValuation": 4_000_000, "valuationDate": "2026-01"},
    ):
        r = client.post(f"/api/properties/{test_property['id']}/transition", json=body)
        assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def test_property_image(test_property):
    """Insert a fake image row (no filesystem dependency) and clean up after."""
    with get_db() as conn:
        row = conn.execute(
            "INSERT INTO property_images (property_id, file_path, file_name, content_type)"
            " VALUES (%s, %s, %s, %s) RETURNING id",
            (test_property['id'], f"properties/{test_property['id']}/fake.jpg",
             'fake.jpg', 'image/jpeg'),
        ).fetchone()
    image_id = row['id']
    yield {'id': image_id, 'property_id': test_property['id']}
    with get_db() as conn:
        conn.execute("DELETE FROM property_images WHERE id = %s", (image_id,))
