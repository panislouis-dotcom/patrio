import type { FloorGraph, VertexId } from './types'
import { SNAP, gridSnap } from './graph'

export interface Guide { t: 'pt' | 'vx' | 'hy'; x?: number; y?: number }

export function snapPoint(
  f: FloorGraph, x: number, y: number, exclude: Set<VertexId>,
): { x: number; y: number; guides: Guide[] } {
  const others = Object.values(f.vertices).filter(v => !exclude.has(v.id))

  let bestPt: { x: number; y: number } | null = null, bd = SNAP
  for (const v of others) {
    const d = Math.hypot(v.x - x, v.y - y)
    if (d < bd) { bd = d; bestPt = { x: v.x, y: v.y } }
  }
  if (bestPt) return { x: bestPt.x, y: bestPt.y, guides: [{ t: 'pt', x: bestPt.x, y: bestPt.y }] }

  let rx = gridSnap(x), ry = gridSnap(y), hitX = false, hitY = false, bx = SNAP, by = SNAP
  for (const v of others) {
    const dx = Math.abs(v.x - x); if (dx < bx) { bx = dx; rx = v.x; hitX = true }
    const dy = Math.abs(v.y - y); if (dy < by) { by = dy; ry = v.y; hitY = true }
  }
  const guides: Guide[] = []
  if (hitX) guides.push({ t: 'vx', x: rx })
  if (hitY) guides.push({ t: 'hy', y: ry })
  return { x: rx, y: ry, guides }
}
