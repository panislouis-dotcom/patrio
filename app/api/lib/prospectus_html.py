from pathlib import Path
import base64
import json
import logging
import math
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
/* break-inside:avoid en .strip: sin esto, una fila de fotos que no cabe
   entera en lo que queda de hoja se parte a la mitad — la mitad de una foto
   en una página, el resto invisible, y un hueco en blanco donde debió seguir
   imprimiéndose. Con esto la fila entera brinca junta a la página siguiente
   en vez de cortarse. aspect-ratio reemplaza al alto fijo que tenían .opp y
   .opp-detail: con una sola foto en la fila (el caso típico de un render),
   un alto fijo angosto forzaba un recorte panorámico exagerado en vez de una
   proporción fotográfica real. justify-content:center no cambia nada cuando
   la fila está llena (las fotos ya ocupan el 100% del ancho), pero centra la
   única foto cuando :only-child le pone un tope de ancho en vez de alto. */
.strip { display: flex; gap: 4px; justify-content: center;
         break-inside: avoid; page-break-inside: avoid; }
.strip img { flex: 1; min-width: 0; aspect-ratio: 4 / 3; object-fit: cover; object-position: center;
             background: var(--warm); display: block; }

/* ── Data tables ─────────────────────────────────────────────────────────── */
table.kv { width: 100%; border-collapse: collapse; }
/* break-inside:avoid vive en la FILA, no en la tabla: un presupuesto de obra
   real trae diez o más capítulos y es una tabla larga, no una foto — quiere
   partirse entre páginas como cualquier tabla de un libro. Lo único que debe
   viajar entero es cada renglón (evita cortar un renglón a la mitad, mitad
   de "Cimentación $1,030,000" en una hoja, mitad en la siguiente). */
table.kv tr { break-inside: avoid; page-break-inside: avoid; }
table.kv td { font-family: 'Inter', sans-serif; font-size: 8.5pt; padding: 4.5px 0;
              border-bottom: 1px solid var(--border); }
table.kv td.n { text-align: right; font-weight: 600; color: var(--ink); }
/* Sin esto un encabezado como "PRESUPUESTO DE OBRA" puede quedar solo al pie
   de una página con toda su tabla en la siguiente. */
.col-label { font-family: 'Inter', sans-serif; font-size: 6.5pt; font-weight: 600;
             letter-spacing: 0.16em; text-transform: uppercase; color: var(--green-dark);
             margin-bottom: 9px; break-after: avoid; page-break-after: avoid; }

/* ── Presupuesto, renglón por renglón ────────────────────────────────────── */
.budget-chapter { margin-bottom: 5mm; }
.budget-chapter:last-of-type { margin-bottom: 0; }
.budget-chapter-name { font-family: 'Inter', sans-serif; font-size: 7pt; font-weight: 600;
                        color: var(--sec); margin-bottom: 2mm;
                        break-after: avoid; page-break-after: avoid; }
.budget-qty { font-size: 7.5pt; color: var(--sec); font-weight: 400; }
.budget-subtotal td { font-weight: 600; border-top: 1px solid var(--ink); }
.budget-grand-total { margin-top: 3mm; }
.budget-grand-total td { font-size: 10pt; font-weight: 600; padding-top: 6px;
                          border-top: 2px solid var(--ink); border-bottom: none; }

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
/* Ni height ni min-height, y desde aquí .opp-detail (plano/renders/
   presupuesto) ya no es su propia page-block: el salto de página real no
   venía del alto de .opp ni de flex vs. bloque — venía de que .page-block
   trae page-break-after:always, y .opp-detail ERA una page-block propia.
   Cuando la nota se quedaba a la mitad de una hoja, plano/renders igual
   brincaban a la siguiente por ese salto forzado, sin importar cuánta hoja
   quedara libre debajo de la nota. Fusionar todo en una sola page-block dejó
   que Chromium sólo pase de hoja cuando de veras se le acaba el espacio, así
   que plano/renders/presupuesto ahora continúan donde la nota los deja. Cada
   fragmento sigue midiendo lo que su contenido pide; .page-block sigue
   heredando overflow:hidden, y sin height fija en .opp no hay nada que
   esconder. */
