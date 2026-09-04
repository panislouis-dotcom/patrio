from dataclasses import dataclass
from pathlib import Path
import base64
import json
import logging
import os
import tempfile
from decimal import Decimal
from markupsafe import escape as _esc

from api.finance.underwriting import ASSUMPTION_DEFAULTS, cap_rate

# Gastos operativos recurrentes de renta — política fija del fondo, no un
# insumo capturado por propiedad (mismo estatus que el 10%/2 meses de
# `_maintenance_offer_note`, un número distinto por coincidencia): se
# descuentan de la renta bruta para llegar a un ingreso y un yield que ya
# reflejan operar la unidad, no solo cobrarla.
_RENT_ADMIN_PCT = 0.10
_RENT_COSTOS_PCT = 0.05

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
.metrics-6 { grid-template-columns: repeat(6, 1fr); }
.metric { border-right: 1px solid var(--border); border-bottom: 1px solid var(--border);
          padding: 5mm 5mm 5.5mm; }
.metric .v { font-family: 'Playfair Display', serif; font-weight: 400; font-size: 20pt;
             color: var(--green-dark); line-height: 1; }
/* white-space:nowrap — sin esto, Chromium parte "3 meses" (la única
   anotación de esta rejilla con un espacio) en dos líneas y la continuación
   pierde el font-size chico, quedando del mismo tamaño que el valor
   principal. Con nowrap la anotación brinca completa a su propia línea en
   vez de partirse a la mitad. */
.metric .v small { font-size: 11pt; color: var(--green); white-space: nowrap; }
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
/* La sub-línea de "Ganancia" en las columnas de RESULTADO (_opportunity_result_col)
   — la bruta, más chica y en gris, bajo la neta que ya lleva el peso visual
   principal. Mismo tratamiento que `.tiers` ya usa para la escalera de
   comisión: una anotación secundaria dentro de la misma celda, en su propio
   bloque en vez de compartir línea con el valor que sí manda. */
table.kv td.n small.sub { display: block; font-weight: 400; font-size: 7.5pt; color: var(--sec); margin-top: 1px; }
/* La escalera de comisión (_fee_tier_lines): más chica que el monto de
   arriba pero en negritas y tinta oscura, igual que el resto de los valores
   de la columna (`table.kv td.n`) — pedido explícito, a diferencia de
   `.sub` (la sub-línea de "Ganancia"), que sí se queda en gris/regular por
   ser un dato secundario. El monto va seguido de un `<br>` (en el f-string
   que arma esta celda) y CADA tramo trae el suyo propio — nunca comparten
   línea. Medido en vivo contra la columna real (`Comisión venta/renta`,
   ~157-165px): los dos tramos juntos en una sola línea piden 220-244px, más
   de lo que hay incluso encogiendo la letra a donde deja de ser legible —
   no hay ancho real para "todo junto". Una línea por tramo sí cabe holgada
   a 7.5pt, y de paso es lo que por fin hace la alineación a la derecha
   consistente: una línea corta dejaba aire a la izquierda; una línea larga
   con dos tramos pegados podía llegar a tocar el margen izquierdo por pura
   falta de espacio y se leía "pegada" junto a una corta que sí tenía aire.
   `.tier` con `white-space: nowrap` es un respaldo, no la defensa
   principal: con cada tramo ya en su propia línea no debería necesitar
   partirse, pero si un umbral con muchos dígitos algún día no cupiera de
   sobra, sigue sin cortarse a la mitad. */
table.kv td.n small.tiers { font-weight: 600; font-size: 7.5pt; color: var(--ink); }
table.kv td.n small.tiers .tier { white-space: nowrap; }
/* Sin esto un encabezado como "PRESUPUESTO DE OBRA" puede quedar solo al pie
   de una página con toda su tabla en la siguiente. */
.col-label { font-family: 'Inter', sans-serif; font-size: 6.5pt; font-weight: 600;
             letter-spacing: 0.16em; text-transform: uppercase; color: var(--green-dark);
             margin-bottom: 9px; break-after: avoid; page-break-after: avoid; }
/* Nota de oferta bajo Escenario renta (_maintenance_offer_note): texto
   corrido, no una fila de table.kv — no es un dato del escenario, es una
   oferta aparte, así que no compite por alineación con la columna de
   valores a su izquierda. */
.opp-note { font-family: 'Inter', sans-serif; font-size: 7.5pt; color: var(--sec);
            line-height: 1.5; margin-top: 6px; }

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
/* La nota de madurez del presupuesto, pegada al Total que califica. Mismo
   tratamiento tipográfico que la nota al pie del portafolio (.valuation-note):
   itálica, secundaria, chica — es una precisión sobre la cifra de al lado, no
   una advertencia, y se lee después de ella. `break-before: avoid` porque una
   nota que califica un número y aterriza sola en la hoja siguiente califica,
   desde donde cae, a nada. */
.budget-note { font-family: 'Inter', sans-serif; font-size: 7pt; font-style: italic;
               color: var(--sec); line-height: 1.45; margin-top: 2.5mm;
               break-before: avoid; page-break-before: avoid; }

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
   Cuando la galería o el desglose de comisiones se quedaban a la mitad de
   una hoja, plano/renders igual brincaban a la siguiente por ese salto
   forzado, sin importar cuánta hoja quedara libre debajo. Fusionar todo en
   una sola page-block dejó que Chromium sólo pase de hoja cuando de veras se
   le acaba el espacio, así que plano/renders continúan donde el contenido
   anterior los deja. Cada fragmento sigue midiendo lo que su contenido pide;
   .page-block sigue heredando overflow:hidden, y sin height fija en .opp no
   hay nada que esconder. El presupuesto es la única excepción deliberada:
   `.detail-section-budget` (más abajo) le fuerza su propio salto, sin volver
   a envolverlo en una page-block completa — el mismo bug que este párrafo
   describe, en miniatura, es justo lo que ese wrapper habría reintroducido. */
.opp .hero { width: 100%; height: 88mm; object-fit: cover; object-position: center; display: block; background: var(--warm); }
/* box-decoration-break:clone — sin esto, el padding de .opp-body (lo único
   que separa su contenido del borde de la hoja, porque @page no tiene
   margen) solo se aplica al PRIMER fragmento cuando el contenido pide una
   segunda página. La continuación arrancaba a ~4mm del borde físico —
   comprobado con una sonda propia: sin clone, el marcador de prueba
   aterrizaba a 3.8mm del borde; con clone, a ~19mm, igual que si esa hoja
   tuviera su propio padding completo. Es el mismo bug de contenido pegado
   al filo que .opp ya arregló para las fotos, aquí aplicado al padding de
   página que las envuelve a todas. */
.opp-body { padding: 8mm var(--pad) 7mm;
            -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.opp-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12mm; margin-bottom: 6mm;
            break-inside: avoid; page-break-inside: avoid; }
