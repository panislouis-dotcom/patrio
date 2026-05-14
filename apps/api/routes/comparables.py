from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.auth import get_current_user
from api.db import (
    get_comparables, get_comparable,
    create_comparable, update_comparable,
)

router = APIRouter()


# ─── Pydantic models ────────────────────────────────

class ComparableCreate(BaseModel):
    """All required fields must be present — backend rejects if missing."""
    address: str
    zoneId: int
    m2: float
    price: int
    listingUrl: str
    sourcePortal: str
    listedAt: str  # ISO 8601

    # Optional
    neighborhood: str = ""
    city: str = "Monterrey"
    lat: Optional[float] = None
    lng: Optional[float] = None
    bedrooms: Optional[int] = None
    bathrooms: Optional[int] = None
    parkingSpots: Optional[int] = None
    propertyType: str = "casa"
    condition: str = "remodelada"
    styleTags: list[str] = Field(default_factory=list)
    notes: str = ""


class ComparableUpdate(BaseModel):
    """PATCH: only include fields to change. No DELETE — use status updates."""
    address: Optional[str] = None
    zoneId: Optional[int] = None
    m2: Optional[float] = None
    price: Optional[int] = None
    listingUrl: Optional[str] = None
    sourcePortal: Optional[str] = None
    listedAt: Optional[str] = None
    neighborhood: Optional[str] = None
    city: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    bedrooms: Optional[int] = None
    bathrooms: Optional[int] = None
    parkingSpots: Optional[int] = None
    propertyType: Optional[str] = None
    condition: Optional[str] = None
    styleTags: Optional[list[str]] = None
    status: Optional[str] = None
    soldAt: Optional[str] = None
    notes: Optional[str] = None


# ─── Routes ──────────────────────────────────────────

@router.get("/api/comparables")
def list_comparables(
    status: Optional[str] = None,
    zone_id: Optional[int] = None,
    _: dict = Depends(get_current_user),
):
    return get_comparables(status=status, zone_id=zone_id)


@router.get("/api/comparables/{comparable_id}")
def detail_comparable(comparable_id: int, _: dict = Depends(get_current_user)):
    c = get_comparable(comparable_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Comparable not found")
    return c


@router.post("/api/comparables", status_code=201)
def post_comparable(body: ComparableCreate, _: dict = Depends(get_current_user)):
    data = body.model_dump(exclude_none=False)
    created = create_comparable(data)
    if created is None:
        raise HTTPException(status_code=500, detail="Comparable created but not retrievable")
    return created


@router.patch("/api/comparables/{comparable_id}")
def patch_comparable(
    comparable_id: int,
    body: ComparableUpdate,
    _: dict = Depends(get_current_user),
):
    payload = body.model_dump(exclude_none=True)
    updated = update_comparable(comparable_id, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="Comparable not found")
    return updated
