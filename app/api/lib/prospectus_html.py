from pathlib import Path
import base64
import json
import os
import tempfile
from markupsafe import escape as _esc

_FONTS_DIR = Path(__file__).resolve().parent.parent / "fonts"


def _font_b64(name: str) -> str:
    path = (_FONTS_DIR / name).resolve()
    if not path.is_relative_to(_FONTS_DIR):
        raise ValueError(f"Font path escapes fonts directory: {name!r}")
    return base64.b64encode(path.read_bytes()).decode()


def _build_fonts_css() -> str:
    # (family, weight_range, style, filename)
    fonts = [
        ("EB Garamond", "400", "normal", "eb-garamond-regular.woff2"),
        ("EB Garamond", "400", "italic", "eb-garamond-italic.woff2"),
        ("Public Sans", "100 900", "normal", "public-sans.woff2"),
        ("Space Grotesk", "300 700", "normal", "space-grotesk.woff2"),
    ]
    blocks = []
    for family, weight, style, filename in fonts:
        b64 = _font_b64(filename)
        blocks.append(
            f"@font-face {{\n"
            f"  font-family: '{family}';\n"
            f"  font-weight: {weight};\n"
            f"  font-style: {style};\n"
            f"  src: url('data:font/woff2;base64,{b64}') format('woff2');\n"
            f"}}"
        )
    return "\n".join(blocks)


