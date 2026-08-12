import type { FloorGraph, EdgeId } from './types'
import { isGhost } from './types'
import { shoelaceSigned, shoelace, polygonCentroid, pointInPolygon, type Pt } from './geometry'

export interface TracedFace { vertexIds: string[]; edgeIds: EdgeId[]; area: number }
export interface RoomArea { cx: number; cy: number; area: number; name: string }
/** A label to draw on the plan: a traced (enclosed) room carries its net area; a
 * free label the user dropped on an open space carries `area: null`. */
export interface RoomLabel { cx: number; cy: number; name: string; area: number | null }

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

/** Edges belonging to the largest-absolute-area traced face (the outer/exterior boundary).
 * Una fantasma jamás califica: aunque caiga en el contorno trazado, no es muro exterior —
 * ni para espesores bulk (reducer) ni para cotas/exports que consumen este set. */
export function exteriorEdgeIds(f: FloorGraph): Set<EdgeId> {
  const faces = traceFaces(f)
  if (faces.length === 0) return new Set()
  const outer = faces.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a))
  return new Set(outer.edgeIds.filter(id => !isGhost(f.edges[id])))
}

/** The interior (non-outer) traced faces as polygons, one per enclosed room. */
function interiorPolygons(f: FloorGraph): Pt[][] {
  const faces = traceFaces(f)
  if (faces.length < 2) return []
  const outer = faces.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a))
  return faces
    .filter(face => face !== outer)
    .map(face => face.vertexIds.map(id => [f.vertices[id].x, f.vertices[id].y] as Pt))
}

/** Rooms = every enclosed face. Named by the user-assigned point that lies INSIDE it
 * (nearest to the centroid if several do); un-named otherwise. Resolving by containment,
 * not by nearest-without-bound, keeps the name sticky across edits without letting a name
 * dropped on an open space bleed onto an unrelated enclosed room. */
export function roomAreas(f: FloorGraph): RoomArea[] {
  return interiorPolygons(f).map(pts => {
    const [cx, cy] = polygonCentroid(pts)
    return { cx, cy, area: shoelace(pts), name: roomNameInside(f, pts) }
  })
}

/** Every label to draw: the enclosed rooms (with net area), plus every user-named point
 * that falls in no enclosed room (drawn name-only, `area: null`). This is what lets an
 * open, un-enclosed space carry a name — the enabler for referencing it later. */
export function roomLabels(f: FloorGraph): RoomLabel[] {
  const enclosed = roomAreas(f).map(t => ({ cx: t.cx, cy: t.cy, name: t.name, area: t.area as number | null }))
  const polys = interiorPolygons(f)
  const free: RoomLabel[] = f.rooms
    .filter(r => !polys.some(poly => pointInPolygon(r.cx, r.cy, poly)))
    .map(r => ({ cx: r.cx, cy: r.cy, name: r.name, area: null }))
  return [...enclosed, ...free]
}

/** Un cuarto cerrado con su lista de vértices (en vez del área/centroide que ya da
 * `roomAreas`). Task 21c la agrega porque `planFacts.ts` necesita el bounding box (ancho ×
 * fondo) de cada cuarto medible, y esa cuenta necesita los vértices crudos — no los da
 * `RoomArea` a propósito (mantenerlo liviano para quien solo quiere área/centroide). Reusa
 * `interiorPolygons`/`roomNameInside` (el mismo trazo de caras que `roomAreas` ya hace, en
 * el mismo orden) en vez de volver a trazar caras: es literalmente `roomAreas` sin colapsar
 * `pts` a área+centroide. */
export interface RoomPolygon { name: string; vertices: { x: number; y: number }[] }

export function roomPolygons(f: FloorGraph): RoomPolygon[] {
  return interiorPolygons(f).map(pts => ({
    name: roomNameInside(f, pts),
    vertices: pts.map(([x, y]) => ({ x, y })),
  }))
}

