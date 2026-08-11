import { describe, it, expect } from 'vitest'
import { emptyFloorGraph, GHOST_THICKNESS_M, type Fixture } from './types'
import { addVertex, addEdge } from './graph'
import { floorToSvgString } from './planImage'

describe('floorToSvgString', () => {
  it('draws a line per wall and a text per named room', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3), d = addVertex(f, 0, 3)
    addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
    f.rooms.push({ name: 'Sala', cx: 2, cy: 1.5 })
    const svg = floorToSvgString(f)
    expect(svg.startsWith('<svg')).toBe(true)
    expect((svg.match(/<line /g) || []).length).toBe(4)   // one per wall
    expect(svg).toContain('>Sala<')                        // the room name
  })

  it('escapes XML in room names', () => {
    const f = emptyFloorGraph('Test')
    f.rooms.push({ name: 'A & B', cx: 0.5, cy: 0.5 })
    expect(floorToSvgString(f)).toContain('A &amp; B')
  })

  it('draws the real walls but never a ghost — the render model would build a wall where there is none', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3), d = addVertex(f, 0, 3)
    addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
    addEdge(f, a, c, GHOST_THICKNESS_M, 'ghost')
    const svg = floorToSvgString(f)
    expect((svg.match(/<line /g) || []).length).toBe(4)   // los 4 muros reales, la fantasma no
  })

  it('draws a rect sized (in px, at the module scale) to the fixture w_m/h_m and positioned at its x/y', () => {
    const f = emptyFloorGraph('Test')
    // Sin vértices: minx=maxx=miny=maxy vienen solo del pad por defecto (1m) y del piso
    // mínimo de 1m que floorToSvgString usa cuando el plano está vacío — así que
    // minx=-1, maxx=2, miny=-1, maxy=2 a escala 100px/m (los defaults del módulo).
    const fx: Fixture = { id: 'fx1', kind: 'cama_queen', x: 2, y: 1, rot: 0, w_m: 1.6, h_m: 2.0 }
    f.fixtures = [fx]
    const svg = floorToSvgString(f)
    const m = svg.match(/<rect data-fixture="fx1"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"[^>]*transform="translate\(([\d.-]+) ([\d.-]+)\) rotate\(([\d.-]+)\)"/)
    expect(m).not.toBeNull()
    const [, w, h, cx, cy, rot] = m!
    expect(Number(w)).toBeCloseTo(1.6 * 100, 5)   // w_m * scale
    expect(Number(h)).toBeCloseTo(2.0 * 100, 5)   // h_m * scale
    expect(Number(cx)).toBeCloseTo((2 - -1) * 100, 5)   // px(x) = (x - minx) * scale
    expect(Number(cy)).toBeCloseTo((2 - 1) * 100, 5)    // py(y) = (maxy - y) * scale
    expect(Number(rot)).toBeCloseTo(-0, 5)
  })

  it('rotates with the sign convention of this module (py flips Y, same as the editor canvas), not the raw world angle', () => {
    const f = emptyFloorGraph('Test')
    const fx: Fixture = { id: 'fx2', kind: 'silla', x: 0, y: 0, rot: 90, w_m: 0.45, h_m: 0.45 }
    f.fixtures = [fx]
    const svg = floorToSvgString(f)
    expect(svg).toContain('rotate(-90)')
  })

  it("labels the fixture with its catalog name, so the render model knows it's a queen bed and not a bare rect", () => {
    const f = emptyFloorGraph('Test')
    const fx: Fixture = { id: 'fx3', kind: 'cama_queen', x: 2, y: 1, rot: 0, w_m: 1.6, h_m: 2.0 }
    f.fixtures = [fx]
    const svg = floorToSvgString(f)
    expect(svg).toContain('Cama queen')
  })

  it('does not crash when fixtures is absent — pre-Task-10 blobs never have this key', () => {
    const f = emptyFloorGraph('Test')
    delete (f as { fixtures?: Fixture[] }).fixtures
    expect(() => floorToSvgString(f)).not.toThrow()
    expect(floorToSvgString(f)).not.toContain('data-fixture')
  })
})