.opp .hero { width: 100%; height: 78mm; object-fit: cover; object-position: center; display: block; background: var(--warm); }
/* box-decoration-break:clone — sin esto, el padding de .opp-body (lo único
   que separa su contenido del borde de la hoja, porque @page no tiene
   margen) solo se aplica al PRIMER fragmento cuando el contenido pide una
   segunda página. La continuación arrancaba a ~4mm del borde físico —
   comprobado con una sonda propia: sin clone, el marcador de prueba
   aterrizaba a 3.8mm del borde; con clone, a ~19mm, igual que si esa hoja
   tuviera su propio padding completo. Es el mismo bug de contenido pegado
   al filo que .opp arregló para las fotos y la nota, aquí aplicado al
   padding de página que las envuelve a todas. */
.opp-body { padding: 8mm var(--pad) 7mm;
            -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.opp .metrics { margin-bottom: 7mm; break-inside: avoid; page-break-inside: avoid; }
/* Mismo ajuste que .summary ya hacía para su propia fila de 5: la celda del
   .metric base (padding 5mm, valor a 20pt) está pensada para una fila de 4 —
   en una de 5 el texto no cabe y CADA etiqueta envuelve a dos líneas, y el
   valor con porcentaje ("$1.9M 51.7%") se parte en dos renglones cuando en
   la fila de 4 el mismo patrón cabe en uno. */
.opp .metrics-5 .metric { padding: 3.6mm 3mm; }
.opp .metrics-5 .metric .v { font-size: 16pt; }
.opp-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12mm; margin-bottom: 6mm;
            break-inside: avoid; page-break-inside: avoid; }
/* Sin break-inside:avoid a propósito: una nota es prosa, no una foto ni una
   tabla — que envuelva y siga en la página siguiente como cualquier párrafo
   de un libro es normal. Forzarla entera a la página siguiente era parte de
   lo que la dejaba varada, sola, en una hoja casi en blanco.
   white-space:pre-line respeta los saltos de párrafo que quien escribió la
   nota de verdad tecleó — por default el HTML los colapsa a un solo espacio
   y una nota de tres párrafos se imprime como un solo bloque de texto.
   overflow-wrap:anywhere evita que una URL o un token sin espacios se salga
   del ancho de la nota (y de la hoja): sin esto no hay dónde partir la
   palabra y .page-block la recorta en silencio contra el borde. */
.opp-note { font-family: 'Inter', sans-serif; font-size: 8pt; color: var(--sec);
            font-style: italic; line-height: 1.55; border-left: 2px solid var(--terra);
            padding-left: 10px; margin-top: 8mm;
            white-space: pre-line; overflow-wrap: anywhere; }
.opp .strip { margin-top: 6mm; }
/* Techo, no piso: con dos o más fotos aspect-ratio ya las deja bajo este
   alto sin ayuda (170mm entre 2 ya da ~63mm) — este límite solo cubre filas
   más angostas. Con UNA sola foto no se usa: ver :only-child abajo, que le
   pone techo al ANCHO en vez de al alto. Ponerle techo al alto a una foto
   que ya ocupa el 100% del ancho es exactamente el recorte panorámico
   exagerado que aspect-ratio existe para evitar (ver comentario arriba) —
   con max-height a secas eso volvía a pasar en el caso de una sola foto. */
.opp .strip img { max-height: 60mm; }
.opp .strip img:only-child { flex: none; width: 62%; max-height: none; }

.opp-detail { margin-top: 8mm; }
/* Los renders del detalle usan `contain`, no `cover`: aquí caben planos-render
   2D VERTICALES (un lote angosto y alto, p.ej. 5.5 x 13.7 m), y recortarlos a
   4/3 —lo que hace la galería de fotos— cortaba la mitad del plano. `contain`
   los muestra ENTEROS; la altura generosa aprovecha que el detalle tiene hoja
   de sobra. `aspect-ratio: auto` suelta el 4/3 de la base. El :only-child (un
   solo render, el caso común) va a su proporción real, sin recorte. */
