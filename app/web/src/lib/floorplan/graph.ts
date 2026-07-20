import type { FloorGraph, VertexId, EdgeId } from './types'
import { genId } from './types'
import { dist, projectAt, pointAt } from './geometry'

export const SNAP = 0.12          // metre magnet radius — matches the old drag-snap feel
export const ENDPOINT_GUARD = 0.15 // within this of an edge's own endpoint, it's vertex-snap territory, not a T-junction
export const gridSnap = (v: number): number => Math.round(v / 0.01) * 0.01

export function addVertex(f: FloorGraph, x: number, y: number): VertexId {
  const id = genId()
  f.vertices[id] = { id, x, y }
  return id
}

export function addEdge(f: FloorGraph, v1: VertexId, v2: VertexId, thickness: number): EdgeId {
  const id = genId()
  f.edges[id] = { id, v1, v2, thickness, openings: [] }
  return id
}

export function moveVertex(f: FloorGraph, id: VertexId, x: number, y: number): void {
  f.vertices[id].x = x
  f.vertices[id].y = y
}

/** Wall-body drag: translate both endpoints by an identical delta. No axis-lock, no
 * shape special-casing — this IS the fix for the old force-straightening bug. Any edge
 * sharing an endpoint with this one follows automatically, since it references the same
 * vertex id. */
export function translateEdgeBody(f: FloorGraph, edgeId: EdgeId, dx: number, dy: number): void {
  const e = f.edges[edgeId]
  moveVertex(f, e.v1, f.vertices[e.v1].x + dx, f.vertices[e.v1].y + dy)
  moveVertex(f, e.v2, f.vertices[e.v2].x + dx, f.vertices[e.v2].y + dy)
}

/** T-junction: split `edgeId` into two edges sharing `atVertexId`, which must already sit
 * on (or very near) the edge's segment. Openings are redistributed to whichever half they
 * now fall in, with `offset` rescaled to that half's length. Returns the new edge's id;
 * the original edge's id is kept for the `v1 -> atVertexId` half. */
export function splitEdgeAtVertex(f: FloorGraph, edgeId: EdgeId, atVertexId: VertexId): EdgeId {
  const e = f.edges[edgeId]
  const p1 = f.vertices[e.v1], p2 = f.vertices[e.v2], mid = f.vertices[atVertexId]
  const fullLen = dist([p1.x, p1.y], [p2.x, p2.y]) || 1
  const atLen = dist([p1.x, p1.y], [mid.x, mid.y])
  const firstHalfOpenings = [], secondHalfOpenings = []
  for (const o of e.openings) {
    const openingLen = o.offset * fullLen
    if (openingLen <= atLen) firstHalfOpenings.push({ ...o, offset: atLen > 0 ? openingLen / atLen : 0 })
    else secondHalfOpenings.push({ ...o, offset: (fullLen - atLen) > 0 ? (openingLen - atLen) / (fullLen - atLen) : 0 })
  }
  const v2 = e.v2
  f.edges[edgeId] = { ...e, v2: atVertexId, openings: firstHalfOpenings }
  const newId = genId()
  f.edges[newId] = { id: newId, v1: atVertexId, v2, thickness: e.thickness, openings: secondHalfOpenings }
  return newId
}

/** Vertex-snap merge: reassign every edge referencing `removeId` to reference `keepId`
 * instead, then delete `removeId`. Any edge that becomes degenerate (both ends now the
 * same vertex, e.g. dragging one end of a wall onto its own other end) is deleted. */
export function mergeVertexInto(f: FloorGraph, removeId: VertexId, keepId: VertexId): void {
  for (const e of Object.values(f.edges)) {
    if (e.v1 === removeId) e.v1 = keepId
    if (e.v2 === removeId) e.v2 = keepId
  }
  for (const e of Object.values(f.edges)) {
    if (e.v1 === e.v2) delete f.edges[e.id]
  }
  delete f.vertices[removeId]
}

export function deleteVertex(f: FloorGraph, id: VertexId): void {
  for (const e of Object.values(f.edges)) {
    if (e.v1 === id || e.v2 === id) delete f.edges[e.id]
  }
  delete f.vertices[id]
}

export function deleteEdge(f: FloorGraph, id: EdgeId): void {
  delete f.edges[id]
}

export function nearestVertex(
  f: FloorGraph, pt: { x: number; y: number }, exclude: Set<VertexId>,
): { id: VertexId; x: number; y: number } | null {
  let best: { id: VertexId; x: number; y: number } | null = null
  let bd = SNAP
  for (const v of Object.values(f.vertices)) {
    if (exclude.has(v.id)) continue
    const d = Math.hypot(v.x - pt.x, v.y - pt.y)
    if (d < bd) { bd = d; best = { id: v.id, x: v.x, y: v.y } }
  }
  return best
}

export function nearestEdgePoint(
  f: FloorGraph, pt: { x: number; y: number }, exclude: Set<EdgeId>,
): { edgeId: EdgeId; x: number; y: number; distance: number } | null {
  let best: { edgeId: EdgeId; x: number; y: number; distance: number } | null = null
  for (const e of Object.values(f.edges)) {
    if (exclude.has(e.id)) continue
    const p1 = f.vertices[e.v1], p2 = f.vertices[e.v2]
    const fullLen = dist([p1.x, p1.y], [p2.x, p2.y]) || 1
    const atM = projectAt([p1.x, p1.y], [p2.x, p2.y], pt)
    if (atM < ENDPOINT_GUARD || (fullLen - atM) < ENDPOINT_GUARD) continue
    const [px, py] = pointAt([p1.x, p1.y], [p2.x, p2.y], atM)
    const d = Math.hypot(pt.x - px, pt.y - py)
    if (!best || d < best.distance) best = { edgeId: e.id, x: px, y: py, distance: d }
  }
  return best
}
