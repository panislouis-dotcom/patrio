import { describe, it, expect } from 'vitest'
import { emptyFloorGraph, GHOST_THICKNESS_M } from './types'
import { addVertex, addEdge, splitEdgeAtVertex } from './graph'
import { traceFaces, roomAreas, roomLabels, exteriorEdgeIds, roomConnections } from './rooms'

/** Rectángulo de 6x4 dividido a la mitad (x=3) por un muro interior, con Cocina a la
 * izquierda y Sala a la derecha — la misma forma que 'reports two rooms...' de roomAreas,
 * reutilizada por todos los tests de roomConnections que necesitan 2 cuartos nombrados. */
function dividedRooms(f: ReturnType<typeof emptyFloorGraph>) {
  const a = addVertex(f, 0, 0), b = addVertex(f, 6, 0), c = addVertex(f, 6, 4), d = addVertex(f, 0, 4)
  const eBottom = addEdge(f, a, b, 0.15)
  addEdge(f, b, c, 0.15)
  const eTop = addEdge(f, c, d, 0.15)
  addEdge(f, d, a, 0.15)
  const botMid = addVertex(f, 3, 0)
  const topMid = addVertex(f, 3, 4)
  const eBottomLeft = eBottom // a -> botMid tras el split, queda con el id original
  splitEdgeAtVertex(f, eBottom, botMid)
  splitEdgeAtVertex(f, eTop, topMid)
  const divider = addEdge(f, botMid, topMid, 0.10)
  f.rooms.push({ name: 'Cocina', cx: 1.5, cy: 2 }, { name: 'Sala', cx: 4.5, cy: 2 })
  return { eBottomLeft, divider }
}

function rectangle(f: ReturnType<typeof emptyFloorGraph>, x0: number, y0: number, x1: number, y1: number) {
  const a = addVertex(f, x0, y0), b = addVertex(f, x1, y0), c = addVertex(f, x1, y1), d = addVertex(f, x0, y1)
  addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
  return { a, b, c, d }
}

describe('traceFaces', () => {
  it('traces exactly 2 faces for a closed rectangle: the interior and the outer face', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    const faces = traceFaces(f)
    expect(faces).toHaveLength(2)
    const areas = faces.map(fc => Math.abs(fc.area)).sort((x, y) => x - y)
    expect(areas[0]).toBeCloseTo(12) // the bounded interior face
    expect(areas[1]).toBeCloseTo(12) // the outer face traces the same boundary, opposite winding
  })
})

describe('roomAreas', () => {
  it('reports one room for a plain closed rectangle', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    const rooms = roomAreas(f)
    expect(rooms).toHaveLength(1)
    expect(rooms[0].area).toBeCloseTo(12)
    expect(rooms[0].cx).toBeCloseTo(2)
    expect(rooms[0].cy).toBeCloseTo(1.5)
  })

  it('reports two rooms when an interior wall fully divides the rectangle', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 6, 0), c = addVertex(f, 6, 4), d = addVertex(f, 0, 4)
    const eBottom = addEdge(f, a, b, 0.15)          // y=0 edge
    addEdge(f, b, c, 0.15)                           // x=6 edge
    const eTop = addEdge(f, c, d, 0.15)             // y=4 edge
    addEdge(f, d, a, 0.15)                           // x=0 edge
    const botMid = addVertex(f, 3, 0)
    const topMid = addVertex(f, 3, 4)
    splitEdgeAtVertex(f, eBottom, botMid)
    splitEdgeAtVertex(f, eTop, topMid)
    addEdge(f, botMid, topMid, 0.10)
    const rooms = roomAreas(f)
    expect(rooms).toHaveLength(2)
    expect(rooms[0].area + rooms[1].area).toBeCloseTo(24)
  })

  it('gives no room when the boundary has a gap (not a closed cycle)', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3)
    addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15) // no closing edge back to a
    expect(roomAreas(f)).toHaveLength(0)
  })
})