.opp-detail .strip img { aspect-ratio: auto; object-fit: contain; height: 118mm; }
.opp-detail .strip img:only-child { flex: none; width: 74%; height: auto; max-height: 165mm; }
/* Sin break-inside:avoid aquí a propósito: un presupuesto de diez capítulos
   es más alto que una página y DEBE poder partirse — forzarlo entero era el
   mismo bug que se acaba de arreglar arriba, con otro disfraz. Lo atómico
   vive donde de verdad hace falta: cada fila de la tabla (arriba) y cada
   plano (abajo), que sí son unidades visuales que no deben cortarse. */
.detail-section { margin-bottom: 8mm; }
.detail-section:last-child { margin-bottom: 0; }
/* El presupuesto YA NO fuerza su propia hoja (pedido de Louis): sin el plano
   técnico y con los renders arriba, la hoja de detalle queda ~70% libre y un
   presupuesto de obra típico (corto) cabe de sobra ahí — mandarlo a una hoja
   nueva dejaba media hoja en blanco. Ahora fluye después de los renders como
   cualquier otra sección; si algún día uno muy largo no cupiera, Chromium
   brinca solo, sin partir renglones (break-inside:avoid en table.kv tr). */
.plano { display: flex; flex-wrap: wrap; gap: 6mm; }
/* max-width limita a la mitad de la columna: sin esto, un piso solo (o un
   número impar que deja uno solo en la última fila) hereda todo el ancho de
   flex:1 y, como el viewBox del SVG ahora respeta la proporción real del
   piso en vez de forzar un cuadrado, un piso angosto podía crecer alto sin
   límite — la misma familia de bug que una página casi en blanco. */
.plano-floor { flex: 1; min-width: 70mm; max-width: calc(50% - 3mm);
               break-inside: avoid; page-break-inside: avoid; }
.plano-floor-name { font-family: 'Inter', sans-serif; font-size: 7pt; font-weight: 600;
  color: var(--sec); margin-bottom: 2mm; }
/* max-height es el otro lado de la misma pinza que max-width en .plano-floor:
   un lote angosto y PROFUNDO (más alto que ancho) sigue siendo respetado en
   su proporción real por el viewBox, así que topar solo el ancho no basta —
   comprobado con datos reales: un piso así medía ~130mm de alto ya topado en
   ancho, y esos ~130mm de más bastaban para correr el presupuesto (dos
   renglones) a una tercera página casi en blanco. Con max-height, el SVG se
   encoge dentro de su caja preservando su proporción (preserveAspectRatio por
   default no distorsiona) en vez de estirar la página. */
.plano-svg { width: 100%; height: auto; max-height: 100mm;
             border: 1px solid var(--border); background: var(--warm); }
.plano-room { font-family: 'Inter', sans-serif; font-size: 7px; fill: var(--sec); }
/* Muebles: rect tenue, SIN label. planImage.ts sí nombra cada mueble ("cama queen") porque
   ahí el lector es un modelo de render que necesita saber qué está viendo; aquí el lector
   es un inversionista viendo un plano técnico en miniatura dentro de un pitch deck — lo que
   importa es la masa (dónde va cada pieza y qué tan grande es), no el nombre impreso en un
   rect de unos milímetros. Menos ruido visual, mismo dato geométrico. */
.plano-fixture { fill: var(--border); stroke: var(--sec); stroke-width: 0.4; opacity: 0.6; }
/* Medidas puestas a mano en el editor (ManualDimension): línea sutil + número,
   mismo lenguaje visual que el editor en vivo (FloorPlanCanvas.tsx) — SIEMPRE se
   dibujan, sin el toggle "showDims" del editor, porque ese toggle no persiste al
   modelo (es puro estado de UI) y aquí no hay pantalla que abarrotar. */
