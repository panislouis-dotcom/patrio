import type { FloorGraph } from './types'
import { exteriorEdgeIds, traceFaces } from './rooms'

export interface CornerAngle { vertexId: string; deg: number; x: number; y: number; isRight: boolean }

const SPAN_TOL = 0.9   // an interior wall covering at least this fraction of the perpendicular span fully divides the room
const SPLIT_EPS = 0.02 // dedup near-duplicate/near-boundary split marks

function dedupSplits(vals: number[], lo: number, hi: number): number[] {
  const out: number[] = []
  for (const v of vals) {
    if (v - lo < SPLIT_EPS || hi - v < SPLIT_EPS) continue
    if (out.length && v - out[out.length - 1] < SPLIT_EPS) continue
    out.push(v)
  }
  return out
}

/** Width/height dimension chains: the exterior boundary's bounding box, split wherever an
 * interior (non-exterior) edge spans nearly the full perpendicular extent — matching how a
 * real architectural drawing chains dimensions across a dividing wall. */
export function widthHeightChains(f: FloorGraph): { widthMarks: number[]; heightMarks: number[] } {
  const ext = exteriorEdgeIds(f)
  const allX = Object.values(f.vertices).map(v => v.x)
  const allY = Object.values(f.vertices).map(v => v.y)
  const x0 = Math.min(...allX, 0), x1 = Math.max(...allX, 1)
  const y0 = Math.min(...allY, 0), y1 = Math.max(...allY, 1)

  const interiorEdges = Object.values(f.edges).filter(e => !ext.has(e.id))

  const widthSplits = dedupSplits(
    interiorEdges
      .filter(e => {
        const p1 = f.vertices[e.v1], p2 = f.vertices[e.v2]
        const dx = Math.abs(p1.x - p2.x), dy = Math.abs(p1.y - p2.y)
        return dy > dx && dy >= (y1 - y0) * SPAN_TOL
      })
      .map(e => (f.vertices[e.v1].x + f.vertices[e.v2].x) / 2)
      .sort((a, b) => a - b),
    x0, x1,
  )
  const heightSplits = dedupSplits(
    interiorEdges
      .filter(e => {
        const p1 = f.vertices[e.v1], p2 = f.vertices[e.v2]
        const dx = Math.abs(p1.x - p2.x), dy = Math.abs(p1.y - p2.y)
        return dx > dy && dx >= (x1 - x0) * SPAN_TOL
      })
      .map(e => (f.vertices[e.v1].y + f.vertices[e.v2].y) / 2)
      .sort((a, b) => a - b),
    y0, y1,
  )
  return { widthMarks: [x0, ...widthSplits, x1], heightMarks: [y0, ...heightSplits, y1] }
}

/** Interior angle at every vertex on the exterior boundary. Uses the traced outer face's
 * own vertex sequence, so it naturally follows however many corners the boundary has —
 * including ones created by T-junction splits along a previously straight exterior wall. */
export function cornerAngles(f: FloorGraph): CornerAngle[] {
  const faces = traceFaces(f)
  if (faces.length === 0) return []
  const outer = faces.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a))
  const ids = outer.vertexIds
  const n = ids.length
  return ids.map((id, i) => {
    const p = f.vertices[id]
    const pa = f.vertices[ids[(i - 1 + n) % n]]
    const pb = f.vertices[ids[(i + 1) % n]]
    const v1x = pa.x - p.x, v1y = pa.y - p.y, v2x = pb.x - p.x, v2y = pb.y - p.y
    const m1 = Math.hypot(v1x, v1y) || 1, m2 = Math.hypot(v2x, v2y) || 1
    const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)))
    const deg = Math.acos(cos) * 180 / Math.PI
    return { vertexId: id, deg, x: p.x, y: p.y, isRight: Math.abs(deg - 90) <= 1 }
  })
}
