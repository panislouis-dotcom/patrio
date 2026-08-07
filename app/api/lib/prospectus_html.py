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

# Lienzo del plano, en unidades del viewBox: el SVG se escala solo al ancho de
# su columna, así que el número no es un tamaño impreso sino la resolución con
# la que se dibujan los muros.
_SVG_SIZE = 260.0
_SVG_PAD = 14.0

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
/* Renders (propuesta de diseño, en la página de detalle): `contain`, no `cover`,
   para que la imagen se vea COMPLETA — recortar una propuesta esconde justo lo
   que se enseña. Y grandes: la página de detalle tiene el espacio. */
.render-strip { display: flex; gap: 6mm; margin-top: 3mm; }
.render-strip img { flex: 1; min-width: 0; height: 82mm; object-fit: contain;
                    background: var(--warm); border: 1px solid var(--border); display: block; }

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
/* Con ventas Y rentas que reportar el resumen crece a cinco columnas: mismo
   bloque, tipografía un punto más chica para que cada cifra quepa en su celda. */
.summary .metrics-5 .metric { padding: 4mm 3mm; }
.summary .metrics-5 .metric .v { font-size: 16pt; }

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

/* La banda va a sangre como en .opp — el padding de página vive en el cuerpo,
   para que el título y el contenido caigan sobre el mismo margen. */
.opp-detail-body { padding: 8mm var(--pad) 7mm; }
/* Sin alto, un render cuadrado se dibuja tan alto como ancho — uno solo se
   comería media página. Más generoso que la galería de .opp: aquí es el tema. */
.opp-detail .strip img { height: 45mm; }
.detail-section { margin-bottom: 8mm; }
.detail-section:last-child { margin-bottom: 0; }
.plano { display: flex; flex-wrap: wrap; gap: 6mm; }
.plano-floor { flex: 1; min-width: 70mm; }
.plano-floor-name { font-family: 'Inter', sans-serif; font-size: 7pt; font-weight: 600;
  color: var(--sec); margin-bottom: 2mm; }
.plano-svg { width: 100%; height: auto; border: 1px solid var(--border); background: var(--warm); }
.plano-room { font-family: 'Inter', sans-serif; font-size: 7px; fill: var(--sec); }

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

/* ══ Portfolio footnote (summary card) ════════════════════════════════════ */
.valuation-note { font-family: 'Inter', sans-serif; font-size: 7pt; font-style: italic;
                  color: var(--sec); line-height: 1.45; margin-top: 7mm; }
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


# Vocabulario de los dos enums de clasificación (espejo de ASSET_TYPE_LABEL y
# STRATEGY_TYPE_LABEL en app/web/src/lib/types.ts, y de los CHECK de la migración
# 024). Un mismo diccionario porque las dos columnas caen en el mismo hueco del
# subtítulo; las llaves no se pisan.
_TYPE_LABEL = {
    "casa": "Casa", "departamento": "Departamento", "local": "Local",
    "edificio": "Edificio", "lote": "Lote", "bodega": "Bodega",
    "adaptive_reuse": "Reconversión", "ground_up": "Obra nueva",
    "flip": "Flip", "hold": "Renta",
}


def _pretty_type(raw) -> str:
    """Etiqueta de dominio para un enum crudo: 'adaptive_reuse' → 'Reconversión'.

    Un valor fuera del vocabulario no se publica: 'Adaptive reuse' era un
    concepto que no existe en ninguna otra pantalla, y traducirlo a medias
    (guiones bajos por espacios) solo hacía que pareciera español."""
    return _TYPE_LABEL.get(str(raw or "").strip(), "")


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


def _render_strip(renders, limit: int) -> str:
    """Los renders se muestran con `contain`, no `cover`: una propuesta se juzga
    entera, y recortarla esconde justo lo que se está enseñando. Grandes, porque
    la página de detalle tiene el espacio."""
    imgs = renders[:limit]
    if not imgs:
        return ""
    tags = "".join(f'<img src="{i["dataUri"]}" alt="">' for i in imgs)
    return f'<div class="render-strip">{tags}</div>'


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