describe('roomLabels', () => {
  it('an enclosed named room is one label carrying its net area', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    f.rooms.push({ name: 'Sala', cx: 2, cy: 1.5 })
    const labels = roomLabels(f)
    expect(labels).toHaveLength(1)
    expect(labels[0].name).toBe('Sala')
    expect(labels[0].area).toBeCloseTo(12)
  })

  it('a named point on an open (un-enclosed) space is a name-only label, area null', () => {
    const f = emptyFloorGraph('Test')
    // an open L of walls: no closed face
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3)
    addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15)
    f.rooms.push({ name: 'Terraza', cx: 2, cy: 1.5 })
    const labels = roomLabels(f)
    expect(labels).toHaveLength(1)
    expect(labels[0].name).toBe('Terraza')
    expect(labels[0].area).toBeNull()
  })

  it('a name dropped outside a room does not bleed onto that enclosed room', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)                 // enclosed room, no name of its own
    f.rooms.push({ name: 'Jardín', cx: 20, cy: 20 })  // far outside
    const labels = roomLabels(f)
    // the enclosed room stays un-named; the far point is its own free label
    const enclosed = labels.find(l => l.area != null)!
    expect(enclosed.name).toBe('')
    expect(labels.some(l => l.name === 'Jardín' && l.area === null)).toBe(true)
  })

  it('does not draw a named enclosed room twice', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    f.rooms.push({ name: 'Sala', cx: 2, cy: 1.5 })
    expect(roomLabels(f).filter(l => l.name === 'Sala')).toHaveLength(1)
  })
})

describe('aristas fantasma (kind ghost)', () => {
  it('una división fantasma parte el rectángulo en dos cuartos con nombre y área propios', () => {
    // Espejo del test del muro divisor: la fantasma divide igual porque traceFaces es
    // genérico sobre aristas — ESTE es el feature test de cocina-sala sin puerta.
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 6, 0), c = addVertex(f, 6, 4), d = addVertex(f, 0, 4)
    const eBottom = addEdge(f, a, b, 0.15)
    addEdge(f, b, c, 0.15)
    const eTop = addEdge(f, c, d, 0.15)
    addEdge(f, d, a, 0.15)
    const botMid = addVertex(f, 3, 0)
    const topMid = addVertex(f, 3, 4)
    splitEdgeAtVertex(f, eBottom, botMid)
    splitEdgeAtVertex(f, eTop, topMid)
    addEdge(f, botMid, topMid, GHOST_THICKNESS_M, 'ghost')
    f.rooms.push({ name: 'Cocina', cx: 1.5, cy: 2 }, { name: 'Sala', cx: 4.5, cy: 2 })
    const rooms = roomAreas(f)
    expect(rooms).toHaveLength(2)
    expect(rooms.map(r => r.name).sort()).toEqual(['Cocina', 'Sala'])
    rooms.forEach(r => expect(r.area).toBeCloseTo(12))
  })

  it('exteriorEdgeIds nunca incluye una fantasma, ni cuando cae en el contorno exterior', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3), d = addVertex(f, 0, 3)
    const ghostSide = addEdge(f, a, b, GHOST_THICKNESS_M, 'ghost')
    addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
    const ext = exteriorEdgeIds(f)
    expect(ext.has(ghostSide)).toBe(false)
    expect(ext.size).toBe(3)
  })
})

describe('exteriorEdgeIds', () => {
  it('marks every edge of a plain rectangle as exterior', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    const ext = exteriorEdgeIds(f)
    expect(ext.size).toBe(4)
    expect(Object.keys(f.edges).every(id => ext.has(id))).toBe(true)
  })

  it('does not mark an interior divider as exterior', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 6, 4)
    const top = addVertex(f, 3, 0), bot = addVertex(f, 3, 4)
    const divider = addEdge(f, top, bot, 0.10)
    const ext = exteriorEdgeIds(f)
    expect(ext.has(divider)).toBe(false)
  })
})