/* Con un solo escenario prendido (`opportunity_scenario_venta`/`_renta` en
   ProspectusSections) la fila de Escenario venta/renta cae a una sola celda:
   sin este modificador se quedaría angosta, a la mitad del ancho, dejando la
   otra mitad de la hoja en blanco por el grid de dos columnas de arriba. */
.opp-cols.single { grid-template-columns: 1fr; }
/* Propiedad/Contexto y Escenario venta/renta arrancan en su propia hoja
   cuando hay galería antes (ver _opportunity()) — mismo mecanismo que ya
   usa `.detail-section-budget` para el presupuesto: una clase que fuerza
   el salto, nunca envolver en una `page-block` completa (ese bug ya se
   documentó arriba, en el comentario grande de OPPORTUNITY). */
.opp-scenarios-break { break-before: page; page-break-before: always; }
/* Galería grande, dos filas, arriba de Escenario venta/renta (pedido
   explícito) — pensada para llenar sola el resto de la primera página,
   debajo de la banda y el hero. Alto de imagen (70mm) medido en vivo, no a
   ojo: banda ~44mm + hero 88mm (subido de 78mm — pedido explícito, "más
   alta"; la galería bajó de 75mm a 70mm por fila para compensar, "un
   poquito más chicas") + padding-top de opp-body 8mm + label de galería
   ~5mm + dos filas de foto + el gap entre ellas + padding-bottom de
   opp-body 7mm debe sumar ~297mm (una hoja A4); 70mm por fila deja margen
   de sobra sobre el mínimo que pide esa cuenta (~67mm) para absorber
   nombres de propiedad que hagan crecer la banda a dos líneas.
   flex-wrap en vez de una fila sola (el `.strip` de siempre): con
   flex-basis fijo a 50% menos medio gap, cualquier cantidad de fotos cae
   en pares, dos por fila, en vez de una sola fila angosta que reparte 4+
   fotos entre el mismo ancho. */
.opp-gallery .strip { flex-wrap: wrap; }
.opp-gallery .strip img { flex: 0 0 calc(50% - 2px); aspect-ratio: auto; height: 70mm; max-height: none; }
.opp-gallery .strip img:only-child { flex: none; width: 62%; aspect-ratio: 4 / 3; height: auto; max-height: none; }

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
/* El presupuesto SÍ fuerza su propia hoja cuando hay plano/renders antes —
   pedido explícito. Vivió sin este salto un tiempo (la premisa era que un
   presupuesto típico es corto y cabe en lo que dejan los renders), pero un
   presupuesto real, con los datos de producción, resultó más largo de lo que
   esa premisa asumía: arrancaba a media hoja de planos y se cortaba ahí. */
.detail-section-budget { break-before: page; page-break-before: always; }

/* ══ Plano junto a su render ══════════════════════════════════════════════ */
.plan-row { margin: 0 0 7mm 0; break-inside: avoid; }
.plan-side { margin-bottom: 3mm; }
.plan-side-label { font-family: 'Inter', sans-serif; font-size: 7pt; letter-spacing: .12em;
                   text-transform: uppercase; color: #7A7A7A; margin-bottom: 1.5mm; }
.plan-pair { display: flex; gap: 4mm; align-items: flex-start; }
.plan-sheet { flex: 1 1 50%; min-width: 0; }
/* 110mm, no 250: subió a 250 un momento (pedido explícito, cuando el
   presupuesto ganó su propia hoja y parecía que ya no había presión por
   achicar el plano) pero un plano+render a 250 mide más de media hoja —
   nunca caben dos pisos en la misma página, cada uno se queda solo con media
   hoja en blanco alrededor. Pedido explícito, otra vez: medio A4 por piso, no
   una página entera, así que dos pisos se leen juntos en una sola hoja. Medido
   con el arnés real de Chromium contra los 4 pisos reales de las propiedades 5
   y 10 (viewBox más angosto: alto/ancho 2.02): a 110mm dos filas miden ~232mm
   juntas —caben en la página— y el plano dibujado sigue midiendo ~55-60mm de
   ancho visible, legible. */
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


def _fmt_rentas(n) -> str:
    """Un número de rentas (meses de renta) → '3 rentas', '2.5 rentas' — la
    unidad de la comisión de renta, no una fracción de precio como venta."""
    v = _num(n)
    trimmed = f"{v:.2f}".rstrip("0").rstrip(".")
    return f"{trimmed} rentas"


def _fmt_mxn_compact_or_dash(val) -> str:
    """No value means no metric — '—', never a fabricated $0."""
    return _fmt_mxn_compact(val) if val is not None else "—"


def _fmt_mxn_or_dash(val) -> str:
    """No value means no metric — '—', never a fabricated $0. Espejo de
    `_fmt_mxn_compact_or_dash`, en el formato completo que usan las columnas
    de `_opportunity_result_col()` (una tabla, no una tarjeta compacta)."""
    return _fmt_mxn(val) if val is not None else "—"


def _fmt_pct_signed(frac, decimals: int = 1) -> str:
    """Como `_fmt_pct`, con signo — '+30.2%', '-15.3%' — mismo criterio que
    `fmtPctSigned` en la ficha (web/src/lib/fmt.ts): una ganancia SÍ puede
    ser negativa, y ahí el signo cambia la lectura. Cero no lleva signo,
    igual que allá."""
    v = _num(frac)
    sign = "+" if v > 0 else ""
    return f"{sign}{v * 100:.{decimals}f}%"


def _fmt_years_or_dash(months) -> str:
    """meses (el que guarda paybackMonths) → años, 1 decimal — pedido explícito:
    redondear a un año entero perdería demasiada precisión en un plazo que
    típicamente son varios años (92 meses ↔ 7.7, no un impreciso "8 años")."""
    return f"{_num(months) / 12:.1f} años" if months is not None else "—"


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
    salida sigue genuinamente indecisa), oportunidad no pasa ninguno (su
    desglose vive en las columnas de RESULTADO, `_opportunity_result_col()`)
    y resumen ya no llama a esta función. Por eso aquí pueden llegar los dos, uno solo,
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


_FEE_MISSING_LABEL = {"salePrice": "falta precio de venta", "rentMonthly": "falta renta mensual"}


def _fee_scenario_missing(reasons: list[str] | None) -> str:
    """El guion, con el porqué al lado — nunca solo, se leería como cero
    comisión. `reasons` siempre trae exactamente un elemento cuando no está
    vacío: compute_fees() (fees.py) nombra un solo insumo por escenario."""
    text = " · ".join(_FEE_MISSING_LABEL[r] for r in (reasons or []) if r in _FEE_MISSING_LABEL)
    return f'— <small>{_esc(text)}</small>' if text else "—"


