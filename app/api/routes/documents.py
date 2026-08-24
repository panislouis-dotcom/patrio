import asyncio
import base64
import io
import logging
import re
import unicodedata
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from api.db import get_db
from api.properties_db import get_properties, get_property
from api.lib.prospectus_html import ProspectusSections, build_prospectus_html, render_to_pdf
from api.lib.term_sheet_html import build_term_sheet_html
from api.lib import plano_js
from api.auth import get_current_user
from api import storage, renders_db, budget_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/documents", tags=["documents"])

_MAX_IMG_DIM = 1200
_JPEG_QUALITY = 78
# Cota real del render: page.pdf() no acepta timeout en Playwright 1.61, así que
# sin esto un Chromium colgado deja la petición abierta indefinidamente.
_RENDER_TIMEOUT_S = 90


def _resize_for_pdf(content: bytes, content_type: str) -> tuple[bytes, str]:
    """Downscale to max 1200px on longest side and convert to JPEG for compact PDF embedding."""
    from PIL import Image
    img = Image.open(io.BytesIO(content))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    w, h = img.size
    if max(w, h) > _MAX_IMG_DIM:
        scale = _MAX_IMG_DIM / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=_JPEG_QUALITY, optimize=True)
    return buf.getvalue(), "image/jpeg"


def _embed_image_list(images: list[dict]) -> None:
    """Enrich each image dict with a base64 data URI for PDF embedding.

    Blocking (network fetch + Pillow resize): call it off the event loop."""
    for img in images:
        try:
            content, content_type = storage.stream(img["filePath"])
            content, content_type = _resize_for_pdf(content, content_type)
            img["dataUri"] = f"data:{content_type};base64,{base64.b64encode(content).decode()}"
        except Exception:
            logger.warning("image embed failed: %s", img.get("filePath"), exc_info=True)
            img["dataUri"] = None


def _embed_opportunity_extras(opportunities: list[dict]) -> None:
    """Lo que la página compañera de una oportunidad necesita y la propiedad no
    trae consigo: presupuesto por capítulo. El plano no está aquí porque
    `geometry` es una columna de la propiedad y ya viene leída; releerla
    sería una segunda fuente del mismo dato. Los renders tampoco — ya los
    trae `_embed_renders` sobre `renderHeads`, y una segunda lectura sin
    deduplicar por cadena repetiría el mismo diseño con peor curación.
    Bloqueante (DB): se llama junto con _embed_images, off the event loop."""
    with get_db() as conn:
        for p in opportunities:
            p["budget"] = budget_db.get_budget(conn, p["id"])


def _embed_images(items: list[dict]) -> None:
    """Enrich each item's `images` list in place. Blocking: call off the event loop."""
    for item in items:
        _embed_image_list(item.get("images", []))


def _embed_renders(items: list[dict]) -> None:
    """Igual que _embed_images, pero para las cabezas de render de cada propiedad
    (una por cadena, la más reciente). Bloqueante: fuera del event loop."""
    for item in items:
        for r in item.get("renderHeads", []):
            try:
                content, content_type = storage.stream(r["filePath"])
                content, content_type = _resize_for_pdf(content, content_type)
                r["dataUri"] = f"data:{content_type};base64,{base64.b64encode(content).decode()}"
            except Exception:
                logger.warning("render embed failed: %s", r.get("filePath"), exc_info=True)
                r["dataUri"] = None


def _by_status(favorites: list[dict], *statuses: str) -> list[dict]:
    """The favorites in these statuses, grouped in the order the statuses are
    listed — which is the order the document wants them in."""
    return [p for status in statuses for p in favorites if p.get("status") == status]