def _cover(month_year: str, rented: list[dict], sold: list[dict]) -> str:
    # Las tres cifras de portada salen de datos reales, y cada una de la etapa
    # que puede sostenerla — promedio simple (no ponderado) de lo que ya calculó
    # el API, nunca una fórmula reinventada aquí:
    #   · Unidades en renta — solo las que siguen en renta. La leyenda dice
    #     "operando hoy" y lo vendido dejó de operar para nosotros.
    #   · Cap rate promedio — solo en renta, y de `capRateActual`: renta COBRADA
    #     sobre capital. El `capRate` a secas sale del underwriting, así que
    #     promediarlo aquí publicaría lo que se estimó como si fuera lo que se
    #     cobra. Una vendida sí trae ambos (el expediente ya no se apaga en la
    #     venta), pero ya no cobra renta: por eso queda fuera del promedio.
    #   · ROI promedio — en renta y vendidas: el rendimiento que la firma ya
    #     entregó o lleva marcado. Ninguna proyección entra aquí; por eso
    #     desarrollo y las oportunidades no cuentan.
    # Sin datos → "—", nunca un 0 inventado.
    units = sum(int(_num(p.get("totalUnits"))) for p in rented)
    units_v = f"{units:,}" if units else "—"
    roi_avg = _fmt_pct_or_dash(_mean([p.get("realizedRoi") for p in sold]
                                     + [p.get("roi") for p in rented]))
    cap_avg = _fmt_pct_or_dash(_mean([p.get("capRateActual") for p in rented]))
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
      <div class="vp-item"><div class="vp-v">{roi_avg}</div><div class="vp-l">ROI promedio</div><div class="vp-d">anualizado · vendidas y en renta</div></div>
      <div class="vp-item"><div class="vp-v">{cap_avg}</div><div class="vp-l">Cap rate promedio</div><div class="vp-d">renta cobrada sobre inversión</div></div>
    </div>
  </div>
  <div class="cover-foot">
    <span>San Pedro Garza García, NL · Distribución restringida</span>
    <span>Documento confidencial</span>
  </div>
