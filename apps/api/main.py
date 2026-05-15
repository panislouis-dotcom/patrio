import os
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from api.config import ALLOWED_ORIGINS, ADMIN_EMAIL, ADMIN_PASSWORD_HASH
from api.routes import prospects, projects, sonar, team, processes, profit, investors, users, comparables, analyses
from api.routes.auth import router as auth_router
from api.db import get_db, execute_script
from api.process_db import sync_periodic_series
from api import geo


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


def _init_schema() -> None:
    schema_path = Path(__file__).parent.parent.parent / "data" / "schema.sql"
    execute_script(schema_path.read_text())


def _seed_admin() -> None:
    if not ADMIN_EMAIL or not ADMIN_PASSWORD_HASH:
        return
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO users (email, hashed_password, is_active)
            VALUES (%s, %s, TRUE)
            ON CONFLICT (email) DO UPDATE SET hashed_password = EXCLUDED.hashed_password
            """,
            (ADMIN_EMAIL, ADMIN_PASSWORD_HASH),
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    _check_env()
    _init_schema()
    _seed_admin()
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

FILES_DIR = Path(__file__).parent.parent.parent / "data" / "files"
FILES_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=str(FILES_DIR)), name="files")

app.include_router(prospects.router)
app.include_router(projects.router)
app.include_router(sonar.router)
app.include_router(team.router)
app.include_router(processes.router)
app.include_router(profit.router)
app.include_router(investors.router)
app.include_router(users.router)
app.include_router(comparables.router)
app.include_router(analyses.router)
app.include_router(auth_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# Serve React frontend in production container (not present in local dev)
FRONTEND_DIR = Path(__file__).parent.parent.parent / "frontend_dist"
if FRONTEND_DIR.exists():
    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        file_path = FRONTEND_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(FRONTEND_DIR / "index.html"))