_BODY_CSS = """
@page { size: A4; margin: 0; }
html { margin: 0; padding: 0; background: #F2F0EB; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Public Sans', sans-serif; background: #F2F0EB; color: #1A1A1A; font-size: 12pt; line-height: 1.75;
       width: 210mm; overflow: hidden; }

.img-hero { display: block; width: 100%; object-fit: contain; object-position: center center;
            background: #F2F0EB; }

/* ── Oportunidad: hero expands to fill remaining page space ─────────── */
.section-oportunidad               { display: flex; flex-direction: column; overflow: hidden; }
.section-oportunidad .section-header  { flex-shrink: 0; }
.section-oportunidad .img-hero     { flex: 1; min-height: 0; }
.section-oportunidad .content-section { flex-shrink: 0; padding: 20px 80px 24px; }

.img-strip-wrap { margin-top: 24px; page-break-inside: avoid; break-inside: avoid; }
.img-strip-label { font-family: 'Space Grotesk', sans-serif; font-size: 6.5pt; letter-spacing: 0.18em;
                   text-transform: uppercase; color: #7A7260; margin-bottom: 6px; }
.img-strip     { display: flex; gap: 6px; }
.img-strip img { flex: 1; height: 150px; object-fit: contain; object-position: top center;
                 background: #F2F0EB; min-width: 0; }

.cover { height: 297mm; background: #1A2319; padding: 72px 80px; page-break-after: always; break-after: always;
         display: flex; flex-direction: column; justify-content: space-between; }
.footer-section { height: 297mm; background: #1A2319; padding: 64px 80px; page-break-before: always; break-before: always;
                  display: flex; flex-direction: column; justify-content: space-between; }

.wordmark { font-family: 'Space Grotesk', sans-serif; font-size: 10pt; font-weight: 400;
            letter-spacing: 0.55em; text-transform: uppercase; color: #F2F0EB; }
.cover-prelabel { font-family: 'Space Grotesk', sans-serif; font-size: 7pt; font-weight: 400;
                  letter-spacing: 0.25em; text-transform: uppercase; color: rgba(242,240,235,0.8); margin-bottom: 16px; }
h1 { font-family: 'EB Garamond', serif; font-weight: 400; font-size: 36pt; color: #F2F0EB; line-height: 1.05; }
.cover-meta   { font-family: 'Space Grotesk', sans-serif; font-size: 7pt; font-weight: 400;
                letter-spacing: 0.08em; color: rgba(242,240,235,0.6); margin-top: 20px; }
.cover-footer { font-family: 'Space Grotesk', sans-serif; font-size: 7pt; font-weight: 400;
                letter-spacing: 0.08em; color: rgba(242,240,235,0.4); }

.page-section         { height: 297mm; overflow: hidden; page-break-after: always; break-after: always; }
.section-vision       { --section-color: #A2571D; }
.section-track        { --section-color: #654F6F; }
.section-oportunidad  { --section-color: #5C5D8D; }

/* ── Track Record: compact text, bigger images ──────────────────────── */
.section-track .content-section      { padding: 20px 80px 20px; }
.section-track h2                    { font-size: 12pt; margin-bottom: 8px; }
.section-track .metric-grid          { margin-top: 10px; }
.section-track .metric-card          { padding: 11px 16px; }
.section-track .metric-value.compact { font-size: 16pt; }
.section-track .metric-label         { margin-top: 4px; font-size: 6pt; }
.section-track .two-col              { margin-top: 12px; gap: 28px; }
.section-track .col-label            { margin-bottom: 8px; font-size: 6.5pt; }
.section-track table.timeline td     { font-size: 8pt; padding: 3px 0; }
.section-track table.timeline td.tdate { font-size: 6.5pt; padding-right: 16px; }
.section-track table.budget td       { font-size: 8pt; padding: 3px 0; }
.section-track .img-strip-wrap  { margin-top: 10px; }
.section-track .img-strip-label { margin-bottom: 4px; }
.section-track .img-strip img   { height: 185px; }

.section-divider      { height: 297mm; page-break-after: always; break-after: always;
                        display: flex; flex-direction: column; align-items: center; justify-content: center;
                        text-align: center; padding: 80px; gap: 24px; }
.divider-label        { font-family: 'Space Grotesk', sans-serif; font-size: 7pt; font-weight: 400;
                        letter-spacing: 0.45em; text-transform: uppercase; color: rgba(242,240,235,0.5); }
.divider-title        { font-family: 'EB Garamond', serif; font-weight: 400; font-size: 52pt;
                        color: #F2F0EB; line-height: 1.0; }
.divider-rule         { width: 40px; height: 1px; background: rgba(242,240,235,0.3); }
.divider-count        { font-family: 'Space Grotesk', sans-serif; font-size: 7pt; font-weight: 400;
                        letter-spacing: 0.2em; color: rgba(242,240,235,0.35); }

.section-header { padding: 24px 80px; background: var(--section-color);
                  page-break-after: avoid; break-after: avoid; }
.band-label { font-family: 'Space Grotesk', sans-serif; font-size: 7pt; font-weight: 400;
              letter-spacing: 0.25em; text-transform: uppercase; color: rgba(242,240,235,0.8); margin-bottom: 8px; }
.band-title { font-family: 'EB Garamond', serif; font-weight: 400; font-size: 30pt;
              color: #F2F0EB; line-height: 1.1; }

.content-section { padding: 48px 80px; page-break-inside: avoid; break-inside: avoid; }
h2 { font-family: 'EB Garamond', serif; font-weight: 400; font-size: 16pt;
     color: #1A1A1A; line-height: 1.2; margin-bottom: 20px; }
h3 { font-family: 'Space Grotesk', sans-serif; font-size: 7pt; font-weight: 400;
     letter-spacing: 0.18em; text-transform: uppercase; color: #7A7260; margin-bottom: 12px; }
p { font-family: 'Public Sans', sans-serif; font-size: 12pt; color: #1A1A1A;
    max-width: 540px; margin-bottom: 14px; }
p.caption { font-size: 9pt; color: #7A7260; }
strong { color: var(--section-color); font-weight: 500; }

.metric-grid   { display: grid; border: 1px solid rgba(26,26,26,0.1);
                 page-break-inside: avoid; break-inside: avoid; margin-top: 24px; }
.metric-grid-3 { grid-template-columns: repeat(3, 1fr); }
.metric-grid-4 { grid-template-columns: repeat(4, 1fr); }
.metric-card   { padding: 24px 20px; border-right: 1px solid rgba(26,26,26,0.1); }
.metric-card:last-child { border-right: none; }
.metric-value  { font-family: 'EB Garamond', serif; font-weight: 400; font-size: 28pt;
                 color: var(--section-color); line-height: 1; }
.metric-value.compact { font-size: 20pt; }
.metric-label  { font-family: 'Space Grotesk', sans-serif; font-size: 6.5pt;
                 letter-spacing: 0.18em; text-transform: uppercase; color: #7A7260; margin-top: 6px; }

.two-col   { display: grid; grid-template-columns: 1fr 1fr; gap: 56px;
             margin-top: 32px; page-break-inside: avoid; break-inside: avoid; }
.col-label { font-family: 'Space Grotesk', sans-serif; font-size: 7pt;
             letter-spacing: 0.18em; text-transform: uppercase; color: #7A7260; margin-bottom: 16px; }

table.timeline           { width: 100%; border-collapse: collapse; }
table.timeline td        { font-size: 9.5pt; padding: 6px 0; vertical-align: top; }
table.timeline td.tdate  { font-family: 'Space Grotesk', sans-serif; font-size: 7pt; color: #7A7260;
                           letter-spacing: 0.12em; text-transform: uppercase;
                           width: 88px; padding-left: 14px; padding-right: 32px;
                           border-left: 2px solid #654F6F; }
table.timeline td.tdesc  { font-family: 'Public Sans', sans-serif; color: #1A1A1A; }

table.budget             { width: 100%; border-collapse: collapse; }
table.budget tr          { border-bottom: 1px solid rgba(26,26,26,0.08); }
table.budget td          { font-family: 'Public Sans', sans-serif; font-size: 9.5pt; padding: 5px 0; }
table.budget td.bnum     { font-family: 'Space Grotesk', sans-serif; color: var(--section-color);
                           text-align: right; font-weight: 500; }

.impact-block     { border-left: 3px solid var(--section-color); padding-left: 24px; margin: 28px 0; }
.impact-block p   { font-family: 'EB Garamond', serif; font-style: italic; font-size: 11pt;
                    color: #7A7260; line-height: 1.7; max-width: 540px; margin-bottom: 0; }

.footer-section h2     { font-family: 'EB Garamond', serif; font-weight: 400; font-size: 16pt; color: #F2F0EB; }
.footer-section p      { color: rgba(242,240,235,0.7); }
.footer-section strong { color: #4A7A4A; }
.footer-disclaimer     { font-family: 'Space Grotesk', sans-serif; font-size: 7pt;
                         letter-spacing: 0.08em; color: rgba(242,240,235,0.3); }
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fmt_mxn(val) -> str:
    try:
        return f"${int(val or 0):,}"
    except (TypeError, ValueError):
        return "—"


def _fmt_mxn_compact(val) -> str:
    """Format as $2.4M or $850K for compact metric cards."""
    try:
        v = int(val or 0)
        if abs(v) >= 1_000_000:
            return f"${v / 1_000_000:.1f}M"
        if abs(v) >= 1_000:
            return f"${v / 1_000:.0f}K"
        return f"${v:,}"
    except (TypeError, ValueError):
        return "—"


def _img_strip(images: list[dict], label: str, max_imgs: int = 3) -> str:
    """Render a labeled horizontal strip of images, preserving aspect ratio via object-fit: contain."""
    imgs = [img for img in images if img.get("dataUri")][:max_imgs]
    if not imgs:
        return ""
    tags = "".join(f'<img src="{img["dataUri"]}" alt="">' for img in imgs)
    return f"""<div class="img-strip-wrap">
  <div class="img-strip-label">{label}</div>
  <div class="img-strip">{tags}</div>
