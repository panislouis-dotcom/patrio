import base64
import io
import logging
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from api.db import get_projects, get_prospects
from api.lib.prospectus_html import build_prospectus_html, render_to_pdf
from api.auth import get_current_user
from api import storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/documents", tags=["documents"])

_MAX_IMG_DIM = 1200
_JPEG_QUALITY = 78


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
    """Enrich each image dict with a base64 data URI for PDF embedding."""
    for item in items:
        for img in item.get("images", []):
            try:
                content, content_type = storage.stream(img["filePath"])
                content, content_type = _resize_for_pdf(content, content_type)
                img["dataUri"] = f"data:{content_type};base64,{base64.b64encode(content).decode()}"
            except Exception:
                img["dataUri"] = None


@router.post("/prospectus")
async def generate_prospectus(_: dict = Depends(get_current_user)):
    projects = [p for p in get_projects() if p.get("isFavorite")]
    prospects = [p for p in get_prospects() if p.get("isFavorite")]
    if not projects and not prospects:
        raise HTTPException(
            status_code=400,
            detail="No favorites set. Mark at least one project or prospect as favorite.",
        )
    _embed_images(projects)
    _embed_images(prospects)
    html = build_prospectus_html(projects, prospects)
    try:
        pdf = await render_to_pdf(html)
    except Exception:
        logger.exception("PDF generation failed")
        raise HTTPException(status_code=500, detail="PDF generation failed")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=prospecto.pdf"},
    )
