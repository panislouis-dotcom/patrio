// Exportar una planta como imagen, para mandarla al motor de renders como fuente.
//
// Dos mitades: floorToSvgString es PURA (un string SVG del plano — muros + nombres
// de cuarto — en estilo cenital limpio) y se prueba sin navegador; floorToPngBlob
// la rasteriza vía canvas y solo corre en el browser.
import type { FloorGraph } from './types'
import { isGhost, FIXTURE_CATALOG, ROOM_TYPE_CATALOG } from './types'
import { roomLabels, roomPolygons } from './rooms'
import { resolveRoomType } from './planFacts'
import { edgeAxis } from './geometry'
import { widthHeightChains, cotaEdges, f2 } from './dimensions'

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string))
}

/** SVG cenital del plano (muros + nombres de cuarto), escalado a los límites de la
 * planta. Es lo que se rasteriza y se manda al motor de renders.
 *
 * `opts.annotations` (default `true`, preserva el comportamiento de siempre): con
 * `false` omite todo TEXTO (nombres de cuarto, cotas, etiquetas de mueble) — deja
 * solo muros, vanos (con su símbolo de puerta/ventana) y las siluetas de mueble sin
 * etiqueta. Task 34 del addendum de fidelidad geométrica: `_PLAN_CLAUSE`
 * (`app/api/renders.py`) le pide al modelo de imagen "sin texto ni marcas de agua"
 * sobre una referencia que hasta ahora iba cubierta de texto — instrucción que se
 * contradecía a sí misma. La versión `annotations:false` es la que de verdad se
 * manda a OpenAI (`floorToPngBlob`, más abajo); la versión completa (`true`, el
 * default) sigue existiendo para cualquier otro consumidor que sí quiera ver
 * cotas/nombres — hoy ninguno más la usa, pero la regresión se prueba explícita.
 *
 * `opts.roomTypeFill` (default `false`, Fase 2 del diagnóstico de Locales Salón
 * Escobedo): un relleno de color plano por `RoomType` (`ROOM_TYPE_CATALOG`, types.ts),
 * bajo las líneas de muro. A diferencia de `annotations`, NO es texto — no tiene
 * glifos que el modelo pueda reproducir mal, la misma categoría de tarea (copiar
 * forma/color) que ya funciona hoy para puertas/ventanas/muebles — así que es
 * independiente de `annotations` y no afecta su contrato. `resolveRoomType`
 * (planFacts.ts) es el MISMO resolutor que decide el `tipo:` del prompt de texto:
 * imagen y prosa nunca pueden describir un tipo distinto para el mismo cuarto.
 *
 * `opts.fixtureFamilyFill` (default `false`, mismo espíritu que `roomTypeFill` — un
 * mueble no dibujaba ninguna señal de QUÉ tipo de objeto es más allá de su etiqueta de
 * texto, que se omite en la versión limpia; el modelo veía un rectángulo gris genérico
 * sin forma de distinguir una cama de una estufa). Con `true`, el `fill` de cada
 * silueta de mueble usa el color de su familia (`FIXTURE_CATALOG[fx.kind].color`,
 * types.ts — 10 familias, paleta distinta de la de tipo de cuarto para no confundir "esto
 * es un mueble" con "esto es otra zona de cuarto") en vez del gris plano de siempre. El
 * `stroke` no cambia.
 *
 * `opts.nameLabels` (default `false`): dibuja SOLO el nombre de cada cuarto y la etiqueta
 * de cada mueble — un subconjunto de lo que `annotations:true` dibujaba, independiente de
 * ese flag (las cotas/cadenas de dimensión NO se activan con esto, siguen exclusivas de
 * `annotations`). Pedido explícito de Eduardo tras ver que un rectángulo gris sin ninguna
 * marca es indistinguible a simple vista ("no es posible saber qué es qué"): a diferencia
 * del intento anterior (Task 34, revertido — el modelo repetía el texto, garabateado, en
 * SU salida), aquí el texto va acompañado de una instrucción explícita en `_PLAN_CLAUSE`
 * (`app/api/renders.py`) de que estas etiquetas son SOLO referencia para el modelo, nunca
 * texto a reproducir.
 *
 * SE VALIDÓ CON UN RENDER REAL Y FALLÓ (2026-08-16, auditoría de 4 agentes). No por el
 * motivo que se temía: el modelo puede o no reproducir el texto —nunca se comprobó, la
 * salida cruda pre-compositing no se persiste— pero el daño medido es otro y es nuestro.
 * (1) El texto de nombre sobresale del muro exterior y `_content_bbox` (renders.py) lo
 * cuenta como edificio al calibrar el compositing: la referencia mide 4.59% más ancha de
 * lo que es y ese ancho inflado entra directo a `scale_x`. (2) El propio `#333333` de la
 * etiqueta es luminancia 51, dentro de la rampa de `_wall_alpha` (25-60), así que NUESTRO
 * compositor estampa las etiquetas en la salida a alpha 66. A/B natural con `prompt_text`
 * idéntico byte a byte (renders 38 vs 41 de la propiedad 5): sin etiquetas scale_x=1.5621
 * y 6 columnas negras; con etiquetas scale_x=1.4360, 118 columnas negras y muros hasta
 * 45px fuera contra un trazo de 15px. Si vuelve a hacer falta distinguir muebles, la vía
 * es `fixtureFamilyFill` (color, sin glifos, sin contaminar el bbox). */