</div>"""


def _metric_card(value: str, label: str) -> str:
    return (
        f'      <div class="metric-card">\n'
        f'        <div class="metric-value compact">{value}</div>\n'
        f'        <div class="metric-label">{label}</div>\n'
        f'      </div>'
    )


def _timeline_html(milestones: list[tuple[str, str]]) -> str:
    rows = "\n".join(
        f'        <tr><td class="tdate">{_esc(d)}</td><td class="tdesc">{_esc(desc)}</td></tr>'
        for d, desc in milestones
    )
    return f'<div class="col-label">CRONOLOGÍA</div>\n        <table class="timeline">\n{rows}\n        </table>'


def _budget_html(budget: list[tuple[str, int]]) -> str:
    rows = "\n".join(
        f'        <tr><td>{_esc(cat)}</td><td class="bnum">{_fmt_mxn(amt)}</td></tr>'
        for cat, amt in budget
    )
    return f'<div class="col-label">PRESUPUESTO</div>\n        <table class="budget">\n{rows}\n        </table>'


def _annualized_roi(total_inv: float, projected_sale: float, hold_months: int) -> float:
    if not (total_inv and projected_sale and hold_months):
        return 0.0
    try:
        return ((projected_sale / total_inv) ** (12.0 / hold_months) - 1) * 100
    except Exception:
        return 0.0


def _sqm_detail(sqm_land: float, sqm_const: float) -> str:
    parts = []
    if sqm_land:
        parts.append(f"{int(sqm_land):,} m² terreno")
    if sqm_const:
        parts.append(f"{int(sqm_const):,} m² construcción")
    return " · ".join(parts)


def _financials_rows(rent_monthly: float, projected_sale: float, projected_gain: float,
                     profit_pct: float, cap_rate: float) -> str:
    rows = ""
    if rent_monthly:
        rows += f'        <tr><td>Renta mensual est.</td><td class="bnum">{_fmt_mxn(rent_monthly)}</td></tr>\n'
    rows += f'        <tr><td>Valuación proyectada</td><td class="bnum">{_fmt_mxn_compact(projected_sale)}</td></tr>\n'
    rows += f'        <tr><td>Ganancia estimada</td><td class="bnum">{_fmt_mxn_compact(projected_gain)} ({profit_pct:.0f}%)</td></tr>\n'
    if cap_rate:
        rows += f'        <tr><td>Cap rate</td><td class="bnum">{cap_rate * 100:.1f}%</td></tr>\n'
    return rows



def _parse_milestones(raw) -> list[tuple[str, str]]:
    try:
        data = json.loads(raw) if isinstance(raw, str) else (raw or {})
        return sorted(data.items())
    except Exception:
        return []


def _parse_budget(raw) -> list[tuple[str, int]]:
    try:
        data = json.loads(raw) if isinstance(raw, str) else (raw or {})
        return sorted(data.items(), key=lambda x: x[1], reverse=True)[:5]
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Section builders
# ---------------------------------------------------------------------------

def _section_divider(label: str, title: str, color: str, count: int) -> str:
    unit = "proyecto" if count == 1 else "proyectos" if "TRACK" in label.upper() else "oportunidad" if count == 1 else "oportunidades"
    return f"""<div class="section-divider" style="background:{color}">
  <div class="divider-label">{label}</div>
  <div class="divider-title">{title}</div>
  <div class="divider-rule"></div>
  <div class="divider-count">{count:02d} {unit}</div>
