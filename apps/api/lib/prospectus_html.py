from pathlib import Path
import base64
import json
import os
import tempfile

_FONTS_DIR = Path(__file__).resolve().parent.parent / "fonts"


def _font_b64(name: str) -> str:
    return base64.b64encode((_FONTS_DIR / name).read_bytes()).decode()


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
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Public Sans', sans-serif; background: #F2F0EB; color: #1A1A1A; font-size: 12pt; line-height: 1.75; }

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

.page-section         { page-break-inside: avoid; break-inside: avoid; }
.section-vision       { --section-color: #A2571D; }
.section-track        { --section-color: #654F6F; }
.section-oportunidad  { --section-color: #5C5D8D; }

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
    name = project.get("name", "")
    address = project.get("address", "")
    total_inv = project.get("totalInvestment", 0)
    current_val = project.get("currentValuation", 0)
    gain = (current_val or 0) - (total_inv or 0)

    milestones = _parse_milestones(project.get("milestones", "{}"))
    timeline_rows = "\n".join(
        f'      <tr><td class="tdate">{date}</td><td class="tdesc">{desc}</td></tr>'
        for date, desc in milestones
    )

    budget = _parse_budget(project.get("budget", "{}"))
    budget_rows = "\n".join(
        f"      <tr><td>{category}</td><td class=\"bnum\">{_fmt_mxn(amount)}</td></tr>"
        for category, amount in budget
    )

    return f"""<div class="page-section section-track">
  <div class="section-header">
    <div class="band-label">TRACK RECORD · {i:02d}</div>
    <div class="band-title">{name}</div>
  </div>
  <section class="content-section">
    <h2>{address}</h2>
    <div class="metric-grid metric-grid-3">
      <div class="metric-card">
        <div class="metric-value">{_fmt_mxn(total_inv)}</div>
        <div class="metric-label">Inversión Total</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">{_fmt_mxn(current_val)}</div>
        <div class="metric-label">Valuación Actual</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">{_fmt_mxn(gain)}</div>
        <div class="metric-label">Ganancia</div>
      </div>
    </div>
    <div class="two-col">
      <div>
        <div class="col-label">CRONOLOGÍA</div>
        <table class="timeline">
{timeline_rows}
        </table>
      </div>
      <div>
        <div class="col-label">PRESUPUESTO</div>
        <table class="budget">
{budget_rows}
        </table>
      </div>
    </div>
  </section>
</div>"""


def _oportunidad_section(prospect: dict) -> str:
    name = prospect.get("name", "")
    address = prospect.get("address", "")
    city = prospect.get("city", "")
    hold_months = prospect.get("holdMonths", 0)
    cap_rate = prospect.get("capRate") or 0
    total_inv = prospect.get("totalInvestment", 0)
    projected_sale = prospect.get("projectedSale", 0)
    rent_monthly = prospect.get("rentMonthly", 0)
    notes = prospect.get("notes", "")

    return f"""<div class="page-section section-oportunidad">
  <div class="section-header">
    <div class="band-label">OPORTUNIDAD</div>
    <div class="band-title">{name}</div>
  </div>
  <section class="content-section">
    <div class="metric-grid metric-grid-4">
      <div class="metric-card">
        <div class="metric-value compact">{hold_months}m</div>
        <div class="metric-label">Plazo</div>
      </div>
      <div class="metric-card">
        <div class="metric-value compact">{cap_rate * 100:.1f}%</div>
        <div class="metric-label">Cap Rate</div>
      </div>
      <div class="metric-card">
        <div class="metric-value compact">{_fmt_mxn(total_inv)}</div>
        <div class="metric-label">Inversión Total</div>
      </div>
      <div class="metric-card">
        <div class="metric-value compact">{_fmt_mxn(projected_sale)}</div>
        <div class="metric-label">Valuación Proyectada</div>
      </div>
    </div>
    <div class="two-col">
      <div>
        <div class="col-label">FINANCIEROS</div>
        <p>Renta Mensual: {_fmt_mxn(rent_monthly)}</p>
        <p class="caption">{notes}</p>
      </div>
      <div>
        <div class="col-label">UBICACIÓN</div>
        <p>{address}</p>
        <p class="caption">{city}</p>
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
    for i, p in enumerate(projects, 1):
        parts.append(_track_record_section(i, p))
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
            browser = await p.chromium.launch()
            page = await browser.new_page()
            await page.goto(f"file://{tmp_path}", wait_until="networkidle")
            pdf = await page.pdf(format="A4", print_background=True)
            await browser.close()
        return pdf
    finally:
        os.unlink(tmp_path)
