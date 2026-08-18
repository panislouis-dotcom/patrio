"""Los planos del prospecto, dibujados por el MISMO `floorToSvg` que usa el editor.

Python no interpreta `properties.geometry`: lo pasa entero al bundle y recibe SVG
terminados. Es lo que evita un cuarto dibujo del mismo modelo en un cuarto lenguaje —
ver docs/plans/2026-08-16-plano-en-prospecto-design.md.
"""
import logging
import os
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

_BUNDLE = Path(__file__).resolve().parent.parent / "assets" / "plano.iife.js"
_EVAL_TIMEOUT_MS = 30_000


async def render_plan_sheets(geometries: dict[int, dict]) -> dict[int, list[dict]]:
    """`{property_id: geometry}` → `{property_id: [PlanSheet]}`.

    Un solo lanzamiento de Chromium para todo el prospecto, no uno por propiedad.

    La página anfitriona es un `file://` temporal y NO `set_content`/`about:blank`:
    `migrateGeometry` rellena los ids de piso faltantes con `crypto.randomUUID()`, que
    solo existe en contexto seguro. Medido contra Playwright real:

        about:blank / set_content -> isSecureContext False -> no es función
        file://                   -> isSecureContext True  -> funciona

    Con `set_content` esto reventaría para todo blob v2 y todo piso guardado antes de
    que `id` existiera —justo las propiedades viejas— y el `except` de abajo lo
    degradaría a "sin planos", en silencio. No lo cambies sin releer esto.

    Cualquier falla —bundle ausente, evaluación con excepción, Chromium caído— devuelve
    vacío y avisa al log. La sección desaparece del PDF, igual que un `_strip` vacío; un
    prospecto no se muere porque un plano no dibujó.
    """
    if not geometries:
        return {}
    if not _BUNDLE.exists():
        logger.warning(
            "bundle del plano ausente en %s — el prospecto saldrá SIN planos. "
            "Corre `make build-plano`.", _BUNDLE)
        return {}

    from playwright.async_api import async_playwright

    items = list(geometries.items())
    try:
        with tempfile.NamedTemporaryFile(suffix=".html", delete=False, mode="w",
                                         encoding="utf-8") as f:
            f.write("<!doctype html><html><body></body></html>")
            host = f.name
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(args=["--hide-scrollbars"])
                try:
                    page = await browser.new_page()
                    page.set_default_timeout(_EVAL_TIMEOUT_MS)
                    await page.goto(f"file://{host}", wait_until="load")
                    await page.add_script_tag(path=str(_BUNDLE))
                    drawn = await page.evaluate(
                        "blobs => blobs.map(b => Plano.planSheets(b))",
                        [g or {} for _, g in items])
                finally:
                    await browser.close()
        finally:
            os.unlink(host)
    except Exception:
        logger.warning("no se pudieron dibujar los planos del prospecto", exc_info=True)
        return {}

    return {pid: sheets for (pid, _), sheets in zip(items, drawn)}
