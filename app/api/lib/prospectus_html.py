from pathlib import Path
import base64
import json
import logging
import os
import tempfile
from markupsafe import escape as _esc

logger = logging.getLogger(__name__)

_FONTS_DIR = Path(__file__).resolve().parent.parent / "fonts"

_MESES = [
    "", "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

# Vocabulario de roles de team_members (espejo de ROLE_LABEL en
# app/web/src/components/OrgTab.tsx); el orden es el de la jerarquía.
_ROLE_LABEL = {
    "director": "Director",
    "responsable_proyecto": "Responsable de Proyecto",
    "lider_proyecto": "Líder de Proyecto",
    "maestro": "Maestro",
    "ayudante": "Ayudante",
    "finder": "Finder",
}
# Roles que aparecen en el prospecto, en orden de jerarquía: solo liderazgo en
# el documento de inversionistas — ajustar aquí si cambia el criterio.
_DOC_ROLES = ("director", "responsable_proyecto", "lider_proyecto")


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
.proj .metrics-5 .metric { padding: 3.6mm 3mm; }
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
.partners-3 { grid-template-columns: repeat(3, 1fr); gap: 7mm; }
.partner-name { font-family: 'Playfair Display', serif; font-weight: 400; font-size: 13pt; color: var(--ink); }
.partner-role { font-family: 'Inter', sans-serif; font-size: 6.5pt; font-weight: 600;
                letter-spacing: 0.14em; text-transform: uppercase; color: var(--green-dark); margin: 4px 0 5px; }
.partner-bio  { font-family: 'Inter', sans-serif; font-size: 8pt; color: var(--sec); line-height: 1.5; }
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


def _fmt_pct_or_dash(frac, decimals: int = 1) -> str:
    """No value means no metric — '—', never a fabricated 0.0%."""
    return _fmt_pct(frac, decimals) if frac is not None else "—"


def _fmt_mxn_compact_or_dash(val) -> str:
    """No value means no metric — '—', never a fabricated $0."""
    return _fmt_mxn_compact(val) if val is not None else "—"


def _sale_or_none(val):
    """0 significa "sin venta modelada" en todo el sistema — es el guard ps > 0
    del underwriting, no un precio de cero. La columna es NOT NULL, así que sin
    esta traducción un prospecto de pura renta imprimiría "$0"."""
    return val if _num(val) > 0 else None


def _fmt_month(raw) -> str:
    """A stored 'YYYY-MM' → 'abr 2026'. Unparseable or empty → ''."""
    try:
        year, month = str(raw or "").split("-")[:2]
        month, year = int(month), int(year)
    except ValueError:
        return ""
    return f"{_MESES[month][:3]} {year}" if 1 <= month <= 12 else ""


def _mean(values: list) -> float | None:
    """Simple (unweighted) average of the values that exist. None → no metric."""
    present = [_num(v) for v in values if v is not None]
    return sum(present) / len(present) if present else None


def _pretty_type(raw) -> str:
    """Human label from a raw DB enum: 'adaptive_reuse' → 'Adaptive reuse'."""
    return str(raw or "").replace("_", " ").strip().capitalize()


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
    """(label, value) rows; a None value drops the row. Labels are escaped here —
    values are emitted as HTML, so the caller must escape anything user-supplied."""
    rows = ""
    for label, value in pairs:
        if value is None:
            continue
        rows += f'<tr><td>{_esc(label)}</td><td class="n">{value}</td></tr>'
    return f'<table class="kv">{rows}</table>'


# ---------------------------------------------------------------------------
# Section builders
# ---------------------------------------------------------------------------

def _track_roi(p: dict):
    """El ROI que presume el track record: realizado si ya se vendió, la marca
    contra costo si sigue en renta."""
    return p.get("realizedRoi") if p.get("realizedRoi") is not None else p.get("roi")


def _cover(month_year: str, operating: list[dict] | None = None) -> str:
    # Las tres cifras de portada salen de los proyectos operando — nada inventado:
    # unidades sumadas, y promedio simple (no ponderado) del ROI anualizado y del
    # cap rate que ya calculó el API. Sin datos → "—".
    ops = operating or []
    units = sum(int(_num(p.get("totalUnits"))) for p in ops)
    units_v = f"{units:,}" if units else "—"
    roi_avg = _fmt_pct_or_dash(_mean([_track_roi(p) for p in ops]))
    cap_avg = _fmt_pct_or_dash(_mean([p.get("capRate") for p in ops]))
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
      <div class="vp-item"><div class="vp-v">{units_v}</div><div class="vp-l">Unidades en renta</div><div class="vp-d">operando hoy</div></div>
      <div class="vp-item"><div class="vp-v">{roi_avg}</div><div class="vp-l">ROI promedio</div><div class="vp-d">anualizado, sobre inversión</div></div>
      <div class="vp-item"><div class="vp-v">{cap_avg}</div><div class="vp-l">Cap rate promedio</div><div class="vp-d">real, no proyectado</div></div>
    </div>
  </div>
  <div class="cover-foot">
    <span>San Pedro Garza García, NL · Distribución restringida</span>
    <span>Documento confidencial</span>
  </div>
</div>"""


def _realized_gain_pct(p: dict) -> float:
    """La plusvalía que el track record presume: realizada si ya se vendió, la
    marca contra costo si sigue en renta."""
    return _num(p.get("realizedGainPct") if p.get("realizedGainPct") is not None
                else p.get("unrealizedGainPct"))


def _project_card(p: dict, kicker: str, projected: bool = False) -> str:
    name = _esc(p.get("name", ""))
    address = _esc(p.get("address", ""))
    city = _esc(p.get("city", ""))
    ptype = _esc(_pretty_type(p.get("strategyType") or p.get("assetType")))
    units = int(_num(p.get("totalUnits")))
    hold = int(_num(p.get("holdMonthsActual")))

    sub_bits = [b for b in [address, city] if b]
    meta_bits = [b for b in [ptype, f"{units} unidades" if units else "", f"{hold} meses" if hold else ""] if b]
    sub = " · ".join(sub_bits)
    if meta_bits:
        sub += "  —  " + " · ".join(meta_bits)

    # Cap rate viene del API (renta anual / inversión — una sola fórmula en todo
    # el sistema): real en operando, proyectado y etiquetado como tal en
    # desarrollo. Sin renta → "—", nunca inventado.
    cap = p.get("capRate")

    if projected:
        # Pre-obra: SOLO cifras del underwriting. currentValuation/unrealizedGainPct
        # nacen igualadas al costo (0%) al crear el proyecto y leerían como un
        # avalúo real que nadie hizo.
        metrics = "".join([
            _metric(_fmt_mxn_compact_or_dash(p.get("totalInvestment")), "Inversión total"),
            _metric(_fmt_mxn_compact_or_dash(_sale_or_none(p.get("projectedSale"))), "Venta proyectada"),
            _metric(_fmt_pct_or_dash(p.get("projectedRoi")), "ROI anual proy."),
            _metric(_fmt_pct_or_dash(p.get("projectedRoiTotal")), "Plusvalía proy."),
            _metric(_fmt_pct_or_dash(cap), "Cap rate proy."),
        ])
    else:
        # Operando: resultados realizados. La valuación lleva su fecha de corte.
        sold = p.get("realizedRoi") is not None or p.get("realizedGainPct") is not None
        if sold:
            exit_value, exit_label = p.get("salePrice"), f"Venta · {_fmt_month(p.get('saleDate'))}"
            roi, gain = p.get("realizedRoi"), p.get("realizedGainPct")
        else:
            val_month = _fmt_month(p.get("valuationDate"))
            exit_value = p.get("currentValuation")
            exit_label = f"Valuación · {val_month}" if val_month else "Valuación actual"
            roi, gain = p.get("roi"), p.get("unrealizedGainPct")
        metrics = "".join([
            _metric(_fmt_mxn_compact_or_dash(p.get("totalInvestment")), "Inversión total"),
            _metric(_fmt_mxn_compact_or_dash(exit_value), exit_label),
            _metric(_fmt_pct_or_dash(roi), "ROI anual"),
            _metric(_fmt_pct_or_dash(gain), "Plusvalía"),
            _metric(_fmt_pct_or_dash(cap), "Cap rate"),
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


def _team_block(team: list[dict] | None) -> str:
    """Equipo tal como está en la base — nombre completo, rol y su nota/bio.
    Sin equipo capturado no se inventa ninguno: la sección desaparece."""
    members = sorted(
        (m for m in (team or []) if str(m.get("role")) in _DOC_ROLES),
        key=lambda m: (_DOC_ROLES.index(str(m.get("role"))), _num(m.get("id"))),
    )
    if not members:
        return ""
    blocks = []
    for m in members:
        role = _ROLE_LABEL[str(m.get("role"))]
        bio = str(m.get("notes") or "").strip()
        blocks.append(
            f'<div><div class="partner-name">{_esc(m.get("name", ""))}</div>'
            f'<div class="partner-role">{_esc(role)}</div>'
            + (f'<div class="partner-bio">{_esc(bio)}</div>' if bio else "")
            + "</div>"
        )
    cols = " partners-3" if len(blocks) > 2 else ""
    return f'<div class="partners{cols}">{"".join(blocks)}</div>'


def _summary_card(projects: list[dict], team: list[dict] | None = None) -> str:
    inv = sum(_num(p.get("totalInvestment")) for p in projects)
    val = sum(_num(p.get("salePrice") or p.get("currentValuation")) for p in projects)
    gain = val - inv
    metrics = "".join([
        _metric(str(len(projects)), "Proyectos"),
        _metric(_fmt_mxn_compact(inv), "Capital invertido"),
        _metric(_fmt_mxn_compact(val), "Valuación actual"),
        _metric(f'{_fmt_mxn_compact(gain)} <small>{_fmt_pct_or_dash(gain / inv if inv else None, 0)}</small>',
                "Plusvalía total"),
    ])
    return f"""<div class="summary">
  <div class="kicker">Portafolio</div>
  <h3>Proyectos reales. Resultados reales.</h3>
  <div class="metrics metrics-4">{metrics}</div>
  {_team_block(team)}
  <div class="valuation-note">Valuaciones estimadas con base en comparables de mercado, no avalúo formal. Plusvalía no realizada.</div>
</div>"""


def _opportunity(p: dict) -> str:
    name = _esc(p.get("name", ""))
    address = _esc(p.get("address", ""))
    city = _esc(p.get("city", ""))
    ptype = _esc(_pretty_type(p.get("assetType") or p.get("strategyType")))
    hold = int(_num(p.get("holdMonths")))
    total_inv = p.get("totalInvestment")
    projected_sale = p.get("projectedSale")
    profit = p.get("projectedProfit")
    # Una sola fuente para la ganancia: el ROI total del API. Es None cuando no hay
    # venta modelada (prospecto sólo de renta) — entonces no hay ganancia estimada
    # que mostrar, en vez del -100% que salía de recalcularla aquí.
    roi_total = p.get("projectedRoiTotal")
    gain_value = (f'{_fmt_mxn_compact_or_dash(profit)} <small>{_fmt_pct(roi_total, 1)}</small>'
                  if roi_total is not None else "—")
    cap_rate = p.get("capRate")
    rent_m = p.get("rentMonthly")
    rent_a = p.get("rentAnnual")
    sqm_land = _num(p.get("sqmLand"))
    sqm_con = _num(p.get("sqmConstruction"))
    inv_ppsqm = p.get("investmentPerSqm")
    land_price = p.get("landPrice")
    acq_costs = p.get("acquisitionCosts")
    # Todo lo que se invierte encima de comprar la propiedad: obra + permisos +
    # subdivisión. Se resta de los dos totales del API en vez de volver a sumar
    # aquí una fórmula que ya vive en el underwriting. Como acquisitionTotal es
    # precio + costos de adquisición, los tres renglones cuadran exactamente con
    # la Inversión total de la tarjeta.
    dev_investment = _num(total_inv) - _num(p.get("acquisitionTotal"))

    metrics = "".join([
        _metric(f"{hold}m" if hold else "—", "Plazo"),
        _metric(_fmt_mxn_compact_or_dash(total_inv), "Inversión total"),
        _metric(_fmt_mxn_compact_or_dash(_sale_or_none(projected_sale)), "Venta proyectada"),
        _metric(gain_value, "Ganancia est."),
        _metric(_fmt_pct_or_dash(cap_rate), "Cap rate"),
    ])

    financieros = _kv_rows([
        ("Precio propiedad", _fmt_mxn(land_price) if _num(land_price) else None),
        ("Costos de adquisición", _fmt_mxn(acq_costs) if _num(acq_costs) else None),
        ("Inversión desarrollo", _fmt_mxn(dev_investment) if dev_investment > 0 else None),
        ("ROI proyectado", _fmt_pct(roi_total, 1) if roi_total is not None else None),
        ("Renta mensual est.", _fmt_mxn(rent_m) if _num(rent_m) else None),
        ("Renta anual est.", _fmt_mxn(rent_a) if _num(rent_a) else None),
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

def build_prospectus_html(track_record: list[dict], development: list[dict],
                          opportunity: list[dict], team: list[dict] | None = None) -> str:
    """The three buckets arrive already partitioned — the caller owns the status
    vocabulary, this file owns the presentation."""
    from datetime import date
    today = date.today()
    month_year = f"{_MESES[today.month].capitalize()} {today.year}"

    track_record = sorted(track_record, key=_realized_gain_pct, reverse=True)

    parts = [_cover(month_year, track_record)]

    if track_record or development:
        cards = [_project_card(p, f"Track Record · {i:02d}", projected=False)
                 for i, p in enumerate(track_record, 1)]
        cards += [_project_card(p, f"En Desarrollo · {j:02d}", projected=True)
                  for j, p in enumerate(development, 1)]
        # Portfolio summary (realized track record) carries the valuation footnote
        # and the team block, and fills the trailing half-sheet.
        if track_record:
            cards.append(_summary_card(track_record, team))
        for pair in _chunk(cards, 2):
            parts.append(f'<div class="page-block sheet">{"".join(pair)}</div>')

    for p in opportunity:
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


_RENDER_TIMEOUT_MS = 60_000


async def render_to_pdf(html: str) -> bytes:
    from playwright.async_api import async_playwright

    with tempfile.NamedTemporaryFile(suffix=".html", delete=False, mode="w", encoding="utf-8") as f:
        f.write(html)
        tmp_path = f.name
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=["--hide-scrollbars"])
            try:
                page = await browser.new_page()
                # networkidle puede no llegar nunca con imágenes embebidas: sin
                # timeout la carga cuelga el worker. page.pdf() no acepta timeout
                # en Playwright 1.61 — no queda acotado por esto, sino por el
                # asyncio.wait_for de la ruta que llama.
                page.set_default_timeout(_RENDER_TIMEOUT_MS)
                await page.goto(f"file://{tmp_path}", wait_until="networkidle",
                                timeout=_RENDER_TIMEOUT_MS)
                pdf = await page.pdf(
                    format="A4",
                    print_background=True,
                    margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
                )
            finally:
                await browser.close()
        return pdf
    finally:
        os.unlink(tmp_path)