def _fee_tier_lines(tiers: list[dict], default_rate: Decimal, kind: str) -> str:
    """La escalera de comisión guardada, en una sola línea compacta —
    reemplaza al `exitSaleCommissionPct`/`exitRentMonths` planos que
    `_opportunity_result_col()` imprimía antes de la escalera (Task 2):
    ninguno de los dos describe ya cómo se calculó `exitFeeVenta`/
    `exitFeeRenta` (`compute_fees()`, fees.py).

    `rate` es una unidad distinta según `kind`: en venta, una fracción de
    precio de venta ('6.0%'); en renta, un número de rentas — meses de renta
    cobrada/proyectada ('3 rentas'), la magnitud real que cobra el fondo.

    Con tramos: el techo primero — mismo orden en el que ya persiste
    `replace_fee_tiers()` (properties_db.py), así que el sort aquí es
    cosmético para el caso común y solo hace falta de verdad si algún día un
    caller pasa la lista sin pasar por ese endpoint. No hay tramo piso que
    tratar aparte: ya no existe como concepto.

    Sin tramos: no hay escalera que describir, así que no se inventa una —
    se nombra el único número real en juego, el default del modelo
    (`ASSUMPTION_DEFAULTS`, underwriting.py) que `compute_fees()` usó en su
    lugar. Derivar una tasa "efectiva" de `exitFeeVenta ÷ salePrice` parecería
    más preciso pero mentiría: esta celda describe la CONFIGURACIÓN
    guardada, no el resultado ya calculado (que vive en su propia celda, al
    lado).

    Cada tramo lleva su propio equivalente en pesos entre paréntesis —
    umbral × tasa — sin excepción, ni siquiera el que de hecho ganó: se
    probó antes que ese tramo se quedara sin paréntesis (ya se veía en
    pesos, exacto, en una cifra líder aparte, arriba de la escalera) y el
    resultado se leía inconsistente — un tramo con formato distinto a los
    demás, sin ninguna pista visual de por qué. Todos en el MISMO formato,
    "≥umbral→tasa (pesos)", es más fácil de leer que intentar explicar cuál
    es "el especial". Esa cifra líder aparte, a su vez, ya no se imprime
    cuando hay escalera (`_opportunity_result_col()`): sería el mismo
    número — el que de hecho se cobró — repetido una tercera vez, ahí
    arriba, ya cubierto por el paréntesis del tramo que ganó. Solo sigue
    imprimiéndose cuando NO hay escalera (`tiers` vacío): sin tramos, esta
    función no devuelve ningún peso, así que esa cifra líder es la única
    pista en pesos que le queda a la celda.

    Cada tramo va en su PROPIA línea (`<br>` entre ellos, no un separador " · "
    en un solo párrafo que envuelve donde el navegador alcance): medido en
    vivo contra la columna real de `Comisión venta/renta` (~157-165px), un
    tramo con paréntesis mide 90-125px — cabe cómodo en su propia línea a
    7.5pt — pero los DOS tramos juntos en una sola línea miden 220-244px,
    ni con el texto encogido a 6pt (que ya se probó y seguía sin caber, y
    más chico deja de ser legible). No hay ancho real para "todo en una
    línea", así que cada tramo se queda en la suya: eso además es lo que
    hace que la alineación a la derecha por fin sea consistente — una línea
    corta con un solo tramo siempre deja aire a la izquierda, a diferencia
    de una línea larga con dos tramos pegados que puede llegar a tocar el
    margen izquierdo por pura falta de espacio, y entonces parece "pegada a
    la izquierda" junto a la línea corta de abajo que sí tiene aire."""
    fmt_rate = _fmt_pct if kind == "venta" else _fmt_rentas
    if not tiers:
        return f"sin tramos · {fmt_rate(default_rate)} por omisión"
    ordered = sorted(tiers, key=lambda t: -t["threshold"])
    parts = [
        f'<span class="tier">≥{_fmt_mxn_compact(t["threshold"])}→{fmt_rate(t["rate"])} '
        f'({_fmt_mxn_compact(t["threshold"] * t["rate"])})</span>'
        for t in ordered
    ]
    return "<br>".join(parts)


def _opportunity_gain_venta(p: dict) -> str:
    """Ganancia (venta) de RESULTADO, columna venta de `_opportunity_result_col()`:
    la neta como cifra principal, la bruta como dato secundario más chico —
    pedido explícito, a diferencia del yield de renta (que sí pide el par
    completo con el mismo peso). Mismo patrón `<small>` que ya usa
    `_inv_value()` para su detalle secundario, pero en su propio renglón
    (`<br>` + `.sub`, CSS) y no compartiendo línea con el de neta: la bruta
    trae SU PROPIO porcentaje, y los dos juntos en una sola línea no dejaban
    claro a cuál pertenecía cada uno.

    Gatea en `netGainVentaPct` — el mismo campo que antes gateaba
    `roi_total` en la vieja "Ganancia proyectada": sin venta modelada (un
    prospecto solo de renta) no hay ganancia que mostrar. La bruta se
    imprime solo si también existe: en la práctica viajan juntas (misma
    venta, dos bases distintas), pero esta función no asume esa garantía por
    el llamador."""
    net_pct = p.get("netGainVentaPct")
    if net_pct is None:
        return "—"
    html = f'{_fmt_mxn(p.get("netGainVenta"))} <small>{_fmt_pct_signed(net_pct)}</small>'
    gross_pct = p.get("grossGainVentaPct")
    if gross_pct is not None:
        html += f'<br><small class="sub">bruta {_fmt_mxn(p.get("grossGainVenta"))} {_fmt_pct_signed(gross_pct)}</small>'
    return html