</div>"""


def _hold_tail(p: dict) -> str:
    """El plazo real: meses desde la adquisición, congelados en la venta por el
    API. Se nombra "plazo real" y no "meses en cartera" ni "meses de obra" porque
    es el mismo `holdMonthsActual` que la ficha y la tabla ya llaman así — y
    porque se cuenta desde que la propiedad es tuya, se haga obra o no."""
    hold = int(_num(p.get("holdMonthsActual")))
    return f"Plazo real {hold} meses" if hold else ""


def _card(p: dict, kicker: str, tail: str, metrics: str) -> str:
    """La caja que comparten las tres etapas: banda con nombre y meta, cinco
    métricas y las fotos. Lo único parametrizado es lo que de verdad cambia por
    etapa — las métricas y la coleta del subtítulo."""
    name = _esc(p.get("name", ""))
    address = _esc(p.get("address", ""))
    city = _esc(p.get("city", ""))
    # Qué ES el inmueble y qué se HACE con él son dos preguntas y dos columnas.
    # Se imprimen las dos: elegir una como sustituta de la otra hacía que la
    # misma posición del subtítulo dijera «Edificio» en una tarjeta y
    # «Reconversión» en la siguiente.
    asset = _esc(_pretty_type(p.get("assetType")))
    strategy = _esc(_pretty_type(p.get("strategyType")))
    units = int(_num(p.get("totalUnits")))

    sub = " · ".join(b for b in [address, city] if b)
    meta_bits = [b for b in [asset, strategy, f"{units} unidades" if units else "", tail] if b]
    if meta_bits:
        sub += "  —  " + " · ".join(meta_bits)

    images = p.get("images", [])
    antes = _imgs_by_type(images, "antes")
    despues = _imgs_by_type(images, "despues")
    if antes and despues:
        imgs_html = (f'<div>{_strip(antes, "Antes", 2)}</div>'
                     f'<div>{_strip(despues, "Después", 2)}</div>')
    else:
        gallery = _imgs_by_type(images)
        imgs_html = f'<div>{_strip(gallery, "Proyecto", 4)}</div>' if gallery else ""
    # Renders: la cabeza de cada línea, rotulada como propuesta — nunca disfrazada
    # de foto real (por eso viven en otra tabla).
    render_heads = [r for r in p.get("renderHeads", []) if r.get("dataUri")]
    renders_html = (f'<div>{_strip(render_heads, "Renders · propuesta de diseño", 3)}</div>'
                    if render_heads else "")
    imgs_block = (f'<div class="proj-imgs">{imgs_html}{renders_html}</div>'
                  if (imgs_html or renders_html) else "")

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


def _sold_card(p: dict, kicker: str) -> str:
    """Una propiedad vendida es un hecho cerrado, y así se presenta: precio de
    venta, ganancia realizada, ROI real anual y plazo real. Ni una cifra
    proyectada ni una valuación. El API sí las trae — el expediente sigue vivo
    después de la venta, para poder comparar lo que se prometió contra lo que
    pasó — y esta tarjeta decide no imprimirlas: presumir una marca o un plan
    cuando ya existe un precio de venta sería cambiar un resultado por una
    opinión. La comparación es una herramienta de la ficha, no del pitch."""
    gain, gain_pct = p.get("realizedGain"), p.get("realizedGainPct")
    gain_v = (f'{_fmt_mxn_compact(gain)} <small>{_fmt_pct(gain_pct, 1)}</small>'
              if gain is not None and gain_pct is not None else "—")
    hold = int(_num(p.get("holdMonthsActual")))
    month = _fmt_month(p.get("saleDate"))
    metrics = "".join([
        _metric(_fmt_mxn_compact_or_dash(p.get("totalInvestment")), "Inversión total"),
        _metric(_fmt_mxn_compact_or_dash(p.get("salePrice")), "Precio de venta"),
        _metric(gain_v, "Ganancia realizada"),
        _metric(_fmt_pct_or_dash(p.get("realizedRoi")), "ROI real anual"),
        _metric(f"{hold} meses" if hold else "—", "Plazo real"),
    ])
    tail = f"Vendida · {month}" if month else "Vendida"
    return _card(p, f"{kicker} · Resultado final", tail, metrics)


def _rented_card(p: dict, kicker: str) -> str:
    """En renta: la marca viva. La valuación lleva su fecha de corte encima
    porque es una estimación con fecha, no un hecho; el cap rate es `capRateActual`,
    la renta efectivamente cobrada sobre el capital — el track record no publica
    lo que se estimó cobrar."""
    val_month = _fmt_month(p.get("valuationDate"))
    metrics = "".join([
        _metric(_fmt_mxn_compact_or_dash(p.get("totalInvestment")), "Inversión total"),
        _metric(_fmt_mxn_compact_or_dash(p.get("currentValuation")),
                f"Valuación · {val_month}" if val_month else "Valuación actual"),
        _metric(_fmt_pct_or_dash(p.get("roi")), "ROI anual"),
        _metric(_fmt_pct_or_dash(p.get("unrealizedGainPct")), "Ganancia no realizada %"),
        _metric(_fmt_pct_or_dash(p.get("capRateActual")), "Cap rate real s/ inversión"),
    ])
    return _card(p, f"{kicker} · En renta", _hold_tail(p), metrics)


def _development_card(p: dict, kicker: str) -> str:
    """En desarrollo: SOLO cifras del underwriting, todas etiquetadas como
    proyección. La valuación inicial de una propiedad recién comprada nace
    igualada al costo, y publicarla leería como un avalúo que nadie hizo."""
    metrics = "".join([
        _metric(_fmt_mxn_compact_or_dash(p.get("totalInvestment")), "Inversión total"),
        _metric(_fmt_mxn_compact_or_dash(_sale_or_none(p.get("projectedSale"))), "Venta proyectada"),
        _metric(_fmt_pct_or_dash(p.get("projectedRoi")), "ROI proy. anual"),
        _metric(_fmt_pct_or_dash(p.get("projectedRoiTotal")), "Ganancia proyectada %"),
        _metric(_fmt_pct_or_dash(p.get("capRate")), "Cap rate proy. s/ inversión"),
    ])
    return _card(p, kicker, _hold_tail(p), metrics)


def _floorplan_svg(geometry: dict) -> str:
    """El plano de una oportunidad, dibujado con lo único que el modelo crudo del
    editor garantiza siempre: muros (con su grosor) y el nombre de cada cuarto en
    su punto de etiqueta. Sin polígono relleno — un cuarto puede nombrarse sin
    estar cerrado por muros, así que el modelo no trae ni su área ni su forma
    (ver docs/plans/2026-08-05-prospecto-plano-renders-presupuesto-design.md).
    Sin pisos → "", el bloque desaparece del mismo modo que un `_strip` vacío."""
    floors = (geometry or {}).get("floors") or []
    blocks = []
    for floor in floors:
        vertices = floor.get("vertices") or {}
        if not vertices:
            continue
        xs = [v["x"] for v in vertices.values()]
        ys = [v["y"] for v in vertices.values()]
        # El piso se encuadra en el lienzo por su lado más largo, para que las
        # dos direcciones conserven la misma escala y el plano no salga estirado.
        # El piso degenerado (un solo vértice) tiene extensión cero: el mínimo
        # evita la división entre cero, no dibuja nada de más.
        width = max(max(xs) - min(xs), 0.01)
        height = max(max(ys) - min(ys), 0.01)
        scale = _SVG_SIZE / max(width, height)
        min_x, max_y = min(xs), max(ys)

        def sx(x):
            return (x - min_x) * scale + _SVG_PAD

        # La y del modelo apunta hacia ARRIBA (viewTransform.ts la niega en sus
        # dos cámaras, y userToWorld la vuelve a invertir); la del SVG apunta
        # hacia abajo. Sin este volteo el plano se imprime espejeado de arriba
        # a abajo respecto de lo que el usuario dibujó en el editor.
        def sy(y):
            return (max_y - y) * scale + _SVG_PAD

        lines = []
        for edge in (floor.get("edges") or {}).values():
            v1 = vertices.get(edge.get("v1"))
            v2 = vertices.get(edge.get("v2"))
            if v1 is None or v2 is None:
                continue
            stroke = max(_num(edge.get("thickness")) * scale, 1)
            lines.append(
                f'<line x1="{sx(v1["x"]):.1f}" y1="{sy(v1["y"]):.1f}" '
                f'x2="{sx(v2["x"]):.1f}" y2="{sy(v2["y"]):.1f}" '
                f'stroke="#1A1A1A" stroke-width="{stroke:.1f}" stroke-linecap="square" />'
            )

        labels = []
        for room in floor.get("rooms") or []:
            cx, cy = room.get("cx"), room.get("cy")
            if cx is None or cy is None:
                continue
            labels.append(
                f'<text x="{sx(cx):.1f}" y="{sy(cy):.1f}" '
                f'class="plano-room" text-anchor="middle">{_esc(room.get("name", ""))}</text>'
            )

        view = _SVG_SIZE + _SVG_PAD * 2
        blocks.append(f"""<div class="plano-floor">
  <div class="plano-floor-name">{_esc(floor.get("name", ""))}</div>
  <svg viewBox="0 0 {view:.1f} {view:.1f}" class="plano-svg">{''.join(lines)}{''.join(labels)}</svg>
