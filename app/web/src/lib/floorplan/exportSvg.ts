import type { FloorGraph } from './types'
import { roomLabels } from './rooms'
import { widthHeightChains } from './dimensions'

// A clean, print-friendly SVG of one floor: white background, dark walls at their real
// thickness, room names + areas, wall-length labels and the overall width/height chains.
// Deliberately independent of the interactive canvas (no grid, no handles, no theme dark
// palette, no camera) so a downloaded plan is legible on paper and editable in a vector tool.

const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2)
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

const INK = '#1a1a1a'      // walls
const DIM = '#444'         // dimension text + lines
const NAME = '#111'        // room name
const AREA = '#555'        // room area
const OPENING = '#333'     // door/window marks

function edgeAxis(p1: { x: number; y: number }, p2: { x: number; y: number }) {
  const L = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
  const ux = (p2.x - p1.x) / L, uy = (p2.y - p1.y) / L
  return { L, ux, uy, nx: -uy, ny: ux }
}

export interface ExportOpts { width?: number; height?: number; margin?: number }

/** Serialize one floor to a standalone, print-friendly SVG string. */
export function floorToSvg(floor: FloorGraph, opts: ExportOpts = {}): string {
  const width = opts.width ?? 1200, height = opts.height ?? 900, margin = opts.margin ?? 64
  const verts = Object.values(floor.vertices)
  const xs = verts.map(v => v.x), ys = verts.map(v => v.y)
  const minx = Math.min(...xs, 0), maxx = Math.max(...xs, 1)
  const miny = Math.min(...ys, 0), maxy = Math.max(...ys, 1)
  const spanx = maxx - minx || 1, spany = maxy - miny || 1
  const scale = Math.min((width - 2 * margin) / spanx, (height - 2 * margin) / spany)
  const px = (x: number) => margin + (x - minx) * scale
  const py = (y: number) => height - margin - (y - miny) * scale

  const el: string[] = []
  const edges = Object.values(floor.edges)

  // walls
  for (const e of edges) {
    const p1 = floor.vertices[e.v1], p2 = floor.vertices[e.v2]
    el.push(`<line x1="${px(p1.x)}" y1="${py(p1.y)}" x2="${px(p2.x)}" y2="${py(p2.y)}" stroke="${INK}" stroke-width="${Math.max(2, e.thickness * scale)}" stroke-linecap="butt"/>`)
  }

  // openings: white gap over the wall + door swing / window mullion
  for (const e of edges) {
    const p1 = floor.vertices[e.v1], p2 = floor.vertices[e.v2]
    const { L, ux, uy, nx, ny } = edgeAxis(p1, p2)
    e.openings.forEach(op => {
      const atM = op.offset * L, cx = p1.x + ux * atM, cy = p1.y + uy * atM, hw = op.width / 2
      const ax = cx - ux * hw, ay = cy - uy * hw, bx = cx + ux * hw, by = cy + uy * hw
      el.push(`<line x1="${px(ax)}" y1="${py(ay)}" x2="${px(bx)}" y2="${py(by)}" stroke="#fff" stroke-width="${e.thickness * scale + 2}" stroke-linecap="butt"/>`)
      if (op.kind === 'door') {
        el.push(`<line x1="${px(ax)}" y1="${py(ay)}" x2="${px(ax + nx * op.width)}" y2="${py(ay + ny * op.width)}" stroke="${OPENING}" stroke-width="1.3"/>`)
        el.push(`<path d="M ${px(bx)} ${py(by)} A ${op.width * scale} ${op.width * scale} 0 0 0 ${px(ax + nx * op.width)} ${py(ay + ny * op.width)}" fill="none" stroke="${OPENING}" stroke-width="0.8"/>`)
      } else {
        el.push(`<line x1="${px(cx - nx * 0.12)}" y1="${py(cy - ny * 0.12)}" x2="${px(cx + nx * 0.12)}" y2="${py(cy + ny * 0.12)}" stroke="${OPENING}" stroke-width="1.3"/>`)
      }
    })
  }

  // per-edge length labels
  for (const e of edges) {
    const p1 = floor.vertices[e.v1], p2 = floor.vertices[e.v2]
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2, L = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    el.push(`<text x="${px(mx) + 11}" y="${py(my)}" text-anchor="middle" font-family="serif" font-size="13" fill="${DIM}">${f2(L)}</text>`)
  }

  // room names + areas
  for (const r of roomLabels(floor)) {
    el.push(`<text x="${px(r.cx)}" y="${py(r.cy) - 5}" text-anchor="middle" font-family="sans-serif" font-size="16" fill="${NAME}">${esc(r.name)}</text>`)
    if (r.area != null) el.push(`<text x="${px(r.cx)}" y="${py(r.cy) + 13}" text-anchor="middle" font-family="serif" font-size="13" fill="${AREA}">${f2(r.area)} m²</text>`)
  }

  // overall width / height dimension chains
  const { widthMarks, heightMarks } = widthHeightChains(floor)
  const x0 = widthMarks[0], x1 = widthMarks[widthMarks.length - 1]
  const y0 = heightMarks[0], y1 = heightMarks[heightMarks.length - 1]
  el.push(`<line x1="${px(x0)}" y1="${py(y0) + 40}" x2="${px(x1)}" y2="${py(y0) + 40}" stroke="${DIM}" stroke-width="0.6"/>`)
  for (let k = 0; k < widthMarks.length - 1; k++) {
    const a = widthMarks[k], b = widthMarks[k + 1]
    el.push(`<text x="${(px(a) + px(b)) / 2}" y="${py(y0) + 54}" text-anchor="middle" font-family="serif" font-size="13" fill="${DIM}">${f2(b - a)} m</text>`)
  }
  el.push(`<line x1="${px(x1) + 40}" y1="${py(y0)}" x2="${px(x1) + 40}" y2="${py(y1)}" stroke="${DIM}" stroke-width="0.6"/>`)
  for (let k = 0; k < heightMarks.length - 1; k++) {
    const a = heightMarks[k], b = heightMarks[k + 1]
    el.push(`<text x="${px(x1) + 64}" y="${(py(a) + py(b)) / 2}" text-anchor="middle" font-family="serif" font-size="13" fill="${DIM}">${f2(b - a)} m</text>`)
  }

  const title = esc(floor.name)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>` +
    `<text x="${margin}" y="${margin - 28}" font-family="sans-serif" font-size="20" fill="${INK}">${title}</text>` +
    el.join('') +
    `</svg>`
}