def _opportunity_result_col(p: dict, kind: str, sections: ProspectusSections) -> str:
    """Una columna de RESULTADO (`kind` es "venta" o "renta") — el espejo de
    la misma columna en PropertyDetailPage.tsx: desglose de inversión,
    comisiones del fondo, inversión con comisiones, y el resultado del
    escenario, cada columna autosuficiente y leída de arriba a abajo sin
    buscar nada en la otra.

    Las primeras seis filas (desglose + Inversión sin comisiones) son el
    MISMO costo base leído dos veces, una por columna — no una dispersión —
    así que se repiten sin condición en las dos, igual que `investmentParts`
    ya se repite en la ficha. Solo las partes con algo que aportar entran:
    un $0 genuino no explica nada del total, así que no ocupa fila (mismo
    criterio que la ficha).

    Las cuatro filas de comisión quedan detrás de `sections.opportunity_fees`
    — el mismo flag de siempre ("desglose de comisiones, apagable"), ahora
    aplicado dentro de cada columna en vez de a una fila de seis celdas
    completa. Terreno y obra son la MISMA comisión en las dos columnas (no
    dependen de la salida elegida) y por eso acceden a `landFee`/
    `constructionFee` con corchetes, no `.get()` — nunca faltan, siempre hay
    una base y un % (el default si nadie lo capturó), así que un KeyError
    aquí sería una señal real de que compute_fees() (fees.py) dejó de
    cumplir esa garantía. Solo la comisión de salida y el total que resulta
    son propios de `kind`, y esos dos sí pueden faltar cada uno por su
    cuenta — sin precio de venta no hay comisión de venta NI total con
    comisiones de venta — y entonces nombran su insumo ausente vía
    `_fee_scenario_missing()`.

    Las últimas filas —precio/renta y el resultado del escenario— nunca se
    apagan: es a lo que el inversionista estaría entrando, la misma garantía
    que ya tenía la vieja fila de proyección de seis celdas."""
    rows = [
        ("Precio de compra", _fmt_mxn(p.get("purchasePrice")) if _num(p.get("purchasePrice")) else None),
        ("Costos de adquisición", _fmt_mxn(p.get("acquisitionCosts")) if _num(p.get("acquisitionCosts")) else None),
        ("Permisos", _fmt_mxn(p.get("permitsCost")) if _num(p.get("permitsCost")) else None),
        ("Subdivisión", _fmt_mxn(p.get("subdivisionCost")) if _num(p.get("subdivisionCost")) else None),
        ("Obra a ejecutar", _fmt_mxn(p.get("constructionBudgeted")) if _num(p.get("constructionBudgeted")) else None),
        ("Inversión sin comisiones", _fmt_mxn(p.get("totalInvestment")) if _num(p.get("totalInvestment")) else None),
    ]

    if sections.opportunity_fees:
        if kind == "venta":
            exit_fee, tiers, default_rate = p.get("exitFeeVenta"), p.get("saleFeeTiers", []), ASSUMPTION_DEFAULTS["exit_sale_commission_pct"]
            missing, total = p.get("feesMissingInputsVenta"), p.get("totalInvestmentWithFeesVenta")
        else:
            exit_fee, tiers, default_rate = p.get("exitFeeRenta"), p.get("rentFeeTiers", []), ASSUMPTION_DEFAULTS["exit_rent_commission_months"]
            missing, total = p.get("feesMissingInputsRenta"), p.get("totalInvestmentWithFeesRenta")
        if exit_fee is not None:
            tier_lines = _fee_tier_lines(tiers, default_rate, kind)
            exit_html = (f'<small class="tiers">{tier_lines}</small>' if tiers
                         else f'{_fmt_mxn(exit_fee)}<br><small class="tiers">{tier_lines}</small>')
        else:
            exit_html = _fee_scenario_missing(missing)
        total_html = _fmt_mxn(total) if total is not None else _fee_scenario_missing(missing)
        rows += [
            ("Comisión adquisición", f'{_fmt_mxn(p["landFee"])} <small>{_fmt_pct(p.get("landCommissionPct"))}</small>'),
            ("Comisión obra", f'{_fmt_mxn(p["constructionFee"])} <small>{_fmt_pct(p.get("constructionCommissionPct"))}</small>'),
            (f"Comisión {kind}", exit_html),
            ("Inversión con comisiones", total_html),
        ]

    if kind == "venta":
        rows.append(("Precio de venta", _fmt_mxn_or_dash(_sale_or_none(p.get("projectedSale")))))
        rows.append(("Ganancia", _opportunity_gain_venta(p)))
    else:
        rent_m = p.get("rentMonthlyProjected")
        rows.append(("Renta/mes", _fmt_mxn(rent_m) if _num(rent_m) else "—"))
        # Gastos operativos en una sola fila (monto total + el desglose como
        # anotación en la misma línea, mismo patrón compacto que ya usan
        # "Comisión adquisición"/"Comisión obra" arriba) — no una fila por
        # gasto, que es exactamente el diseño de dos filas por tramo que ya
        # se descartó antes en esta misma columna por ocupar espacio de más.
        net_income = None
        if _num(rent_m):
            admin = _num(rent_m) * _RENT_ADMIN_PCT
            costos = _num(rent_m) * _RENT_COSTOS_PCT
            net_income = _num(rent_m) - admin - costos
            # `<br>` + `.sub` (no un solo renglón con espacios): con todo en
            # una línea, el auto-layout de la tabla mide el ancho SIN cortar
            # del texto completo para dimensionar la columna, y ese texto es
            # más ancho que cualquier otra celda de la columna — termina
            # angostando la columna de etiquetas y partiendo "Costos de
            # adquisición"/"Inversión con comisiones" a la mitad más abajo,
            # en la MISMA tabla. Con `<br>`, el ancho que cuenta es el de la
            # línea más angosta de las dos (mismo mecanismo que ya evita esto
            # en `.tiers` y en la sub-línea de "Ganancia").
            rows.append(("Gastos operativos",
                         f'{_fmt_mxn(admin + costos)}<br><small class="sub">'
                         f'{_fmt_pct(_RENT_ADMIN_PCT, 0)} admin + {_fmt_pct(_RENT_COSTOS_PCT, 0)} costos</small>'))
            rows.append(("Ingresos mensuales", _fmt_mxn(net_income)))
        rows.append(("Yield s/comisión", _fmt_pct_or_dash(p.get("grossYieldRenta"))))
        rows.append(("Yield c/comisión", _fmt_pct_or_dash(p.get("netYieldRenta"))))
        # Mismo denominador que `netYieldRenta` (inversión CON comisiones de
        # salida de renta) — la única diferencia es el numerador: ingreso
        # mensual ya neto de gastos operativos, no la renta bruta.
        yield_full = cap_rate(net_income, p.get("totalInvestmentWithFeesRenta")) if net_income else None
        rows.append(("Yield c/com. y gastos", _fmt_pct_or_dash(yield_full)))

    return _kv_rows(rows)


def _maintenance_offer_note(p: dict) -> str:
    """La oferta de mantenimiento, bajo Escenario renta: un servicio opcional
    del fondo, 10% de la renta mensual, con 2 meses menos de comisión de
    salida · renta si el inversionista firma un contrato de 2 años. Es una
    oferta fija del fondo, no un dato calculado por `compute_fees()` — no
    hay `maintenanceFeePct` ni insumo equivalente en `p`, así que el 10% y
    los 2 meses van fijos en el texto en vez de leerse de la propiedad.

    El único número que SÍ sale de `p` es la cifra en pesos entre paréntesis
    — 10% de `rentMonthlyProjected` — y solo aparece cuando hay una renta
    proyectada real que multiplicar; sin ella la nota se queda en el
    porcentaje, sin inventar un peso que no está soportado por ningún dato."""
    rent_m = p.get("rentMonthlyProjected")
    cost = f" ({_fmt_mxn(_num(rent_m) * 0.10)}/mes)" if _num(rent_m) else ""
    return (f'<p class="opp-note">Servicio de mantenimiento opcional: 10% de la renta mensual{cost}. '
            f'Firmando un contrato de 2 años, la comisión de salida de renta se reduce 2 meses.</p>')


def _strip(images, label: str, limit: int) -> str:
    imgs = images[:limit]
    if not imgs:
        return ""
    tags = "".join(f'<img src="{i["dataUri"]}" alt="">' for i in imgs)
    lab = f'<div class="strip-label">{_esc(label)}</div>' if label else ""
    return f'{lab}<div class="strip">{tags}</div>'


