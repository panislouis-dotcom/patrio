from dataclasses import asdict
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from api.db import get_prospects, get_prospect, update_prospect, create_prospect
from api.checks import run_checks

app = FastAPI(title="Refigan API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
)


class ProspectUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    status: Optional[str] = None
    url: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    sqmLand: Optional[float] = None
    sqmConstruction: Optional[float] = None
    landPrice: Optional[float] = None
    acquisitionCostPct: Optional[float] = None
    permitsCost: Optional[float] = None
    subdivisionCost: Optional[float] = None
    constructionCostPerSqm: Optional[float] = None
    constructionOverhead: Optional[float] = None
    projectedSale: Optional[float] = None
    rentMonthly: Optional[float] = None
    holdMonths: Optional[int] = None
    notes: Optional[str] = None


class ProspectCreate(BaseModel):
    name: str
    address: str
    city: str
    status: str
    holdMonths: int = 12
    url: str = "https://refigan.mx"
    latitude: float = 0.0
    longitude: float = 0.0
    sqmLand: float = 0.0
    sqmConstruction: float = 0.0
    landPrice: float = 0.0
    acquisitionCostPct: float = 0.065
    permitsCost: float = 0.0
    subdivisionCost: float = 0.0
    constructionCostPerSqm: float = 0.0
    constructionOverhead: float = 1.3
    projectedSale: float = 0.0
    rentMonthly: float = 0.0
    notes: str = "-"


def _with_checks(p: dict) -> dict:
    issues = [asdict(i) for i in run_checks(p)]
    return {**p, "issues": issues}


def _score(p: dict, all_prospects: list[dict]) -> float:
    """Weighted percentile rank: ROI 50%, capRate 30%, profit 20%. Returns 0-100."""
    weights = {"roi": 0.5, "capRate": 0.3, "profit": 0.2}
    total = 0.0
    for field, weight in weights.items():
        values = [x.get(field) or 0 for x in all_prospects]
        v = p.get(field) or 0
        below = sum(1 for x in values if x < v)
        ties = sum(1 for x in values if x == v)
        pct = (below + 0.5 * ties) / len(values) if values else 0.5
        total += pct * weight
    return round(total * 100)


@app.get("/api/prospects")
def list_prospects():
    prospects = get_prospects()
    return [_with_checks({**p, "score": _score(p, prospects)}) for p in prospects]


@app.get("/api/prospects/{prospect_id}")
def detail_prospect(prospect_id: int):
    p = get_prospect(prospect_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Prospect not found")
    all_prospects = get_prospects()
    return _with_checks({**p, "score": _score(p, all_prospects)})


@app.get("/api/quality")
def quality_report():
    prospects = get_prospects()
    return [
        {"id": p["id"], "name": p["name"],
         "issues": [asdict(i) for i in run_checks(p)]}
        for p in prospects
    ]


@app.patch("/api/prospects/{prospect_id}")
def patch_prospect(prospect_id: int, body: ProspectUpdate):
    payload = body.model_dump(exclude_none=True)
    updated = update_prospect(prospect_id, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="Prospect not found")
    all_prospects = get_prospects()
    return _with_checks({**updated, "score": _score(updated, all_prospects)})


@app.post("/api/prospects", status_code=201)
def post_prospect(body: ProspectCreate):
    created = create_prospect(body.model_dump(exclude_none=False))
    if created is None:
        raise HTTPException(status_code=500, detail="Prospect created but not retrievable")
    all_prospects = get_prospects()
    return _with_checks({**created, "score": _score(created, all_prospects)})
