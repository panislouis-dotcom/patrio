from pathlib import Path
import base64
import json
import os
import tempfile
from markupsafe import escape as _esc

_FONTS_DIR = Path(__file__).resolve().parent.parent / "fonts"

_MESES = [
    "", "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def _font_b64(name: str) -> str:
    path = (_FONTS_DIR / name).resolve()
    if not path.is_relative_to(_FONTS_DIR):
        raise ValueError(f"Font path escapes fonts directory: {name!r}")
    return base64.b64encode(path.read_bytes()).decode()


def _build_fonts_css() -> str:
    # (family, weight_range, style, filename)
    fonts = [
        ("Playfair Display", "400", "normal", "playfair-display-regular.woff2"),
        ("Playfair Display", "400", "italic", "playfair-display-italic.woff2"),
        ("Inter", "400", "normal", "inter-400.woff2"),
        ("Inter", "500", "normal", "inter-500.woff2"),
        ("Inter", "600", "normal", "inter-600.woff2"),
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


# ── Patrio brand palette (from the marketing site + DESIGN.md) ───────────────
#   green #6B8A5E · green-dark #5A7A4E · green tints #F0F4EE / #E4EBDF
#   ink #1A1A1A · secondary #6B6B6B · border #E5E2DC · warm #F8F7F4 · white
#   terracotta #A16A3C used only as a hairline warm accent.
_BODY_CSS = """
@page { size: A4; margin: 0; }
:root {
  --green: #6B8A5E; --green-dark: #5A7A4E; --green-tint: #F0F4EE; --green-wash: #E4EBDF;
  --ink: #1A1A1A; --sec: #6B6B6B; --border: #E5E2DC; --warm: #F8F7F4; --terra: #A16A3C;
  --pad: 20mm;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html { background: #FFFFFF; }
body { font-family: 'Inter', sans-serif; background: #FFFFFF; color: var(--ink);
       font-size: 10.5pt; line-height: 1.62; width: 210mm; -webkit-print-color-adjust: exact; }

.page-block { page-break-after: always; break-after: always; overflow: hidden; }
.page-block:last-child { page-break-after: auto; break-after: auto; }

/* ── Shared type ─────────────────────────────────────────────────────────── */
.kicker { font-family: 'Inter', sans-serif; font-size: 6.5pt; font-weight: 600;
          letter-spacing: 0.26em; text-transform: uppercase; color: var(--sec); }
.serif  { font-family: 'Playfair Display', serif; font-weight: 400; }

/* ── Section band (green) ────────────────────────────────────────────────── */
.band { background: var(--green); color: #fff; padding: 13mm var(--pad) 10mm; }
.band .kicker { color: rgba(255,255,255,0.72); margin-bottom: 8px; }
.band h2 { font-family: 'Playfair Display', serif; font-weight: 400; font-size: 23pt;
           color: #fff; line-height: 1.04; }
.band .sub { font-family: 'Inter', sans-serif; font-size: 8.5pt; color: rgba(255,255,255,0.82);
             margin-top: 7px; letter-spacing: 0.02em; }

/* ── Metric grid ─────────────────────────────────────────────────────────── */
.metrics { display: grid; border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
.metrics-4 { grid-template-columns: repeat(4, 1fr); }
.metrics-5 { grid-template-columns: repeat(5, 1fr); }
.metric { border-right: 1px solid var(--border); border-bottom: 1px solid var(--border);
          padding: 5mm 5mm 5.5mm; }
.metric .v { font-family: 'Playfair Display', serif; font-weight: 400; font-size: 20pt;
             color: var(--green-dark); line-height: 1; }
.metric .v small { font-size: 11pt; color: var(--green); }
.metric .l { font-family: 'Inter', sans-serif; font-size: 5.8pt; font-weight: 600;
             letter-spacing: 0.15em; text-transform: uppercase; color: var(--sec); margin-top: 6px; }

/* ── Image strips ────────────────────────────────────────────────────────── */
.strip-label { font-family: 'Inter', sans-serif; font-size: 6pt; font-weight: 600;
               letter-spacing: 0.18em; text-transform: uppercase; color: var(--sec); margin-bottom: 5px; }
.strip { display: flex; gap: 4px; }
.strip img { flex: 1; min-width: 0; object-fit: cover; object-position: center;
             background: var(--warm); display: block; }

/* ── Data tables ─────────────────────────────────────────────────────────── */
table.kv { width: 100%; border-collapse: collapse; }
table.kv td { font-family: 'Inter', sans-serif; font-size: 8.5pt; padding: 4.5px 0;
              border-bottom: 1px solid var(--border); }
table.kv td.n { text-align: right; font-weight: 600; color: var(--ink); }
.col-label { font-family: 'Inter', sans-serif; font-size: 6.5pt; font-weight: 600;
             letter-spacing: 0.16em; text-transform: uppercase; color: var(--green-dark);
             margin-bottom: 9px; }

/* ══ COVER ═══════════════════════════════════════════════════════════════ */
.cover { height: 297mm; padding: 24mm var(--pad) 20mm; display: flex; flex-direction: column; }
.cover-top { display: flex; align-items: baseline; justify-content: space-between; }
.wordmark { font-family: 'Inter', sans-serif; font-size: 12pt; font-weight: 600;
            letter-spacing: 0.5em; text-transform: uppercase; color: var(--ink); }
.wordmark-tag { font-family: 'Inter', sans-serif; font-style: italic; font-weight: 400;
                font-size: 8pt; color: var(--sec); }
.cover-rule { height: 2px; background: var(--green); width: 54px; margin-top: 14px; }
.cover-main { margin-top: auto; margin-bottom: auto; }
.cover-main .kicker { margin-bottom: 16px; }
.cover h1 { font-family: 'Playfair Display', serif; font-weight: 400; font-size: 40pt;
            color: var(--ink); line-height: 1.06; letter-spacing: -0.01em; max-width: 150mm; }
.cover-lede { font-family: 'Inter', sans-serif; font-size: 11pt; color: var(--sec);
              margin-top: 18px; max-width: 130mm; line-height: 1.7; }
.cover-lede b { color: var(--green-dark); font-weight: 600; }

.vp { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0;
      border: 1px solid var(--border); background: var(--green-tint); margin-top: 26px; }
.vp-item { padding: 9mm 8mm; border-right: 1px solid var(--border); }
.vp-item:last-child { border-right: none; }
.vp-v { font-family: 'Playfair Display', serif; font-weight: 400; font-size: 22pt; color: var(--green-dark); line-height: 1; }
.vp-l { font-family: 'Inter', sans-serif; font-size: 7pt; font-weight: 600; letter-spacing: 0.12em;
        text-transform: uppercase; color: var(--ink); margin-top: 8px; }
.vp-d { font-family: 'Inter', sans-serif; font-size: 8pt; color: var(--sec); margin-top: 4px; line-height: 1.4; }

.cover-foot { margin-top: 22px; font-family: 'Inter', sans-serif; font-size: 6.5pt;
              letter-spacing: 0.06em; color: var(--sec); display: flex; justify-content: space-between; }

/* ══ TRACK RECORD — half-page project cards, 2 per sheet ═════════════════ */
.sheet { height: 297mm; display: flex; flex-direction: column; }
.proj { height: 148.5mm; display: flex; flex-direction: column; overflow: hidden;
        border-bottom: 1px solid var(--border); }
.proj:last-child { border-bottom: none; }
.proj .band { padding: 8mm var(--pad) 6.5mm; background: var(--green); }
.proj .band h2 { font-size: 17pt; }
.proj .band .sub { margin-top: 5px; font-size: 8pt; }
.proj-body { flex: 1; min-height: 0; padding: 6mm var(--pad) 6mm; display: flex; flex-direction: column; }
.proj .metrics { margin-bottom: 5mm; }
.proj .metric { padding: 3.6mm 5mm; }
.proj .metric .v { font-size: 16pt; }
.proj-imgs { flex: 1; min-height: 0; display: flex; gap: 7mm; }
.proj-imgs > div { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.proj-imgs .strip { flex: 1; min-height: 0; }
.proj-imgs .strip img { height: 100%; }

/* Portfolio summary (fills an odd trailing half) */
.summary { height: 148.5mm; background: var(--green-tint); padding: 14mm var(--pad);
           display: flex; flex-direction: column; justify-content: center; }
.summary .kicker { color: var(--green-dark); }
.summary h3 { font-family: 'Playfair Display', serif; font-weight: 400; font-size: 20pt;
              color: var(--ink); margin: 8px 0 10mm; }
.summary .metrics { border-color: rgba(90,122,78,0.25); }
.summary .metric { border-color: rgba(90,122,78,0.25); background: rgba(255,255,255,0.5); }

/* ══ OPPORTUNITY — full page ═════════════════════════════════════════════ */
.opp { height: 297mm; display: flex; flex-direction: column; }
.opp .hero { width: 100%; height: 78mm; object-fit: cover; object-position: center; display: block; background: var(--warm); }
.opp-body { flex: 1; min-height: 0; padding: 8mm var(--pad) 7mm; display: flex; flex-direction: column; }
.opp .metrics { margin-bottom: 7mm; }
.opp-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12mm; margin-bottom: 6mm; }
.opp-note { font-family: 'Inter', sans-serif; font-size: 8pt; color: var(--sec);
            font-style: italic; line-height: 1.55; border-left: 2px solid var(--terra);
            padding-left: 10px; margin-top: auto; }
.opp .strip { margin-top: 6mm; }
.opp .strip img { height: 32mm; }

/* ══ CLOSING ═════════════════════════════════════════════════════════════ */
.closing { height: 297mm; background: var(--green); color: #fff; padding: 30mm var(--pad);
           display: flex; flex-direction: column; justify-content: space-between; }
.closing .kicker { color: rgba(255,255,255,0.7); }
.closing h2 { font-family: 'Playfair Display', serif; font-weight: 400; font-size: 30pt;
              color: #fff; line-height: 1.1; margin: 12px 0 18px; max-width: 150mm; }
.closing p { font-family: 'Inter', sans-serif; font-size: 10pt; color: rgba(255,255,255,0.9);
             max-width: 135mm; margin-bottom: 12px; line-height: 1.7; }
.closing .wordmark { color: #fff; margin-bottom: 10px; }
.closing-disc { font-family: 'Inter', sans-serif; font-size: 6.5pt; letter-spacing: 0.05em;
                color: rgba(255,255,255,0.6); line-height: 1.6; }

/* ══ Portfolio footnote + partner bios (summary card) ════════════════════ */
.valuation-note { font-family: 'Inter', sans-serif; font-size: 7pt; font-style: italic;
                  color: var(--sec); line-height: 1.45; margin-top: 7mm; }
.partners { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; margin-top: 8mm;
            padding-top: 7mm; border-top: 1px solid rgba(90,122,78,0.25); }
.partner-name  { font-family: 'Playfair Display', serif; font-weight: 400; font-size: 13pt; color: var(--ink); }
.partner-quote { font-family: 'Playfair Display', serif; font-style: italic; font-size: 10pt;
                 color: var(--green-dark); margin: 3px 0 5px; }
.partner-bio   { font-family: 'Inter', sans-serif; font-size: 8pt; color: var(--sec); line-height: 1.5; }
"""


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def _num(val) -> float:
    try:
        return float(val)
    except (TypeError, ValueError):
        return 0.0


def _fmt_mxn(val) -> str:
    try:
        return f"${int(round(_num(val))):,}"
    except (TypeError, ValueError):
        return "—"


def _fmt_mxn_compact(val) -> str:
    """Format as $2.4M or $850K for compact metric cards."""
    v = _num(val)
    if abs(v) >= 1_000_000:
        return f"${v / 1_000_000:.1f}M"
    if abs(v) >= 1_000:
        return f"${v / 1_000:.0f}K"
    return f"${int(v):,}"


def _fmt_pct(frac, decimals: int = 1) -> str:
    """A stored fraction (0.6722) → '67.2%'."""
    return f"{_num(frac) * 100:.{decimals}f}%"


def _fmt_mult(a, b) -> str:
    a, b = _num(a), _num(b)
    return f"{a / b:.2f}×" if b else "—"


def _pretty_type(raw) -> str:
    """Human label from a raw DB enum: 'adaptive_reuse' → 'Adaptive reuse'."""
    return str(raw or "").replace("_", " ").strip().capitalize()


# Real operating cap rate = NOI anual / valuación actual, for projects already
# operating & renting. Development (pre-obra) projects have no cap rate → "—";
# it is never fabricated. Interim source: net monthly rent per operating project
# lives here until Refigan's finance tab captures rent_monthly on the project
# ficha (then p["rentMonthly"] is used and these fall away). Casa Modesto has no
# operating expenses, so NOI = gross rent. Edificio Uno keeps its established
# dashboard cap rate (~8%) since its net rent is not captured here.
_OPERATING_RENT_MONTHLY = {
    "Casa Modesto 415": 31000,
    "Casa Centro": 31000,
}
_OPERATING_CAP_RATE = {
    "Edificio Uno": 0.08,
}


def _operating_cap_rate(p: dict):
    """Fraction (0.06) for a renting project, or None → shown as '—'."""
    if str(p.get("status")) != "operating":
        return None
    name = p.get("name", "")
    val = _num(p.get("currentValuation"))
    rent = _num(p.get("rentMonthly")) or _OPERATING_RENT_MONTHLY.get(name, 0)
    if rent and val:
        return (rent * 12) / val
    return _OPERATING_CAP_RATE.get(name)


def _chunk(seq, n):
    return [seq[i:i + n] for i in range(0, len(seq), n)]


def _imgs_by_type(images, kind=None):
    out = []
    for img in images:
        if not img.get("dataUri"):
            continue
        if kind is None or img.get("imageType") == kind:
            out.append(img)
    return out


def _metric(value: str, label: str) -> str:
    return (f'<div class="metric"><div class="v">{value}</div>'
            f'<div class="l">{_esc(label)}</div></div>')


def _strip(images, label: str, limit: int) -> str:
    imgs = images[:limit]
    if not imgs:
        return ""
    tags = "".join(f'<img src="{i["dataUri"]}" alt="">' for i in imgs)
    lab = f'<div class="strip-label">{_esc(label)}</div>' if label else ""
    return f'{lab}<div class="strip">{tags}</div>'


def _kv_rows(pairs) -> str:
    rows = ""
    for label, value in pairs:
        if value is None:
            continue
        rows += f'<tr><td>{_esc(label)}</td><td class="n">{value}</td></tr>'
    return f'<table class="kv">{rows}</table>'


# ---------------------------------------------------------------------------
# Section builders
# ---------------------------------------------------------------------------

def _cover(month_year: str) -> str:
    return f"""<div class="page-block cover">
  <div class="cover-top">
    <div>
      <div class="wordmark">P A T R I O</div>
      <div class="cover-rule"></div>
    </div>
    <div class="wordmark-tag">Los expertos en tu patrimonio</div>
  </div>
  <div class="cover-main">
    <div class="kicker">Prospecto de Inversión · {month_year}</div>
    <h1>Haz crecer tu patrimonio</h1>
    <p class="cover-lede">Compramos, transformamos y operamos bienes raíces que valen más de lo que cuestan.
      Tú pones el capital y eres dueño de todo — nosotros lo hacemos realidad, de principio a fin.</p>
    <div class="vp">
      <div class="vp-item"><div class="vp-v">14</div><div class="vp-l">Unidades en renta</div><div class="vp-d">operando hoy</div></div>
      <div class="vp-item"><div class="vp-v">2&times;</div><div class="vp-l">Valor creado</div><div class="vp-d">Edificio Uno: $9.5M &rarr; $19M</div></div>
      <div class="vp-item"><div class="vp-v">8%</div><div class="vp-l">Cap rate promedio</div><div class="vp-d">real, no proyectado</div></div>
    </div>
  </div>
  <div class="cover-foot">
    <span>San Pedro Garza García, NL · Distribución restringida</span>
    <span>Documento confidencial</span>
  </div>
</div>"""


def _project_card(i: int, p: dict, kicker: str, projected: bool = False) -> str:
    name = _esc(p.get("name", ""))
    address = _esc(p.get("address", ""))
    city = _esc(p.get("city", ""))
    ptype = _esc(_pretty_type(p.get("type")))
    units = int(_num(p.get("totalUnits")))
    total_inv = p.get("totalInvestment")
    current_val = p.get("currentValuation")
    gain = _num(current_val) - _num(total_inv)
    gain_pct = _num(p.get("unrealizedGainPct"))
    hold = int(_num(p.get("holdMonthsActual")))

    sub_bits = [b for b in [address, city] if b]
    meta_bits = [b for b in [ptype, f"{units} unidades" if units else "", f"{hold} meses" if hold else ""] if b]
    sub = " · ".join(sub_bits)
    if meta_bits:
        sub += "  —  " + " · ".join(meta_bits)

    # Development projects (pre-obra) read as PROJECTED, not realized.
    val_label = "Valuación proyectada" if projected else "Valuación actual"
    gain_label = "Plusvalía proyectada" if projected else "Plusvalía"
    mult_label = "Multiplicador proy." if projected else "Multiplicador"
    cap = _operating_cap_rate(p)
    cap_value = _fmt_pct(cap, 1) if cap is not None else "—"

    metrics = "".join([
        _metric(_fmt_mxn_compact(total_inv), "Inversión total"),
        _metric(_fmt_mxn_compact(current_val), val_label),
        _metric(f'{_fmt_mxn_compact(gain)} <small>{_fmt_pct(gain_pct, 0)}</small>', gain_label),
        _metric(_fmt_mult(current_val, total_inv), mult_label),
        _metric(cap_value, "Cap rate"),
    ])

    images = p.get("images", [])
    antes = _imgs_by_type(images, "antes")
    despues = _imgs_by_type(images, "despues")
    if antes and despues:
        imgs_html = (f'<div>{_strip(antes, "Antes", 2)}</div>'
                     f'<div>{_strip(despues, "Después", 2)}</div>')
    else:
        gallery = _imgs_by_type(images)
        imgs_html = f'<div>{_strip(gallery, "Proyecto", 4)}</div>' if gallery else ""
    imgs_block = f'<div class="proj-imgs">{imgs_html}</div>' if imgs_html else ""

    return f"""<div class="proj">
  <div class="band">
    <div class="kicker">{_esc(kicker)}</div>
    <h2>{name}</h2>
    <div class="sub">{sub}</div>
  </div>
  <div class="proj-body">
    <div class="metrics metrics-5">{metrics}</div>
    {imgs_block}
  </div>
</div>"""


def _summary_card(projects: list[dict]) -> str:
    inv = sum(_num(p.get("totalInvestment")) for p in projects)
    val = sum(_num(p.get("currentValuation")) for p in projects)
    gain = val - inv
    pct = (gain / inv) if inv else 0
    metrics = "".join([
        _metric(str(len(projects)), "Proyectos"),
        _metric(_fmt_mxn_compact(inv), "Capital invertido"),
        _metric(_fmt_mxn_compact(val), "Valuación actual"),
        _metric(f'{_fmt_mxn_compact(gain)} <small>{_fmt_pct(pct, 0)}</small>', "Plusvalía total"),
    ])
    return f"""<div class="summary">
  <div class="kicker">Portafolio</div>
  <h3>Proyectos reales. Resultados reales.</h3>
  <div class="metrics metrics-4">{metrics}</div>
  <div class="partners">
    <div>
      <div class="partner-name">Louis Panis</div>
      <div class="partner-quote">“Hacer que las cosas sucedan.”</div>
      <div class="partner-bio">Ha adquirido, remodelado y operado inmuebles de principio a fin, y dirigido proyectos de gran escala bajo régimen de condominio.</div>
    </div>
    <div>
      <div class="partner-name">Garza</div>
      <div class="partner-quote">“Hacer que sucedan bien — a tiempo y en presupuesto.”</div>
    </div>
  </div>
  <div class="valuation-note">Valuaciones estimadas con base en comparables de mercado, no avalúo formal. Plusvalía no realizada.</div>
</div>"""


def _opportunity(p: dict) -> str:
    name = _esc(p.get("name", ""))
    address = _esc(p.get("address", ""))
    city = _esc(p.get("city", ""))
    ptype = _esc(_pretty_type(p.get("type")))
    hold = int(_num(p.get("holdMonths")))
    total_inv = p.get("totalInvestment")
    projected_sale = p.get("projectedSale")
    profit = p.get("profit")
    profit_pct = (_num(profit) / _num(total_inv)) if _num(total_inv) else 0
    roi_total = _num(p.get("roiTotal"))
    cap_rate = _num(p.get("capRate"))
    rent_m = p.get("rentMonthly")
    rent_a = p.get("rentAnnual")
    sqm_land = _num(p.get("sqmLand"))
    sqm_con = _num(p.get("sqmConstruction"))
    land_ppsqm = p.get("landPricePerSqm")
    sale_ppsqm = p.get("salePerSqm")
    inv_ppsqm = p.get("investmentPerSqm")

    metrics = "".join([
        _metric(f"{hold}m" if hold else "—", "Plazo"),
        _metric(_fmt_mxn_compact(total_inv), "Inversión total"),
        _metric(_fmt_mxn_compact(projected_sale), "Venta proyectada"),
        _metric(f'{_fmt_mxn_compact(profit)} <small>{_fmt_pct(profit_pct, 0)}</small>', "Ganancia est."),
        _metric(_fmt_pct(cap_rate, 1), "Cap rate"),
    ])

    financieros = _kv_rows([
        ("ROI proyectado", _fmt_pct(roi_total, 1) if roi_total else None),
        ("Renta mensual est.", _fmt_mxn(rent_m) if _num(rent_m) else None),
        ("Renta anual est.", _fmt_mxn(rent_a) if _num(rent_a) else None),
        ("Precio terreno / m²", _fmt_mxn(land_ppsqm) if _num(land_ppsqm) else None),
        ("Venta / m²", _fmt_mxn(sale_ppsqm) if _num(sale_ppsqm) else None),
        ("Inversión / m²", _fmt_mxn(inv_ppsqm) if _num(inv_ppsqm) else None),
    ])
    ubicacion = _kv_rows([
        ("Dirección", address or None),
        ("Ciudad", city or None),
        ("Tipo", ptype or None),
        ("Terreno", f"{int(sqm_land):,} m²" if sqm_land else None),
        ("Construcción", f"{int(sqm_con):,} m²" if sqm_con else None),
    ])

    images = _imgs_by_type(p.get("images", []))
    hero = f'<img class="hero" src="{images[0]["dataUri"]}" alt="">' if images else ""
    strip = _strip(images[1:], "Galería", 4) if len(images) > 1 else ""
    notes = _esc(p.get("notes", ""))
    note_html = f'<div class="opp-note">{notes}</div>' if notes else ""

    return f"""<div class="page-block opp">
  <div class="band">
    <div class="kicker">Oportunidad Activa</div>
    <h2>{name}</h2>
    <div class="sub">{address}{(' · ' + city) if city else ''}</div>
  </div>
  {hero}
  <div class="opp-body">
    <div class="metrics metrics-5">{metrics}</div>
    <div class="opp-cols">
      <div><div class="col-label">Financieros</div>{financieros}</div>
      <div><div class="col-label">Ubicación · Propiedad</div>{ubicacion}</div>
    </div>
    {strip}
    {note_html}
  </div>
</div>"""


def _closing(month_year: str) -> str:
    return f"""<div class="page-block closing">
  <div>
    <div class="wordmark">P A T R I O</div>
    <div class="kicker">Conversemos</div>
    <h2>¿Lo vemos con tus números?</h2>
    <p>Compramos barato, transformamos y lo vendemos o te lo entregamos operando. Cuatro pasos —
       uno solo para ti: decidir. El resto lo hacemos nosotros: scouting, obra llave en mano,
       operación o venta, y todo reportado en vivo.</p>
    <p><b>Los expertos en tu patrimonio.</b></p>
  </div>
  <div class="closing-disc">
    Documento confidencial · Distribución restringida · {month_year}<br>
    Preparado exclusivamente para prospectos e inversionistas autorizados. Los rendimientos proyectados
    son estimados y no constituyen una garantía. Prohibida su distribución o reproducción sin autorización.
  </div>
</div>"""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_prospectus_html(projects: list[dict], prospects: list[dict]) -> str:
    from datetime import date
    today = date.today()
    month_year = f"{_MESES[today.month].capitalize()} {today.year}"

    parts = [_cover(month_year)]

    # Track record = projects already operating (realized results).
    # En desarrollo = projects still pre-obra (projected figures, not achieved).
    operating = [p for p in projects if str(p.get("status")) == "operating"]
    development = [p for p in projects if str(p.get("status")) != "operating"]
    # Strongest → weakest by value multiplier (valuación / inversión).
    operating.sort(
        key=lambda p: (_num(p.get("currentValuation")) / _num(p.get("totalInvestment")))
        if _num(p.get("totalInvestment")) else 0,
        reverse=True,
    )

    if projects:
        cards = [_project_card(i, p, f"Track Record · {i:02d}", projected=False)
                 for i, p in enumerate(operating, 1)]
        cards += [_project_card(j, p, f"En Desarrollo · {j:02d}", projected=True)
                  for j, p in enumerate(development, 1)]
        # Portfolio summary (realized track record) carries the valuation footnote
        # and the partner bios, and fills the trailing half-sheet.
        if operating:
            cards.append(_summary_card(operating))
        for pair in _chunk(cards, 2):
            parts.append(f'<div class="page-block sheet">{"".join(pair)}</div>')

    for p in prospects:
        parts.append(_opportunity(p))

    parts.append(_closing(month_year))

    body_html = "\n".join(parts)
    return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
{_build_fonts_css()}
{_BODY_CSS}
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
