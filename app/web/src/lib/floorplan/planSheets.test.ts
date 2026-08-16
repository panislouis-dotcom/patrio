import { describe, it, expect } from 'vitest'
import type { FloorGraph } from './types'
import { planSheets } from './planSheets'

function rect(w: number, h: number, name = 'Recámara'): FloorGraph {
  const pts = [[0, 0], [w, 0], [w, h], [0, h]]
  const vertices = Object.fromEntries(pts.map(([x, y], i) => [`v${i}`, { id: `v${i}`, x, y }]))
  const edges = Object.fromEntries(pts.map((_, i) => [`e${i}`, {
    id: `e${i}`, v1: `v${i}`, v2: `v${(i + 1) % 4}`, thickness: 0.15, openings: [],
  }]))
  return {
    id: 'f1', name: 'Planta Baja', height_m: 2.6, extWall_m: 0.15, intWall_m: 0.10,
    vertices, edges, rooms: [{ name, cx: w / 2, cy: h / 2 }], fixtures: [], manualDimensions: [],
  }
}

const floor = (w: number, h: number, id: string) => ({ ...rect(w, h), id })
const blank = (id: string) => ({ ...rect(1, 1), id, vertices: {}, edges: {}, rooms: [] })
const v2 = (f: any) => ({ schemaVersion: 2, slab_m: 0.15, activeFloor: 0, floors: [f] })
const v3 = (o: any[], p: any[] | null) => ({
  schemaVersion: 3,
  variants: {
    original: { slab_m: 0.15, activeFloor: 0, floors: o },
    planned: p === null ? null : { slab_m: 0.15, activeFloor: 0, floors: p },
  },
})

describe('planSheets', () => {
  it('un blob v2 da una hoja original', () => {
    const s = planSheets(v2(floor(4.2, 3.1, 'f1')))
    expect(s).toHaveLength(1)
    expect(s[0].variant).toBe('original')
    expect(s[0].svg).toContain('m²')
  })

  it('un blob v2 SIN ids de piso no revienta y produce hoja', () => {
    // migrateGeometry rellena el id con crypto.randomUUID(). Ese id efímero jamás
    // empatará con el floor_id de un render — y así debe ser.
    const { id, ...noId } = floor(4.2, 3.1, 'f1') as any
    const s = planSheets(v2(noId))
    expect(s).toHaveLength(1)
    expect(s[0].floorId).toBeTruthy()
  })

  it('v3 con las dos variantes da dos hojas con el MISMO floorId', () => {
    const s = planSheets(v3([floor(4.2, 3.1, 'abc')], [floor(5.0, 3.1, 'abc')]))
    expect(s.map(x => x.variant)).toEqual(['original', 'planned'])
    expect(s[0].floorId).toBe('abc')
    expect(s[1].floorId).toBe('abc')
  })

  it('las dos variantes de un linaje comparten escala', () => {
    const s = planSheets(v3([floor(4.2, 3.1, 'abc')], [floor(5.0, 3.1, 'abc')]))
    const wall = (svg: string) => parseFloat(svg.match(/<line[^>]*stroke-width="([\d.]+)"/)![1])
    expect(wall(s[1].svg)).toBeCloseTo(wall(s[0].svg), 5)
  })

  it('omite un piso planeado en blanco — un lienzo vacío no es propuesta', () => {
    const s = planSheets(v3([floor(4.2, 3.1, 'abc')], [blank('nuevo')]))
    expect(s).toHaveLength(1)
    expect(s[0].variant).toBe('original')
  })

  it('un planeado clonado sin editar produce el MISMO svg', () => {
    const s = planSheets(v3([floor(4.2, 3.1, 'abc')], [floor(4.2, 3.1, 'abc')]))
    expect(s[1].svg).toBe(s[0].svg)
  })

  it('basura, v1 y vacío dan []', () => {
    expect(planSheets({ schemaVersion: 1 })).toEqual([])
    expect(planSheets({})).toEqual([])
    expect(planSheets(null)).toEqual([])
    expect(planSheets('nope')).toEqual([])
  })
})