</div>""")
    if not blocks:
        return ""
    return f'<div class="plano">{"".join(blocks)}</div>'


def _chapter_totals(lines: list[dict], chapters: list[str]) -> list[tuple[str, str]]:
    """Subtotal presupuestado por capítulo, en el orden que `chapters` ya trae
    (residuo al final, ver budget_db._chapters), más un renglón de Total. Sin
    renglones → lista vacía, para que el llamador decida que no hay presupuesto
    que enseñar."""
    if not lines:
        return []
    by_chapter: dict[str, float] = {}
    for line in lines:
        name = line.get("chapterName") or ""
        by_chapter[name] = by_chapter.get(name, 0.0) + _num(line.get("budgetedAmount"))
    pairs = [(name, _fmt_mxn(by_chapter[name])) for name in chapters if name in by_chapter]
    pairs.append(("Total", _fmt_mxn(sum(by_chapter.values()))))
    return pairs


def _summary_card(sold: list[dict], rented: list[dict]) -> str:
    """El portafolio que el track record ya produjo: capital desplegado contra lo
    que ese capital vale hoy. Las vendidas cuentan — son el resultado más fuerte
    de la firma y dejarlas fuera subvaluaría el historial — pero entran por su
    precio de venta en un renglón propio, separado de la valuación de lo que
    sigue en renta. Sumarlas en una sola cifra obligaría a llamar "valuación
    actual" a dinero que ya se cobró. El encabezado nombra las etapas que
    resume, y cada renglón desaparece cuando su etapa está vacía."""
    track = sold + rented
    inv = sum(_num(p.get("totalInvestment")) for p in track)
    sales = sum(_num(p.get("salePrice")) for p in sold)
    marks = sum(_num(p.get("currentValuation")) for p in rented)
    gain = sales + marks - inv

    cells = [(str(len(track)), "Propiedades"), (_fmt_mxn_compact(inv), "Capital invertido")]
    if sold:
        cells.append((_fmt_mxn_compact(sales), "Ventas realizadas"))
    if rented:
        cells.append((_fmt_mxn_compact(marks), "Valuación actual"))
    # Agregado sin campo de API, y se nombra como lo que es: la ganancia DEL
    # PORTAFOLIO, no la de ninguna propiedad. Mezcla dinero cobrado con
    # estimaciones a propósito — la nota al pie lo dice — y por eso no puede
    # llamarse «ganancia realizada» ni compartir nombre con las de una ficha.
    cells.append((
        f'{_fmt_mxn_compact(gain)} <small>{_fmt_pct_or_dash(gain / inv if inv else None, 0)}</small>',
        "Ganancia del portafolio",
    ))
    metrics = "".join(_metric(value, label) for value, label in cells)

    scope = " y ".join(s for s in ["vendidas" if sold else "", "en renta" if rented else ""] if s)
    notes = []
    if sold:
        notes.append("Las propiedades vendidas entran por su precio de venta: resultado realizado.")
    if rented:
        notes.append("Las que siguen en renta entran por una valuación estimada con base en "
                     "comparables de mercado, no un avalúo formal — esa ganancia no está realizada.")
    return f"""<div class="summary">
  <div class="kicker">Portafolio · {_esc(scope)}</div>
  <h3>Propiedades reales. Resultados reales.</h3>
  <div class="metrics metrics-{len(cells)}">{metrics}</div>
  <div class="valuation-note">{_esc(" ".join(notes))}</div>
