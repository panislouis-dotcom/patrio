"""Endpoints de la biblioteca de prompts y de los renders de una propiedad."""
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from api import properties_db as properties
from api import renders, renders_db, storage
from api.auth import get_current_user

router = APIRouter()


class PromptCreate(BaseModel):
    name: str
    body: str


class PromptUpdate(BaseModel):
    name: str | None = None
    body: str | None = None


class RenderRequest(BaseModel):
    sourceImageId: int
    promptText: str
    promptId: int | None = None


# ─── Biblioteca de prompts ────────────────────────────────────────────────────

@router.get("/api/render-prompts", operation_id="render_prompts_list")
def list_render_prompts(_: dict = Depends(get_current_user)):
    return renders_db.list_prompts()


@router.post("/api/render-prompts", status_code=201, operation_id="render_prompts_create")
def create_render_prompt(body: PromptCreate, _: dict = Depends(get_current_user)):
    try:
        return renders_db.create_prompt(body.name, body.body)
    except renders_db.PromptError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.patch("/api/render-prompts/{prompt_id}", operation_id="render_prompts_update")
def update_render_prompt(prompt_id: int, body: PromptUpdate,
                         _: dict = Depends(get_current_user)):
    try:
        return renders_db.update_prompt(prompt_id, body.name, body.body)
    except renders_db.NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except renders_db.PromptError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/api/render-prompts/{prompt_id}", status_code=204,
               operation_id="render_prompts_delete")
def delete_render_prompt(prompt_id: int, _: dict = Depends(get_current_user)):
    try:
        renders_db.archive_prompt(prompt_id)
    except renders_db.NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except renders_db.PromptError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


# ─── Renders de una propiedad ─────────────────────────────────────────────────

@router.get("/api/properties/{property_id}/renders", operation_id="property_renders_list")
def list_property_renders(property_id: int, _: dict = Depends(get_current_user)):
    if not properties.exists(property_id):
        raise HTTPException(status_code=404, detail="Propiedad no encontrada")
    return renders_db.list_renders(property_id)


@router.post("/api/properties/{property_id}/renders", status_code=201,
             operation_id="property_renders_create")
def create_property_render(property_id: int, body: RenderRequest,
                           _: dict = Depends(get_current_user)):
    if not properties.exists(property_id):
        raise HTTPException(status_code=404, detail="Propiedad no encontrada")
    if not body.promptText.strip():
        raise HTTPException(status_code=422, detail="El prompt no puede ir vacío")
    source = renders_db.source_image(property_id, body.sourceImageId)
    if source is None:
        raise HTTPException(status_code=422,
                            detail="La foto fuente no pertenece a esta propiedad")
    try:
        content, _ct = storage.stream(source["filePath"])
    except FileNotFoundError as exc:
        raise HTTPException(status_code=422, detail="La foto fuente ya no está almacenada") from exc

    prompt = renders.compose_prompt(body.promptText)
    try:
        image_bytes, content_type = renders.generate_image(
            content, source["contentType"], prompt)
    except renders.RenderUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        # El mensaje del proveedor viaja tal cual a propósito. Un «falló» genérico
        # ya nos costó una sesión de depuración: el 400 real decía exactamente
        # qué parámetro sobraba, y quedó escondido detrás del texto bonito.
        raise HTTPException(
            status_code=502, detail=f"El proveedor de renders falló: {exc}") from exc

    relative_path = f"properties/{property_id}/renders/{uuid4().hex}.png"
    try:
        storage.upload(relative_path, image_bytes, content_type)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="No se pudo guardar el render") from exc

    return renders_db.add_render(
        property_id=property_id,
        source_image_id=body.sourceImageId,
        file_path=relative_path,
        content_type=content_type,
        prompt_id=body.promptId,
        # El texto que el usuario aprobó, no el compuesto: la cláusula
        # estructural es del sistema y se puede reconstruir siempre.
        prompt_text=body.promptText.strip(),
        provider=renders.PROVIDER,
        model=renders.MODEL,
    )


@router.post("/api/properties/{property_id}/renders/from-plan", status_code=201,
             operation_id="property_renders_from_plan")
async def create_render_from_plan(
    property_id: int,
    file: UploadFile = File(...),
    promptText: str = Form(...),
    promptId: int | None = Form(None),
    _: dict = Depends(get_current_user),
):
    """Genera un render a partir del PLANO exportado (no de una foto). El plano
    se guarda como imagen-fuente; el render nace con source_image_id NULL y la
    ruta del plano en source_plan_path."""
    if not properties.exists(property_id):
        raise HTTPException(status_code=404, detail="Propiedad no encontrada")
    if not promptText.strip():
        raise HTTPException(status_code=422, detail="El prompt no puede ir vacío")
    plan_bytes = await file.read()
    if not plan_bytes:
        raise HTTPException(status_code=422, detail="El plano llegó vacío")

    content_in = file.content_type or "image/png"
    plan_path = f"properties/{property_id}/plan-sources/{uuid4().hex}.png"
    try:
        storage.upload(plan_path, plan_bytes, content_in)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="No se pudo guardar el plano") from exc

    # Cláusula del plano, no la de la foto: mantén la distribución, amuebla, 2D.
    prompt = renders.compose_plan_prompt(promptText)
    try:
        image_bytes, content_type = renders.generate_image(plan_bytes, content_in, prompt)
    except renders.RenderUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"El proveedor de renders falló: {exc}") from exc

    relative_path = f"properties/{property_id}/renders/{uuid4().hex}.png"
    try:
        storage.upload(relative_path, image_bytes, content_type)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="No se pudo guardar el render") from exc

    return renders_db.add_render(
        property_id=property_id,
        source_image_id=None,
        file_path=relative_path,
        content_type=content_type,
        prompt_id=promptId,
        prompt_text=promptText.strip(),
        provider=renders.PROVIDER,
        model=renders.MODEL,
        source_plan_path=plan_path,
    )


@router.delete("/api/properties/{property_id}/renders/{render_id}", status_code=204,
               operation_id="property_renders_delete")
def delete_property_render(property_id: int, render_id: int,
                           _: dict = Depends(get_current_user)):
    try:
        storage.delete(renders_db.delete_render(render_id, property_id))
    except renders_db.NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