def _plan_rows(sheets: list[dict], renders: list[dict], plan_id: str | None) -> list[dict]:
    """Las hojas dibujadas + las cabezas de render → filas por LINAJE de piso,
    para UN plan: el antes es el original, el después es `plan_id` (None = solo
    hay original que mostrar, sin lado de propuesta). Con N planes, quien llama
    (`_opportunity_detail`) invoca esta función una vez por plan seleccionado —
    cada plan imprime su propia sección, nunca N columnas en una fila.

    Una fila es un piso a lo largo de sus variantes, no una hoja: un piso de plan
    nacido de PARTIR comparte el `id` de su contraparte original
    (`LevantamientoPanel.tsx`), y ese id compartido es justo lo que permite
    alinear el antes con el después sin heurística. La variante de una hoja/render
    de plan ES el plan id (envelope v4, migración 050), así que el pareo
    `(floorId, variante)` distingue planes solo.

    De los renders de cada (floorId, sourceVariant) solo entra el que trae
    `isChosen` — nunca hay más de uno, porque el índice único de la base de
    datos ya lo garantiza (migración 046). Sin estrella, ese lado queda con
    `renders: []`: el PLANO se imprime de todos modos (es el ancla dimensional
    de la PR #45, no depende de que exista un render), solo el hueco de imagen
    queda vacío. No hay tira suelta ni «el más reciente» de respaldo — si nadie
    eligió, el documento no adivina.

    El nombre del piso sale de la HOJA, no del render: `floorName` en el render
    está congelado para sobrevivir a un renombre, pero el piso vivo siempre
    existe si hay una hoja que mostrar.
    """
    mine = [s for s in sheets if s["variant"] == "original" or s["variant"] == plan_id]
    chosen_by_key = {
        (r["floorId"], r["sourceVariant"]): r
        for r in renders
        if r.get("dataUri") and r.get("isChosen") and r.get("floorId") is not None
    }
    by_key = {(s["floorId"], s["variant"]): s for s in mine}

    order, seen = [], set()
    for s in mine:
        if s["floorId"] not in seen:
            seen.add(s["floorId"])
            order.append(s["floorId"])

    rows = []
    for fid in order:
        antes = by_key.get((fid, "original"))
        despues = by_key.get((fid, plan_id)) if plan_id is not None else None
        antes_r = chosen_by_key.get((fid, "original"))
        despues_r = chosen_by_key.get((fid, plan_id)) if plan_id is not None else None
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
# Qué entra al documento
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ProspectusSections:
    """Los pedazos del prospecto que el llamador puede apagar.

    Todo en True es el documento completo — el único que este módulo supo
    imprimir hasta ahora—, así que es el default de cada función que lo
    recibe: ninguna llamada existente cambia, y un prospecto sin opiniones
    sale idéntico byte por byte al de siempre. Esa identidad es el contrato,
    no una coincidencia: es lo que deja meter el recorte sin volver a validar
    el PDF entero.

    Es un dataclass pelón y NO el modelo Pydantic de la ruta a propósito: este
    módulo es presentación y no puede depender de la capa HTTP. El vocabulario
    camelCase del JSON vive en el borde (`ProspectusOptions`, routes/
    documents.py) y se traduce una sola vez, ahí.

    Lo que NO es apagable, y por qué: de una página de oportunidad siempre
    salen la banda (nombre y dirección), el hero y la primera fila de
    columnas (Propiedad/Contexto). Sin ellas la página deja de identificar a
    la propiedad o de decir dónde y qué es — no es un prospecto más corto,
    es una hoja que no dice nada. Apagable es lo que ABUNDA (fotos, planos,
    presupuesto), lo que es un desglose de algo que ya se dijo (las cuatro
    filas de comisión dentro de cada columna de escenario), y ahora también
    la segunda fila de columnas: `opportunity_scenario_venta` y
    `opportunity_scenario_renta` deciden, cada una por su cuenta, si
    Escenario venta y Escenario renta aparecen. Apagar las dos no deja un
    hueco en blanco — esa fila entera se omite, y nada más en la tarjeta
    depende de que exista."""
    cover: bool = True
    portfolio_summary: bool = True
    closing: bool = True
    opportunity_fees: bool = True
    opportunity_gallery: bool = True
    opportunity_plans: bool = True
    opportunity_renders: bool = True
    opportunity_budget: bool = True
    opportunity_scenario_venta: bool = True
    opportunity_scenario_renta: bool = True