export function floorToSvgString(
  floor: FloorGraph,
  opts: {
    pad?: number; scale?: number; annotations?: boolean
    roomTypeFill?: boolean; fixtureFamilyFill?: boolean; nameLabels?: boolean
  } = {},
): string {
  const pad = opts.pad ?? 1          // metros de margen
  const scale = opts.scale ?? 100    // px por metro
  const annotations = opts.annotations ?? true
  const roomTypeFill = opts.roomTypeFill ?? false
  const fixtureFamilyFill = opts.fixtureFamilyFill ?? false
  // annotations:true implica nameLabels (el conjunto completo incluye el subconjunto).
  const nameLabels = (opts.nameLabels ?? false) || annotations
  const vs = Object.values(floor.vertices)
  const xs = vs.map(v => v.x), ys = vs.map(v => v.y)
  // El encuadre se ajusta al edificio REAL, no al origen del mundo. Sembrar el bbox con
  // `Math.min(...xs, 0)` / `Math.max(...xs, 1)` metía el origen (0,0) en el lienzo aunque el
  // inmueble estuviera dibujado lejos de él: en los levantamientos reales de la propiedad 5
  // eso dejaba al edificio ocupando solo 63-67% de la imagen, el resto margen en blanco que
  // no es parte del inmueble. No es cosmético — medido contra la API real (2026-08-12,
  // n=3 vs n=4): con encuadre ajustado el modelo deja el edificio quieto (desplazamiento
  // 0-18px, escala 0.993-1.014); con ~64% de lienzo vacío lo MUEVE Y LO REESCALA
  // (desplazamiento 87-261px, escala hasta 1.279x1.424, anisotrópica). El 0/1 solo sobrevive
  // como piso para un floor SIN vértices, que es lo único que esa semilla protegía de verdad.
  const seeded = (pick: (a: number[]) => number, values: number[], fallback: number) =>
    values.length ? pick(values) : fallback
  const minx = seeded(a => Math.min(...a), xs, 0) - pad
  const maxx = seeded(a => Math.max(...a), xs, 1) + pad
  const miny = seeded(a => Math.min(...a), ys, 0) - pad
  const maxy = seeded(a => Math.max(...a), ys, 1) + pad
  const W = Math.max(1, (maxx - minx) * scale), H = Math.max(1, (maxy - miny) * scale)
  const px = (x: number) => (x - minx) * scale
  const py = (y: number) => (maxy - y) * scale   // Y del mundo hacia arriba = pantalla hacia abajo

  // Bug #5 del plan de Task 33a: los font-size de cotas/nombres/muebles eran constantes en
  // px mientras el lienzo crece con `scale` y el tamaño real del plano — arriba de ~18.5m de
  // lado mayor, el reescalado a MAX_EDGE_PLAN (app/api/renders.py) reducía el factor de
  // escala real de la imagen final y el texto se volvía ilegible en silencio. Mecanismo
  // elegido: el font-size es una fracción CONSTANTE del lado mayor del SVG (`planSpan`, que
  // ya incorpora `scale` y el bounding box real) — así la razón font-size/lienzo, y por lo
  // tanto la legibilidad relativa, es la misma sin importar si el plano mide 8m o 30m de
  // lado, y sobrevive intacta a cualquier reescalado UNIFORME posterior (como el de
  // MAX_EDGE_PLAN, que no distorsiona esa razón). FONT_REF=1000px es el lienzo "de
  // referencia" (~un plano de 8x6m con el pad por defecto) al que esta fórmula reproduce los
  // valores fijos originales (11/12/16) — sin regresión visual en el caso típico. Los pisos
  // mínimos evitan que un plano diminuto (o el piso de 1m que usa este módulo cuando no hay
  // vértices) produzca texto ilegiblemente chico.
  const planSpan = Math.max(W, H)
  const FONT_REF = 1000
  const fontSize = (basePx: number, minPx: number) => Math.max(minPx, planSpan * (basePx / FONT_REF))
  const dimFontPx = fontSize(11, 8)
  const roomFontPx = fontSize(16, 10)
  const fixtureFontPx = fontSize(12, 9)

  const parts: string[] = [`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`]

  // Relleno por tipo de cuarto, ANTES del loop de muros (más abajo) para que el trazo
  // negro quede siempre encima, nunca tapado por el relleno. Un cuarto sin tipo
  // resoluble (ni Room.type explícito ni palabra clave en el nombre) o marcado 'otro'
  // se queda sin relleno — mismo blanco de siempre, no un color inventado.
  if (roomTypeFill) {
    for (const room of roomPolygons(floor)) {
      const type = resolveRoomType(room.name, room.type)
      const color = type != null ? ROOM_TYPE_CATALOG[type].color : undefined
      if (!color) continue
      const points = room.vertices.map(v => `${px(v.x)},${py(v.y)}`).join(' ')
      parts.push(`<polygon points="${points}" fill="${color}" />`)
    }
  }

  for (const e of Object.values(floor.edges)) {
    // Una fantasma es una anotación (divide cuartos para nombres/áreas), no un muro: si se
    // dibujara aquí, el modelo de render vería un muro donde el usuario solo puso una línea
    // de referencia — exactamente el caso de falla que este export existe para evitar.
    if (isGhost(e)) continue
    const p1 = floor.vertices[e.v1], p2 = floor.vertices[e.v2]
    const w = Math.max(4, e.thickness * scale)
    const { L, ux, uy, nx, ny } = edgeAxis(p1, p2)

    // Huecos: antes esta línea era continua y el modelo de render no tenía forma de saber
    // dónde está una puerta o ventana (ver el diagnóstico del plan de Task 19). Ahora el
    // muro se corta en tantos segmentos como huecos tenga — ordenados por offset, porque
    // el orden de inserción de e.openings no garantiza el orden a lo largo del muro.
    const openingsByOffset = [...e.openings].sort((a, b) => a.offset - b.offset)
    const gaps = openingsByOffset.map(op => {
      const atM = op.offset * L, hw = op.width / 2
      return { s: Math.max(0, atM - hw), t: Math.min(L, atM + hw) }
    })
    let cursor = 0
    const segs: Array<[number, number]> = []
    for (const g of gaps) {
      if (g.s > cursor) segs.push([cursor, g.s])
      cursor = Math.max(cursor, g.t)
    }
    if (cursor < L) segs.push([cursor, L])
    // stroke-linecap="round" se conserva (no "butt") porque cada muro es un <line> suelto,
    // no un <path> conectado: sin round-cap, dos muros que se encuentran en ángulo dejarían
    // una muesca triangular sin pintar en la esquina exterior (ningún stroke-linejoin aplica
    // entre elementos <line> distintos). Pero ese mismo round-cap, aplicado sin más, extiende
    // CADA extremo de segmento media anchura de línea más allá de su punto — comiéndose el
    // vano de puerta/ventana adyacente (0.90 m medía 0.76 m, verificado rasterizando).
    // Fix: recortar hacia adentro, por media anchura de línea, solo el extremo de un
    // segmento que colinda con un vano (no el que coincide con el vértice real del muro,
    // donde SÍ queremos que el cap rellene la esquina). Al dibujar con round-cap, la media
    // anchura recortada se repone exactamente — el vano queda con su medida real.
    const trimM = (w / 2) / scale
    for (const [s0, s1] of segs) {
      const mid = (s0 + s1) / 2
      const ts0 = s0 > 1e-9 ? Math.min(s0 + trimM, mid) : s0            // s0=0 → vértice real, sin recorte
      const ts1 = s1 < L - 1e-9 ? Math.max(s1 - trimM, mid) : s1        // s1=L → vértice real, sin recorte
      const ax0 = p1.x + ux * ts0, ay0 = p1.y + uy * ts0
      const ax1 = p1.x + ux * ts1, ay1 = p1.y + uy * ts1
      parts.push(`<line data-wall="${e.id}" x1="${px(ax0)}" y1="${py(ay0)}" x2="${px(ax1)}" y2="${py(ay1)}" stroke="#111111" stroke-width="${w}" stroke-linecap="round"/>`)
    }

    // Puertas: el arco de abatimiento (mismo path que el editor, FloorPlanCanvas.tsx) le dice
    // al modelo hacia dónde abre. Ventanas: una línea de "vidrio" que atraviesa el vano de
    // punta a punta, más una jamba corta en cada extremo — antes la ventana solo llevaba un
    // marcador perpendicular de 0.24m que NO cruzaba el vano, así que un modelo de render la
    // leía igual que "aquí no hay muro", el mismo tratamiento visual que un hueco desnudo
    // (bug verificado rasterizando un plano de prueba). Grosores de trazo proporcionales al
    // grosor del muro (`w`, ya calculado arriba): el muro se dibuja en 10-15px típico, así
    // que un arco/hoja/vidrio de 0.8-1.3px fijos eran ~19× más delgados — señal casi
    // invisible para el modelo tras el reescalado a MAX_EDGE_PLAN.
    const leafW = Math.max(3, w / 3)
    const arcW = Math.max(2.5, w / 5)
    const glassW = Math.max(3, w / 3)
    const jambW = Math.max(2.5, w / 5)
    e.openings.forEach((op, i) => {
      const atM = op.offset * L
      const cx = p1.x + ux * atM, cy = p1.y + uy * atM, hw = op.width / 2
      const ax = cx - ux * hw, ay = cy - uy * hw, bx = cx + ux * hw, by = cy + uy * hw
      if (op.kind === 'door') {
        const lx = ax + nx * op.width, ly = ay + ny * op.width
        parts.push(`<line data-opening="door-leaf" data-edge="${e.id}" data-index="${i}" x1="${px(ax)}" y1="${py(ay)}" x2="${px(lx)}" y2="${py(ly)}" stroke="#111111" stroke-width="${leafW}"/>`)
        parts.push(`<path data-opening="door-arc" data-edge="${e.id}" data-index="${i}" d="M ${px(bx)} ${py(by)} A ${op.width * scale} ${op.width * scale} 0 0 0 ${px(lx)} ${py(ly)}" fill="none" stroke="#111111" stroke-width="${arcW}" opacity="0.7"/>`)
      } else {
        // Vidrio: cruza el vano completo (de a a b, los mismos extremos del hueco de muro) —
        // inconfundible con la hoja+arco de una puerta, que se marcan hacia un lado.
        parts.push(`<line data-opening="window-glass" data-edge="${e.id}" data-index="${i}" x1="${px(ax)}" y1="${py(ay)}" x2="${px(bx)}" y2="${py(by)}" stroke="#111111" stroke-width="${glassW}"/>`)
        // Jambas: remate corto perpendicular en cada extremo del vano, marcando el marco.
        const jamb = 0.12
        const jax0 = ax - nx * jamb, jay0 = ay - ny * jamb, jax1 = ax + nx * jamb, jay1 = ay + ny * jamb
        const jbx0 = bx - nx * jamb, jby0 = by - ny * jamb, jbx1 = bx + nx * jamb, jby1 = by + ny * jamb
        parts.push(`<line data-opening="window-jamb" data-edge="${e.id}" data-index="${i}" x1="${px(jax0)}" y1="${py(jay0)}" x2="${px(jax1)}" y2="${py(jay1)}" stroke="#111111" stroke-width="${jambW}"/>`)
        parts.push(`<line data-opening="window-jamb" data-edge="${e.id}" data-index="${i}" x1="${px(jbx0)}" y1="${py(jby0)}" x2="${px(jbx1)}" y2="${py(jby1)}" stroke="#111111" stroke-width="${jambW}"/>`)
      }
    })
  }
  // Muebles: el modelo de render los necesita dibujados a escala real Y nombrados — el
  // prompt le pide "amuebla el espacio" pero sin esto no tiene ni un dato de qué mueble va
  // dónde. `data-fixture` (no un <rect> a secas) para que un test pueda apuntar a ESTE
  // elemento sin contar rects genéricos, que otro renderer podría usar para otra cosa.
  //
  // Signo de rotación: fx.rot es CCW en coordenadas de MUNDO (y hacia arriba, ver types.ts).
  // py() de este módulo NIEGA el eje Y ((maxy - y) * scale, ver arriba) — el mismo signo
  // que viewTransform.ts usa en FloorPlanCanvas.tsx. Con el eje Y invertido, una rotación
  // CCW de mundo se ve en pantalla como CW, y SVG rotate() con ángulo positivo YA es CW en
  // pantalla — así que hay que negar fx.rot aquí también, igual que en el canvas del editor.
  for (const fx of floor.fixtures ?? []) {
    const meta = FIXTURE_CATALOG[fx.kind]
    const cx = px(fx.x), cy = py(fx.y)
    const w2 = fx.w_m * scale, h2 = fx.h_m * scale
    const fill = fixtureFamilyFill ? meta.color : '#e8e8e8'
    parts.push(
      `<rect data-fixture="${fx.id}" x="${-w2 / 2}" y="${-h2 / 2}" width="${w2}" height="${h2}" ` +
      `fill="${fill}" stroke="#555555" stroke-width="1" ` +
      `transform="translate(${cx} ${cy}) rotate(${-fx.rot})"/>`,
    )
    // La silueta del mueble (el <rect> de arriba) va SIEMPRE — el modelo de render necesita
    // verla a escala real sin importar `annotations`/`nameLabels`. Su etiqueta de texto es la
    // que se omite en la versión limpia por default (Task 34: el modelo la repetía,
    // garabateada, en su salida) — `nameLabels:true` la trae de vuelta, pero acompañada de la
    // instrucción explícita en `_PLAN_CLAUSE` de que es solo referencia, no texto a copiar.
    if (nameLabels) {
      parts.push(
        `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="sans-serif" font-size="${fixtureFontPx}" fill="#333333">${escapeXml(meta.label)}</text>`,
      )
    }
  }
  if (nameLabels) {
    for (const r of roomLabels(floor)) {
      const t = (r.name || '').trim()
      if (!t) continue
      parts.push(`<text x="${px(r.cx)}" y="${py(r.cy)}" text-anchor="middle" font-family="sans-serif" font-size="${roomFontPx}" fill="#333333">${escapeXml(t)}</text>`)
    }
  }
  if (annotations) {
    // Cotas: antes el export no mandaba NINGUNA dimensión en la imagen (solo vivían en el
    // texto del prompt) — mismas cadenas ancho/alto y misma convención visual que el editor
    // (FloorPlanCanvas.tsx, sección "── dimensions ──"), adaptada a este módulo sin JSX.
    // Task 34: toda esta sección es TEXTO — se omite por completo en la versión limpia que se
    // manda a OpenAI (las cotas y nombres solo importan para un humano viendo el SVG completo).
    // Nunca se activó junto con `nameLabels` en producción — nadie pidió las cotas de vuelta.
    const dimText = (x: number, y: number, txt: string) =>
      parts.push(`<text x="${x}" y="${y}" text-anchor="middle" font-family="serif" font-size="${dimFontPx}" fill="#333333">${escapeXml(txt)}</text>`)
    const { widthMarks, heightMarks } = widthHeightChains(floor)
    const dimX0 = widthMarks[0], dimX1 = widthMarks[widthMarks.length - 1]
    const dimY0 = heightMarks[0], dimY1 = heightMarks[heightMarks.length - 1]

    parts.push(`<line x1="${px(dimX0)}" y1="${py(dimY0) + 40}" x2="${px(dimX1)}" y2="${py(dimY0) + 40}" stroke="#999999" stroke-width="0.6"/>`)
    for (let k = 0; k < widthMarks.length - 1; k++) {
      const a = widthMarks[k], b = widthMarks[k + 1]
      dimText((px(a) + px(b)) / 2, py(dimY0) + 54, `${f2(b - a)} m`)
    }

    parts.push(`<line x1="${px(dimX1) + 40}" y1="${py(dimY0)}" x2="${px(dimX1) + 40}" y2="${py(dimY1)}" stroke="#999999" stroke-width="0.6"/>`)
    for (let k = 0; k < heightMarks.length - 1; k++) {
      const a = heightMarks[k], b = heightMarks[k + 1]
      dimText(px(dimX1) + 64, (py(a) + py(b)) / 2, `${f2(b - a)} m`)
    }

    // Longitud por muro real — la fantasma no lleva su propia cota, igual que en dimensions.ts.
    // Antes el offset era fijo (+11px en X): para un muro HORIZONTAL, my cae sobre la línea del
    // muro, así que el texto quedaba encima del propio trazo negro (10-15px de grosor, #111111)
    // en gris #333 — ilegible. El fix desplaza el texto por la normal REAL del muro (edgeAxis),
    // así que se separa del trazo sin importar su orientación (horizontal, vertical o diagonal).
    // (nx,ny) es un vector unitario en espacio de MUNDO; como px/py son una transformación
    // conforme (escala uniforme + reflejo en Y, sin cizalla), un desplazamiento unitario en
    // mundo sigue siendo perpendicular en pantalla — solo el componente Y cambia de signo
    // (py(y) = (maxy - y) * scale). El margen crece con el grosor real del muro (w/2) más un
    // colchón fijo, para despegar el texto del trazo sin importar qué tan grueso sea el muro.
    for (const e of cotaEdges(floor)) {
      const p1 = floor.vertices[e.v1], p2 = floor.vertices[e.v2]
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2
      const L = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      const { nx, ny } = edgeAxis(p1, p2)
      const wallPx = Math.max(4, e.thickness * scale)
      const off = wallPx / 2 + 10
      dimText(px(mx) + nx * off, py(my) - ny * off, f2(L))
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`
}

/** Rasteriza el SVG del plano a un PNG (navegador). `opts.annotations`/`opts.roomTypeFill`/
 * `opts.fixtureFamilyFill`/`opts.nameLabels` se reenvían tal cual a `floorToSvgString` —
 * default `true`/`false`/`false`/`false` (SVG completo, sin relleno de color), los
 * llamadores que generan la imagen de referencia para OpenAI deben pasar
 * `annotations: false, roomTypeFill: true, nameLabels: true` (`fixtureFamilyFill` sigue
 * fuera del default de producción hasta validarse con un experimento real — ver docs/plans). */
export async function floorToPngBlob(
  floor: FloorGraph,
  opts: { annotations?: boolean; roomTypeFill?: boolean; fixtureFamilyFill?: boolean; nameLabels?: boolean } = {},
): Promise<Blob> {
  const svg = floorToSvgString(floor, {
    annotations: opts.annotations, roomTypeFill: opts.roomTypeFill,
    fixtureFamilyFill: opts.fixtureFamilyFill, nameLabels: opts.nameLabels,
  })
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('No se pudo rasterizar el plano'))
    img.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.width || 1
  canvas.height = img.height || 1
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo obtener el contexto de canvas')
  ctx.drawImage(img, 0, 0)
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('No se pudo generar el PNG del plano'))), 'image/png'))
}
