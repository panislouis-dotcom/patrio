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


async def _eval_in_bundle(js_call: str, blobs: list[dict]) -> list:
    """Lanza UN Chromium, carga el bundle, y evalúa `js_call` contra `blobs`. Compartido
    por cada función de este módulo — todas necesitan el mismo anfitrión seguro y el
    mismo bundle, solo cambia qué exportado de `Plano` se llama.

    La página anfitriona es un `file://` temporal y NO `set_content`/`about:blank`:
    `migrateGeometry` (que tanto `planSheets` como `migrateGeometry` mismo usan) rellena
    los ids de piso faltantes con `crypto.randomUUID()`, que solo existe en contexto
    seguro. Medido contra Playwright real:

        about:blank / set_content -> isSecureContext False -> no es función
        file://                   -> isSecureContext True  -> funciona

    Con `set_content` esto reventaría para todo blob v2 y todo piso guardado antes de
    que `id` existiera —justo las propiedades viejas—. No lo cambies sin releer esto.
    """
    from playwright.async_api import async_playwright

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
                return await page.evaluate(js_call, blobs)
            finally:
                await browser.close()
    finally:
        os.unlink(host)


async def render_plan_sheets(geometries: dict[int, dict]) -> dict[int, list[dict]]:
    """`{property_id: geometry}` → `{property_id: [PlanSheet]}`.

    Un solo lanzamiento de Chromium para todo el prospecto, no uno por propiedad.

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

    items = list(geometries.items())
    try:
        drawn = await _eval_in_bundle(
            "blobs => blobs.map(b => Plano.planSheets(b))", [g or {} for _, g in items])
    except Exception:
        logger.warning("no se pudieron dibujar los planos del prospecto", exc_info=True)
        return {}

    return {pid: sheets for (pid, _), sheets in zip(items, drawn)}


async def backfill_floor_ids(geometries: dict[int, dict]) -> dict[int, dict | None]:
    """`{property_id: geometry}` → `{property_id: geometry con FloorGraph.id relleno}`.

    Mismo `migrateGeometry` que el editor corre en memoria cada vez que ABRE un blob
    (`types.ts:237`) — no una reimplementación en Python del schema v2/v3 que podría
    divergir. Un piso guardado antes de que `id` existiera recibe hoy un id DISTINTO en
    cada carga (`crypto.randomUUID()` nunca persistido): un render generado con el id de
    una carga deja de encontrar su piso en la siguiente, y desaparece de la vista aunque
    la fila siga en la base — el bug real detrás de esta función.

    `None` en un valor significa blob ilegible (`migrateGeometry` lo rechazó): nada que
    reparar ahí, y nada que se pueda escribir de vuelta sin inventar geometría.

    A diferencia de `render_plan_sheets`, una falla de evaluación SE PROPAGA — este es
    un script de reparación de datos, no una sección opcional de PDF; degradarla en
    silencio dejaría creer que ya se reparó cuando no se tocó nada."""
    if not geometries:
        return {}
    if not _BUNDLE.exists():
        raise RuntimeError(f"bundle del plano ausente en {_BUNDLE} — corre `make build-plano`")

    items = list(geometries.items())
    migrated = await _eval_in_bundle(
        "blobs => blobs.map(b => Plano.migrateGeometry(b))", [g or {} for _, g in items])
    return {pid: m for (pid, _), m in zip(items, migrated)}