/** Name of the user-assigned point that lies inside `poly`, nearest its centroid; '' if none. */
function roomNameInside(f: FloorGraph, poly: Pt[]): string {
  const [cx, cy] = polygonCentroid(poly)
  let name = '', bd = Infinity
  for (const r of f.rooms) {
    if (!pointInPolygon(r.cx, r.cy, poly)) continue
    const d = Math.hypot(r.cx - cx, r.cy - cy)
    if (d < bd) { bd = d; name = r.name }
  }
  return name
}

/** La cara de mayor |área| — el mismo criterio que interiorPolygons/exteriorEdgeIds usan
 * inline para descartar "la exterior"; no se extrajo de esas dos (Task 20 solo AGREGA a
 * este archivo, no las restructura) pero replica el criterio idéntico a propósito, no uno
 * inventado — para que roomConnections coincida siempre con qué cara es "exterior" ahí. */
function outerFace(faces: TracedFace[]): TracedFace | undefined {
  if (faces.length === 0) return undefined
  return faces.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a))
}

/** Nombre de cuarto de una cara trazada: `'exterior'` literal si es la cara exterior,
 * si no la MISMA búsqueda por contención que roomNameInside ya usa para las caras
 * interiores (roomAreas/roomLabels) — ninguna lógica de punto-en-polígono nueva. */
function faceRoomName(f: FloorGraph, face: TracedFace, outer: TracedFace | undefined): string | 'exterior' {
  if (face === outer) return 'exterior'
  const poly: Pt[] = face.vertexIds.map(id => [f.vertices[id].x, f.vertices[id].y])
  return roomNameInside(f, poly)
}

export interface Connection {
  edgeId: EdgeId
  openingIndex: number
  kind: 'door' | 'window'
  roomA: string | 'exterior'
  roomB: string | 'exterior'
}

/**
 * Qué cuarto(s) conecta cada puerta/ventana. Reusa traceFaces (no reimplementa trazo de
 * caras ni punto-en-polígono): en un grafo plano bien formado toda arista tiene exactamente
 * 2 darts (uno por sentido) y cada dart pertenece a exactamente una cara trazada — así que
 * las 2 caras que bordean una arista son las dueñas de sus 2 darts.
 *
 * Orden de roomA/roomB: NO es "izquierda/derecha" visual ni depende del orden de iteración
 * de Object.values(f.edges) (que sería incidental y podría cambiar si el grafo se
 * reconstruye). Es determinista por la identidad propia de la arista: roomA es siempre el
 * lado de la cara cuyo dart ARRANCA en e.v1; roomB, el de la cara cuyo dart arranca en e.v2.
 * Mover un vértice no cambia v1/v2 de una arista, así que el orden es estable ante edición.
 */
export function roomConnections(f: FloorGraph): Connection[] {
  const faces = traceFaces(f)
  const outer = outerFace(faces)

  // Mismo formato de llave que traceFaces usa internamente para `visited` (`${fromVertex}|${edgeId}`)
  // — un dart identifica de forma única la cara que lo contiene.
  const faceByDart = new Map<string, TracedFace>()
  for (const face of faces) {
    face.edgeIds.forEach((edgeId, i) => faceByDart.set(`${face.vertexIds[i]}|${edgeId}`, face))
  }

  const connections: Connection[] = []
  for (const e of Object.values(f.edges)) {
    if (e.openings.length === 0) continue
    const faceA = faceByDart.get(`${e.v1}|${e.id}`)
    const faceB = faceByDart.get(`${e.v2}|${e.id}`)
    // Una arista bien formada siempre tiene sus 2 darts, cada uno en su cara. Si falta
    // alguno (grafo roto/no cerrado) no hay conectividad que resolver — se omite en vez de
    // tronar. Esto también cubre, de forma defensiva, el caso imposible de una fantasma con
    // opening (Task 7 ya lo rechaza en el reducer: una fantasma nunca debería llegar aquí
    // con e.openings.length > 0).
    if (!faceA || !faceB) continue
    const roomA = faceRoomName(f, faceA, outer)
    const roomB = faceRoomName(f, faceB, outer)
    e.openings.forEach((op, openingIndex) => {
      connections.push({ edgeId: e.id, openingIndex, kind: op.kind, roomA, roomB })
    })
  }
  return connections
}
