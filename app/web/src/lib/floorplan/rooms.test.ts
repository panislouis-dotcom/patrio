import { describe, it, expect } from 'vitest'
import { emptyFloorGraph, GHOST_THICKNESS_M } from './types'
import { addVertex, addEdge, splitEdgeAtVertex } from './graph'
import { traceFaces, roomAreas, roomLabels, exteriorEdgeIds, roomConnections, roomPolygons } from './rooms'
import { pointInPolygon } from './geometry'

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

/** Mismo shape que el bug real (Locales Salón Escobedo, Planta Alta, diagnóstico de
 * docs/plans): dos vértices de grado 1 unidos por un vértice intermedio de grado 2, vía
 * dos aristas — un subgrafo colgante, desconectado de cualquier otra estructura del
 * piso. traceFaces rebota en cada punta de grado 1 y traza una "cara" de área 0 que no
 * es un cuarto real. */
function danglingSpur(f: ReturnType<typeof emptyFloorGraph>) {
  const p1 = addVertex(f, 20, 20), mid = addVertex(f, 21, 20), p2 = addVertex(f, 21, 21)
  const eWithWindow = addEdge(f, p1, mid, 0.10)
  addEdge(f, mid, p2, 0.10)
  return { p1, mid, p2, eWithWindow }
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

  it('excludes the degenerate zero-area face produced by a dangling, disconnected spur', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    danglingSpur(f)
    const faces = traceFaces(f)
    // Solo las 2 caras reales del rectángulo — nada del spur colgante.
    expect(faces).toHaveLength(2)
    faces.forEach(face => expect(Math.abs(face.area)).toBeGreaterThan(1))
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

  it('does not report a phantom room for a dangling, disconnected spur', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    danglingSpur(f)
    const rooms = roomAreas(f)
    expect(rooms).toHaveLength(1) // solo el rectángulo real, nada del spur
    expect(rooms[0].area).toBeCloseTo(12)
  })

  it('propaga el type del Room que cae dentro del cuarto', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    f.rooms.push({ name: 'Escalera', cx: 2, cy: 1.5, type: 'escalera' })
    expect(roomAreas(f)[0].type).toBe('escalera')
  })

  it('type queda undefined cuando el Room dentro del cuarto no lo trae', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    f.rooms.push({ name: 'Sala', cx: 2, cy: 1.5 })
    expect(roomAreas(f)[0].type).toBeUndefined()
  })

  // Bug real (Locales Salón Escobedo, escaleras de Planta Alta, 2026-08-16): un cuarto NO
  // convexo (en L/Z/U — el caso normal cuando un muro nuevo divide un cuarto sin dejarlo
  // rectangular) puede tener su centroide geométrico FUERA de su propio contorno. Antes,
  // roomAreas dibujaba/aceptaba clics justo en ese punto exterior — cualquier intento de
  // nombrar el cuarto ahí se perdía en silencio (el nombre nuevo nunca volvía a resolver
  // para ESE cuarto, porque roomInside exige que el punto esté DENTRO del polígono).
  it('el punto de anclaje de un cuarto NO convexo (forma de U) cae DENTRO de su polígono, no en su centroide geométrico', () => {
    const f = emptyFloorGraph('Test')
    // "Grapa"/U ancha: [0,0]-[6,0]-[6,4]-[4,4]-[4,1]-[2,1]-[2,4]-[0,4] — el centroide
    // geométrico real (3, 1.83) cae en la muesca cóncava de arriba, fuera del cuarto.
    const p00 = addVertex(f, 0, 0), p60 = addVertex(f, 6, 0), p64 = addVertex(f, 6, 4)
    const p44 = addVertex(f, 4, 4), p41 = addVertex(f, 4, 1), p21 = addVertex(f, 2, 1)
    const p24 = addVertex(f, 2, 4), p04 = addVertex(f, 0, 4)
    addEdge(f, p00, p60, 0.15); addEdge(f, p60, p64, 0.15); addEdge(f, p64, p44, 0.15)
    addEdge(f, p44, p41, 0.15); addEdge(f, p41, p21, 0.15); addEdge(f, p21, p24, 0.15)
    addEdge(f, p24, p04, 0.15); addEdge(f, p04, p00, 0.15)

    const rooms = roomAreas(f)
    expect(rooms).toHaveLength(1)
    // El centroide geométrico puro sería (3, 1.83) — verificado fuera del polígono. El
    // punto de anclaje real debe caer DENTRO, sin importar el valor exacto.
    const poly = roomPolygons(f)[0].vertices.map(v => [v.x, v.y] as [number, number])
    expect(pointInPolygon(rooms[0].cx, rooms[0].cy, poly)).toBe(true)
  })

  it('nombrar un cuarto en forma de U en su punto de anclaje SÍ se resuelve — antes se perdía en silencio', () => {
    const f = emptyFloorGraph('Test')
    const p00 = addVertex(f, 0, 0), p60 = addVertex(f, 6, 0), p64 = addVertex(f, 6, 4)
    const p44 = addVertex(f, 4, 4), p41 = addVertex(f, 4, 1), p21 = addVertex(f, 2, 1)
    const p24 = addVertex(f, 2, 4), p04 = addVertex(f, 0, 4)
    addEdge(f, p00, p60, 0.15); addEdge(f, p60, p64, 0.15); addEdge(f, p64, p44, 0.15)
    addEdge(f, p44, p41, 0.15); addEdge(f, p41, p21, 0.15); addEdge(f, p21, p24, 0.15)
    addEdge(f, p24, p04, 0.15); addEdge(f, p04, p00, 0.15)

    // Mismo flujo que el editor: leer dónde el cuarto SIN nombre se dibujaría (su punto de
    // anclaje), y "escribir" un nombre justo ahí — exactamente lo que hace el usuario al
    // hacer clic sobre el label y teclear.
    const anchor = roomAreas(f)[0]
    f.rooms.push({ name: 'ESCALERAS', cx: anchor.cx, cy: anchor.cy })

    const renamed = roomAreas(f)
    expect(renamed).toHaveLength(1)
    expect(renamed[0].name).toBe('ESCALERAS')
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

  it('propaga type tanto para un cuarto cerrado como para un label libre', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    f.rooms.push({ name: 'Escalera', cx: 2, cy: 1.5, type: 'escalera' })
    f.rooms.push({ name: 'Azotea', cx: 20, cy: 20, type: 'azotea' }) // libre, fuera del rectángulo
    const labels = roomLabels(f)
    expect(labels.find(l => l.name === 'Escalera')?.type).toBe('escalera')
    expect(labels.find(l => l.name === 'Azotea')?.type).toBe('azotea')
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

  it('a window on a dangling, disconnected spur produces no connection (not two "cuarto sin nombre")', () => {
    // Regresión del bug real (Locales Salón Escobedo, Planta Alta): antes del fix de
    // traceFaces, una ventana sobre esta geometría colgante resolvía sus dos lados a la
    // MISMA cara degenerada, produciendo una conexión "sin nombre" con "sin nombre" — un
    // dato sin sentido en el prompt de render. Con la cara degenerada ya filtrada en la
    // fuente, el código defensivo existente de roomConnections (dart sin cara -> se omite)
    // la deja fuera por completo.
    const f = emptyFloorGraph('Test')
    dividedRooms(f)
    const { eWithWindow } = danglingSpur(f)
    f.edges[eWithWindow].openings.push({ kind: 'window', offset: 0.3, width: 0.9 })
    const conns = roomConnections(f)
    expect(conns).toHaveLength(0)
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

  it('el guard de faceA/faceB satisface el narrowing de TS aunque nunca se alcance en un grafo bien formado', () => {
    // Una fantasma con opening es imposible por construcción (Task 7 la rechaza en el
    // reducer). Y este caso —un opening sobre un límite abierto (no cerrado)— TAMPOCO
    // dispara la rama `!faceA || !faceB`: quitando el guard temporalmente y corriendo
    // toda la suite (revisión de código previa) confirmó que sigue pasando sin tronar,
    // porque `traceFaces` siempre resuelve una cara para cada dart, cerrado o no. El
    // guard existe solo para que TypeScript acepte el `T | undefined` de `Map.get`, no
    // porque haya un `FloorGraph` real que lo alcance. Este test se queda igual (cobertura
    // barata y sin daño de que un límite abierto no truena), solo con el nombre corregido.
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3)
    const e1 = addEdge(f, a, b, 0.15)
    addEdge(f, b, c, 0.15) // sin arista de cierre de vuelta a "a"
    f.edges[e1].openings.push({ kind: 'window', offset: 0.5, width: 1.0 })
    expect(() => roomConnections(f)).not.toThrow()
  })
})

describe('roomPolygons', () => {
  it('returns the closed vertex list of a plain rectangular room, matching its known bounding box', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    f.rooms.push({ name: 'Sala', cx: 2, cy: 1.5 })
    const polys = roomPolygons(f)
    expect(polys).toHaveLength(1)
    expect(polys[0].name).toBe('Sala')
    expect(polys[0].vertices).toHaveLength(4)
    const xs = polys[0].vertices.map(v => v.x), ys = polys[0].vertices.map(v => v.y)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(3)
  })

  it('propaga el type del Room que cae dentro del cuarto', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    f.rooms.push({ name: 'Baño', cx: 2, cy: 1.5, type: 'bano' })
    expect(roomPolygons(f)[0].type).toBe('bano')
  })

  it('returns more than 4 vertices for an L-shaped room (not reducible to a simple bounding box)', () => {
    const f = emptyFloorGraph('Test')
    // L: un rectángulo de 4x3 con la esquina superior derecha (2x1) recortada.
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 2)
    const d = addVertex(f, 2, 2), e = addVertex(f, 2, 3), g = addVertex(f, 0, 3)
    addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15)
    addEdge(f, d, e, 0.15); addEdge(f, e, g, 0.15); addEdge(f, g, a, 0.15)
    f.rooms.push({ name: 'Sala en L', cx: 1, cy: 1 })
    const polys = roomPolygons(f)
    expect(polys).toHaveLength(1)
    expect(polys[0].name).toBe('Sala en L')
    expect(polys[0].vertices.length).toBeGreaterThan(4)
  })

  it('a name dropped outside any enclosed room yields no polygon entry for it (mirrors roomAreas/roomLabels)', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    f.rooms.push({ name: 'Jardín', cx: 20, cy: 20 })
    const polys = roomPolygons(f)
    expect(polys).toHaveLength(1)
    expect(polys[0].name).toBe('')
  })
})
