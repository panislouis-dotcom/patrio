from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes import prospects, projects, sonar, team, processes

app = FastAPI(title="Refigan API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
)

app.include_router(prospects.router)
app.include_router(projects.router)
app.include_router(sonar.router)
app.include_router(team.router)
app.include_router(processes.router)
