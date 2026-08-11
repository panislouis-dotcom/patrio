import { describe, it, expect } from 'vitest'
import { emptyFloorGraph } from './types'
import { addVertex, addEdge } from './graph'
import { toGeometryJson } from './export'

describe('toGeometryJson', () => {
  it('projects vertices, walls (with is_exterior + absolute opening position), and rooms', () => {
    const f = emptyFloorGraph('Planta Baja')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3), d = addVertex(f, 0, 3)
    const e1 = addEdge(f, a, b, 0.15)
    addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
    f.edges[e1].openings.push({ kind: 'door', offset: 0.5, width: 0.9 })

    const model = { slab_m: 0.15, activeFloor: 0, floors: [f] }
    const json = toGeometryJson(model)

    expect(json.slab_thickness_m).toBeCloseTo(0.15)
    expect(json.storeys).toHaveLength(1)
    const storey = json.storeys[0]
    expect(storey.name).toBe('Planta Baja')
    expect(storey.elevation_m).toBe(0)
    expect(Object.keys(storey.vertices)).toHaveLength(4)
    expect(storey.walls).toHaveLength(4)
    const wallWithDoor = storey.walls.find(w => w.id === e1)!
    expect(wallWithDoor.is_exterior).toBe(true)
    expect(wallWithDoor.openings[0].at_m).toBeCloseTo(2) // offset 0.5 * length 4
    expect(storey.rooms).toHaveLength(1)
    expect(storey.rooms[0].net_area_m2).toBeCloseTo(12)
  })

  it('stacks storey elevation from prior floors\' heights', () => {
    const f0 = emptyFloorGraph('PB'); f0.height_m = 3
    const f1 = emptyFloorGraph('PA'); f1.height_m = 2.6
    const model = { slab_m: 0.15, activeFloor: 0, floors: [f0, f1] }
    const json = toGeometryJson(model)
    expect(json.storeys[0].elevation_m).toBe(0)
    expect(json.storeys[1].elevation_m).toBeCloseTo(3)
  })
})
