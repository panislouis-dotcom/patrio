from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from api.auth import get_current_user
from api.db_proveedores import (
    # categories
    get_categories, get_category, create_category, update_category, delete_category,
    # proveedores
    get_proveedores, get_proveedor, create_proveedor, update_proveedor, delete_proveedor,
    set_proveedor_categories, get_proveedor_assignments,
    # photos
    add_proveedor_photo, delete_proveedor_photo,
    # cotizaciones
    get_cotizaciones, create_cotizacion, update_cotizacion, select_cotizacion, delete_cotizacion,
)

router = APIRouter()

_FILES_BASE = Path(__file__).parent.parent.parent.parent / "data" / "files"
_ALLOWED_MIME = {"image/jpeg", "image/png", "image/gif", "image/webp"}
_ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
_MAX_IMAGE_SIZE = 20 * 1024 * 1024  # 20 MB


# ── Pydantic Models ───────────────────────────────────────────────────────────

class CategoryCreate(BaseModel):
    name: str
    description: str = ""


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class ProveedorCreate(BaseModel):
    name: str
    phone: str = ""
    email: str = ""
    website: str = ""
    zona: str = ""
    status: str = "activo"
    notes: str = ""


class ProveedorUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    zona: Optional[str] = None
    status: Optional[str] = None
    vetoReason: Optional[str] = None
    ratingCalidad: Optional[int] = None
    ratingPuntualidad: Optional[int] = None
    ratingPrecio: Optional[int] = None
    notes: Optional[str] = None


class SetCategoriesBody(BaseModel):
    categoryIds: list[int]


class CotizacionCreate(BaseModel):
    proveedorId: Optional[int] = None
    proveedorNameOverride: str = ""
    monto: float = 0
    moneda: str = "MXN"
    descripcion: str = ""
    notes: str = ""
    fechaCotizacion: Optional[str] = None
    validezDias: Optional[int] = None


class CotizacionUpdate(BaseModel):
    proveedorId: Optional[int] = None
    proveedorNameOverride: Optional[str] = None
    monto: Optional[float] = None
    moneda: Optional[str] = None
    descripcion: Optional[str] = None
    notes: Optional[str] = None
    fechaCotizacion: Optional[str] = None
    validezDias: Optional[int] = None


class SelectCotizacionBody(BaseModel):
    instanceNodeStateId: int


# ── Category Routes ───────────────────────────────────────────────────────────

@router.get("/api/proveedor-categories")
def list_categories(_: dict = Depends(get_current_user)):
    return get_categories()


@router.post("/api/proveedor-categories", status_code=201)
def add_category(body: CategoryCreate, _: dict = Depends(get_current_user)):
    return create_category(body.model_dump())


@router.patch("/api/proveedor-categories/{category_id}")
def patch_category(category_id: int, body: CategoryUpdate, _: dict = Depends(get_current_user)):
    data = body.model_dump(exclude_unset=True)
    result = update_category(category_id, data)
    if result is None:
        raise HTTPException(status_code=404, detail="Category not found")
    return result


@router.delete("/api/proveedor-categories/{category_id}", status_code=204)
def remove_category(category_id: int, _: dict = Depends(get_current_user)):
    if get_category(category_id) is None:
        raise HTTPException(status_code=404, detail="Category not found")
    delete_category(category_id)


# ── Proveedor Routes ──────────────────────────────────────────────────────────

@router.get("/api/proveedores")
def list_proveedores(category_id: Optional[int] = None, _: dict = Depends(get_current_user)):
    return get_proveedores(category_id=category_id)


