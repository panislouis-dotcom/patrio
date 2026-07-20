import type { FloorGraph, EdgeId } from './types'
import { shoelaceSigned, shoelace, polygonCentroid, type Pt } from './geometry'

export interface TracedFace { vertexIds: string[]; edgeIds: EdgeId[]; area: number }
export interface RoomArea { cx: number; cy: number; area: number; name: string }

/**
 * Trace every face of the planar graph via the standard "next edge in rotational
 * order" walk: sort each vertex's incident edges by angle, and on arriving at a vertex
 * always continue via the next edge clockwise from the one just arrived on. Every
 * directed edge (dart) belongs to exactly one traced face; a plain closed loop of N
 * edges produces exactly 2 faces (the bounded interior, and the outer face tracing the
 * same boundary in the opposite direction) since each edge has exactly 2 darts.
 */
export function traceFaces(f: FloorGraph): TracedFace[] {
  type Dart = { edgeId: EdgeId; to: string; angle: number }
  const incident = new Map<string, Dart[]>()
  for (const id of Object.keys(f.vertices)) incident.set(id, [])
  for (const e of Object.values(f.edges)) {
    const p1 = f.vertices[e.v1], p2 = f.vertices[e.v2]
    incident.get(e.v1)!.push({ edgeId: e.id, to: e.v2, angle: Math.atan2(p2.y - p1.y, p2.x - p1.x) })
    incident.get(e.v2)!.push({ edgeId: e.id, to: e.v1, angle: Math.atan2(p1.y - p2.y, p1.x - p2.x) })
  }
  for (const list of incident.values()) list.sort((a, b) => a.angle - b.angle)

  const visited = new Set<string>() // `${fromVertex}|${edgeId}`
  const faces: TracedFace[] = []

  for (const startEdge of Object.values(f.edges)) {
    for (const startFrom of [startEdge.v1, startEdge.v2]) {
      const startKey = `${startFrom}|${startEdge.id}`
      if (visited.has(startKey)) continue

      const vertexIds: string[] = []
      const edgeIds: EdgeId[] = []
      let curFrom = startFrom, curEdgeId = startEdge.id
      // safety bound: a real planar graph can't produce a face longer than 2x edge count
      const maxSteps = Object.keys(f.edges).length * 2 + 1
      for (let steps = 0; steps < maxSteps; steps++) {
        visited.add(`${curFrom}|${curEdgeId}`)
        vertexIds.push(curFrom)
        edgeIds.push(curEdgeId)
        const curEdge = f.edges[curEdgeId]
        const to = curEdge.v1 === curFrom ? curEdge.v2 : curEdge.v1
        const incidentAtTo = incident.get(to)!
        const idx = incidentAtTo.findIndex(d => d.edgeId === curEdgeId && d.to === curFrom)
        const nextIdx = (idx - 1 + incidentAtTo.length) % incidentAtTo.length
        const nextDart = incidentAtTo[nextIdx]
        curFrom = to
        curEdgeId = nextDart.edgeId
        if (curFrom === startFrom && curEdgeId === startEdge.id) break
      }
      const pts: Pt[] = vertexIds.map(id => [f.vertices[id].x, f.vertices[id].y])
      faces.push({ vertexIds, edgeIds, area: shoelaceSigned(pts) })
    }
  }
  return faces
}

/** Edges belonging to the largest-absolute-area traced face (the outer/exterior boundary). */
export function exteriorEdgeIds(f: FloorGraph): Set<EdgeId> {
  const faces = traceFaces(f)
  if (faces.length === 0) return new Set()
  const outer = faces.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a))
  return new Set(outer.edgeIds)
}

/** Rooms = every traced face except the outer boundary. Named by nearest previously
 * user-assigned room centroid (same "sticky name across edits" behavior as the old
 * flood-fill model). */
export function roomAreas(f: FloorGraph): RoomArea[] {
  const faces = traceFaces(f)
  if (faces.length < 2) return []
  const outer = faces.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a))
  const out: RoomArea[] = []
  for (const face of faces) {
    if (face === outer) continue
    const pts: Pt[] = face.vertexIds.map(id => [f.vertices[id].x, f.vertices[id].y])
    const [cx, cy] = polygonCentroid(pts)
    out.push({ cx, cy, area: shoelace(pts), name: nearestRoomName(f, cx, cy) })
  }
  return out
}

function nearestRoomName(f: FloorGraph, cx: number, cy: number): string {
  let name = '', bd = 1e9
  for (const r of f.rooms) {
    const d = Math.hypot(r.cx - cx, r.cy - cy)
    if (d < bd) { bd = d; name = r.name }
  }
  return name
}