</div>"""


def _cover(month_year: str) -> str:
    return f"""<div class="cover">
  <div class="wordmark">R E F I G A N</div>
  <div class="cover-main">
    <div class="cover-prelabel">Prospecto de Inversión · {month_year}</div>
    <h1>Renta Fija con Garantía Inmobiliaria</h1>
    <div class="cover-meta">San Pedro Garza García, NL · Distribución Restringida</div>
  </div>
  <div class="cover-footer">Documento Confidencial · Solo para uso de prospectos e inversionistas autorizados</div>
</div>"""


def _vision() -> str:
    return """<div class="page-section section-vision">
  <div class="section-header">
    <div class="band-label">PROPUESTA DE VALOR</div>
    <div class="band-title">Tu capital merece más que CETES</div>
  </div>
  <section class="content-section">
    <h3>VISIÓN</h3>
    <h2>La brecha entre lo que recibes y lo que genera el mercado</h2>
    <p>CETES ronda el 9% anual. Los bancos prestan al 15% a desarrolladores. La diferencia existe, y alguien la captura. Ese espacio es donde Refigan opera.</p>
    <p>Refigan ofrece rendimiento fijo ~12% anual, respaldado por inmuebles reales en el Centro de Monterrey y otras zonas de oportunidad. Plazo definido, activo tangible, salida clara — sin la volatilidad de mercados financieros.</p>
    <p>Cada inversión financia un edificio real. Refigan identifica y desarrolla oportunidades en el Centro de Monterrey y otras zonas de oportunidad, siguiendo una metodología de adquisición probada.</p>
    <div class="impact-block"><p>Restaurar un edificio histórico no es solo una operación financiera. Es devolver vida a una estructura que guarda la historia de una ciudad. Cada proyecto de Refigan rescata una pieza del patrimonio urbano de Monterrey — y la convierte en un espacio digno, habitado, vivo.</p></div>
  </section>
