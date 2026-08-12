// Exportar una planta como imagen, para mandarla al motor de renders como fuente.
//
// Dos mitades: floorToSvgString es PURA (un string SVG del plano — muros + nombres
// de cuarto — en estilo cenital limpio) y se prueba sin navegador; floorToPngBlob
// la rasteriza vía canvas y solo corre en el browser.
import type { FloorGraph } from './types'
import { isGhost, FIXTURE_CATALOG } from './types'
import { roomLabels } from './rooms'
import { edgeAxis } from './geometry'
import { widthHeightChains, cotaEdges, f2 } from './dimensions'

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string))
}

/** SVG cenital del plano (muros + nombres de cuarto), escalado a los límites de la
 * planta. Es lo que se rasteriza y se manda al motor de renders. */
export function floorToSvgString(floor: FloorGraph, opts: { pad?: number; scale?: number } = {}): string {
  const pad = opts.pad ?? 1          // metros de margen
  const scale = opts.scale ?? 100    // px por metro
  const vs = Object.values(floor.vertices)
  const xs = vs.map(v => v.x), ys = vs.map(v => v.y)
  const minx = Math.min(...xs, 0) - pad, maxx = Math.max(...xs, 1) + pad
  const miny = Math.min(...ys, 0) - pad, maxy = Math.max(...ys, 1) + pad
  const W = Math.max(1, (maxx - minx) * scale), H = Math.max(1, (maxy - miny) * scale)
  const px = (x: number) => (x - minx) * scale
  const py = (y: number) => (maxy - y) * scale   // Y del mundo hacia arriba = pantalla hacia abajo

  const parts: string[] = [`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`]
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
    for (const [s0, s1] of segs) {
      const ax0 = p1.x + ux * s0, ay0 = p1.y + uy * s0
      const ax1 = p1.x + ux * s1, ay1 = p1.y + uy * s1
      parts.push(`<line data-wall="${e.id}" x1="${px(ax0)}" y1="${py(ay0)}" x2="${px(ax1)}" y2="${py(ay1)}" stroke="#111111" stroke-width="${w}" stroke-linecap="round"/>`)
    }

    // Puertas: el arco de abatimiento (mismo path que el editor, FloorPlanCanvas.tsx) le
    // dice al modelo hacia dónde abre. Ventanas: un marcador perpendicular corto — no
    // abaten, solo hay que marcar dónde está el vano.
    e.openings.forEach((op, i) => {
      const atM = op.offset * L
      const cx = p1.x + ux * atM, cy = p1.y + uy * atM, hw = op.width / 2
      const ax = cx - ux * hw, ay = cy - uy * hw, bx = cx + ux * hw, by = cy + uy * hw
      if (op.kind === 'door') {
        const lx = ax + nx * op.width, ly = ay + ny * op.width
        parts.push(`<line data-opening="door-leaf" data-edge="${e.id}" data-index="${i}" x1="${px(ax)}" y1="${py(ay)}" x2="${px(lx)}" y2="${py(ly)}" stroke="#111111" stroke-width="1.3"/>`)
        parts.push(`<path data-opening="door-arc" data-edge="${e.id}" data-index="${i}" d="M ${px(bx)} ${py(by)} A ${op.width * scale} ${op.width * scale} 0 0 0 ${px(lx)} ${py(ly)}" fill="none" stroke="#111111" stroke-width="0.8" opacity="0.7"/>`)
      } else {
        const mx0 = cx - nx * 0.12, my0 = cy - ny * 0.12, mx1 = cx + nx * 0.12, my1 = cy + ny * 0.12
        parts.push(`<line data-opening="window-marker" data-edge="${e.id}" data-index="${i}" x1="${px(mx0)}" y1="${py(my0)}" x2="${px(mx1)}" y2="${py(my1)}" stroke="#111111" stroke-width="1.3"/>`)
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
    parts.push(
      `<rect data-fixture="${fx.id}" x="${-w2 / 2}" y="${-h2 / 2}" width="${w2}" height="${h2}" ` +
      `fill="#e8e8e8" stroke="#555555" stroke-width="1" ` +
      `transform="translate(${cx} ${cy}) rotate(${-fx.rot})"/>`,
    )
    parts.push(
      `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#333333">${escapeXml(meta.label)}</text>`,
    )
  }
  for (const r of roomLabels(floor)) {
    const t = (r.name || '').trim()
    if (!t) continue
    parts.push(`<text x="${px(r.cx)}" y="${py(r.cy)}" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#333333">${escapeXml(t)}</text>`)
  }

  // Cotas: antes el export no mandaba NINGUNA dimensión en la imagen (solo vivían en el
  // texto del prompt) — mismas cadenas ancho/alto y misma convención visual que el editor
  // (FloorPlanCanvas.tsx, sección "── dimensions ──"), adaptada a este módulo sin JSX.
  const dimText = (x: number, y: number, txt: string) =>
    parts.push(`<text x="${x}" y="${y}" text-anchor="middle" font-family="serif" font-size="11" fill="#333333">${escapeXml(txt)}</text>`)
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
  for (const e of cotaEdges(floor)) {
    const p1 = floor.vertices[e.v1], p2 = floor.vertices[e.v2]
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2
    const L = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    dimText(px(mx) + 11, py(my), f2(L))
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`
}

/** Rasteriza el SVG del plano a un PNG (navegador). */
export async function floorToPngBlob(floor: FloorGraph): Promise<Blob> {
  const svg = floorToSvgString(floor)
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