# El documento completo. Vive como constante —y no como `ProspectusSections()`
# repetido en cada firma— para que las funciones internas puedan pasarse el
# mismo objeto sin construir uno por página; es frozen, así que compartirlo no
# tiene riesgo.
_ALL_SECTIONS = ProspectusSections()


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
    #     sobre la valuación actual. El `capRate` a secas sale del underwriting,
    #     así que promediarlo aquí publicaría lo que se estimó como si fuera lo
    #     que se cobra. Una vendida sí trae ambos (el expediente ya no se apaga
    #     en la venta), pero ya no cobra renta: por eso queda fuera del promedio.
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
      <div class="vp-item"><div class="vp-v">{cap_avg}</div><div class="vp-l">Cap rate promedio</div><div class="vp-d">renta cobrada sobre valuación actual</div></div>
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
    porque es una estimación con fecha, no un hecho; el cap rate es
    `capRateActual`, la renta efectivamente cobrada sobre esa misma valuación —
    ya no sobre la venta proyectada, que sigue siendo una apuesta de salida y no
    lo que la propiedad vale hoy. Por eso la etiqueta ya no dice "s/ venta": sin
    sufijo, porque en esta tarjeta ya no hay ambigüedad de contra qué se mide —
    la valuación es la única cifra de valor en pantalla."""
    val_month = _fmt_month(p.get("valuationDate"))
    metrics = "".join([
        # venta es contrafactual en una rentada — nunca se pasa, aunque el
        # dato exista: es el espejo del mismo criterio en _sold_card().
        _metric(_inv_value(p.get("totalInvestment"), None, p.get("totalInvestmentWithFeesRenta")), "Inversión sin comisiones"),
        _metric(_fmt_mxn_compact_or_dash(p.get("currentValuation")),
                f"Valuación · {val_month}" if val_month else "Valuación actual"),
        _metric(_fmt_pct_or_dash(p.get("roi")), "ROI anual"),
        _metric(_fmt_pct_or_dash(p.get("unrealizedGainPct")), "Ganancia no realizada %"),
        _metric(_fmt_pct_or_dash(p.get("capRateActual")), "Cap rate"),
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
        _metric(_fmt_pct_or_dash(p.get("capRate")), "Cap rate proy. s/ venta"),
    ])
    return _card(p, kicker, _projected_hold_tail(p), metrics)


# Doce renglones es aproximadamente media página a una columna con el tipo
# compacto de .budget-columns — por debajo de eso, partir en dos columnas
# dejaría la segunda visiblemente vacía en vez de ahorrar espacio.
_BUDGET_TWO_COLUMN_THRESHOLD = 12

# Dónde vive la EJECUCIÓN de un renglón. Basta uno de estos —más un pago— para
# que el renglón haya dejado de ser una estimación: alguien lo adjudicó, lo
# comprometió con un monto, midió lo que de verdad se hizo o lo cerró.
_LINE_EXECUTION_FIELDS = ("supplierId", "committedAmount", "actualQuantity", "closedAt")


def _is_lone_estimate(lines: list[dict]) -> bool:
    """El presupuesto no es más que el estimado que sembró la calculadora: un
    solo renglón, escrito por el sistema, y nadie ha ejecutado nada contra él.

    ES LA MISMA PREGUNTA QUE `budget_db.budget_holds_only_initial_estimate`,
    contestada con los mismos dos hechos y sin ninguna aproximación:
    `seeded` —la columna de la 054, que solo escribe `seed_estimate_line` y
    nadie actualiza después— dice QUIÉN escribió el renglón, y los campos de
    ejecución dicen si algo le ha pasado desde entonces. Hacen falta los dos: un
    estimado que ya se adjudicó a un proveedor sigue siendo un solo renglón, y
    dejó de ser una cifra de orden de magnitud.

    LOS DOS HECHOS, NO EL PARECIDO, y eso es lo que deja escribir «todavía sin
    desglosar ni cotizar» sin mentir. Preguntar solo «¿un renglón sin
    ejecución?» rotularía como paramétrica la suma alzada que un contratista
    cotizó y alguien tecleó de un tirón: sin desglosar, sí, pero cotizada. El
    nombre tampoco serviría —el del estimado lleva dentro los m², así que
    corregir el metraje de la ficha lo cambia; ver la nota de `_UNTOUCHED_BUDGET`
    en budget_db—. Editar el IMPORTE del renglón sembrado sí conserva el rótulo,
    y debe: sigue siendo una sola cifra global sin partidas detrás.

    Llega gratis al prospecto: `_LINES_SQL` es `SELECT l.*`, así que `seeded`
    viaja en la fila y `_row_to_dict` la publica con su propio nombre. Y viaja
    también en la COPIA (`_COPIED_LINE_COLUMNS`), así que el escenario de un
    plan que espejea el presupuesto de la propiedad se rotula por la misma
    regla, sin un caso aparte.

    `payments` viene de `get_budget` como lista (vacía si no hay), pero se lee
    con `.get`: las fixtures de esta capa arman renglones mínimos y un renglón
    sin la llave es un renglón sin pagos."""
    if len(lines) != 1:
        return False
    line = lines[0]
    return (bool(line.get("seeded"))
            and not any(line.get(field) is not None for field in _LINE_EXECUTION_FIELDS)
            and not line.get("payments"))


def _budget_full(lines: list[dict], chapters: list[str]) -> str:
    """El presupuesto renglón por renglón, agrupado por capítulo (en el orden
    que `chapters` ya trae — ver budget_db._chapters), con un subtotal por
    capítulo y un Total general. Pedido explícito: un solo agregado por capítulo
    escondía la granularidad real del presupuesto — esto es cada partida, su
    cantidad y su monto.

    SIN RENGLONES IMPRIME UN CERO, no una cadena vacía. Desde que el total es la
    suma de sus renglones, un presupuesto vacío es un estado legítimo —«todavía
    no se ha capturado obra»— y suma $0 en `investment_raw` y en la comisión de
    obra como el número que es. Devolver "" lo volvía indistinguible de un deck
    pedido sin la sección de presupuesto (`opportunity_budget=False`), que
    produce exactamente el mismo vacío: el lector no podía saber si la obra vale
    cero o si no se la enseñaron. Quién decide si HAY presupuesto que imprimir
    es el llamador —tiene el dato para contestarlo—; esta función imprime el que
    le den, y $0 es un presupuesto.

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
    pegado a su primer renglón sigan intactos. Un presupuesto de pocos renglones
    —el estimado inicial es uno solo— se queda en una columna: dos columnas ahí
    solo dejarían una segunda columna vacía.

    Y CUANDO NO HAY MÁS QUE ESE ESTIMADO, EL PROSPECTO LO DICE. Un renglón
    global sin cotizar y trece capítulos con proveedor son objetos distintos:
    el primero es un supuesto, el segundo es obra costeada. Las dos cifras se
    imprimen igual de grandes bajo la palabra «Total», así que la diferencia
    tiene que estar escrita o el lector la pierde. Se DERIVA de los renglones
    (`_is_lone_estimate`) — no hay clase de estimación capturada en ninguna
    parte, nada que mantener en sync, nada que se pueda quedar mintiendo."""
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
    return body + total + _budget_note(lines)


def _budget_note(lines: list[dict]) -> str:
    """La precisión que acompaña al Total cuando el Total, solo, diría de más.

    Dos casos y nada más; un presupuesto con varias partidas se explica solo y
    no lleva nota. Están redactados en el registro del documento —«las que
    siguen en renta entran por una valuación estimada […], no un avalúo
    formal»—: dicen QUÉ ES la cifra, no advierten de ella. Un presupuesto
    paramétrico no es un defecto, es la clase de estimación que le toca a una
    propiedad que todavía no se compra."""
    if not lines:
        return ('<div class="budget-note">Sin partidas capturadas: '
                'la obra todavía no está presupuestada.</div>')
    if _is_lone_estimate(lines):
        return ('<div class="budget-note">Estimación de orden de magnitud: '
                'una cifra global, todavía sin desglosar ni cotizar por partidas.</div>')
    return ""


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


def _opportunity(p: dict, sections: ProspectusSections = _ALL_SECTIONS) -> str:
    """La página de oportunidad — espejo de RESULTADO en PropertyDetailPage.tsx,
    en tres hojas forzadas cuando hay galería: banda+hero+galería primero
    (`.opp-gallery`, dos filas grandes), Propiedad/Contexto y Escenario
    venta/renta después (`.opp-scenarios-break` fuerza el salto), y planos/
    renders/presupuesto al final (`.detail-section-budget` ya fuerza el
    suyo). Antes la galería vivía DESPUÉS de Escenario venta/renta —
    pedido explícito: con las filas nuevas de Escenario renta (gastos
    operativos, ingresos, el tercer yield) la columna creció lo bastante
    para desfasar dónde caía cada salto de página, y las fotos de una sola
    fila angosta quedaban a la mitad de la hoja que les tocara. Sin
    galería (`sections.opportunity_gallery` apagado, o la propiedad no
    tiene fotos de sobra) no hay nada que llene una primera hoja aparte,
    así que no se fuerza el salto: Propiedad/Contexto y Escenario
    venta/renta arrancan justo debajo del hero, como antes.

    Propiedad/Contexto es identidad y encuadre; Escenario venta/renta es el
    resultado completo — desglose de inversión, comisiones del fondo,
    inversión con comisiones, y bruto/neto — mismo texto, mismo orden que
    la ficha, solo en `_kv_rows()` en vez de `StatRow`.

    Escenario venta y Escenario renta se apagan cada uno por su cuenta
    (`sections.opportunity_scenario_venta`/`_renta`): con los dos prendidos
    la fila es el grid de dos columnas de siempre; con uno solo, esa columna
    ocupa la fila entera (`.opp-cols.single`); con los dos apagados la fila
    completa desaparece, sin dejar un `.opp-cols` vacío en su lugar."""
    name = _esc(p.get("name", ""))
    address = _esc(p.get("address", ""))
    city = _esc(p.get("city", ""))
    asset = _esc(_pretty_type(p.get("assetType")))
    strategy = _esc(_pretty_type(p.get("strategyType")))
    hold = int(_num(p.get("holdMonths")))
    sqm_land = _num(p.get("sqmLand"))
    sqm_con = _num(p.get("sqmConstruction"))

    # Sin Dirección ni Ciudad aquí: la banda verde de arriba ya las imprime
    # ({address} · {city}), palabra por palabra — repetirlas en la tabla no
    # añadía información, solo un renglón más para desalinear contra la
    # columna vecina.
    ubicacion = _kv_rows([
        ("Tipo de activo", asset or None),
        ("Estrategia", strategy or None),
        ("Terreno", f"{int(sqm_land):,} m²" if sqm_land else None),
        # `sqmConstruction` son los metros de obra A EJECUTAR, no los que el
        # inmueble ya tiene: «Construcción» a secas se leía como lo segundo.
        ("Obra a ejecutar", f"{int(sqm_con):,} m²" if sqm_con else None),
    ])
    # Los tres campos de la vieja fila de proyección que NO son ni desglose,
    # ni comisión, ni resultado de un escenario — no tienen un hogar natural
    # dentro de Escenario venta/renta, así que se quedan aparte. "Cap rate" se
    # queda con su etiqueta actual sin calificar: ya no tiene al lado un
    # "Rendimiento sobre inversión" con el que confundirse (ese denominador
    # equivocado —dividía la renta entre la inversión con comisiones de
    # VENTA— se retira del todo, no se muda). Siempre visibles con guion, no
    # se caen de la tabla: mismo criterio que ya tenían como `_metric()`.
    contexto = _kv_rows([
        ("Plazo proyectado", f"{hold} meses" if hold else "—"),
        ("Plazo de recuperación", _fmt_years_or_dash(p.get("paybackMonths"))),
        ("Cap rate", _fmt_pct_or_dash(p.get("capRate"))),
    ])

    # Cada celda se computa solo si su escenario está prendido: la nota de
    # mantenimiento (`_maintenance_offer_note`) es una oferta sobre RENTAR, así
    # que no tiene sentido calcularla —ni imprimirla— cuando renta está apagado.
    # La indentación de cada línea replica a mano la del f-string de abajo para
    # que, con los dos escenarios prendidos, el HTML salga byte por byte igual
    # al de antes de este cambio.
    venta_cell = (f'        <div><div class="col-label">Escenario venta</div>'
                  f'{_opportunity_result_col(p, "venta", sections)}</div>\n'
                  if sections.opportunity_scenario_venta else "")
    renta_cell = (f'        <div><div class="col-label">Escenario renta</div>'
                  f'{_opportunity_result_col(p, "renta", sections)}{_maintenance_offer_note(p)}</div>\n'
                  if sections.opportunity_scenario_renta else "")
    n_scenarios = sum(1 for c in (venta_cell, renta_cell) if c)
    scenarios_html = (f'<div class="opp-cols{"" if n_scenarios == 2 else " single"}">\n'
                       f'{venta_cell}{renta_cell}      </div>'
                       if n_scenarios else "")

    images = _imgs_by_type(p.get("images", []))
    # El hero no se apaga con la galería: es la primera foto, la que dice de
    # qué inmueble habla la página. Apagar «galería» quita el resto de las
    # fotos, no la identidad de la propiedad.
    hero = f'<img class="hero" src="{images[0]["dataUri"]}" alt="">' if images else ""
    strip = (_strip(images[1:], "Galería", 4)
             if sections.opportunity_gallery and len(images) > 1 else "")
    # `.opp-gallery` la sube arriba de las dos filas de opp-cols (pedido
    # explícito) — antes vivía después, empujada por Escenario venta/renta
    # hasta terminar a la mitad de una hoja cualquiera, con las fotos
    # angostas de una sola fila. Ahora es lo primero bajo el hero, en dos
    # filas grandes (`.opp-gallery .strip`, CSS) dimensionadas para llenar
    # el resto de la primera página: banda (~44mm) + hero (78mm) + label de
    # la galería (~5mm) + dos filas de foto (75mm c/u) + paddings de
    # opp-body (8mm/7mm) ≈ 297mm, medido en vivo contra un render real
    # (Locales Salon Escobedo) — no a ojo.
    gallery_html = f'<div class="opp-gallery">{strip}</div>' if strip else ""
    detail_html = _opportunity_detail(p, sections)

    return f"""<div class="page-block opp">
  <div class="band">
    <div class="kicker">Oportunidad Activa</div>
    <h2>{name}</h2>
    <div class="sub">{address}{(' · ' + city) if city else ''}</div>
  </div>
  {hero}
  <div class="opp-body">
    {gallery_html}
    <div class="{'opp-scenarios-break' if gallery_html else ''}">
      <div class="opp-cols">
        <div><div class="col-label">Propiedad</div>{ubicacion}</div>
        <div><div class="col-label">Contexto</div>{contexto}</div>
      </div>
      {scenarios_html}
    </div>
    {detail_html}
  </div>
