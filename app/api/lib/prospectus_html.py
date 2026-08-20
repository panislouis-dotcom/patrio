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
/* Dos columnas por CSS puro (Python solo decide SI aplica — ver
   _BUDGET_TWO_COLUMN_THRESHOLD — nunca cuáles capítulos van en cuál columna).
   column-gap en vez de un borde/padding manual entre columnas: es lo que ya
   separa .opp-cols del mismo documento. */
.budget-columns { columns: 2; column-gap: 8mm; }
/* Sin break-inside:avoid-column a propósito: mismo motivo que table.kv ya
   documenta para páginas — un capítulo largo puede partirse entre columnas
   como cualquier tabla de un libro. Lo único protegido sigue siendo el
   renglón (table.kv tr) y el título pegado a su primer renglón
   (budget-chapter-name, abajo). */
.budget-chapter { margin-bottom: 3mm; }
.budget-chapter:last-of-type { margin-bottom: 0; }
.budget-chapter-name { font-family: 'Inter', sans-serif; font-size: 6.5pt; font-weight: 600;
                        color: var(--sec); margin-bottom: 1.5mm;
                        break-after: avoid; page-break-after: avoid; }
.budget-columns table.kv td { font-size: 7.5pt; padding: 3px 0; }
.budget-qty { font-size: 7pt; color: var(--sec); font-weight: 400; }
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