.plano-dim { stroke: var(--sec); stroke-width: 0.4; }
.plano-dim-label { font-family: 'Inter', sans-serif; font-size: 6px; fill: var(--sec); }

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
    """El plazo real: meses desde la adquisición, congelados por el API en la
    primera renta —o en la venta si nunca rentó—, es decir en el momento en que
    la propiedad se volvió productiva. Se nombra "plazo real" y no "meses en
    cartera" ni "meses de obra" porque es el mismo `holdMonthsActual` que la
    ficha y la tabla ya llaman así."""
    hold = int(_num(p.get("holdMonthsActual")))
    return f"Plazo real {hold} meses" if hold else ""


def _projected_hold_tail(p: dict) -> str:
    """En desarrollo nada es real todavía — ni siquiera el plazo: sin primera
    renta ni venta, `holdMonthsActual` no tiene hito del cual congelar y cae a
    adquisición → hoy, que no mide nada del proyecto, solo cuánto hace que se
    compró. Esta coleta usa `holdMonths`, el supuesto de underwriting en
    vigor — la misma cifra que ya alimenta `projectedRoi` — etiquetada como
    lo que es, igual que las demás métricas de esta tarjeta."""
    hold = int(_num(p.get("holdMonths")))
    return f"Plazo proyectado {hold} meses" if hold else ""


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
    return _card(p, kicker, _projected_hold_tail(p), metrics)


def _pick_floors(geometry: dict) -> list:
    """Los pisos que el prospecto debe dibujar, aceptando los dos shapes que
    persiste el editor (types.ts): v2 trae `floors` en la raíz; v3 los anida
    en `variants.original` / `variants.planned`. El prospecto es el pitch al
    inversionista: muestra la PROPUESTA (el levantamiento planeado) cuando
    existe, y el original queda como el registro de respaldo.

    "Existe" exige geometría dibujada — CUALQUIER piso del planeado con al
    menos un vértice — porque "EMPEZAR EN BLANCO" persiste un planeado con un
    piso vacío, y ese lienzo en blanco no es propuesta todavía: no le gana a
    un original dibujado. Cualquier otro shape (v1, basura, vacío) regresa []
    y el bloque desaparece, igual que siempre."""
    geometry = geometry or {}
    if geometry.get("schemaVersion") != 3:
        return geometry.get("floors") or []
    variants = geometry.get("variants") or {}
    planned = (variants.get("planned") or {}).get("floors") or []
    if any(floor.get("vertices") for floor in planned):
        return planned
    return (variants.get("original") or {}).get("floors") or []