</div>"""


def _track_record_section(i: int, project: dict) -> str:
    name = _esc(project.get("name", ""))
    address = _esc(project.get("address", ""))
    total_inv = float(project.get("totalInvestment") or 0)
    current_val = float(project.get("currentValuation") or 0)
    gain = current_val - total_inv
    multiplier = f"{current_val / total_inv:.2f}×" if total_inv else "—"
    hold_months = int(project.get("holdMonthsActual") or 0)
    duration = f"{hold_months}m" if hold_months else "—"

    metrics_html = "\n".join([
        _metric_card(_fmt_mxn_compact(total_inv), "Inversión Total"),
        _metric_card(_fmt_mxn_compact(current_val), "Valuación Actual"),
        _metric_card(_fmt_mxn_compact(gain), "Ganancia"),
        _metric_card(multiplier, f"Multiplicador · {duration}"),
    ])
    timeline_html = _timeline_html(_parse_milestones(project.get("milestones", "{}")))
    budget_html = _budget_html(_parse_budget(project.get("budget", "{}")))

    images = project.get("images", [])
    antes = [img for img in images if img.get("imageType") == "antes"]
    despues = [img for img in images if img.get("imageType") == "despues"]
    images_html = _img_strip(antes, "ANTES") + _img_strip(despues, "DESPUÉS")

    return f"""<div class="page-section section-track">
  <div class="section-header">
    <div class="band-label">TRACK RECORD · {i:02d}</div>
    <div class="band-title">{name}</div>
  </div>
  <section class="content-section">
    <h2>{address}</h2>
    <div class="metric-grid metric-grid-4">
{metrics_html}
    </div>
    <div class="two-col">
      <div>{timeline_html}</div>
      <div>{budget_html}</div>
    </div>
    {images_html}
  </section>
