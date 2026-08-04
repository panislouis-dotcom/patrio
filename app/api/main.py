import os
import sys
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pathlib import Path
from api.config import ALLOWED_ORIGINS, ADMIN_EMAIL, ADMIN_PASSWORD_HASH
from api.routes import properties, sonar, team, processes, profit, investors, users, comparables, analyses, documents, proveedores, budget, budget_catalog
from api.routes.auth import router as auth_router
from api.db import get_db
from api.budget_db import BudgetError, BudgetNotFound
from api.properties_db import PropertyError, PropertyNotFound
from api.process_db import sync_periodic_series
from api import geo
from api.auth import hash_password

_REQUIRED_ENV = [
    "DATABASE_URL",
    "JWT_SECRET",
    "ANTHROPIC_API_KEY",
]


def _check_env() -> None:
    missing = [k for k in _REQUIRED_ENV if not os.environ.get(k)]
    if missing:
        print(f"[FATAL] Missing required environment variables: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)


def _assert_schema_ready() -> None:
    with get_db() as conn:
        row = conn.execute("SELECT to_regclass('public.schema_migrations')").fetchone()
    if row["to_regclass"] is None:
        print(
            "[FATAL] schema_migrations table missing — run: docker compose run --rm migrate",
            file=sys.stderr,
        )
        sys.exit(1)


def _seed_admin() -> None:
    if not ADMIN_EMAIL or not ADMIN_PASSWORD_HASH:
        return
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO users (email, hashed_password, is_active)
            VALUES (%s, %s, TRUE)
            ON CONFLICT (email) DO NOTHING
            """,
            (ADMIN_EMAIL, ADMIN_PASSWORD_HASH),
        )


def _seed_smoke_user() -> None:
    email = os.environ.get("SMOKE_EMAIL")
    password = os.environ.get("SMOKE_PASS")
    if not email or not password:
        return
    with get_db() as conn:
        exists = conn.execute(
            "SELECT 1 FROM users WHERE email = %s", (email,)
        ).fetchone()
        if exists is None:
            conn.execute(
                "INSERT INTO users (email, hashed_password, is_active) VALUES (%s, %s, TRUE)",
                (email, hash_password(password)),
            )


@asynccontextmanager
async def lifespan(_: FastAPI):
    _check_env()
    _assert_schema_ready()
    _seed_admin()
    _seed_smoke_user()
    sync_periodic_series()
    geo.load_colonias()
    yield


app = FastAPI(title="Refigan API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


def _status_to_code(status: int) -> str:
    return {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        413: "PAYLOAD_TOO_LARGE",
        415: "UNSUPPORTED_MEDIA_TYPE",
        422: "VALIDATION_ERROR",
        500: "INTERNAL_ERROR",
        502: "BAD_GATEWAY",
    }.get(status, f"HTTP_{status}")


def _error(status: int, message, headers: dict | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": _status_to_code(status), "message": message, "request_id": str(uuid.uuid4())}},
        headers=headers or {},
    )


@app.exception_handler(HTTPException)
async def _http_exc(request: Request, exc: HTTPException) -> JSONResponse:
    return _error(exc.status_code, exc.detail, getattr(exc, "headers", None))


# The property domain rejects in its own vocabulary; these two handlers are what
# keep a refused transition or a bad date a 422 with a sentence, instead of the
# 500 the database trigger would raise a moment later.
@app.exception_handler(PropertyNotFound)
async def _property_not_found(request: Request, exc: PropertyNotFound) -> JSONResponse:
    return _error(404, str(exc))


@app.exception_handler(PropertyError)
async def _property_rejected(request: Request, exc: PropertyError) -> JSONResponse:
    return _error(422, str(exc))


# El presupuesto rechaza en su propio vocabulario y por las mismas dos razones:
# no existe lo que se pidió, o la regla del residual no deja hacer lo que se
# pidió. Sin estos dos, «el remanente se calcula solo» le llegaría al navegador
# como un 500 disfrazado de error de CORS.
@app.exception_handler(BudgetNotFound)
async def _budget_not_found(request: Request, exc: BudgetNotFound) -> JSONResponse:
    return _error(404, str(exc))


@app.exception_handler(BudgetError)
async def _budget_rejected(request: Request, exc: BudgetError) -> JSONResponse:
    return _error(422, str(exc))


@app.exception_handler(RequestValidationError)
async def _validation_exc(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"error": {"code": "VALIDATION_ERROR", "message": str(exc.errors()), "request_id": str(uuid.uuid4())}},
    )


from api import storage as _storage

app.include_router(properties.router)
app.include_router(budget.router)
app.include_router(budget_catalog.router)
app.include_router(sonar.router)
app.include_router(team.router)
app.include_router(processes.router)
app.include_router(profit.router)
app.include_router(investors.router)
app.include_router(users.router)
app.include_router(comparables.router)
app.include_router(analyses.router)
app.include_router(documents.router)
app.include_router(proveedores.router)
app.include_router(auth_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/version")
def version() -> dict:
    return {"sha": os.environ.get("APP_VERSION", "dev")}


@app.get("/files/{path:path}", include_in_schema=False)
def serve_file(path: str):
    try:
        content, content_type = _storage.stream(path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    return Response(content=content, media_type=content_type)


# Serve React frontend in production container (not present in local dev)
FRONTEND_DIR = Path(__file__).parent.parent / "frontend_dist"
if FRONTEND_DIR.exists():
    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        file_path = FRONTEND_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(FRONTEND_DIR / "index.html"))