/* ══ Plano junto a su render ══════════════════════════════════════════════ */
.plan-row { margin: 0 0 7mm 0; break-inside: avoid; }
.plan-side { margin-bottom: 3mm; }
.plan-side-label { font-family: 'Inter', sans-serif; font-size: 7pt; letter-spacing: .12em;
                   text-transform: uppercase; color: #7A7A7A; margin-bottom: 1.5mm; }
.plan-pair { display: flex; gap: 4mm; align-items: flex-start; }
.plan-sheet { flex: 1 1 50%; min-width: 0; }
/* 110mm, no 165: con 165mm cada piso ocupaba solo su columna de ~83mm de ancho pero
   ~171mm de alto de fila — más de la mitad de una A4 (297mm) — así que nunca cabían
   2 pisos en la misma página. Medido con el arnés real de Chromium contra los 4 pisos
   reales de las propiedades 5 y 10 (viewBox más angosto: alto/ancho 2.02): a 110mm dos
   filas miden ~232mm juntas —caben en la página— y el plano dibujado sigue midiendo
   ~55-60mm de ancho visible. Not 85mm: ahí el ancho visible cae a ~42-46mm, medido
   ilegible en un PDF real (cotas y m² encimados) — 110mm es el primer escalón donde
   caben 2 por página sin repetir ese problema. */
.plan-sheet svg { width: 100%; height: auto; max-height: 110mm; }
/* `_photo_block` mete una FOTO (etiqueta img) en este mismo hueco — antes solo lo
   llenaba un plano en SVG, que ya trae su propia proporción en el viewBox. Una
   imagen sin ancho ni alto explícitos se dibuja a su tamaño de píxeles real (miles
   de px de una foto de cámara) dentro de un flex angosto: el layout la desborda y
   no se ve nada. Mismo tope que la regla vecina de SVG, con object-fit porque, a
   diferencia del plano, una foto sí puede desbordar su caja en cualquier proporción. */
.plan-sheet img { width: 100%; height: auto; max-height: 110mm; object-fit: contain; }
/* El plano trae su nombre de piso DIBUJADO dentro del propio SVG (floorToSvg — el
   mismo que usa el botón ↓ SVG del editor, no se toca aquí para no cambiarle la
   descarga) — el margen que le hace lugar a ese título es ~8.5% de su alto, medido
   sobre las 4 hojas reales de las propiedades 5 y 10. A los 110mm de tope que ya
   toca un piso angosto, eso es ~9mm de aire antes de que empiecen los muros. El
   render de al lado no trae ese margen —la imagen ocupa el cuadro completo—, así
   que sin este padding sus dos "arribas" no coinciden: el plano se ve corrido hacia
   abajo respecto al render. Este padding empuja el render esos mismos ~9mm.  */
.plan-renders { flex: 1 1 50%; min-width: 0; display: flex; flex-direction: column; gap: 2mm;
                padding-top: 9mm; }
/* La FOTO (a diferencia del plano) no trae título dibujado adentro — ocupa el
   cuadro completo desde su borde superior. Con el mismo padding-top de arriba el
   render quedaba ~9mm más abajo que la foto: las dos "arribas" ya no coincidían,
   al revés del problema que ese padding arregla para el plano. */
.plan-pair--photo .plan-renders { padding-top: 0; }
/* 78mm × 2 + hueco ≈ el alto del plano de al lado: la pareja se lee como una banda,
   no como una columna corta junto a una torre de imágenes. */
.plan-renders img { width: 100%; height: auto; max-height: 78mm; object-fit: contain; }
/* Una hoja sin render no debe estirarse a media página: sin pareja se queda a su ancho. */
.plan-pair > .plan-sheet:only-child { flex: 0 0 62%; }

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


def _inv_value(total_inv, with_fees_venta, with_fees_renta) -> str:
    """La inversión sin comisiones, y —cuando el llamador los pasa— hasta dos
    escenarios con comisiones (venta y renta) como sub-línea `<small>` en la
    misma celda: mismo patrón que ya usan `gain_v` (Ganancia realizada) y
    `gain_value` (Ganancia proyectada) para su detalle secundario, sin abrir
    columnas nuevas en la rejilla fija de métricas.

    `compute_fees()` (fees.py) calcula los dos escenarios siempre, sin
    importar `exit_strategy` — pero esta función no decide cuál mostrar, solo
    imprime lo que le pasan. Esa decisión es de cada CALLER, por etapa:
    vendida solo pasa venta (renta ya es contrafactual, nunca se cobró),
    rentada solo pasa renta (venta es el espejo), desarrollo pasa los dos (la
    salida sigue genuinamente indecisa), oportunidad no pasa ninguno (el
    detalle vive en su propia fila, `_opportunity_fees_metrics()`) y resumen
    ya no llama a esta función. Por eso aquí pueden llegar los dos, uno solo,
    o ninguno — nunca por ambigüedad, siempre porque el llamador ya resolvió
    cuál escenario es real para su propia tarjeta."""
    v = _fmt_mxn_compact_or_dash(total_inv)
    parts = []
    if with_fees_venta is not None:
        parts.append(f'V {_fmt_mxn_compact(with_fees_venta)}')
    if with_fees_renta is not None:
        parts.append(f'R {_fmt_mxn_compact(with_fees_renta)}')
    if parts:
        v += f' <small>{" · ".join(parts)} c/comisiones</small>'
    return v


def _fee_scenario_missing(reasons: list[str] | None) -> str:
    """El guion, con el porqué al lado — nunca solo, se leería como cero
    comisión. `reasons` siempre trae exactamente un elemento cuando no está
    vacío: compute_fees() (fees.py) nombra un solo insumo por escenario."""
    labels = {"salePrice": "falta precio de venta", "rentMonthly": "falta renta mensual"}
    text = " · ".join(labels[r] for r in (reasons or []) if r in labels)
    return f'— <small>{_esc(text)}</small>' if text else "—"


def _opportunity_fees_metrics(p: dict) -> str:
    """Comisiones del fondo, en su propia fila. Solo en _opportunity(): es la
    única etapa donde el camino de salida sigue genuinamente indeciso Y la
    única con espacio de sobra (página completa, sin el alto fijo de .proj
    que aprieta a las demás). No lleva CSS nuevo: hereda el tamaño base de
    `.metric` (padding 5mm, valor a 20pt) — el mismo que ya usa cualquier
    otra fila de 4 del documento (p.ej. `_summary_card()` sin ventas). Eso la
    deja MÁS GRANDE que la fila principal justo arriba, que es una de 5 y por
    eso sí lleva el override a 16pt (`.opp .metrics-5`, ver el comentario ahí
    arriba) — no es el mismo peso visual: la de arriba está recortada para
    caber sus cinco columnas, esta no necesita recorte con solo cuatro.

    Terreno y obra nunca faltan — siempre hay una base y un % (el default si
    nadie lo capturó), así que sus dos celdas acceden a `landFee`/
    `constructionFee` con corchetes, no `.get()`: un KeyError aquí sería una
    señal real de que compute_fees() (fees.py) dejó de cumplir esa garantía,
    no un dato opcional que la tarjeta deba tolerar en silencio. Los dos
    finales sí pueden faltar, cada uno por su cuenta, y entonces nombran su
    propio insumo ausente."""
    venta = (_fmt_mxn_compact(p["totalInvestmentWithFeesVenta"])
             if p.get("totalInvestmentWithFeesVenta") is not None
             else _fee_scenario_missing(p.get("feesMissingInputsVenta")))
    renta = (_fmt_mxn_compact(p["totalInvestmentWithFeesRenta"])
             if p.get("totalInvestmentWithFeesRenta") is not None
             else _fee_scenario_missing(p.get("feesMissingInputsRenta")))
    return "".join([
        _metric(f'{_fmt_mxn_compact(p["landFee"])} <small>{_fmt_pct(p.get("landCommissionPct"))}</small>', "Comisión compra terreno"),
        _metric(f'{_fmt_mxn_compact(p["constructionFee"])} <small>{_fmt_pct(p.get("constructionCommissionPct"))}</small>', "Comisión de obra"),
        _metric(venta, "Inversión c/comisiones · venta"),
        _metric(renta, "Inversión c/comisiones · renta"),
    ])


def _strip(images, label: str, limit: int) -> str:
    imgs = images[:limit]
    if not imgs:
        return ""
    tags = "".join(f'<img src="{i["dataUri"]}" alt="">' for i in imgs)
    lab = f'<div class="strip-label">{_esc(label)}</div>' if label else ""
    return f'{lab}<div class="strip">{tags}</div>'


def _plan_rows(sheets: list[dict], renders: list[dict]) -> list[dict]:
    """Las hojas dibujadas + las cabezas de render → filas por LINAJE de piso.

    Una fila es un piso a lo largo de sus variantes, no una hoja: un piso planeado
    nacido de PARTIR/RE-PARTIR comparte el `id` de su contraparte original
    (`LevantamientoPanel.tsx:231`), y ese id compartido es justo lo que permite
    alinear el antes con el después sin heurística.

    De los renders de cada (floorId, sourceVariant) solo entra el que trae
    `isChosen` — nunca hay más de uno, porque el índice único de la base de
    datos ya lo garantiza (migración 046). Sin estrella, ese lado queda con
    `renders: []`: el PLANO se imprime de todos modos (es el ancla dimensional
    de la PR #45, no depende de que exista un render), solo el hueco de imagen
    queda vacío. No hay tira suelta ni «el más reciente» de respaldo — si nadie
    eligió, el documento no adivina.

    Por eso mismo un render empata por `(floorId, sourceVariant)`, LAS DOS, nunca
    solo la primera: el propio comentario de `LevantamientoPanel.tsx` lo advirtió
    por escrito antes de que esta función existiera.

    El nombre del piso sale de la HOJA, no del render: `floorName` en el render
    está congelado para sobrevivir a un renombre, pero el piso vivo siempre
    existe si hay una hoja que mostrar.
    """
    chosen_by_key = {
        (r["floorId"], r["sourceVariant"]): r
        for r in renders
        if r.get("dataUri") and r.get("isChosen") and r.get("floorId") is not None
    }
    by_key = {(s["floorId"], s["variant"]): s for s in sheets}

    order, seen = [], set()
    for s in sheets:
        if s["floorId"] not in seen:
            seen.add(s["floorId"])
            order.append(s["floorId"])

    rows = []
    for fid in order:
        antes, despues = by_key.get((fid, "original")), by_key.get((fid, "planned"))
        antes_r = chosen_by_key.get((fid, "original"))
        despues_r = chosen_by_key.get((fid, "planned"))
        # Un planeado clonado y aún no editado produce el MISMO string —mismo
        # serializador, misma entrada—. Imprimirlo bajo "Antes / Después" afirmaría
        # una transformación que nadie diseñó. Si las dos variantes tenían estrella
        # propia, se queda con la del lado "antes" — arbitrario entre dos iguales,
        # pero determinista.
        if antes and despues and antes["svg"] == despues["svg"]:
            despues = None
        rows.append({
            "floorName": (antes or despues)["floorName"],
            "antes": {**antes, "renders": [antes_r] if antes_r else []} if antes else None,
            "despues": {**despues, "renders": [despues_r] if despues_r else []} if despues else None,
        })
    return rows


def _photo_rows(images: list[dict], renders: list[dict]) -> list[dict]:
    """Foto fuente + su render elegido — mismo principio que `_plan_rows`, sin
    Antes/Después porque una foto no tiene variantes. Sin estrella, esa foto no
    imprime fila: a diferencia del plano, una foto sin su render elegido no tiene
    nada propio que decir aquí (la foto en sí ya se ve en la galería de arriba)."""
    chosen_by_image = {
        r["sourceImageId"]: r for r in renders
        if r.get("dataUri") and r.get("isChosen") and r.get("sourceImageId") is not None
    }
    rows = []
    for img in images:
        r = chosen_by_image.get(img["id"])
        if r is not None:
            rows.append({"svg": f'<img src="{img["dataUri"]}" alt="">', "renders": [r]})
    return rows


def _plan_side(side: dict | None, label: str, show_label: bool, is_photo: bool = False) -> str:
    """Un lado de una fila: la hoja (o foto) y, a su derecha, su render elegido.

    `show_label` solo es cierto cuando la fila trae las DOS variantes: un piso sin
    propuesta no necesita que le digan "Antes" de qué.

    `is_photo` distingue una FOTO de un PLANO: solo el plano trae su título dibujado
    dentro del propio SVG (ver `.plan-renders`), así que solo él necesita el padding
    que alinea el render con eso. Una foto no trae ese título — sin la clase
    `plan-pair--photo` que apaga ese padding, el render de al lado empieza más abajo
    que la foto misma."""
    if side is None:
        return ""
    lab = f'<div class="plan-side-label">{_esc(label)}</div>' if show_label else ""
    imgs = "".join(f'<img src="{r["dataUri"]}" alt="">' for r in side["renders"])
    renders = f'<div class="plan-renders">{imgs}</div>' if imgs else ""
    pair_class = "plan-pair plan-pair--photo" if is_photo else "plan-pair"
    return (f'<div class="plan-side">{lab}<div class="{pair_class}">'
            f'<div class="plan-sheet">{side["svg"]}</div>{renders}</div></div>')


def _plan_block(rows: list[dict]) -> str:
    """La medida junto a la imagen que la aproxima. Sin filas → "", el bloque
    desaparece: si está va, si no está no va."""
    if not rows:
        return ""
    out = []
    for row in rows:
        both = row["antes"] is not None and row["despues"] is not None
        out.append(f'<div class="plan-row"><div class="col-label">{_esc(row["floorName"])}</div>'
                   + _plan_side(row["antes"], "Antes", both)
                   + _plan_side(row["despues"], "Después", both)
                   + '</div>')
    return "".join(out)


def _photo_block(rows: list[dict]) -> str:
    """Foto + su render elegido, mismo layout de pareja que `_plan_block` pero sin
    encabezado de piso — una foto no tiene nombre que anunciar."""
    if not rows:
        return ""
    return "".join(f'<div class="plan-row">{_plan_side(row, "", False, is_photo=True)}</div>'
                   for row in rows)


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
        # renta es contrafactual en una vendida — nunca se pasa, aunque el
        # dato exista (compute_fees() lo calcula igual, con la renta
        # proyectada, porque nunca hay una real que cobrar).
        _metric(_inv_value(p.get("totalInvestment"), p.get("totalInvestmentWithFeesVenta"), None), "Inversión sin comisiones"),
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
        # venta es contrafactual en una rentada — nunca se pasa, aunque el
        # dato exista: es el espejo del mismo criterio en _sold_card().
        _metric(_inv_value(p.get("totalInvestment"), None, p.get("totalInvestmentWithFeesRenta")), "Inversión sin comisiones"),
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
        _metric(_inv_value(p.get("totalInvestment"), p.get("totalInvestmentWithFeesVenta"), p.get("totalInvestmentWithFeesRenta")), "Inversión sin comisiones"),
        _metric(_fmt_mxn_compact_or_dash(_sale_or_none(p.get("projectedSale"))), "Venta proyectada"),
        _metric(_fmt_pct_or_dash(p.get("projectedRoi")), "ROI proy. anual"),
        _metric(_fmt_pct_or_dash(p.get("projectedRoiTotal")), "Ganancia proyectada %"),
        _metric(_fmt_pct_or_dash(p.get("capRate")), "Cap rate proy. s/ inversión"),
    ])
    return _card(p, kicker, _projected_hold_tail(p), metrics)


