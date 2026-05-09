from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from api.auth import get_current_user
from api.db import get_projects, get_project, update_project, create_project

router = APIRouter()


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    status: Optional[str] = None
    url: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    totalUnits: Optional[int] = None
    acquisitionDate: Optional[str] = None
    conclusionDate: Optional[str] = None
    totalInvestment: Optional[float] = None
    currentValuation: Optional[float] = None
    valuationDate: Optional[str] = None
    milestones: Optional[dict] = None
    budget: Optional[dict] = None
    notes: Optional[str] = None
    prospectId: Optional[int] = None


class ProjectCreate(BaseModel):
    name: str
    type: str
    address: str
    city: str
    status: str
    totalUnits: int
    acquisitionDate: str
    conclusionDate: str
    totalInvestment: float
    currentValuation: float
    valuationDate: str
    url: str = "https://refigan.mx"
    latitude: float = 0.0
    longitude: float = 0.0
    milestones: dict = Field(default_factory=dict)
    budget: dict = Field(default_factory=dict)
    notes: str = "-"
    prospectId: Optional[int] = None


@router.get("/api/projects")
def list_projects(_: dict = Depends(get_current_user)):
    return get_projects()


@router.get("/api/projects/{project_id}")
def detail_project(project_id: int, _: dict = Depends(get_current_user)):
    p = get_project(project_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


@router.patch("/api/projects/{project_id}")
def patch_project(project_id: int, body: ProjectUpdate, _: dict = Depends(get_current_user)):
    payload = body.model_dump(exclude_unset=True)
    updated = update_project(project_id, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return updated


@router.post("/api/projects", status_code=201)
def post_project(body: ProjectCreate, _: dict = Depends(get_current_user)):
    created = create_project(body.model_dump(exclude_none=False))
    if created is None:
        raise HTTPException(status_code=500, detail="Project created but not retrievable")
    return created
