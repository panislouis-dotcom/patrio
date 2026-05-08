from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from api.auth import get_current_user
from api.profit_db import (
    get_profit_template, upsert_profit_template,
    get_project_profit, upsert_project_profit,
    compute_waterfall,
)
from api.db import get_project, get_team_members
from api.investor_db import get_project_investors

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
    maestroCount: Optional[int] = None
    ayudanteCount: Optional[int] = None
    plannedEndDate: Optional[str] = None
    actualEndDate: Optional[str] = None
    bufferDays: Optional[int] = None
    notes: Optional[str] = None


@router.get("/api/profit/template")
def get_template_route(_: dict = Depends(get_current_user)):
    return get_profit_template()


@router.put("/api/profit/template")
def update_template_route(body: ProfitConfigUpdate, _: dict = Depends(get_current_user)):
    return upsert_profit_template(body.model_dump(exclude_unset=True))


@router.get("/api/projects/{project_id}/profit")
def get_project_profit_route(project_id: int, _: dict = Depends(get_current_user)):
    project = get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    team = get_team_members()
    config = get_project_profit(project_id)
    project_investors_data = get_project_investors(project_id)
    waterfall = compute_waterfall(project, config, team, project_investors_data)
    return {"config": config, "waterfall": waterfall}


@router.put("/api/projects/{project_id}/profit")
def update_project_profit_route(project_id: int, body: ProfitConfigUpdate, _: dict = Depends(get_current_user)):
    project = get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    config = upsert_project_profit(project_id, body.model_dump(exclude_unset=True))
    team = get_team_members()
    project_investors_data = get_project_investors(project_id)
    waterfall = compute_waterfall(project, config, team, project_investors_data)
    return {"config": config, "waterfall": waterfall}