# Doce renglones es aproximadamente media página a una columna con el tipo
# compacto de .budget-columns — por debajo de eso, partir en dos columnas
# dejaría la segunda visiblemente vacía en vez de ahorrar espacio.
_BUDGET_TWO_COLUMN_THRESHOLD = 12


def _budget_full(lines: list[dict], chapters: list[str]) -> str:
    """El presupuesto renglón por renglón, agrupado por capítulo (en el orden
    que `chapters` ya trae — residuo al final, ver budget_db._chapters), con
    un subtotal por capítulo y un Total general. Pedido explícito: un solo
    agregado por capítulo escondía la granularidad real del presupuesto —
    esto es cada partida, su cantidad y su monto. Sin renglones → "", el
    bloque desaparece del mismo modo que un `_strip` vacío.

    Sin subtotal cuando un capítulo trae un solo renglón: repetir la misma
    cifra dos veces (la partida y "Subtotal" idénticos) no añade información,
    solo la impresión de que el presupuesto no está costeado a detalle.

    A dos columnas cuando hay suficientes renglones (feedback en vivo: un
    presupuesto real, con capítulos de verdad, ocupaba hasta tres páginas).
    `columns: 2` en CSS, no una división manual aquí — Chromium reparte los
    capítulos entre columnas él solo, y balancea mejor de lo que cualquier
    heurística de "la mitad de los capítulos a la izquierda" lograría con
    capítulos de tamaños desiguales. Los capítulos NO llevan
    `break-inside: avoid`: el comentario de `table.kv` ya explica por qué un
    capítulo largo puede partirse — aquí igual, entre columnas y no solo entre
    páginas — mientras cada renglón (`table.kv tr`) y el título de capítulo
    pegado a su primer renglón sigan intactos. Un presupuesto corto (la
    mayoría: una sola línea "Otros, por detallar") se queda en una columna —
    dos columnas ahí solo dejarían una segunda columna vacía."""
    if not lines:
        return ""
    by_chapter: dict[str, list[dict]] = {}
    for line in lines:
        by_chapter.setdefault(line.get("chapterName") or "", []).append(line)

    chapter_sections = []
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
        chapter_sections.append(
            f'<div class="budget-chapter"><div class="budget-chapter-name">{_esc(chapter)}</div>'
            f'<table class="kv">{"".join(rows)}</table></div>'
        )

    body = "".join(chapter_sections)
    if len(lines) > _BUDGET_TWO_COLUMN_THRESHOLD:
        body = f'<div class="budget-columns">{body}</div>'
    total = f'<table class="kv budget-grand-total"><tr><td>Total</td><td class="n">{_fmt_mxn(grand_total)}</td></tr></table>'
    return body + total


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

    # Sin sub-línea de comisiones aquí (a diferencia de las tarjetas
    # individuales): un track record mixto nunca va a "ser" ni todo venta ni
    # todo renta, así que sumar "si todo se hubiera vendido" + "si todo se
    # hubiera rentado" no es una cifra que ningún inversionista pregunte —
    # mezclaría dinero realizado con dinero hipotético en un solo número,
    # exactamente lo que este mismo renglón ya evita a propósito para
    # `sales`/`marks` (ver la nota de "Sumarlas en una sola cifra..." arriba,
    # en el docstring de la función).
    cells = [(str(len(track)), "Propiedades"), (_fmt_mxn_compact_or_dash(inv), "Capital invertido")]
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
        # el detalle vive en _opportunity_fees_metrics() más abajo — aquí
        # solo la cifra plana, para no repetir las mismas cifras dos veces
        # en la misma página.
        _metric(_inv_value(total_inv, None, None), "Inversión sin comisiones"),
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
    <div class="metrics metrics-4">{_opportunity_fees_metrics(p)}</div>
    {strip}
    {note_html}
    {detail_html}
  </div>
