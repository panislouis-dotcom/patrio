from pathlib import Path
from typing import Optional
from uuid import uuid4
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from api.auth import get_current_user
from api.db import get_projects, get_project, update_project, create_project, delete_project, add_project_image, delete_project_image, update_project_image_type, get_project_geometry, set_project_geometry
from api import storage

router = APIRouter()
_ALLOWED_MIME = {"image/jpeg", "image/png", "image/gif", "image/webp"}
_MAX_IMAGE_SIZE = 20 * 1024 * 1024  # 20 MB
_FLOORPLAN_EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
_FLOORPLAN_ALLOWED_MIME = set(_FLOORPLAN_EXT)  # no GIF: not a sane format for a technical drawing


class _UnderwritingInputs(BaseModel):
    """The 11 prospect underwriting inputs a project may carry (Project ⊇ Prospect).
    All optional — a project without a breakdown falls back to its stored total."""
    sqmLand: Optional[float] = None
    sqmConstruction: Optional[float] = None
    landPrice: Optional[float] = None
    acquisitionCostPct: Optional[float] = None
    permitsCost: Optional[float] = None
    subdivisionCost: Optional[float] = None
    constructionCostPerSqm: Optional[float] = None
    constructionOverhead: Optional[float] = None
    projectedSale: Optional[float] = None
    holdMonths: Optional[int] = None
    rentMonthly: Optional[float] = None


class ProjectUpdate(_UnderwritingInputs):
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
    notes: Optional[str] = None
    prospectId: Optional[int] = None
    isFavorite: Optional[bool] = None


class ProjectCreate(_UnderwritingInputs):
    name: str
    type: str
    address: str
    city: str
    status: str
    totalUnits: int
    acquisitionDate: str
    conclusionDate: str
    totalInvestment: float = 0.0  # computed from the breakdown on conversion
    currentValuation: float
    valuationDate: str
    url: str = "https://refigan.mx"
    latitude: float = 0.0
    longitude: float = 0.0
    milestones: dict = Field(default_factory=dict)
    notes: str = "-"
    prospectId: Optional[int] = None


@router.get("/api/projects", operation_id="projects_list")
def list_projects(_: dict = Depends(get_current_user)):
    return get_projects()


@router.get("/api/projects/{project_id}", operation_id="projects_get")
def detail_project(project_id: int, _: dict = Depends(get_current_user)):
    p = get_project(project_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


@router.patch("/api/projects/{project_id}", operation_id="projects_update")
def patch_project(project_id: int, body: ProjectUpdate, _: dict = Depends(get_current_user)):
    payload = body.model_dump(exclude_unset=True)
    updated = update_project(project_id, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return updated


@router.post("/api/projects", status_code=201, operation_id="projects_create")
def post_project(body: ProjectCreate, _: dict = Depends(get_current_user)):
    created = create_project(body.model_dump(exclude_none=False))
    if created is None:
        raise HTTPException(status_code=500, detail="Project created but not retrievable")
    return created


@router.delete("/api/projects/{project_id}", status_code=204, operation_id="projects_delete")
def remove_project(project_id: int, _: dict = Depends(get_current_user)):
    try:
        delete_project(project_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Project not found")


@router.post("/api/projects/{project_id}/images", status_code=201, operation_id="project_images_upload")
async def upload_project_image(
    project_id: int,
    file: UploadFile = File(...),
    image_type: str = Form(default='antes'),
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
    if image_type not in ('antes', 'despues'):
        raise HTTPException(status_code=422, detail="image_type must be 'antes' or 'despues'")
    ext = Path(file.filename).suffix if file.filename else ""
    relative_path = f"projects/{project_id}/{uuid4().hex}{ext}"
    try:
        storage.upload(relative_path, content, file.content_type or "image/jpeg")
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to store image") from exc
    return add_project_image(project_id, relative_path, file.filename or "", file.content_type or "image/jpeg", image_type)


class GeometryBody(BaseModel):
    geometry: dict  # deep schema is validated in the TS engine (single source of truth)


@router.get("/api/projects/{project_id}/geometry", operation_id="projects_get_geometry")
def get_geometry(project_id: int, _: dict = Depends(get_current_user)):
    geo = get_project_geometry(project_id)
    if geo is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return geo


@router.put("/api/projects/{project_id}/geometry", operation_id="projects_set_geometry")
def put_geometry(project_id: int, body: GeometryBody,
                 _: dict = Depends(get_current_user)):
    saved = set_project_geometry(project_id, body.geometry)
    if saved is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return saved


@router.post("/api/projects/{project_id}/floorplan-image", status_code=201,
             operation_id="projects_upload_floorplan_image")
async def upload_floorplan_image(project_id: int, file: UploadFile = File(...),
                                  _: dict = Depends(get_current_user)):
    if get_project_geometry(project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if file.content_type not in _FLOORPLAN_ALLOWED_MIME:
        raise HTTPException(status_code=415, detail=f"Unsupported media type: {file.content_type}")
    content = await file.read(_MAX_IMAGE_SIZE + 1)
    if len(content) > _MAX_IMAGE_SIZE:
        raise HTTPException(status_code=413, detail="Image too large (max 20 MB)")
    ext = _FLOORPLAN_EXT[file.content_type]
    key = f"projects/{project_id}/floorplan/{uuid4().hex}{ext}"
    storage.upload(key, content, file.content_type)
    return {"imageKey": key}


@router.delete("/api/projects/{project_id}/images/{image_id}", status_code=204, operation_id="project_images_delete")
async def remove_project_image(
    project_id: int,
    image_id: int,
    _: dict = Depends(get_current_user),
):
    try:
        file_path = delete_project_image(image_id, project_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Image not found")
    storage.delete(file_path)


class ImageTypeUpdate(BaseModel):
    image_type: str


@router.patch("/api/projects/{project_id}/images/{image_id}", status_code=200, operation_id="project_images_update_type")
async def patch_project_image_type(
    project_id: int,
    image_id: int,
    body: ImageTypeUpdate,
    _: dict = Depends(get_current_user),
):
    if body.image_type not in ('antes', 'despues'):
        raise HTTPException(status_code=422, detail="image_type must be 'antes' or 'despues'")
    try:
        return update_project_image_type(image_id, project_id, body.image_type)
    except ValueError:
        raise HTTPException(status_code=404, detail="Image not found")
