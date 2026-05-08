from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from api.profit_db import (
    get_profit_template, upsert_profit_template,
    get_project_profit, upsert_project_profit,
    compute_waterfall,
)
from api.db import get_project, get_team_members

router = APIRouter()


class ProfitConfigUpdate(BaseModel):
    exitPrice: Optional[float] = None
    investorCapital: Optional[float] = None
    investorRateAnnual: Optional[float] = None
    investorMonths: Optional[float] = None
    isrRate: Optional[float] = None
    finderFeePct: Optional[float] = None
    directorPct: Optional[float] = None
    responsablePct: Optional[float] = None
    liderPct: Optional[float] = None
    maestroPct: Optional[float] = None
    ayudantePct: Optional[float] = None
    finderMemberId: Optional[int] = None
    responsableMemberId: Optional[int] = None
    liderMemberId: Optional[int] = None
    maestroMemberIds: Optional[list[int]] = None
    ayudanteMemberIds: Optional[list[int]] = None
    plannedEndDate: Optional[str] = None
    actualEndDate: Optional[str] = None
    bufferDays: Optional[int] = None
    notes: Optional[str] = None


@router.get("/api/profit/template")
def get_template_route():
    return get_profit_template()


@router.put("/api/profit/template")
def update_template_route(body: ProfitConfigUpdate):
    return upsert_profit_template(body.model_dump(exclude_unset=True))


@router.get("/api/projects/{project_id}/profit")
def get_project_profit_route(project_id: int):
    project = get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    team = get_team_members()
    config = get_project_profit(project_id)
    waterfall = compute_waterfall(project, config, team)
    return {"config": config, "waterfall": waterfall}


@router.put("/api/projects/{project_id}/profit")
def update_project_profit_route(project_id: int, body: ProfitConfigUpdate):
    project = get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    config = upsert_project_profit(project_id, body.model_dump(exclude_unset=True))
    team = get_team_members()
    waterfall = compute_waterfall(project, config, team)
    return {"config": config, "waterfall": waterfall}
