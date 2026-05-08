from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from api.auth import get_current_user
from api.investor_db import (
    get_investors, get_investor, create_investor, update_investor, delete_investor,
    get_project_investors, upsert_project_investor, delete_project_investor,
)

router = APIRouter()


class InvestorCreate(BaseModel):
    name: str
    email: str = ''
    phone: str = ''
    notes: str = ''


class InvestorUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None


class ProjectInvestorUpsert(BaseModel):
    investorId: int
    status: str = 'interesado'
    interestedAmount: float = 0
    committedAmount: float = 0
    fundedAmount: float = 0
    interestRateAnnual: float = 0.12
    notes: str = ''


# ── Global investor routes ────────────────────────────────────────────────────

@router.get("/api/investors")
def list_investors(_: dict = Depends(get_current_user)):
    return get_investors()


@router.post("/api/investors", status_code=201)
def create_investor_route(body: InvestorCreate, _: dict = Depends(get_current_user)):
    return create_investor(body.model_dump())


@router.get("/api/investors/{investor_id}")
def get_investor_route(investor_id: int, _: dict = Depends(get_current_user)):
    inv = get_investor(investor_id)
    if inv is None:
        raise HTTPException(status_code=404, detail="Investor not found")
    return inv


@router.put("/api/investors/{investor_id}")
def update_investor_route(investor_id: int, body: InvestorUpdate, _: dict = Depends(get_current_user)):
    inv = get_investor(investor_id)
    if inv is None:
        raise HTTPException(status_code=404, detail="Investor not found")
    return update_investor(investor_id, body.model_dump(exclude_unset=True))


@router.delete("/api/investors/{investor_id}", status_code=204)
def delete_investor_route(investor_id: int, _: dict = Depends(get_current_user)):
    inv = get_investor(investor_id)
    if inv is None:
        raise HTTPException(status_code=404, detail="Investor not found")
    delete_investor(investor_id)


# ── Per-project investor routes ───────────────────────────────────────────────

@router.get("/api/projects/{project_id}/investors")
def list_project_investors(project_id: int, _: dict = Depends(get_current_user)):
    return get_project_investors(project_id)


@router.post("/api/projects/{project_id}/investors", status_code=201)
def upsert_project_investor_route(project_id: int, body: ProjectInvestorUpsert, _: dict = Depends(get_current_user)):
    data = body.model_dump()
    investor_id = data.pop("investorId")
    return upsert_project_investor(project_id, investor_id, data)


@router.put("/api/projects/{project_id}/investors/{investor_id}")
def update_project_investor_route(project_id: int, investor_id: int, body: ProjectInvestorUpsert, _: dict = Depends(get_current_user)):
    data = body.model_dump(exclude_unset=True)
    data.pop("investorId", None)
    return upsert_project_investor(project_id, investor_id, data)


@router.delete("/api/projects/{project_id}/investors/{investor_id}", status_code=204)
def delete_project_investor_route(project_id: int, investor_id: int, _: dict = Depends(get_current_user)):
    delete_project_investor(project_id, investor_id)