</div>"""


def _opportunity_detail(p: dict) -> str:
    """Plano, renders (propuesta de diseño) y desglose del presupuesto de obra de
    una oportunidad. "" si no hay ninguno de los tres.

    El plano SÍ va aquí, junto al render que ancla. El render de IA no es
    dimensionalmente exacto —mueve muros interiores, estira cuartos— así que no
    puede ser el único portador de la distribución: el lector necesita la medida
    al lado de la imagen que la aproxima. Lo que entra NO es el plano técnico en
    blanco y negro que `fe302aa` quitó (aquel sí era ruido para el cliente), sino
    el dibujo que carga m² por cuarto, largo de muros, cotas y abatimiento de
    puertas. Se empareja por piso y variante (`_plan_rows`), y cada hoja se
    imprime al lado de sus propios renders, no en una sección aparte.

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
    aquí, no junto al hero, donde la tira quedaba apretada y no se veía.

    De todas esas cabezas se imprime SOLO la que alguien marcó con estrella
    (`isChosen`), y siempre pegada a su fuente: la del piso junto a su hoja
    ("Plano y propuesta", `_plan_rows`), la de una foto junto a esa foto ("Fotos
    y propuesta", `_photo_rows`). Ya no hay tira suelta de sobrantes ni
    «los dos más recientes» de respaldo — un prospecto con tres ideas por piso
    salía ilegible, y adivinar cuál enseñar nunca fue del documento. Sin
    estrella, la hoja se imprime igual (es el ancla dimensional) y la foto no
    imprime nada: ya se ve en la galería de arriba."""
    rows = _plan_rows(p.get("planSheets") or [], p.get("renderHeads") or [])
    plan_html = _plan_block(rows)

    photo_rows = _photo_rows(p.get("images") or [], p.get("renderHeads") or [])
    photos_html = _photo_block(photo_rows)

    budget = p.get("budget") or {}
    budget_html = _budget_full(budget.get("lines", []), budget.get("chapters", []))

    if not (plan_html or photos_html or budget_html):
        return ""

    sections = "".join([
        f'<div class="detail-section"><div class="col-label">Plano y propuesta</div>{plan_html}</div>'
        if plan_html else "",
        # Solo lo que alguien eligió de verdad: sin estrella marcada en ninguna
        # foto de la propiedad, esta sección no existe — no hay tira suelta
        # esperando a los que no se eligieron.
        f'<div class="detail-section"><div class="col-label">Fotos y propuesta</div>{photos_html}</div>'
        if photos_html else "",
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
