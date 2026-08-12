import { describe, it, expect } from 'vitest'
import { emptyFloorGraph, type Fixture } from './types'
import { addVertex, addEdge, splitEdgeAtVertex } from './graph'
import { planFacts } from './planFacts'

function rectangle(f: ReturnType<typeof emptyFloorGraph>, x0: number, y0: number, x1: number, y1: number) {
  const a = addVertex(f, x0, y0), b = addVertex(f, x1, y0), c = addVertex(f, x1, y1), d = addVertex(f, x0, y1)
  addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
}

/** Rectángulo de 6x4 dividido a la mitad (x=3) por un muro interior — misma forma que
 * `dividedRooms` de rooms.test.ts, reusada aquí para probar las oraciones de conectividad
 * que planFacts arma sobre `roomConnections`. `nameLeft`/`nameRight` en '' deja ese cuarto
 * SIN punto de nombre (cuarto cerrado pero sin etiqueta) — el caso "sin nombre" del task.
 */
function dividedRooms(f: ReturnType<typeof emptyFloorGraph>, nameLeft: string, nameRight: string) {
  const a = addVertex(f, 0, 0), b = addVertex(f, 6, 0), c = addVertex(f, 6, 4), d = addVertex(f, 0, 4)
  const eBottom = addEdge(f, a, b, 0.15)
  addEdge(f, b, c, 0.15)
  const eTop = addEdge(f, c, d, 0.15)
  addEdge(f, d, a, 0.15)
  const botMid = addVertex(f, 3, 0)
  const topMid = addVertex(f, 3, 4)
  splitEdgeAtVertex(f, eBottom, botMid)
  splitEdgeAtVertex(f, eTop, topMid)
  const divider = addEdge(f, botMid, topMid, 0.10)
  if (nameLeft) f.rooms.push({ name: nameLeft, cx: 1.5, cy: 2 })
  if (nameRight) f.rooms.push({ name: nameRight, cx: 4.5, cy: 2 })
  return { divider, eBottomLeft: eBottom }
}

describe('planFacts', () => {
  it('reports both named rooms with their real area, the bounding box, and the fixture with its real size', () => {
    const f = emptyFloorGraph('Test')
    // Dos cuartos cerrados de 4x3 (=12 m²) uno junto al otro: bounding box 8x3.
    rectangle(f, 0, 0, 4, 3)
    const a2 = addVertex(f, 4, 0), b2 = addVertex(f, 8, 0), c2 = addVertex(f, 8, 3), d2 = addVertex(f, 4, 3)
    addEdge(f, a2, b2, 0.15); addEdge(f, b2, c2, 0.15); addEdge(f, c2, d2, 0.15); addEdge(f, d2, a2, 0.15)
    f.rooms.push({ name: 'Sala', cx: 2, cy: 1.5 }, { name: 'Cocina', cx: 6, cy: 1.5 })
    const fx: Fixture = { id: 'fx1', kind: 'cama_queen', x: 2, y: 1.5, rot: 0, w_m: 1.6, h_m: 2.0 }
    f.fixtures = [fx]

    const text = planFacts(f)

    expect(text).toContain('Sala')
    expect(text).toContain('12.00 m²')
    expect(text).toContain('Cocina')
    // La cocina también mide 12 m² (4x3) — se contrasta contra la cadena exacta para no
    // colarse con la coincidencia de "Sala".
    const cocinaIdx = text.indexOf('Cocina')
    expect(text.slice(cocinaIdx, cocinaIdx + 30)).toContain('12.00 m²')
    expect(text).toContain('Cama queen')
    expect(text).toContain('1.60')
    expect(text).toContain('2.00')
  })

  it('states a free-floating labeled room (no closed polygon) is unmeasured, never null or NaN', () => {
    const f = emptyFloorGraph('Test')
    // Una L abierta: no hay cara cerrada, así que roomLabels da area: null para 'Terraza'.
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3)
    addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15)
    f.rooms.push({ name: 'Terraza', cx: 2, cy: 1.5 })

    const text = planFacts(f)

    expect(text).toContain('Terraza')
    expect(text).not.toMatch(/null/i)
    expect(text).not.toContain('NaN')
    expect(text).not.toContain('undefined')
  })

  it('produces a minimal valid string for an empty floor — no NaN/undefined anywhere', () => {
    const f = emptyFloorGraph('Test')

    const text = planFacts(f)

    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(0)
    expect(text).not.toMatch(/nan/i)
    expect(text).not.toMatch(/undefined/i)
    expect(text).not.toMatch(/null/i)
  })

  it('uses the fixture\'s own stored w_m/h_m, not the catalog default, when it was resized after placing it', () => {
    const f = emptyFloorGraph('Test')
    // El default de catálogo para 'silla' es 0.45x0.45 (types.ts) — este mueble se
    // redimensionó después de colocarse, y el prompt tiene que reflejar la medida real.
    const fx: Fixture = { id: 'fx1', kind: 'silla', x: 1, y: 1, rot: 0, w_m: 1.10, h_m: 0.77 }
    f.fixtures = [fx]

    const text = planFacts(f)

    expect(text).toContain('1.10')
    expect(text).toContain('0.77')
    expect(text).not.toContain('0.45')
  })

  it('reports the overall floor height to 2 decimals with explicit units', () => {
    const f = emptyFloorGraph('Test')
    f.height_m = 2.6
    const text = planFacts(f)
    expect(text).toContain('2.60 m')
  })

  it('states which two rooms a door connects, by name', () => {
    const f = emptyFloorGraph('Test')
    const { divider } = dividedRooms(f, 'Cocina', 'Sala')
    f.edges[divider].openings.push({ kind: 'door', offset: 0.5, width: 0.9 })

    const text = planFacts(f)

    expect(text).toContain('Cocina conecta por puerta con Sala.')
  })

  it('states a room with a window to the exterior', () => {
    const f = emptyFloorGraph('Test')
    const { eBottomLeft } = dividedRooms(f, 'Cocina', 'Sala')
    f.edges[eBottomLeft].openings.push({ kind: 'window', offset: 0.5, width: 1.2 })

    const text = planFacts(f)

    expect(text).toContain('Cocina tiene ventana hacia el exterior.')
  })

  it('falls back gracefully when a door connects a named room to a closed but UNLABELED room', () => {
    const f = emptyFloorGraph('Test')
    // El cuarto izquierdo se queda sin punto de nombre en f.rooms — cerrado, pero sin
    // etiqueta. roomConnections le resuelve name: '' (rooms.ts::roomNameInside), y
    // planFacts no debe imprimir eso crudo ("conecta por puerta con .").
    const { divider } = dividedRooms(f, '', 'Sala')
    f.edges[divider].openings.push({ kind: 'door', offset: 0.5, width: 0.9 })

    const text = planFacts(f)

    expect(text).toContain('un cuarto sin nombre conecta por puerta con Sala.')
    expect(text).not.toContain('con .')
    expect(text).not.toMatch(/undefined/i)
    expect(text).not.toMatch(/null/i)
  })
})
