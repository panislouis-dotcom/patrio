from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from api.db import get_projects, get_prospects
from api.lib.prospectus_html import build_prospectus_html, render_to_pdf

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.post("/prospectus")
async def generate_prospectus():
    projects = [p for p in get_projects() if p.get('isFavorite')]
    prospects = [p for p in get_prospects() if p.get('isFavorite')]
    if not projects and not prospects:
        raise HTTPException(
            status_code=400,
            detail="No favorites set. Mark at least one project or prospect as favorite.",
        )
    html = build_prospectus_html(projects, prospects)
    pdf = await render_to_pdf(html)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=prospecto.pdf"},
    )