describe('roomConnections', () => {
  it('a door between two named, closed rooms connects them by name', () => {
    const f = emptyFloorGraph('Test')
    const { divider } = dividedRooms(f)
    f.edges[divider].openings.push({ kind: 'door', offset: 0.5, width: 0.9 })
    const conns = roomConnections(f)
    expect(conns).toHaveLength(1)
    expect(conns[0].edgeId).toBe(divider)
    expect(conns[0].openingIndex).toBe(0)
    expect(conns[0].kind).toBe('door')
    // Orden roomA/roomB: determinista por v1/v2 de la arista divisoria (roomConnections la
    // define como "roomA = cara del dart que arranca en e.v1"), NO por el orden de
    // Object.values(f.edges) ni por una noción de izquierda/derecha visual — ver el
    // comentario de roomConnections en rooms.ts. Para esta geometría concreta (divider
    // creado como addEdge(f, botMid, topMid, ...), v1=botMid del lado de Cocina) el dart de
    // v1 cae en la cara de Cocina.
    expect(conns[0].roomA).toBe('Cocina')
    expect(conns[0].roomB).toBe('Sala')
  })

  it('a window on the exterior wall of a named room connects it to "exterior"', () => {
    const f = emptyFloorGraph('Test')
    const { eBottomLeft } = dividedRooms(f)
    f.edges[eBottomLeft].openings.push({ kind: 'window', offset: 0.5, width: 1.2 })
    const conns = roomConnections(f)
    expect(conns).toHaveLength(1)
    expect(conns[0].kind).toBe('window')
    expect(conns[0].roomA).toBe('Cocina')
    expect(conns[0].roomB).toBe('exterior')
  })

  it('an edge with a door AND a window produces two separate connections with correct openingIndex', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3), d = addVertex(f, 0, 3)
    addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15)
    const eLeft = addEdge(f, d, a, 0.15)
    f.rooms.push({ name: 'Sala', cx: 2, cy: 1.5 })
    // Se insertan dos huecos en la MISMA arista — caso raro pero válido, hay que manejarlo.
    f.edges[eLeft].openings.push({ kind: 'door', offset: 0.7, width: 0.9 })
    f.edges[eLeft].openings.push({ kind: 'window', offset: 0.2, width: 1.0 })
    const conns = roomConnections(f)
    expect(conns).toHaveLength(2)
    expect(conns[0]).toMatchObject({ edgeId: eLeft, openingIndex: 0, kind: 'door', roomA: 'exterior', roomB: 'Sala' })
    expect(conns[1]).toMatchObject({ edgeId: eLeft, openingIndex: 1, kind: 'window', roomA: 'exterior', roomB: 'Sala' })
  })

  it('an edge with no openings contributes zero connections', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    expect(roomConnections(f)).toHaveLength(0)
  })

  it('two rooms with no opening between them produce zero connections between them, even if one has its own window', () => {
    const f = emptyFloorGraph('Test')
    const { eBottomLeft } = dividedRooms(f)
    // El divisor se queda SIN opening: las 2 caras existen y tienen nombre, pero no hay
    // puerta que las conecte. Cocina además trae su propia ventana, para probar que la
    // ausencia de conexión entre cuartos no significa que el arreglo entero salga vacío.
    f.edges[eBottomLeft].openings.push({ kind: 'window', offset: 0.5, width: 1.2 })
    const conns = roomConnections(f)
    expect(conns.some(c => c.kind === 'door')).toBe(false)
    expect(conns).toHaveLength(1)
    expect(conns[0]).toMatchObject({ kind: 'window', roomA: 'Cocina', roomB: 'exterior' })
  })

  it('does not crash on an opening whose edge sits on an open (non-closed) boundary', () => {
    // Una fantasma con opening es imposible por construcción (Task 7 la rechaza en el
    // reducer), pero esta es la guarda defensiva real: una arista cuyo dart no resuelve a
    // ninguna cara (grafo no cerrado) no debe tronar, solo omitirse o degradar con calma.
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3)
    const e1 = addEdge(f, a, b, 0.15)
    addEdge(f, b, c, 0.15) // sin arista de cierre de vuelta a "a"
    f.edges[e1].openings.push({ kind: 'window', offset: 0.5, width: 1.0 })
    expect(() => roomConnections(f)).not.toThrow()
  })
})
