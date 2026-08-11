import type { FloorSet } from './types'
import { floorElev, isGhost } from './types'
import { dist } from './geometry'
import { roomAreas, exteriorEdgeIds } from './rooms'

const r3 = (n: number) => Math.round(n * 1000) / 1000

export interface GeometryJson {
  slab_thickness_m: number
  storeys: Array<{
    name: string
    elevation_m: number
    storey_height_m: number
    ext_wall_thickness_m: number
    int_wall_thickness_m: number
    vertices: Record<string, { x: number; y: number }>
    walls: Array<{
      id: string; v1: string; v2: string; thickness_m: number; is_exterior: boolean
      openings: Array<{ kind: string; at_m: number; width_m: number }>
    }>
    rooms: Array<{ name: string; net_area_m2: number; centroid: [number, number] }>
  }>
}

export function toGeometryJson(model: FloorSet): GeometryJson {
  return {
    slab_thickness_m: model.slab_m,
    storeys: model.floors.map((f, i) => {
      const ext = exteriorEdgeIds(f)
      const vertices: Record<string, { x: number; y: number }> = {}
      for (const v of Object.values(f.vertices)) vertices[v.id] = { x: r3(v.x), y: r3(v.y) }
      // Una fantasma es una anotación del editor (divide cuartos para nombres/áreas), no un
      // elemento constructivo: se excluye por completo del export BIM en vez de emitirse con
      // una bandera — un consumidor BIM que no conozca 'ghost' nunca debe verla como muro.
      const walls = Object.values(f.edges).filter(e => !isGhost(e)).map(e => {
        const p1 = f.vertices[e.v1], p2 = f.vertices[e.v2]
        const length = dist([p1.x, p1.y], [p2.x, p2.y])
        return {
          id: e.id, v1: e.v1, v2: e.v2, thickness_m: e.thickness, is_exterior: ext.has(e.id),
          openings: e.openings.map(o => ({ kind: o.kind, at_m: r3(o.offset * length), width_m: r3(o.width) })),
        }
      })
      const rooms = roomAreas(f).map(rg => ({
        name: rg.name, net_area_m2: r3(rg.area), centroid: [r3(rg.cx), r3(rg.cy)] as [number, number],
      }))
      return {
        name: f.name, elevation_m: r3(floorElev(model, i)), storey_height_m: f.height_m,
        ext_wall_thickness_m: f.extWall_m, int_wall_thickness_m: f.intWall_m,
        vertices, walls, rooms,
      }
    }),
  }
}