class ProspectusOptions(BaseModel):
    """Qué entra al PDF. Todo default es el prospecto completo —el único que
    este endpoint supo emitir hasta ahora—, así que un POST sin cuerpo sigue
    produciendo el mismo documento byte por byte. Esa equivalencia es el
    contrato con quien ya llama a esta ruta, no una casualidad de los valores.

    `propertyIds` solo RECORTA las favoritas: el pool sigue siendo `isFavorite`
    y esto es una intersección, nunca una unión. Un id que nadie marcó como
    favorito NO entra al documento por pedirlo aquí — la marca es lo que
    declara que una propiedad se puede publicar, y este parámetro existe para
    armar un deck más corto con parte de ellas, no para saltarse esa
    declaración. `None` (el default) es "todas las favoritas"; una lista vacía
    sí significa ninguna, y no es lo mismo.

    El vocabulario camelCase vive aquí, en el borde HTTP, y se traduce a
    `ProspectusSections` (lib/prospectus_html.py) una sola vez: la capa de
    presentación no importa nada de esta."""
    propertyIds: list[int] | None = None
    # Mismo contrato que propertyIds, por propiedad: `None` = todos los planes de
    # todas; una propiedad AUSENTE del dict = todos sus planes; una lista = solo
    # esos planes (vacía = ninguno — la hoja del original se imprime igual, es el
    # ancla dimensional, no un plan). Solo RECORTA: un plan id que no existe en el
    # geometry simplemente no aparece, nunca agrega nada.
    planIds: dict[int, list[str]] | None = None
    cover: bool = True
    portfolioSummary: bool = True
    closing: bool = True
    opportunityFees: bool = True
    opportunityGallery: bool = True
    opportunityPlans: bool = True
    opportunityRenders: bool = True
    opportunityBudget: bool = True


@router.post("/prospectus", operation_id="documents_prospectus")
async def generate_prospectus(body: ProspectusOptions | None = None,
                              current_user: dict = Depends(get_current_user)):
    options = body or ProspectusOptions()
    favorites = [p for p in get_properties() if p.get("isFavorite")]
    if not favorites:
        raise HTTPException(
            status_code=400,
            detail="No favorites set. Mark at least one property as favorite.",
        )
    # El recorte se aplica ANTES de enriquecer (imágenes, renders, planos,
    # presupuesto): lo que no va al PDF no se descarga ni se dibuja. Filtrar
    # después habría dado el mismo documento pagando el costo completo.
    if options.propertyIds is not None:
        wanted = set(options.propertyIds)
        favorites = [p for p in favorites if p["id"] in wanted]
    # Un documento vacío no es un documento: si no queda ninguna propiedad y
    # tampoco se pidieron las dos páginas que existen sin ellas (portada y
    # cierre), el PDF saldría en blanco y el llamador se enteraría hasta
    # abrirlo. El resumen de portafolio NO cuenta como página propia aquí:
    # resume el track record, así que sin propiedades no imprime nada — darlo
    # por bueno dejaría pasar justo el caso que este guard existe para negar.
    if not favorites and not (options.cover or options.closing):
        raise HTTPException(
            status_code=400,
            detail="La selección se quedó vacía: elige al menos una propiedad favorita, "
                   "o incluye la portada o el cierre.",
        )
    # La presentación muestra la cabeza de cada cadena de render: una por línea,
    # la más reciente. Los pasos intermedios de una edición se quedan fuera.
    # Entran TODAS las cabezas —incluidos los planos-render 2D amueblados, que son
    # los que mejor comunican la distribución propuesta—, no solo las de foto.
    for p in favorites:
        p["renderHeads"] = renders_db.list_render_heads(p["id"])
    await asyncio.to_thread(_embed_images, favorites)
    await asyncio.to_thread(_embed_renders, favorites)
    opportunities = _by_status(favorites, "oferta", "prospecto")
    # El plano solo entra a las páginas de oportunidad: es lo único a lo que un
    # inversionista todavía puede entrar. `geometry` ya viene en la fila (_FETCH_SQL es
    # SELECT p.*), así que esto no es una segunda lectura del mismo dato. No va en
    # to_thread: render_plan_sheets ya es I/O asíncrona, y lanza UN Chromium para todo
    # el prospecto, no uno por propiedad.
    sheets = await plano_js.render_plan_sheets(
        {p["id"]: (p.get("geometry") or {}) for p in opportunities})
    for p in opportunities:
        p["planSheets"] = sheets.get(p["id"], [])
    # El recorte por plan se aplica al DATO (las hojas), no en la presentación:
    # un plan apagado se corta en su origen y todo lo de abajo (secciones,
    # saltos de página) se decide igual que si el plan no existiera. Se recorta
    # DESPUÉS de dibujar y no antes porque filtrar antes exigiría interpretar el
    # blob de geometría en Python (regla del repo: eso es del bundle); las hojas
    # ya tienen forma plana conocida y Chromium dibuja de sobra rápido.
    if options.planIds is not None:
        for p in opportunities:
            wanted = options.planIds.get(p["id"])
            if wanted is not None:
                keep = set(wanted)
                p["planSheets"] = [s for s in p["planSheets"]
                                   if s["variant"] == "original" or s["variant"] in keep]
    await asyncio.to_thread(_embed_opportunity_extras, opportunities)
    # Cómo lee el prospecto una propiedad, por etapa. El track record es lo que
    # la firma ya hizo, y llega en dos cubetas porque una vendida se presume con
    # su resultado realizado y una en renta con su marca: son dos tarjetas
    # distintas, no una con condicionales. En desarrollo es obra en curso. Las
    # páginas de oportunidad son a lo que un inversionista todavía puede
    # entrar — la oferta encabeza porque es el trato al que la firma ya se
    # comprometió; un prospecto que nadie ha ofertado es lo más débil del deck y
    # va al final.
    html = build_prospectus_html(
        _by_status(favorites, "vendida"),
        _by_status(favorites, "en_renta"),
        _by_status(favorites, "desarrollo"),
        opportunities,
        # Traducción explícita, campo por campo, y no un desempaquetado del
        # modelo: son dos vocabularios distintos a propósito (camelCase en el
        # JSON, snake_case en la presentación) y esto es el único lugar donde
        # se tocan. Un campo nuevo tiene que pasar por aquí — que es
        # exactamente lo que se quiere que cueste.
        ProspectusSections(
            cover=options.cover,
            portfolio_summary=options.portfolioSummary,
            closing=options.closing,
            opportunity_fees=options.opportunityFees,
            opportunity_gallery=options.opportunityGallery,
            opportunity_plans=options.opportunityPlans,
            opportunity_renders=options.opportunityRenders,
            opportunity_budget=options.opportunityBudget,
        ),
    )
    try:
        pdf = await asyncio.wait_for(render_to_pdf(html), timeout=_RENDER_TIMEOUT_S)
    except Exception:
        logger.exception("PDF generation failed")
        raise HTTPException(status_code=500, detail="PDF generation failed")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=prospecto.pdf"},
    )


