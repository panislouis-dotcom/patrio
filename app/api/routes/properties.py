"""The one surface for properties. CRUD plus the lifecycle operations that used
to be a convert button: a status only moves through /transition (gated, and
recorded), and a field is only emptied through /clear-fields (allowlisted).
PATCH can do neither, which is why nothing it sends can be a null."""
import asyncio
from pathlib import Path
from typing import Annotated, Literal, Optional, Union
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from api import properties_db as properties
from api import storage
from api.auth import get_current_user
from api.lib import images

router = APIRouter()

_ALLOWED_MIME = {"image/jpeg", "image/png", "image/gif", "image/webp"}
_MAX_IMAGE_SIZE = 20 * 1024 * 1024  # 20 MB
_FLOORPLAN_EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
_FLOORPLAN_ALLOWED_MIME = set(_FLOORPLAN_EXT)  # no GIF: not a sane format for a technical drawing


# ─── Bodies ───────────────────────────────────────────────────────────────────

class PropertyCreate(BaseModel):
    """A property is born a prospecto — `status` is not settable here or anywhere
    else. Anything left out falls back to properties_db.CAPTURE_DEFAULTS, so the
    form and the sonar importer produce the same starting row."""
    name: str
    address: str
    city: str
    url: str = ""
    latitude: float = 0.0
    longitude: float = 0.0
    assetType: Optional[str] = None
    strategyType: Optional[str] = None
    sqmLand: Optional[float] = None
    sqmConstruction: Optional[float] = None
    purchasePrice: Optional[float] = None
    acquisitionCostPct: Optional[float] = None
    landCommissionPct: Optional[float] = None
    constructionCommissionPct: Optional[float] = None
    exitSaleCommissionPct: Optional[float] = None
    exitRentMonths: Optional[float] = None
    permitsCost: Optional[float] = None
    subdivisionCost: Optional[float] = None
    constructionCostPerSqm: Optional[float] = None
    constructionOverhead: Optional[float] = None
    projectedSale: Optional[float] = None
    holdMonths: Optional[int] = None
    rentMonthlyProjected: Optional[float] = None
    notes: str = ""
    isFavorite: bool = False


class PropertyUpdate(BaseModel):
    """Everything optional and nothing nullable: the route drops unset *and* null
    keys, so a PATCH can raise a value or change it but never take it away."""
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    url: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    assetType: Optional[str] = None
    strategyType: Optional[str] = None
    sqmLand: Optional[float] = None
    sqmConstruction: Optional[float] = None
    purchasePrice: Optional[float] = None
    acquisitionCostPct: Optional[float] = None
    landCommissionPct: Optional[float] = None
    constructionCommissionPct: Optional[float] = None
    exitSaleCommissionPct: Optional[float] = None
    exitRentMonths: Optional[float] = None
    exitStrategy: Optional[str] = None
    permitsCost: Optional[float] = None
    subdivisionCost: Optional[float] = None
    constructionCostPerSqm: Optional[float] = None
    constructionOverhead: Optional[float] = None
    projectedSale: Optional[float] = None
    holdMonths: Optional[int] = None
    rentMonthlyProjected: Optional[float] = None
    rentMonthlyActual: Optional[float] = None
    totalUnits: Optional[int] = None
    acquisitionDate: Optional[str] = None
    firstRentDate: Optional[str] = None
    saleDate: Optional[str] = None
    salePrice: Optional[float] = None
    currentValuation: Optional[float] = None
    valuationDate: Optional[str] = None
    milestones: Optional[dict] = None
    notes: Optional[str] = None
    isFavorite: Optional[bool] = None


class _TransitionBase(BaseModel):
    effectiveOn: Optional[str] = None   # defaults to today in the events table
    notes: str = ""


class ToOferta(_TransitionBase):
    to: Literal["oferta"]
    projectedSale: Optional[float] = None   # required, unless already captured


class ToDesarrollo(_TransitionBase):
    to: Literal["desarrollo"]
    acquisitionDate: str
    totalUnits: int
    # La valuación NO se pide al comprar: nadie avalúa el día de la compra, y
    # exigirla solo lograba que se inventara. Se captura cuando exista un avalúo
    # de verdad; hasta entonces la ganancia no realizada es None, que es la
    # respuesta honesta.
    currentValuation: Optional[float] = None
    valuationDate: Optional[str] = None
    # La inversión no se teclea: sale del desglose. Lo que esta etapa sí exige es
    # el precio de compra — se acepta aquí, como `projectedSale` en ToOferta,
    # para que la transición pueda traerlo si la propiedad no lo trae ya.
    purchasePrice: Optional[float] = None