</div>"""


def _opportunity(p: dict) -> str:
    name = _esc(p.get("name", ""))
    address = _esc(p.get("address", ""))
    city = _esc(p.get("city", ""))
    asset = _esc(_pretty_type(p.get("assetType")))
    strategy = _esc(_pretty_type(p.get("strategyType")))
    hold = int(_num(p.get("holdMonths")))
    total_inv = p.get("totalInvestment")
    projected_sale = p.get("projectedSale")
    profit = p.get("projectedProfit")
    # Monto y porcentaje son la MISMA cifra en dos unidades, así que llevan un
    # solo nombre y viajan juntos: «Ganancia proyectada». El porcentaje sale del
    # API (`projectedRoiTotal`) y es None cuando no hay venta modelada
    # (prospecto sólo de renta) — entonces no hay ganancia que mostrar, en vez
    # del -100% que salía de recalcularla aquí.
    roi_total = p.get("projectedRoiTotal")
    gain_value = (f'{_fmt_mxn_compact_or_dash(profit)} <small>{_fmt_pct(roi_total, 1)}</small>'
                  if roi_total is not None else "—")
    cap_rate = p.get("capRate")
    rent_m = p.get("rentMonthlyProjected")
    rent_a = p.get("rentAnnual")
    sqm_land = _num(p.get("sqmLand"))
    sqm_con = _num(p.get("sqmConstruction"))
    inv_ppsqm = p.get("investmentPerSqm")
    purchase_price = p.get("purchasePrice")
    acq_costs = p.get("acquisitionCosts")
    # Todo lo que se invierte encima de adquirir la propiedad, que son exactamente
    # tres cosas del desglose: obra a ejecutar, permisos y subdivisión. Se obtiene
    # restando de los dos totales del API en vez de volver a sumar aquí una
    # fórmula que ya vive en el underwriting. Como acquisitionTotal es precio +
    # costos de adquisición, los tres renglones cuadran exactamente con la
    # Inversión total de la tarjeta.
    dev_investment = _num(total_inv) - _num(p.get("acquisitionTotal"))

    metrics = "".join([
        _metric(f"{hold}m" if hold else "—", "Plazo proyectado"),
        _metric(_fmt_mxn_compact_or_dash(total_inv), "Inversión total"),
        _metric(_fmt_mxn_compact_or_dash(_sale_or_none(projected_sale)), "Venta proyectada"),
        _metric(gain_value, "Ganancia proyectada"),
        _metric(_fmt_pct_or_dash(cap_rate), "Cap rate proy. s/ inversión"),
    ])

    # La ganancia proyectada, monto y porcentaje, ya vive en su métrica de arriba:
    # aquí solo van los renglones del desglose de costos y de la renta modelada.
    # El renglón «ROI proyectado» que estaba aquí repetía ese mismo porcentaje
    # bajo un nombre que en otras superficies designaba la cifra ANUALIZADA —
    # el mismo número dos veces, y el nombre para dos números distintos.
    financieros = _kv_rows([
        ("Precio de compra", _fmt_mxn(purchase_price) if _num(purchase_price) else None),
        ("Costos de adquisición", _fmt_mxn(acq_costs) if _num(acq_costs) else None),
        ("Obra, permisos y subdivisión", _fmt_mxn(dev_investment) if dev_investment > 0 else None),
        ("Renta mensual estimada", _fmt_mxn(rent_m) if _num(rent_m) else None),
        ("Renta anual estimada", _fmt_mxn(rent_a) if _num(rent_a) else None),
        ("Inversión / m²", _fmt_mxn(inv_ppsqm) if _num(inv_ppsqm) else None),
    ])
    ubicacion = _kv_rows([
        ("Dirección", address or None),
        ("Ciudad", city or None),
        ("Tipo de activo", asset or None),
        ("Estrategia", strategy or None),
        ("Terreno", f"{int(sqm_land):,} m²" if sqm_land else None),
        # `sqmConstruction` son los metros de obra A EJECUTAR, no los que el
        # inmueble ya tiene: «Construcción» a secas se leía como lo segundo.
        ("Obra a ejecutar", f"{int(sqm_con):,} m²" if sqm_con else None),
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


def _opportunity_detail(p: dict) -> str:
    """Página compañera de una oportunidad: plano técnico, renders y desglose del
    presupuesto de obra. "" si no hay ninguno de los tres.

    Los renders (la cabeza de cada cadena de FOTO — la propuesta vigente de cada
    idea, sin pasos intermedios, y sin planos-render) viven AQUÍ, no en la
    tarjeta principal: allá, con el hero, las métricas y las dos columnas, la
    tira quedaba de 32mm apretada y no se veía. Aquí hay medio A4 libre junto al
    plano y salen grandes. Antes esta página traía `renders` sin deduplicar por
    cadena —el mismo diseño dos veces, con borradores ya editados encima—; ahora
    es `renderHeads`, una por línea."""
    floorplan_html = _floorplan_svg(p.get("geometry") or {})

    render_heads = [r for r in p.get("renderHeads", []) if r.get("dataUri")]
    renders_html = _render_strip(render_heads, 3) if render_heads else ""

    budget = p.get("budget") or {}
    chapter_pairs = _chapter_totals(budget.get("lines", []), budget.get("chapters", []))
    budget_html = _kv_rows(chapter_pairs) if chapter_pairs else ""

    if not (floorplan_html or renders_html or budget_html):
        return ""

    sections = "".join([
        f'<div class="detail-section"><div class="col-label">Plano</div>{floorplan_html}</div>'
        if floorplan_html else "",
        f'<div class="detail-section"><div class="col-label">Renders · propuesta de diseño</div>{renders_html}</div>'
        if renders_html else "",
        f'<div class="detail-section"><div class="col-label">Presupuesto de obra</div>{budget_html}</div>'
        if budget_html else "",
    ])
    return f"""<div class="page-block opp-detail">
  <div class="band">
    <div class="kicker">Oportunidad Activa</div>
    <h2>{_esc(p.get("name", ""))}</h2>
  </div>
  <div class="opp-detail-body">{sections}</div>
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

