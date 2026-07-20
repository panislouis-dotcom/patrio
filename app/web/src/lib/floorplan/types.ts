export type VertexId = string
export type EdgeId = string

export interface Vertex { id: VertexId; x: number; y: number }

export interface Opening {
  kind: 'door' | 'window'
  offset: number   // 0..1, fraction of the edge's length at drag-commit time
  width: number    // metres
}

export interface Edge {
  id: EdgeId
  v1: VertexId
  v2: VertexId
  thickness: number   // metres; bulk-updated from extWall_m/intWall_m — see reducer.ts
  openings: Opening[]
}

export interface Reference {
  imageKey: string
  scale_m_per_px: number
  origin_px: [number, number]
  opacity: number
}

export interface Room { name: string; cx: number; cy: number }

export interface FloorGraph {
  name: string
  height_m: number
  extWall_m: number
  intWall_m: number
  vertices: Record<VertexId, Vertex>
  edges: Record<EdgeId, Edge>
  rooms: Room[]          // user-assigned names, matched to traced faces by nearest centroid
  reference?: Reference
}

export interface FloorPlanModel {
  schemaVersion: 2
  slab_m: number
  activeFloor: number
  floors: FloorGraph[]
}

export function genId(): string {
  return crypto.randomUUID()
}

export function emptyFloorGraph(name: string): FloorGraph {
  return {
    name, height_m: 2.60, extWall_m: 0.15, intWall_m: 0.10,
    vertices: {}, edges: {}, rooms: [],
  }
}

export function emptyModel(): FloorPlanModel {
  return {
    schemaVersion: 2,
    slab_m: 0.15,
    activeFloor: 0,
    floors: [emptyFloorGraph('Planta Baja')],
  }
}

export function isEmpty(m: FloorPlanModel | Record<string, never>): boolean {
  return !m || !('floors' in m) || !Array.isArray(m.floors) || m.floors.length === 0
}

export const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o))

export const floorElev = (m: FloorPlanModel, i: number): number =>
  m.floors.slice(0, i).reduce((e, f) => e + f.height_m, 0)