@router.get("/api/proveedores/{proveedor_id}")
def get_one_proveedor(proveedor_id: int, _: dict = Depends(get_current_user)):
    p = get_proveedor(proveedor_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Proveedor not found")
    return p


@router.get("/api/proveedores/{proveedor_id}/assignments")
def list_assignments(proveedor_id: int, _: dict = Depends(get_current_user)):
    return get_proveedor_assignments(proveedor_id)


@router.post("/api/proveedores", status_code=201)
def add_proveedor(body: ProveedorCreate, _: dict = Depends(get_current_user)):
    created = create_proveedor(body.model_dump())
    return get_proveedor(created["id"])


@router.patch("/api/proveedores/{proveedor_id}")
def patch_proveedor(proveedor_id: int, body: ProveedorUpdate, _: dict = Depends(get_current_user)):
    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in ("activo", "inactivo", "vetado"):
        raise HTTPException(status_code=422, detail="status must be 'activo', 'inactivo', or 'vetado'")
    if data.get("status") == "vetado" and not data.get("vetoReason"):
        raise HTTPException(status_code=422, detail="vetoReason required when status is 'vetado'")
    try:
        return update_proveedor(proveedor_id, data)
    except ValueError:
        raise HTTPException(status_code=404, detail="Proveedor not found")


@router.delete("/api/proveedores/{proveedor_id}", status_code=204)
def remove_proveedor(proveedor_id: int, _: dict = Depends(get_current_user)):
    if get_proveedor(proveedor_id) is None:
        raise HTTPException(status_code=404, detail="Proveedor not found")
    delete_proveedor(proveedor_id)


@router.put("/api/proveedores/{proveedor_id}/categories", status_code=200)
def set_categories(proveedor_id: int, body: SetCategoriesBody, _: dict = Depends(get_current_user)):
    if get_proveedor(proveedor_id) is None:
        raise HTTPException(status_code=404, detail="Proveedor not found")
    set_proveedor_categories(proveedor_id, body.categoryIds)
    return get_proveedor(proveedor_id)


# ── Photo Routes ──────────────────────────────────────────────────────────────

@router.post("/api/proveedores/{proveedor_id}/photos", status_code=201)
async def upload_photo(
    proveedor_id: int,
    file: UploadFile = File(...),
    _: dict = Depends(get_current_user),
):
    if get_proveedor(proveedor_id) is None:
        raise HTTPException(status_code=404, detail="Proveedor not found")
    if file.content_type not in _ALLOWED_MIME:
        raise HTTPException(status_code=415, detail=f"Unsupported media type: {file.content_type}")
    content = await file.read(_MAX_IMAGE_SIZE + 1)
    if len(content) > _MAX_IMAGE_SIZE:
        raise HTTPException(status_code=413, detail="Image too large (max 20 MB)")
    ext = Path(file.filename).suffix if file.filename else ""
    if ext.lower() not in _ALLOWED_EXT:
        ext = ""  # Don't trust client-supplied extension if not in allowed set
    relative_path = f"proveedores/{proveedor_id}/{uuid4().hex}{ext}"
    full_path = _FILES_BASE / relative_path
    try:
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_bytes(content)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to store image") from exc
    return add_proveedor_photo(proveedor_id, relative_path, file.filename or "", file.content_type or "image/jpeg")


@router.delete("/api/proveedores/{proveedor_id}/photos/{photo_id}", status_code=204)
def remove_photo(proveedor_id: int, photo_id: int, _: dict = Depends(get_current_user)):
    try:
        delete_proveedor_photo(photo_id, proveedor_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Photo not found")


# ── Cotizaciones Routes ───────────────────────────────────────────────────────

@router.get("/api/instance-node-states/{state_id}/cotizaciones")
def list_cotizaciones(state_id: int, _: dict = Depends(get_current_user)):
    return get_cotizaciones(state_id)


@router.post("/api/instance-node-states/{state_id}/cotizaciones", status_code=201)
def add_cotizacion(state_id: int, body: CotizacionCreate, _: dict = Depends(get_current_user)):
    return create_cotizacion(state_id, body.model_dump())


@router.patch("/api/cotizaciones/{cotizacion_id}")
def patch_cotizacion(cotizacion_id: int, body: CotizacionUpdate, _: dict = Depends(get_current_user)):
    data = body.model_dump(exclude_unset=True)
    try:
        return update_cotizacion(cotizacion_id, data)
    except ValueError:
        raise HTTPException(status_code=404, detail="Cotizacion not found")


@router.post("/api/cotizaciones/{cotizacion_id}/select", status_code=200)
def select_quote(cotizacion_id: int, body: SelectCotizacionBody, _: dict = Depends(get_current_user)):
    result = select_cotizacion(cotizacion_id, body.instanceNodeStateId)
    if result is None:
        raise HTTPException(status_code=404, detail="Cotizacion not found")
    return result


@router.delete("/api/cotizaciones/{cotizacion_id}", status_code=204)
def remove_cotizacion(cotizacion_id: int, _: dict = Depends(get_current_user)):
    try:
        delete_cotizacion(cotizacion_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Cotizacion not found")