def _slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


class TermSheetRequest(BaseModel):
    investor_name: str
    investment_amount: float
    property_id: Optional[int] = None
    rate: float = 0.12


@router.post("/term-sheet", operation_id="documents_term_sheet")
async def generate_term_sheet(body: TermSheetRequest, _: dict = Depends(get_current_user)):
    if body.property_id is not None:
        subject = get_property(body.property_id)
        if subject is None:
            raise HTTPException(status_code=400, detail="Propiedad no encontrada")
    else:
        # The pool is `oferta`: a term sheet is raised against a deal the firm is
        # actually bidding on, not against one it is still evaluating.
        candidates = [p for p in get_properties() if p.get("status") == "oferta"]
        if not candidates:
            raise HTTPException(status_code=400, detail="No hay propiedades en oferta")
        subject = max(candidates, key=lambda p: p.get("projectedRoi") or 0)

    # El plazo es la columna vertebral del documento: el resumen lo declara y los
    # tres escenarios de rendimiento se calculan sobre él. Tiene que estar
    # CAPTURADO: el modelo siempre puede suponer 12 meses, y suponerlos sirve
    # para rankear un prospecto, pero no para comprometerle un plazo por escrito
    # a un inversionista con nombre y apellido.
    if subject.get("assumptions", {}).get("holdMonths", {}).get("source") != "captured":
        raise HTTPException(
            status_code=400,
            detail="La propiedad no tiene plazo modelado: captúralo antes de emitir la carta.",
        )

    html = build_term_sheet_html(subject, body.investor_name, body.investment_amount, body.rate)
    try:
        pdf = await asyncio.wait_for(render_to_pdf(html), timeout=_RENDER_TIMEOUT_S)
    except Exception:
        logger.exception("Term sheet PDF generation failed")
        raise HTTPException(status_code=500, detail="PDF generation failed")

    slug = _slugify(body.investor_name)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=carta-terminos-{slug}.pdf"},
    )
