import type { Edge, FloorGraph } from './types'
import { isGhost } from './types'
import { exteriorEdgeIds, traceFaces } from './rooms'

export interface CornerAngle { vertexId: string; deg: number; x: number; y: number; isRight: boolean }

const SPAN_TOL = 0.9   // an interior wall covering at least this fraction of the perpendicular span fully divides the room
const SPLIT_EPS = 0.02 // dedup near-duplicate/near-boundary split marks

/** Tolerance for "is this corner angle a right angle" — shared with planFacts.ts (the
 * "is this ~180° degenerate, not a real corner" filter), which imports this constant
 * instead of keeping its own copy of the literal. Exported, not duplicated: a mutation
 * test showed two independently-declared `1`s can silently drift apart with the full
 * suite still green — see docs/plans (Task 33c review). */
export const CORNER_ANGLE_TOL_DEG = 1

/** Formatea un metraje a 2 decimales para etiquetas de cota. Vivía duplicada, byte-idéntica,
 * en FloorPlanCanvas.tsx y planImage.ts — ambos ya importan de este módulo, así que aquí es
 * donde deja de ser dos copias que podrían divergir. */
export const f2 = (v: number): string => (Math.round(v * 100) / 100).toFixed(2)

/** Edges that count as walls for cotas: every edge except a ghost. A ghost is a manual
 * room divider, not a measured wall — it never splits a dimension chain (widthHeightChains
 * below) and never gets its own per-edge length label, in the editor or anywhere else. */
export function cotaEdges(f: FloorGraph): Edge[] {
  return Object.values(f.edges).filter(e => !isGhost(e))
}

function dedupSplits(vals: number[], lo: number, hi: number): number[] {
  const out: number[] = []
  for (const v of vals) {
    if (v - lo < SPLIT_EPS || hi - v < SPLIT_EPS) continue
    if (out.length && v - out[out.length - 1] < SPLIT_EPS) continue
    out.push(v)
  }
  return out
}

/** Groups interior wall edges that run along the same divider (same coordinate on `axis`,
 * within SPLIT_EPS) and finds the longest CONTIGUOUS run they form along the perpendicular
 * extent. A real interior wall is rarely one edge — `splitEdgeAtVertex` breaks it into a
 * short segment on each side wherever another wall Ts into it (the normal shape of a
 * surveyed floor plan with more than one room). Checking coverage per touching run, not per
 * lone edge, lets a T-split wall still register as "spans the room" while two segments that
 * merely share a coordinate WITHOUT touching (a real gap between them, not a T-junction
 * vertex) are kept separate — same as an isolated stub/column, neither reaches SPAN_TOL and
 * neither should invent a split. This is what SPAN_TOL was for from the start: telling a
 * wall that actually divides the floor from one that only partially crosses it — a T-split
 * wall still fully divides the floor, it is just drawn as more than one edge. */
function spanningCoords(edges: Edge[], vertices: FloorGraph['vertices'], axis: 'x' | 'y', perpSpan: number): number[] {
  const other = axis === 'x' ? 'y' : 'x'
  const groups: { coord: number; ranges: [number, number][] }[] = []
  for (const e of edges) {
    const p1 = vertices[e.v1], p2 = vertices[e.v2]
    const dAxis = Math.abs(p1[axis] - p2[axis]), dOther = Math.abs(p1[other] - p2[other])
    if (!(dOther > dAxis)) continue // must run mostly along `other` to divide that extent
    const coord = (p1[axis] + p2[axis]) / 2
    const lo = Math.min(p1[other], p2[other]), hi = Math.max(p1[other], p2[other])
    let g = groups.find(g => Math.abs(g.coord - coord) < SPLIT_EPS)
    if (!g) { g = { coord, ranges: [] }; groups.push(g) }
    g.ranges.push([lo, hi])
  }
  const out: number[] = []
  for (const g of groups) {
    const sorted = g.ranges.slice().sort((a, b) => a[0] - b[0])
    let bestRun = 0, curLo = sorted[0][0], curHi = sorted[0][1]
    for (let i = 1; i < sorted.length; i++) {
      const [lo, hi] = sorted[i]
      if (lo <= curHi + SPLIT_EPS) curHi = Math.max(curHi, hi) // touching/overlapping: same run
      else { bestRun = Math.max(bestRun, curHi - curLo); curLo = lo; curHi = hi } // real gap: new run
    }
    bestRun = Math.max(bestRun, curHi - curLo)
    if (bestRun >= perpSpan * SPAN_TOL) out.push(g.coord)
  }
  return out.sort((a, b) => a - b)
}

/** Width/height dimension chains: the exterior boundary's bounding box, split wherever an
 * interior (non-exterior) divider spans nearly the full perpendicular extent — matching how
 * a real architectural drawing chains dimensions across a dividing wall. */
export function widthHeightChains(f: FloorGraph): { widthMarks: number[]; heightMarks: number[] } {
  const ext = exteriorEdgeIds(f)
  const allX = Object.values(f.vertices).map(v => v.x)
  const allY = Object.values(f.vertices).map(v => v.y)
  const x0 = Math.min(...allX, 0), x1 = Math.max(...allX, 1)
  const y0 = Math.min(...allY, 0), y1 = Math.max(...allY, 1)

  const interiorEdges = cotaEdges(f).filter(e => !ext.has(e.id))

  const widthSplits = dedupSplits(spanningCoords(interiorEdges, f.vertices, 'x', y1 - y0), x0, x1)
  const heightSplits = dedupSplits(spanningCoords(interiorEdges, f.vertices, 'y', x1 - x0), y0, y1)
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
    return { vertexId: id, deg, x: p.x, y: p.y, isRight: Math.abs(deg - 90) <= CORNER_ANGLE_TOL_DEG }
  })
}
