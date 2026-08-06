// Exportar una planta como imagen, para mandarla al motor de renders como fuente.
//
// Dos mitades: floorToSvgString es PURA (un string SVG del plano — muros + nombres
// de cuarto — en estilo cenital limpio) y se prueba sin navegador; floorToPngBlob
// la rasteriza vía canvas y solo corre en el browser.
import type { FloorGraph } from './types'
import { roomLabels } from './rooms'

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
    const p1 = floor.vertices[e.v1], p2 = floor.vertices[e.v2]
    const w = Math.max(4, e.thickness * scale)
    parts.push(`<line x1="${px(p1.x)}" y1="${py(p1.y)}" x2="${px(p2.x)}" y2="${py(p2.y)}" stroke="#111111" stroke-width="${w}" stroke-linecap="round"/>`)
  }
  for (const r of roomLabels(floor)) {
    const t = (r.name || '').trim()
    if (!t) continue
    parts.push(`<text x="${px(r.cx)}" y="${py(r.cy)}" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#333333">${escapeXml(t)}</text>`)
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
