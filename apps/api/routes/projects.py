from pathlib import Path
from typing import Optional
from uuid import uuid4
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from api.auth import get_current_user
from api.db import get_projects, get_project, update_project, create_project, delete_project, set_project_image_path

router = APIRouter()

_FILES_BASE = Path(__file__).parent.parent.parent.parent / "data" / "files"
_ALLOWED_MIME = {"image/jpeg", "image/png", "image/gif", "image/webp"}
_MAX_IMAGE_SIZE = 20 * 1024 * 1024  # 20 MB


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


@router.delete("/api/projects/{project_id}", status_code=204)
def remove_project(project_id: int, _: dict = Depends(get_current_user)):
    try:
        delete_project(project_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Project not found")


@router.post("/api/projects/{project_id}/image", status_code=200)
async def upload_project_image(
    project_id: int,
    file: UploadFile = File(...),
    _: dict = Depends(get_current_user),
):
    p = get_project(project_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Project not found")

    if file.content_type not in _ALLOWED_MIME:
        raise HTTPException(status_code=415, detail=f"Unsupported media type: {file.content_type}")

    content = await file.read(_MAX_IMAGE_SIZE + 1)
    if len(content) > _MAX_IMAGE_SIZE:
        raise HTTPException(status_code=413, detail="Image too large (max 20 MB)")

    ext = Path(file.filename).suffix if file.filename else ""
    relative_path = f"projects/{project_id}/{uuid4().hex}{ext}"
    full_path = _FILES_BASE / relative_path
    try:
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_bytes(content)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to store image") from exc

    try:
        set_project_image_path(project_id, relative_path)
    except ValueError:
        full_path.unlink(missing_ok=True)
        raise HTTPException(status_code=404, detail="Project not found")
    except Exception:
        full_path.unlink(missing_ok=True)
        raise

    return get_project(project_id)
