from dataclasses import asdict
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from api.db import get_prospects, get_prospect
from api.checks import run_checks

app = FastAPI(title="Refigan API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


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
    return round(total * 100, 1)


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
