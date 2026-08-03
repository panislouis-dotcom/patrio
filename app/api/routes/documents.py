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
from api.db import get_team_members
from api.properties_db import get_properties, get_property
from api.lib.prospectus_html import build_prospectus_html, render_to_pdf
from api.lib.term_sheet_html import build_term_sheet_html
from api.auth import get_current_user
from api import storage

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


def _embed_images(items: list[dict]) -> None:
    """Enrich each image dict with a base64 data URI for PDF embedding.

    Blocking (network fetch + Pillow resize): call it off the event loop."""
    for item in items:
        for img in item.get("images", []):
            try:
                content, content_type = storage.stream(img["filePath"])
                content, content_type = _resize_for_pdf(content, content_type)
                img["dataUri"] = f"data:{content_type};base64,{base64.b64encode(content).decode()}"
            except Exception:
                logger.warning("image embed failed: %s", img.get("filePath"), exc_info=True)
                img["dataUri"] = None


def _by_status(favorites: list[dict], *statuses: str) -> list[dict]:
    """The favorites in these statuses, grouped in the order the statuses are
    listed — which is the order the document wants them in."""
    return [p for status in statuses for p in favorites if p.get("status") == status]


@router.post("/prospectus", operation_id="documents_prospectus")
async def generate_prospectus(current_user: dict = Depends(get_current_user)):
    favorites = [p for p in get_properties() if p.get("isFavorite")]
    if not favorites:
        raise HTTPException(
            status_code=400,
            detail="No favorites set. Mark at least one property as favorite.",
        )
    await asyncio.to_thread(_embed_images, favorites)
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
        _by_status(favorites, "oferta", "prospecto"),
        get_team_members(),
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