</div>"""


def _opportunity_detail(p: dict, sections: ProspectusSections = _ALL_SECTIONS) -> str:
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

    Vive en el mismo flujo que la tarjeta principal, justo después de
    Escenario venta/renta — ya no en su propia page-block. Forzar un salto
    de página aquí era lo que dejaba una cola de dos líneas sola arriba de
    una hoja casi en blanco: plano/renders/presupuesto brincaban a la
    siguiente por el page-break-after:always de su propia page-block sin
    importar cuánta hoja quedara libre. Sin ese salto forzado, Chromium
    solo pasa de página cuando de verdad se le acaba el espacio — con una
    excepción deliberada: el presupuesto SIEMPRE fuerza su propio salto
    (`.detail-section-budget`, ver más abajo), pedido explícito para que
    sea la tercera hoja fija del documento de oportunidad (galería,
    Escenario venta/renta, presupuesto), plano/renders queden antes o no.

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
    # Un bloque apagado se corta en su ORIGEN —sin filas, sin renglones— y no
    # borrando HTML ya armado. Así todo lo que se decide más abajo (que la
    # sección exista, y sobre todo si el presupuesto fuerza su propia hoja)
    # se calcula exactamente igual que cuando el dato no existe, que es el
    # camino que este archivo lleva probando desde siempre.
    #
    # Con N planes, cada plan seleccionado imprime SU sección "Plano y propuesta
    # · {nombre}" con el par Antes/Después de siempre — nunca N columnas en una
    # fila (ilegible en A4). Con 0-1 planes el título queda sin sufijo: el
    # documento de una propiedad con su único plan legado sale byte-idéntico al
    # de siempre — ese es el contrato de ProspectusSections, extendido aquí.
    plan_sections_html = ""
    if sections.opportunity_plans:
        sheets_all = p.get("planSheets") or []
        heads = p.get("renderHeads") or []
        plan_budgets = p.get("planBudgets") or {}

        def _plan_budget_html(plan_id, plan_name):
            # El presupuesto-ESCENARIO del plan (addendum 2026-08-24), dentro de
            # su propia sección — distinto del "Presupuesto de obra" de la
            # propiedad (más abajo), que es el compromiso vigente y se imprime
            # igual que siempre. Sin escenario, nada: null sobre fabricado.
            # Existir es el único requisito: un escenario que alguien creó
            # vacío imprime su Total en $0 con su nota, igual que el
            # presupuesto de la propiedad. La rama de «y además que
            # `_budget_full` haya devuelto algo» se fue con el vacío que ya no
            # devuelve — era la misma pregunta contestada dos veces, y la
            # segunda copia habría vuelto a esconder un cero legítimo.
            budget = plan_budgets.get(plan_id)
            if not budget:
                return ""
            h = _budget_full(budget.get("lines", []), budget.get("chapters", []))
            title = f"Presupuesto · {plan_name}" if plan_name else "Presupuesto del plan"
            return (f'<div class="detail-section">'
                    f'<div class="col-label">{_esc(title)}</div>{h}</div>')

        plans_present, seen_plans = [], set()
        for s in sheets_all:
            v = s["variant"]
            if v != "original" and v not in seen_plans:
                seen_plans.add(v)
                plans_present.append((v, s.get("planName")))
        if len(plans_present) <= 1:
            only = plans_present[0][0] if plans_present else None
            h = _plan_block(_plan_rows(sheets_all, heads, only))
            if h:
                plan_sections_html = (f'<div class="detail-section">'
                                      f'<div class="col-label">Plano y propuesta</div>{h}</div>')
                if only is not None:
                    plan_sections_html += _plan_budget_html(only, plans_present[0][1])
        else:
            parts = []
            for plan_id, plan_name in plans_present:
                h = _plan_block(_plan_rows(sheets_all, heads, plan_id))
                if h:
                    title = f"Plano y propuesta · {plan_name}" if plan_name else "Plano y propuesta"
                    parts.append(f'<div class="detail-section">'
                                 f'<div class="col-label">{_esc(title)}</div>{h}</div>')
                    parts.append(_plan_budget_html(plan_id, plan_name))
            plan_sections_html = "".join(parts)

    photo_rows = (_photo_rows(p.get("images") or [], p.get("renderHeads") or [])
                  if sections.opportunity_renders else [])
    photos_html = _photo_block(photo_rows)

    # «¿Hay presupuesto que imprimir?» se contesta AQUÍ, y solo aquí: la
    # propiedad lo trae (`_embed_opportunity_extras` lo lee siempre, y toda
    # propiedad tiene presupuesto) o la sección viene apagada. Antes la
    # pregunta la contestaba `_budget_full` devolviendo "" sin renglones, y
    # entonces un presupuesto vacío y un deck pedido sin presupuesto salían
    # idénticos — el cero legítimo se leía como sección omitida.
    budget = p.get("budget") if sections.opportunity_budget else None
    budget_html = (_budget_full(budget.get("lines", []), budget.get("chapters", []))
                   if budget else "")

    if not (plan_sections_html or photos_html or budget_html):
        return ""

    sections = "".join([
        plan_sections_html,
        # Solo lo que alguien eligió de verdad: sin estrella marcada en ninguna
        # foto de la propiedad, esta sección no existe — no hay tira suelta
        # esperando a los que no se eligieron.
        f'<div class="detail-section"><div class="col-label">Fotos y propuesta</div>{photos_html}</div>'
        if photos_html else "",
        # El presupuesto SIEMPRE arranca en su PROPIA hoja — pedido explícito
        # (revierte la decisión anterior, "un presupuesto típico es corto y
        # cabe en lo que dejan los renders"): el presupuesto real, con datos
        # de producción, resultó más largo de lo que esa premisa asumía y
        # arrancaba a media hoja de planos para luego cortarse.
        # `.detail-section-budget` (CSS) fuerza el salto. Ya no depende de
        # que haya plano/renders antes que separar: con la galería y
        # Escenario venta/renta reordenados a sus propias hojas
        # (`_opportunity()`), el presupuesto es la tercera hoja fija del
        # documento de oportunidad tenga o no plano/renders — otra vez
        # pedido explícito, no una inferencia de este archivo.
        (f'<div class="detail-section detail-section-budget"><div class="col-label">Presupuesto de obra</div>{budget_html}</div>'
         if budget_html else ""),
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
                          opportunity: list[dict],
                          sections: ProspectusSections = _ALL_SECTIONS) -> str:
    """The four buckets arrive already partitioned — the caller owns the status
    vocabulary, this file owns the presentation.

    Sold and rented arrive apart, rather than as one "track record", because a
    closed deal and a held one are not presumed with the same figures: one
    reports what it collected, the other what it is worth today. Keeping them
    apart is what lets every number below name its own source instead of
    guessing which one is present.

    `sections` recorta el documento; su default es el documento entero, así
    que un llamador que no opine obtiene el mismo HTML de siempre. QUÉ
    propiedades entran no se decide aquí: eso ya venía resuelto en las cuatro
    cubetas y sigue siendo del llamador."""
    from datetime import date
    today = date.today()
    month_year = f"{_MESES[today.month].capitalize()} {today.year}"

    # El track record abre con lo cerrado: un resultado realizado es la prueba
    # más fuerte que tiene la firma, y una marca de valuación no debería colarse
    # por delante de una venta. Dentro de cada grupo, mayor ganancia primero.
    sold = sorted(sold, key=lambda p: _num(p.get("realizedGainPct")), reverse=True)
    rented = sorted(rented, key=lambda p: _num(p.get("unrealizedGainPct")), reverse=True)
    track = [(_sold_card, p) for p in sold] + [(_rented_card, p) for p in rented]

    parts = [_cover(month_year, rented, sold)] if sections.cover else []

    if track or development:
        cards = [build(p, f"Track Record · {i:02d}") for i, (build, p) in enumerate(track, 1)]
        cards += [_development_card(p, f"En Desarrollo · {j:02d}")
                  for j, p in enumerate(development, 1)]
        # Portfolio summary carries the valuation footnote and fills the
        # trailing half-sheet. Apagarlo NO deja media hoja en blanco: entra al
        # mismo _chunk que las tarjetas, así que sin él las que siguen se
        # reacomodan de a dos, igual que si el track record tuviera una
        # propiedad menos.
        if track and sections.portfolio_summary:
            cards.append(_summary_card(sold, rented))
        for pair in _chunk(cards, 2):
            parts.append(f'<div class="page-block sheet">{"".join(pair)}</div>')

    for p in opportunity:
        parts.append(_opportunity(p, sections))

    if sections.closing:
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