def build_prospectus_html(sold: list[dict], rented: list[dict], development: list[dict],
                          opportunity: list[dict]) -> str:
    """The four buckets arrive already partitioned — the caller owns the status
    vocabulary, this file owns the presentation.

    Sold and rented arrive apart, rather than as one "track record", because a
    closed deal and a held one are not presumed with the same figures: one
    reports what it collected, the other what it is worth today. Keeping them
    apart is what lets every number below name its own source instead of
    guessing which one is present."""
    from datetime import date
    today = date.today()
    month_year = f"{_MESES[today.month].capitalize()} {today.year}"

    # El track record abre con lo cerrado: un resultado realizado es la prueba
    # más fuerte que tiene la firma, y una marca de valuación no debería colarse
    # por delante de una venta. Dentro de cada grupo, mayor ganancia primero.
    sold = sorted(sold, key=lambda p: _num(p.get("realizedGainPct")), reverse=True)
    rented = sorted(rented, key=lambda p: _num(p.get("unrealizedGainPct")), reverse=True)
    track = [(_sold_card, p) for p in sold] + [(_rented_card, p) for p in rented]

    parts = [_cover(month_year, rented, sold)]

    if track or development:
        cards = [build(p, f"Track Record · {i:02d}") for i, (build, p) in enumerate(track, 1)]
        cards += [_development_card(p, f"En Desarrollo · {j:02d}")
                  for j, p in enumerate(development, 1)]
        # Portfolio summary carries the valuation footnote and fills the
        # trailing half-sheet.
        if track:
            cards.append(_summary_card(sold, rented))
        for pair in _chunk(cards, 2):
            parts.append(f'<div class="page-block sheet">{"".join(pair)}</div>')

    for p in opportunity:
        parts.append(_opportunity(p))
        parts.append(_opportunity_detail(p))

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
