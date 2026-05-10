from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from api.config import ALLOWED_ORIGINS, ADMIN_EMAIL, ADMIN_PASSWORD_HASH
from api.routes import prospects, projects, sonar, team, processes, profit, investors, users
from api.routes.auth import router as auth_router
from api.db import get_db
from api.process_db import sync_periodic_series
from api import geo


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
    _seed_admin()
    sync_periodic_series()
    geo.load_colonias()
    yield


app = FastAPI(title="Refigan API", lifespan=lifespan)

_origins = ALLOWED_ORIGINS
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
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
app.include_router(auth_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# Serve React frontend in production container (not present in local dev)
FRONTEND_DIR = Path(__file__).parent.parent.parent / "frontend_dist"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
