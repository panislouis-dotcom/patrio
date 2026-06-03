from dataclasses import asdict
from pathlib import Path
from typing import Optional
from uuid import uuid4
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from api.auth import get_current_user
from api.db import get_prospects, get_prospect, update_prospect, create_prospect, add_prospect_image, delete_prospect_image, delete_prospect
from api.checks import run_checks
from api import storage

router = APIRouter()

_ALLOWED_MIME = {"image/jpeg", "image/png", "image/gif", "image/webp"}
_MAX_IMAGE_SIZE = 20 * 1024 * 1024  # 20 MB


class ProspectUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    status: Optional[str] = None
    type: Optional[str] = None
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
    isFavorite: Optional[bool] = None


class ProspectCreate(BaseModel):
    name: str
    address: str
    city: str
    status: str
    type: str = ""
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


@router.get("/api/prospects")
def list_prospects(_: dict = Depends(get_current_user)):
    prospects = get_prospects()
    return [_with_checks({**p, "score": _score(p, prospects)}) for p in prospects]


@router.get("/api/prospects/{prospect_id}")
def detail_prospect(prospect_id: int, _: dict = Depends(get_current_user)):
    p = get_prospect(prospect_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Prospect not found")
    all_prospects = get_prospects()
    return _with_checks({**p, "score": _score(p, all_prospects)})


@router.get("/api/quality")
def quality_report(_: dict = Depends(get_current_user)):
    prospects = get_prospects()
    return [
        {"id": p["id"], "name": p["name"],
         "issues": [asdict(i) for i in run_checks(p)]}
        for p in prospects
    ]


@router.patch("/api/prospects/{prospect_id}")
def patch_prospect(prospect_id: int, body: ProspectUpdate, _: dict = Depends(get_current_user)):
    payload = body.model_dump(exclude_none=True)
    updated = update_prospect(prospect_id, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="Prospect not found")
    all_prospects = get_prospects()
    return _with_checks({**updated, "score": _score(updated, all_prospects)})


@router.delete("/api/prospects/{prospect_id}", status_code=204)
def remove_prospect(prospect_id: int, _: dict = Depends(get_current_user)):
    try:
        delete_prospect(prospect_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Prospect not found")


@router.post("/api/prospects", status_code=201)
def post_prospect(body: ProspectCreate, _: dict = Depends(get_current_user)):
    created = create_prospect(body.model_dump(exclude_none=False))
    if created is None:
        raise HTTPException(status_code=500, detail="Prospect created but not retrievable")
    all_prospects = get_prospects()
    return _with_checks({**created, "score": _score(created, all_prospects)})


@router.post("/api/prospects/parse")
async def parse_prospect_route(
    url: str = Form(""),
    text: str = Form(""),
    file: Optional[UploadFile] = File(None),
    _: dict = Depends(get_current_user),
):
    from api.parse_prospect import parse_prospect
    image_bytes = await file.read() if file else None
    try:
        return parse_prospect(url=url.strip(), text=text.strip(), image_bytes=image_bytes)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error al analizar la propiedad: {e}")


@router.post("/api/prospects/{prospect_id}/images", status_code=201)
async def upload_prospect_image(
    prospect_id: int,
    file: UploadFile = File(...),
    _: dict = Depends(get_current_user),
):
    p = get_prospect(prospect_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Prospect not found")
    if file.content_type not in _ALLOWED_MIME:
        raise HTTPException(status_code=415, detail=f"Unsupported media type: {file.content_type}")
    content = await file.read(_MAX_IMAGE_SIZE + 1)
    if len(content) > _MAX_IMAGE_SIZE:
        raise HTTPException(status_code=413, detail="Image too large (max 20 MB)")
    ext = Path(file.filename).suffix if file.filename else ""
    relative_path = f"prospects/{prospect_id}/{uuid4().hex}{ext}"
    try:
        storage.upload(relative_path, content, file.content_type or "image/jpeg")
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to store image") from exc
    return add_prospect_image(prospect_id, relative_path, file.filename or "", file.content_type or "image/jpeg")


@router.delete("/api/prospects/{prospect_id}/images/{image_id}", status_code=204)
async def remove_prospect_image(
    prospect_id: int,
    image_id: int,
    _: dict = Depends(get_current_user),
):
    try:
        file_path = delete_prospect_image(image_id, prospect_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Image not found")
    storage.delete(file_path)