class ToEnRenta(_TransitionBase):
    to: Literal["en_renta"]
    firstRentDate: str
    rentMonthlyActual: float
    currentValuation: Optional[float] = None
    valuationDate: Optional[str] = None


class ToVendida(_TransitionBase):
    to: Literal["vendida"]
    saleDate: str
    salePrice: float


class ToArchivada(_TransitionBase):
    to: Literal["archivada"]


TransitionRequest = Annotated[
    Union[ToOferta, ToDesarrollo, ToEnRenta, ToVendida, ToArchivada],
    Field(discriminator="to"),
]


class ClearFieldsRequest(BaseModel):
    fields: list[str]


class GeometryBody(BaseModel):
    geometry: dict  # deep schema is validated in the TS engine (single source of truth)


class ImageTypeUpdate(BaseModel):
    image_type: str


class ImageReorderRequest(BaseModel):
    image_ids: list[int]


# ─── Collection ───────────────────────────────────────────────────────────────

@router.get("/api/properties", operation_id="properties_list")
def list_properties(
    status: Optional[str] = None,
    city: Optional[str] = None,
    is_favorite: Optional[bool] = None,
    min_roi: Optional[float] = None,
    max_roi: Optional[float] = None,
    include_archived: bool = False,
    _: dict = Depends(get_current_user),
):
    items = properties.get_properties(include_archived=include_archived)
    if status is not None:
        items = [p for p in items if p["status"] == status]
    if city is not None:
        needle = city.lower()
        items = [p for p in items if needle in (p.get("city") or "").lower()]
    if is_favorite is not None:
        items = [p for p in items if bool(p.get("isFavorite")) == is_favorite]
    if min_roi is not None:
        items = [p for p in items if float(properties.headline_roi(p) or 0) >= min_roi]
    if max_roi is not None:
        items = [p for p in items if float(properties.headline_roi(p) or 0) <= max_roi]
    return items


@router.post("/api/properties", status_code=201, operation_id="properties_create")
def create_property(body: PropertyCreate, _: dict = Depends(get_current_user)):
    return properties.create_property(body.model_dump(exclude_none=True))