</div>"""


def _oportunidad_section(prospect: dict) -> str:
    name = _esc(prospect.get("name", ""))
    address = _esc(prospect.get("address", ""))
    city = _esc(prospect.get("city", ""))
    hold_months = int(prospect.get("holdMonths") or 0)
    cap_rate = float(prospect.get("capRate") or 0)
    total_inv = float(prospect.get("totalInvestment") or 0)
    projected_sale = float(prospect.get("projectedSale") or 0)
    rent_monthly = float(prospect.get("rentMonthly") or 0)
    notes = _esc(prospect.get("notes", ""))
    sqm_land = float(prospect.get("sqmLand") or 0)
    sqm_const = float(prospect.get("sqmConstruction") or 0)
    prop_type = prospect.get("type", "")

    projected_gain = projected_sale - total_inv
    profit_pct = (projected_gain / total_inv * 100) if total_inv else 0
    annualized_roi = _annualized_roi(total_inv, projected_sale, hold_months)
    roi_str = f"{annualized_roi:.1f}%" if annualized_roi else "—"
    sqm_detail = _sqm_detail(sqm_land, sqm_const)
    type_detail = _esc(prop_type.capitalize()) if prop_type else ""

    metrics_html = "\n".join([
        _metric_card(f"{hold_months}m", "Plazo"),
        _metric_card(_fmt_mxn_compact(total_inv), "Inversión Total"),
        _metric_card(_fmt_mxn_compact(projected_gain), "Ganancia Estimada"),
        _metric_card(roi_str, "ROI Anualizado"),
    ])
    financials_rows = _financials_rows(rent_monthly, projected_sale, projected_gain, profit_pct, cap_rate)

    images = prospect.get("images", [])
    hero = next((img for img in images if img.get("dataUri")), None)
    hero_html = f'<img class="img-hero" src="{hero["dataUri"]}" alt="">' if hero else ""

    return f"""<div class="page-section section-oportunidad">
  <div class="section-header">
    <div class="band-label">OPORTUNIDAD</div>
    <div class="band-title">{name}</div>
  </div>
  {hero_html}
  <section class="content-section">
    <div class="metric-grid metric-grid-4">
{metrics_html}
    </div>
    <div class="two-col">
      <div>
        <div class="col-label">FINANCIEROS</div>
        <table class="budget">
{financials_rows}
        </table>
        {f'<p class="caption" style="margin-top:12px">{notes}</p>' if notes else ""}
      </div>
      <div>
        <div class="col-label">UBICACIÓN</div>
        <p>{address}</p>
        <p class="caption">{city}</p>
        {f'<p class="caption">{sqm_detail}</p>' if sqm_detail else ""}
        {f'<p class="caption">{type_detail}</p>' if type_detail else ""}
      </div>
    </div>
  </section>
</div>"""


def _cta(month_year: str) -> str:
    return f"""<div class="footer-section">
  <div>
    <h2>Hablemos de su próxima inversión</h2>
    <p>Refigan opera desde <strong>San Pedro Garza García</strong> e invierte en el Centro de Monterrey y otras zonas con oportunidades. Fondeos cerrados, plazos definidos, rendimientos fijos.</p>
    <p>Documento preparado exclusivamente para prospectos e inversionistas autorizados. Los rendimientos proyectados son estimados y no constituyen una garantía.</p>
  </div>
  <div class="footer-disclaimer">
    Documento Confidencial · Distribución Restringida · {month_year}<br>
    Este documento es de uso exclusivo del destinatario. Su distribución o reproducción sin autorización está prohibida.
  </div>
</div>"""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_prospectus_html(projects: list[dict], prospects: list[dict]) -> str:
    from datetime import date
    month_year = date.today().strftime("%B %Y")
    fonts_css = _build_fonts_css()
    body_css = _BODY_CSS
    parts = [_cover(month_year), _vision()]
    if projects:
        parts.append(_section_divider("Track Record", "Proyectos<br>Realizados", "#654F6F", len(projects)))
        for i, p in enumerate(projects, 1):
            parts.append(_track_record_section(i, p))
    if prospects:
        parts.append(_section_divider("Oportunidades", "Próximas<br>Inversiones", "#5C5D8D", len(prospects)))
        for p in prospects:
            parts.append(_oportunidad_section(p))
    parts.append(_cta(month_year))
    body_html = "\n".join(parts)
    return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
{fonts_css}
{body_css}
</style>
</head>
<body>{body_html}</body>
</html>"""


async def render_to_pdf(html: str) -> bytes:
    from playwright.async_api import async_playwright

    with tempfile.NamedTemporaryFile(suffix=".html", delete=False, mode="w", encoding="utf-8") as f:
        f.write(html)
        tmp_path = f.name
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=["--hide-scrollbars"])
            page = await browser.new_page()
            await page.goto(f"file://{tmp_path}", wait_until="networkidle")
            pdf = await page.pdf(
                format="A4",
                print_background=True,
                margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
            )
            await browser.close()
        return pdf
    finally:
        os.unlink(tmp_path)