def _floorplan_svg(geometry: dict) -> str:
    """El plano de una oportunidad, dibujado con lo único que el modelo crudo del
    editor garantiza siempre: muros (con su grosor) y el nombre de cada cuarto en
    su punto de etiqueta — más muebles y medidas manuales cuando el usuario los
    puso. Sin polígono relleno — un cuarto puede nombrarse sin estar cerrado por
    muros, así que el modelo no trae ni su área ni su forma
    (ver docs/plans/2026-08-05-prospecto-plano-renders-presupuesto-design.md).
    Sin pisos → "", el bloque desaparece del mismo modo que un `_strip` vacío.

    Una sola escala para TODOS los pisos del edificio, no una por piso: dos
    plantas de la MISMA construcción tienen que leerse a un tamaño comparable
    — un muro de 15cm es el mismo grosor de línea en planta baja y en planta
    alta. Escalar cada piso por separado (como hacía antes) dibuja edificios
    distintos a "el mismo tamaño de página" en vez de a la misma escala, que
    es precisamente lo que un plano técnico no puede hacer.

    El viewBox de cada piso ya no es un cuadrado fijo: mide el ancho y el alto
    reales de ESE piso a la escala compartida. Antes el cuadrado forzaba
    `.plano-svg { width:100%; height:auto }` a un 1:1 sin importar la forma
    real del piso — un lote angosto y profundo se dibujaba con casi la mitad
    del lienzo vacía, y un piso solo (o uno impar sobrante en la fila) podía
    estirarse a 170mm de alto por pura coincidencia geométrica, no por su
    contenido. Con el viewBox real, el alto que ocupa en la página es el alto
    que el piso de verdad necesita."""
    floors = _pick_floors(geometry)
    extents = []
    for floor in floors:
        vertices = floor.get("vertices") or {}
        if not vertices:
            extents.append(None)
            continue
        xs = [v["x"] for v in vertices.values()]
        ys = [v["y"] for v in vertices.values()]
        # El piso degenerado (un solo vértice) tiene extensión cero: el mínimo
        # evita la división entre cero, no dibuja nada de más.
        width = max(max(xs) - min(xs), 0.01)
        height = max(max(ys) - min(ys), 0.01)
        extents.append((width, height, min(xs), max(ys)))

    real = [e for e in extents if e is not None]
    if not real:
        return ""
    # La escala compartida se fija por el piso MÁS GRANDE del edificio, para
    # que ningún piso se salga de su columna de 82mm — el mismo criterio que
    # ya se usaba por piso, ahora aplicado al edificio completo.
    scale = _SVG_SIZE / max(max(w, h) for w, h, _, _ in real)

    blocks = []
    for floor, extent in zip(floors, extents):
        if extent is None:
            continue
        width, height, min_x, max_y = extent
        vertices = floor.get("vertices") or {}

        def sx(x, min_x=min_x):
            return (x - min_x) * scale + _SVG_PAD

        # La y del modelo apunta hacia ARRIBA (viewTransform.ts la niega en sus
        # dos cámaras, y userToWorld la vuelve a invertir); la del SVG apunta
        # hacia abajo. Sin este volteo el plano se imprime espejeado de arriba
        # a abajo respecto de lo que el usuario dibujó en el editor.
        def sy(y, max_y=max_y):
            return (max_y - y) * scale + _SVG_PAD

        lines = []
        for edge in (floor.get("edges") or {}).values():
            # Una fantasma (kind 'ghost') es una división manual de cuarto, no un muro: no
            # puede traer aberturas (motor lo impide), así que basta este skip temprano —
            # sin él el prospecto dibujaría un muro donde el usuario solo puso una división.
            if edge.get("kind") == "ghost":
                continue
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

        # Muebles (Task 12): rect tenue por mueble, sin label (ver .plano-fixture arriba).
        # `?? []` en TS es `or []` aquí — ningún blob previo a Task 10 trae esta clave, y
        # no puede tratarse como error: es "sin muebles", no un plano roto.
        fixtures = []
        for fx in floor.get("fixtures") or []:
            fx_x, fx_y = fx.get("x"), fx.get("y")
            if fx_x is None or fx_y is None:
                continue
            fcx, fcy = sx(fx_x), sy(fx_y)
            fw, fh = _num(fx.get("w_m")) * scale, _num(fx.get("h_m")) * scale
            # Mismo signo que planImage.ts y FloorPlanCanvas.tsx: rot es CCW en coordenadas
            # de MUNDO (y hacia arriba); sy() niega el eje Y igual que py() allá, así que la
            # rotación se niega aquí también — si no, un mueble rotado saldría al revés.
            frot = -_num(fx.get("rot"))
            fixtures.append(
                f'<rect class="plano-fixture" x="{-fw / 2:.1f}" y="{-fh / 2:.1f}" '
                f'width="{fw:.1f}" height="{fh:.1f}" '
                f'transform="translate({fcx:.1f} {fcy:.1f}) rotate({frot:.1f})" />'
            )

        # Medidas manuales (Eduardo, addendum #5): el editor las guarda siempre pero
        # solo las muestra a demanda vía "Dims"; ese toggle es puro estado de UI
        # (`showDims` vive en el reducer, no en el modelo persistido), así que aquí,
        # sin UI que abarrotar, se dibujan todas — mismo criterio que fixtures/muros.
        dims = []
        for dim in floor.get("manualDimensions") or []:
            p1, p2 = dim.get("p1") or {}, dim.get("p2") or {}
            x1_m, y1_m, x2_m, y2_m = p1.get("x"), p1.get("y"), p2.get("x"), p2.get("y")
            if x1_m is None or y1_m is None or x2_m is None or y2_m is None:
                continue
            x1, y1, x2, y2 = sx(x1_m), sy(y1_m), sx(x2_m), sy(y2_m)
            length = math.hypot(x2_m - x1_m, y2_m - y1_m)
            # El número corre PARALELO a la línea, no siempre horizontal — mismo ajuste que
            # FloorPlanCanvas.tsx: una cota vertical (o diagonal) con el número horizontal
            # encima quedaba cruzada por su propia línea. Desplazamiento PERPENDICULAR a la
            # línea, no solo "hacia arriba", para despegarse de ella en cualquier orientación.
            #
            # La dirección se CANONIZA (siempre "hacia la derecha", o hacia abajo si es
            # exactamente vertical) igual que en el editor: p1/p2 quedan grabados en el orden
            # en que el usuario los trazó, y sin canonizar el lado del número dependía de ese
            # sentido de arrastre — mismo trazo visual, número a veces a la izquierda, a veces
            # a la derecha. Canonizada, ddx ≥ 0 siempre, así que atan2 ya cae en [-90°, 90°]
            # sin recortarlo aparte — el texto nunca sale cabeza abajo.
            ddx, ddy = x2 - x1, y2 - y1
            if ddx < 0 or (ddx == 0 and ddy < 0):
                ddx, ddy = -ddx, -ddy
            seg_len = math.hypot(ddx, ddy) or 1
            angle_deg = math.degrees(math.atan2(ddy, ddx))
            label_x = (x1 + x2) / 2 + (ddy / seg_len) * 3
            label_y = (y1 + y2) / 2 - (ddx / seg_len) * 3
            dims.append(
                f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" class="plano-dim" />'
                f'<text x="{label_x:.1f}" y="{label_y:.1f}" class="plano-dim-label" text-anchor="middle" '
                f'transform="rotate({angle_deg:.1f} {label_x:.1f} {label_y:.1f})">{length:.2f} m</text>'
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

        view_w = width * scale + _SVG_PAD * 2
        view_h = height * scale + _SVG_PAD * 2
        blocks.append(f"""<div class="plano-floor">
  <div class="plano-floor-name">{_esc(floor.get("name", ""))}</div>
  <svg viewBox="0 0 {view_w:.1f} {view_h:.1f}" class="plano-svg">{''.join(lines)}{''.join(fixtures)}{''.join(dims)}{''.join(labels)}</svg>
</div>""")
    if not blocks:
        return ""
    return f'<div class="plano">{"".join(blocks)}</div>'


def _budget_full(lines: list[dict], chapters: list[str]) -> str:
    """El presupuesto renglón por renglón, agrupado por capítulo (en el orden
    que `chapters` ya trae — residuo al final, ver budget_db._chapters), con
    un subtotal por capítulo y un Total general. Pedido explícito: un solo
    agregado por capítulo escondía la granularidad real del presupuesto —
    esto es cada partida, su cantidad y su monto. Sin renglones → "", el
    bloque desaparece del mismo modo que un `_strip` vacío.

    Sin subtotal cuando un capítulo trae un solo renglón: repetir la misma
    cifra dos veces (la partida y "Subtotal" idénticos) no añade información,
    solo la impresión de que el presupuesto no está costeado a detalle."""
    if not lines:
        return ""
    by_chapter: dict[str, list[dict]] = {}
    for line in lines:
        by_chapter.setdefault(line.get("chapterName") or "", []).append(line)

    sections = []
    grand_total = 0.0
    for chapter in chapters:
        chapter_lines = by_chapter.get(chapter)
        if not chapter_lines:
            continue
        rows, subtotal = [], 0.0
        for line in chapter_lines:
            amount = _num(line.get("budgetedAmount"))
            subtotal += amount
            qty = _num(line.get("quantity"))
            unit = line.get("unit") or ""
            qty_label = f"{qty:g} {unit}".strip()
            rows.append(
                f'<tr><td>{_esc(line.get("name", ""))}'
                f'<span class="budget-qty"> · {_esc(qty_label)}</span></td>'
                f'<td class="n">{_fmt_mxn(amount)}</td></tr>'
            )
        if len(chapter_lines) > 1:
            rows.append(f'<tr class="budget-subtotal"><td>Subtotal</td><td class="n">{_fmt_mxn(subtotal)}</td></tr>')
        grand_total += subtotal
        sections.append(
            f'<div class="budget-chapter"><div class="budget-chapter-name">{_esc(chapter)}</div>'
            f'<table class="kv">{"".join(rows)}</table></div>'
        )
    sections.append(
        f'<table class="kv budget-grand-total"><tr><td>Total</td><td class="n">{_fmt_mxn(grand_total)}</td></tr></table>'
    )
    return "".join(sections)


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
        _metric(f"{hold} meses" if hold else "—", "Plazo proyectado"),
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
    # Sin Dirección ni Ciudad aquí: la banda verde de arriba ya las imprime
    # ({address} · {city}), palabra por palabra — repetirlas en la tabla no
    # añadía información, solo un renglón más para desalinear contra la
    # columna de Financieros.
    ubicacion = _kv_rows([
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
    detail_html = _opportunity_detail(p)

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
      <div><div class="col-label">Propiedad</div>{ubicacion}</div>
    </div>
    {strip}
    {note_html}
    {detail_html}
  </div>
</div>"""


def _opportunity_detail(p: dict) -> str:
    """Renders (propuesta de diseño) y desglose del presupuesto de obra de una
    oportunidad. "" si no hay ninguno de los dos.

    El plano TÉCNICO (`_floorplan_svg`) NO va aquí — pedido de Louis: al cliente
    no le interesan los planos técnicos; la distribución la comunica el render 2D
    amueblado, que sí entra.

    Vive en el mismo flujo que la tarjeta principal, justo después de la nota
    — ya no en su propia page-block. Forzar un salto de página aquí, sin
    importar cuánta hoja quedara libre tras la nota, era lo que dejaba una
    cola de dos líneas sola arriba de una hoja casi en blanco: cuando la nota
    terminaba a la mitad de una página, plano/renders/presupuesto de todos
    modos brincaban a la siguiente por el page-break-after:always de su
    propia page-block. Sin ese salto forzado, Chromium solo pasa de página
    cuando de verdad se le acaba el espacio.

    Los renders son la cabeza de cada cadena (`renderHeads`, una por línea, la
    propuesta vigente de cada idea, sin pasos intermedios) — INCLUIDOS los
    planos-render 2D amueblados, que son los que muestran la distribución. Viven
    aquí, no junto al hero, donde la tira quedaba apretada y no se veía. Antes
    esta sección traía `renders` sin deduplicar por cadena —el mismo diseño dos
    veces, con borradores ya editados encima—; ahora es `renderHeads`."""
    render_heads = [r for r in p.get("renderHeads", []) if r.get("dataUri")]
    renders_html = _strip(render_heads, "", 3) if render_heads else ""

    budget = p.get("budget") or {}
    budget_html = _budget_full(budget.get("lines", []), budget.get("chapters", []))

    if not (renders_html or budget_html):
        return ""

    # El plano TÉCNICO (muros/nombres de cuarto, `_floorplan_svg`) NO se muestra:
    # pedido explícito de Louis — al cliente no le interesa ver planos técnicos;
    # lo que comunica la distribución es el render 2D amueblado, que sí entra abajo.
    sections = "".join([
        f'<div class="detail-section"><div class="col-label">Renders · propuesta de diseño</div>{renders_html}</div>'
        if renders_html else "",
        # El presupuesto fluye después de los renders, en la misma hoja (pedido
        # de Louis): un presupuesto de obra típico es corto y cabe en el ~70% de
        # hoja que dejan los renders. Ya no fuerza su propia página.
        f'<div class="detail-section"><div class="col-label">Presupuesto de obra</div>{budget_html}</div>'
        if budget_html else "",
    ])
    return f'<div class="opp-detail">{sections}</div>'


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