@router.post("/api/properties/parse", operation_id="properties_parse")
async def parse_property_route(
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


@router.get("/api/quality", operation_id="properties_quality")
def quality_report(_: dict = Depends(get_current_user)):
    """Every property with what is wrong with it *at its own stage*."""
    return [
        {"id": p["id"], "name": p["name"], "status": p["status"], "issues": p["issues"]}
        for p in properties.get_properties(include_archived=False)
    ]


# ─── One property ─────────────────────────────────────────────────────────────

@router.get("/api/properties/{property_id}", operation_id="properties_get")
def get_property(property_id: int, _: dict = Depends(get_current_user)):
    found = properties.get_property(property_id)
    if found is None:
        raise HTTPException(status_code=404, detail="Propiedad no encontrada")
    return found


@router.patch("/api/properties/{property_id}", operation_id="properties_update")
def update_property(property_id: int, body: PropertyUpdate, _: dict = Depends(get_current_user)):
    return properties.update_property(property_id, body.model_dump(exclude_none=True))


@router.delete("/api/properties/{property_id}", status_code=204, operation_id="properties_delete")
def delete_property(property_id: int, _: dict = Depends(get_current_user)):
    properties.delete_property(property_id)


@router.post("/api/properties/{property_id}/transition", operation_id="properties_transition")
def transition_property(property_id: int, body: TransitionRequest,
                        user: dict = Depends(get_current_user)):
    payload = body.model_dump(exclude_none=True)
    to_status = payload.pop("to")
    effective_on = payload.pop("effectiveOn", None)
    notes = payload.pop("notes", "")
    return properties.transition(property_id, to_status, payload,
                                 effective_on=effective_on, notes=notes,
                                 actor_email=user.get("email"))


@router.post("/api/properties/{property_id}/clear-fields", operation_id="properties_clear_fields")
def clear_property_fields(property_id: int, body: ClearFieldsRequest,
                          _: dict = Depends(get_current_user)):
    return properties.clear_fields(property_id, body.fields)


# ─── Images ───────────────────────────────────────────────────────────────────

@router.post("/api/properties/{property_id}/images", status_code=201,
             operation_id="property_images_upload")
async def upload_property_image(
    property_id: int,
    file: UploadFile = File(...),
    image_type: str = Form(default="antes"),
    _: dict = Depends(get_current_user),
):
    if not properties.exists(property_id):
        raise HTTPException(status_code=404, detail="Propiedad no encontrada")
    if file.content_type not in _ALLOWED_MIME:
        raise HTTPException(status_code=415, detail=f"Unsupported media type: {file.content_type}")
    if image_type not in properties.IMAGE_TYPES:
        raise HTTPException(status_code=422,
                            detail=f"image_type debe ser uno de {', '.join(properties.IMAGE_TYPES)}")
    content = await file.read(_MAX_IMAGE_SIZE + 1)
    if len(content) > _MAX_IMAGE_SIZE:
        raise HTTPException(status_code=413, detail="Image too large (max 20 MB)")
    content = await asyncio.to_thread(images.normalize_orientation, content)
    ext = Path(file.filename).suffix if file.filename else ""
    relative_path = f"properties/{property_id}/{uuid4().hex}{ext}"
    try:
        storage.upload(relative_path, content, file.content_type or "image/jpeg")
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to store image") from exc
    return properties.add_image(property_id, relative_path, file.filename or "",
                                file.content_type or "image/jpeg", image_type)


@router.delete("/api/properties/{property_id}/images/{image_id}", status_code=204,
               operation_id="property_images_delete")
def delete_property_image(property_id: int, image_id: int, _: dict = Depends(get_current_user)):
    storage.delete(properties.delete_image(image_id, property_id))


@router.patch("/api/properties/{property_id}/images/{image_id}",
              operation_id="property_images_update_type")
def update_property_image_type(property_id: int, image_id: int, body: ImageTypeUpdate,
                               _: dict = Depends(get_current_user)):
    if body.image_type not in properties.IMAGE_TYPES:
        raise HTTPException(status_code=422,
                            detail=f"image_type debe ser uno de {', '.join(properties.IMAGE_TYPES)}")
    return properties.update_image_type(image_id, property_id, body.image_type)


@router.put("/api/properties/{property_id}/images/reorder",
            operation_id="property_images_reorder")
def reorder_property_images(property_id: int, body: ImageReorderRequest,
                            _: dict = Depends(get_current_user)):
    return properties.reorder_images(property_id, body.image_ids)


# ─── Floorplan geometry ───────────────────────────────────────────────────────

@router.get("/api/properties/{property_id}/geometry", operation_id="properties_get_geometry")
def get_property_geometry(property_id: int, _: dict = Depends(get_current_user)):
    geometry = properties.get_geometry(property_id)
    if geometry is None:
        raise HTTPException(status_code=404, detail="Propiedad no encontrada")
    return geometry


@router.put("/api/properties/{property_id}/geometry", operation_id="properties_set_geometry")
def set_property_geometry(property_id: int, body: GeometryBody,
                          _: dict = Depends(get_current_user)):
    saved = properties.set_geometry(property_id, body.geometry)
    if saved is None:
        raise HTTPException(status_code=404, detail="Propiedad no encontrada")
    return saved


@router.post("/api/properties/{property_id}/floorplan-image", status_code=201,
             operation_id="properties_upload_floorplan_image")
async def upload_floorplan_image(property_id: int, file: UploadFile = File(...),
                                 _: dict = Depends(get_current_user)):
    if not properties.exists(property_id):
        raise HTTPException(status_code=404, detail="Propiedad no encontrada")
    if file.content_type not in _FLOORPLAN_ALLOWED_MIME:
        raise HTTPException(status_code=415, detail=f"Unsupported media type: {file.content_type}")
    content = await file.read(_MAX_IMAGE_SIZE + 1)
    if len(content) > _MAX_IMAGE_SIZE:
        raise HTTPException(status_code=413, detail="Image too large (max 20 MB)")
    content = await asyncio.to_thread(images.normalize_orientation, content)
    key = f"properties/{property_id}/floorplan/{uuid4().hex}{_FLOORPLAN_EXT[file.content_type]}"
    storage.upload(key, content, file.content_type)
    return {"imageKey": key}
