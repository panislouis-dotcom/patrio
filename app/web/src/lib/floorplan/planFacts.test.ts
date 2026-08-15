import { describe, it, expect } from 'vitest'
import { emptyFloorGraph, ROOM_TYPE_CATALOG, type Fixture } from './types'
import { addVertex, addEdge, splitEdgeAtVertex } from './graph'
import { planFacts, resolveRoomType } from './planFacts'

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

  // Bug real verificado (tercer mecanismo de "cuartos inventados"): un nombre puesto sobre
  // espacio abierto sin cara cerrada (el caso "Terraza" de rooms.ts) se listaba bajo
  // "Cuartos:" indistinguible de uno cerrado, salvo "área sin medir" — que un lector
  // descuidado (o un modelo de imagen siguiendo la instrucción "no agregues ni quites
  // cuartos ni paredes" de _PLAN_CLAUSE, app/api/renders.py) puede leer como "cuarto real
  // sin medida capturada", no como "esto no tiene ni un muro". El texto ahora lo marca
  // explícitamente como espacio abierto.
  it('marks a room with no closed polygon explicitly as OPEN SPACE, distinct from a real closed room', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3)
    addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15)
    f.rooms.push({ name: 'Terraza', cx: 2, cy: 1.5 })

    const text = planFacts(f)

    // 'Terraza' también infiere tipo: terraza (ROOM_TYPE_KEYWORDS) — la marca de espacio
    // abierto convive con esa anotación, no la reemplaza.
    expect(text).toContain('Terraza (espacio abierto, sin muros que lo cierren, tipo: terraza)')
    expect(text).not.toContain('área sin medir')
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

    // divider va de botMid=(3,0) a topMid=(3,4) → muro VERTICAL (Δy=4 domina Δx=0) de 4 m;
    // offset .5 → 2.00 m desde v1=botMid. v1.y=0 < v2.y=4 → v1 es el extremo "inferior"
    // (Task 26: la sentencia de conectividad ahora incluye la posición métrica de la puerta,
    // anclada a un extremo visualmente verificable en la imagen, no al v1/v2 interno).
    // Bug #2 (identidad del muro): el divider corre por x=3, el centro exacto del piso
    // (bbox x: 0–6) — ni cerca del borde izquierdo ni del derecho, así que se marca
    // "central" EXPLÍCITAMENTE en vez de fabricar un lado que no le corresponde (partición
    // interior típica).
    expect(text).toContain('Cocina conecta por puerta con Sala, a 2.00 m del extremo inferior del muro central (4.00 m).')
  })

  it('states a room with a window to the exterior', () => {
    const f = emptyFloorGraph('Test')
    const { eBottomLeft } = dividedRooms(f, 'Cocina', 'Sala')
    f.edges[eBottomLeft].openings.push({ kind: 'window', offset: 0.5, width: 1.2 })

    const text = planFacts(f)

    // eBottomLeft va de a=(0,0) a botMid=(3,0) tras el split → muro HORIZONTAL (Δx=3 domina
    // Δy=0) de 3 m; offset .5 → 1.50 m. v1.x=0 <= v2.x=3 → v1 es el extremo "izquierdo".
    // Bug #2: este muro corre por y=0, el borde inferior del piso (bbox y: 0–4) → lado
    // "inferior" del inmueble, largo real 3.00 m — el identificador que el bug pedía (antes
    // el texto nunca decía CUÁL muro, solo "del muro" a secas).
    expect(text).toContain('Cocina tiene ventana hacia el exterior, a 1.50 m del extremo izquierdo del muro inferior (3.00 m).')
  })

  it('states a room with a door to the exterior — the most common door in any home (front/patio door)', () => {
    const f = emptyFloorGraph('Test')
    const { eBottomLeft } = dividedRooms(f, 'Cocina', 'Sala')
    f.edges[eBottomLeft].openings.push({ kind: 'door', offset: 0.5, width: 0.9 })

    const text = planFacts(f)

    // Mismo muro horizontal que el test anterior (eBottomLeft, a→botMid, 3 m, extremo v1
    // izquierdo, lado inferior del inmueble).
    expect(text).toContain('Cocina tiene puerta hacia el exterior, a 1.50 m del extremo izquierdo del muro inferior (3.00 m).')
    // Nunca la frase al revés/rota: 'exterior' no es un cuarto que "conecte por puerta"
    // con otro — ese texto sale de tratar la puerta exterior como la plantilla genérica.
    expect(text).not.toContain('exterior conecta por puerta')
    expect(text).not.toContain('conecta por puerta con exterior')
  })

  it('normalizes an exterior door the same way regardless of which side (roomA/roomB) resolves to \'exterior\'', () => {
    // Misma geometría que el test "door AND window" de rooms.test.ts: la arista v1=d cae
    // del lado cuyo dart resuelve a la cara EXTERIOR en roomA (no roomB, al revés del test
    // de arriba) — el reporte original del bug ("exterior conecta por puerta con Sala")
    // viene exactamente de este ordenamiento.
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3), d = addVertex(f, 0, 3)
    addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15)
    const eLeft = addEdge(f, d, a, 0.15)
    f.rooms.push({ name: 'Sala', cx: 2, cy: 1.5 })
    f.edges[eLeft].openings.push({ kind: 'door', offset: 0.7, width: 0.9 })

    const text = planFacts(f)

    // eLeft va de d=(0,3) a a=(0,0) → muro VERTICAL (Δy=3 domina Δx=0) de 3 m; offset .7 →
    // 2.10 m desde v1=d. v1.y=3 >= v2.y=0 → v1 es el extremo "superior". Bug #2: eLeft corre
    // por x=0, el borde izquierdo del piso (bbox x: 0–4) → lado "izquierdo" del inmueble.
    expect(text).toContain('Sala tiene puerta hacia el exterior, a 2.10 m del extremo superior del muro izquierdo (3.00 m).')
    expect(text).not.toContain('exterior conecta por puerta')
  })

  it('states two named interior rooms sharing an interior window (no wall-type restriction on window placement)', () => {
    const f = emptyFloorGraph('Test')
    const { divider } = dividedRooms(f, 'Cocina', 'Sala')
    f.edges[divider].openings.push({ kind: 'window', offset: 0.5, width: 1.0 })

    const text = planFacts(f)

    // Mismo divider vertical que el primer test de este bloque (botMid→topMid, 4 m, extremo
    // v1 inferior, lado "central" del inmueble).
    expect(text).toContain('Cocina y Sala comparten una ventana interior, a 2.00 m del extremo inferior del muro central (4.00 m).')
  })

  it('falls back gracefully when a door connects a named room to a closed but UNLABELED room', () => {
    const f = emptyFloorGraph('Test')
    // El cuarto izquierdo se queda sin punto de nombre en f.rooms — cerrado, pero sin
    // etiqueta. roomConnections le resuelve name: '' (rooms.ts::roomNameInside), y
    // planFacts no debe imprimir eso crudo ("conecta por puerta con .").
    const { divider } = dividedRooms(f, '', 'Sala')
    f.edges[divider].openings.push({ kind: 'door', offset: 0.5, width: 0.9 })

    const text = planFacts(f)

    // Mismo divider vertical (botMid→topMid, 4 m, extremo v1 inferior, lado central).
    expect(text).toContain('un cuarto sin nombre conecta por puerta con Sala, a 2.00 m del extremo inferior del muro central (4.00 m).')
    expect(text).not.toContain('con .')
    expect(text).not.toMatch(/undefined/i)
    expect(text).not.toMatch(/null/i)
  })

  // Task 26 — posición métrica de puertas/ventanas a lo largo del muro + ángulos de
  // esquina no rectos. Ver docs/plans/2026-08-12-fidelidad-dimensional-renders.md: el
  // usuario, tras ver un render real, notó que las puertas no salían "en el lugar
  // correcto" — planFacts ya decía QUÉ cuartos conecta una puerta, pero no DÓNDE a lo
  // largo del muro.
  describe('posición de aberturas y ángulos de esquina', () => {
    it('a door at a known offset on a wall of known length reports the correct metric distance', () => {
      const f = emptyFloorGraph('Test')
      const a = addVertex(f, 0, 0), b = addVertex(f, 5, 0), c = addVertex(f, 5, 3), d = addVertex(f, 0, 3)
      const eBottom = addEdge(f, a, b, 0.15)
      addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
      f.rooms.push({ name: 'Recámara', cx: 2.5, cy: 1.5 })
      f.edges[eBottom].openings.push({ kind: 'door', offset: 0.4, width: 0.9 })

      const text = planFacts(f)

      // Muro HORIZONTAL de a=(0,0) a b=(5,0): 5 m de largo, offset .4 → 0.4*5 = 2.00 m
      // desde v1=a. v1.x=0 <= v2.x=5 → v1 es el extremo "izquierdo" (verificable en la
      // imagen: a queda a la izquierda de b en el PNG rasterizado por planImage.ts). Bug #2:
      // este muro corre por y=0, el borde inferior del piso (bbox y: 0–3) → lado "inferior"
      // del inmueble.
      expect(text).toContain('Recámara tiene puerta hacia el exterior, a 2.00 m del extremo izquierdo del muro inferior (5.00 m).')
    })

    it('two openings on the SAME wall each report their own independent offset off the same wall length', () => {
      // Escenario realista: un muro exterior con una ventana Y una puerta (p.ej. cochera
      // con puerta peatonal junto a una ventana). Ambas comparten muro/longitud pero deben
      // salir con SU PROPIA distancia — no la del otro opening, ni una mezclada.
      const f = emptyFloorGraph('Test')
      const a = addVertex(f, 0, 0), b = addVertex(f, 6, 0), c = addVertex(f, 6, 3), d = addVertex(f, 0, 3)
      const eBottom = addEdge(f, a, b, 0.15)
      addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
      f.rooms.push({ name: 'Cochera', cx: 3, cy: 1.5 })
      f.edges[eBottom].openings.push(
        { kind: 'door', offset: 0.25, width: 0.9 },
        { kind: 'window', offset: 0.75, width: 1.2 },
      )

      const text = planFacts(f)

      // Muro de 6 m, v1=a=(0,0), extremo izquierdo (horizontal, v1.x <= v2.x), lado
      // "inferior" del inmueble (corre por y=0, bbox y: 0–3).
      // Puerta: offset .25 → 1.50 m. Ventana: offset .75 → 4.50 m. Distintas entre sí,
      // cada una calculada sobre la MISMA longitud de muro (6 m) — y ambas identifican el
      // MISMO muro (lado inferior, 6.00 m), correcto: es una sola pared con 2 aberturas.
      expect(text).toContain('Cochera tiene puerta hacia el exterior, a 1.50 m del extremo izquierdo del muro inferior (6.00 m).')
      expect(text).toContain('Cochera tiene ventana hacia el exterior, a 4.50 m del extremo izquierdo del muro inferior (6.00 m).')
    })

    // Bug real verificado (bug #2 — dos aberturas en muros DISTINTOS del mismo cuarto): un
    // cuarto de esquina con dos ventanas, cada una en un muro exterior distinto, producía
    // dos oraciones idénticas salvo el extremo ("...del muro." x2) — ambiguo sobre CUÁL muro
    // es cuál. Ahora cada oración nombra el lado del inmueble donde corre su propio muro
    // (más el largo real, como desempate si dos muros cayeran del mismo lado).
    it('two windows on two DIFFERENT walls of the same corner room are distinguished by wall side', () => {
      const f = emptyFloorGraph('Test')
      const a = addVertex(f, 0, 0), b = addVertex(f, 5, 0), c = addVertex(f, 5, 4), d = addVertex(f, 0, 4)
      addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15)
      const eTop = addEdge(f, c, d, 0.15)
      const eLeft = addEdge(f, d, a, 0.15)
      f.rooms.push({ name: 'RECAMARA PRINCIPAL', cx: 2.5, cy: 2 })
      f.edges[eLeft].openings.push({ kind: 'window', offset: 0.5, width: 1.2 })
      f.edges[eTop].openings.push({ kind: 'window', offset: 0.5, width: 1.2 })

      const text = planFacts(f)

      // eLeft: d=(0,4)→a=(0,0), vertical, 4 m, corre por x=0 (bbox x: 0–5) → lado
      // "izquierdo". offset .5 → 2.00 m desde v1=d; v1.y=4 >= v2.y=0 → extremo "superior".
      expect(text).toContain('RECAMARA PRINCIPAL tiene ventana hacia el exterior, a 2.00 m del extremo superior del muro izquierdo (4.00 m).')
      // eTop: c=(5,4)→d=(0,4), horizontal, 5 m, corre por y=4 (bbox y: 0–4) → lado
      // "superior". offset .5 → 2.50 m desde v1=c; v1.x=5 <= v2.x=0 es falso → extremo
      // "derecho".
      expect(text).toContain('RECAMARA PRINCIPAL tiene ventana hacia el exterior, a 2.50 m del extremo derecho del muro superior (5.00 m).')
      // Las dos oraciones ya no son indistinguibles salvo el extremo: "muro izquierdo" vs
      // "muro superior" identifican inequívocamente muros distintos.
    })

    it('a non-90° corner (an L/angled cut) is reported by location and angle', () => {
      const f = emptyFloorGraph('Test')
      // Triángulo rectángulo isósceles: ángulos exactos 90°/45°/45° (verificado con
      // python: acos aplicado a los vectores da 90.0 en a, 45.00...1 en b y c).
      const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 0, 4)
      addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, a, 0.15)

      const text = planFacts(f)

      expect(text).toContain('Esquina en (4.00, 0.00) con ángulo de 45°.')
      expect(text).toContain('Esquina en (0.00, 4.00) con ángulo de 45°.')
      // La esquina recta (90°, en el origen) no se menciona — no aporta información nueva.
      expect(text).not.toContain('(0.00, 0.00)')
    })

    it('a fully rectangular floor (every corner at 90°) never mentions a corner angle', () => {
      const f = emptyFloorGraph('Test')
      rectangle(f, 0, 0, 4, 3)
      f.rooms.push({ name: 'Sala', cx: 2, cy: 1.5 })

      const text = planFacts(f)

      expect(text).not.toContain('Esquina')
      expect(text).not.toContain('ángulo')
    })

    // Bug real verificado: un muro exterior recto partido por una T interior
    // (`splitEdgeAtVertex`, el caso normal de un levantamiento con más de un cuarto) dejaba
    // un vértice colineal a 180° en la frontera exterior — `cornerAngles` lo reporta (no es
    // una esquina recta, `isRight` es false), pero tampoco es una esquina IRREGULAR: es un
    // punto sobre una línea recta. Antes del fix, planFacts lo listaba igual que un corte en
    // L real ("Esquina en (3.00, 0.00) con ángulo de 180°" ×2 en este plano), dato fabricado
    // que le decía al modelo de imagen que el edificio tiene esquinas donde solo hay un muro
    // recto partido.
    it('a T-junction split on an otherwise straight exterior wall (180°, colinear) is never reported as a corner', () => {
      const f = emptyFloorGraph('Test')
      dividedRooms(f, 'Cocina', 'Sala')

      const text = planFacts(f)

      expect(text).not.toContain('Esquina')
      expect(text).not.toContain('180')
    })
  })

  // Task 21b — tipo de cuarto inferido por palabra clave en el nombre. Nombres reales
  // tomados del diagnóstico en docs/plans/2026-08-11-renders-de-plano-mas-precisos.md
  // (levantamientos capturados por el usuario, no inventados).
  describe('room-type inference by name', () => {
    const cases: Array<[string, string]> = [
      ['HABITACION DP1', 'recámara'],
      ['ESTANCIA DP2', 'sala'],
      ['BAÑO DP1', 'baño'],
      ['cocina dp1', 'cocina'],
      ['PATIO DP1', 'patio'],
      // Cobertura directa de las 2 categorías que antes solo se ejercitaban de forma
      // incidental (comedor y terraza no tienen sinónimos, así que un solo caso basta).
      ['COMEDOR PB', 'comedor'],
      ['TERRAZA PA', 'terraza'],
      // Un sinónimo más por categoría con sinónimos, además del ya cubierto arriba
      // (habitacion sin acento y estancia): wc y "bano" sin acento para baño, dormitorio
      // y "recamara" sin acento para recámara — antes ninguno tenía aserción directa.
      ['WC PB', 'baño'],
      ['BANO PB', 'baño'],
      ['DORMITORIO PPAL', 'recámara'],
      ['RECAMARA PPAL', 'recámara'],
      // Regresión (diagnóstico de Locales Salón Escobedo, Planta Alta): estos dos nombres
      // reales de esa propiedad no caían en ninguna categoría — el prompt de render no
      // tenía ningún dato sobre su función, solo sus medidas.
      ['ESCALERAS ACCESO', 'escalera'],
      ['ESCALERAS', 'escalera'],
      ['RECIBIDOR PA', 'vestíbulo'],
      ['VESTIBULO PB', 'vestíbulo'],
    ]

    it.each(cases)('infiere el tipo de "%s" como "%s"', (name, expectedType) => {
      const f = emptyFloorGraph('Test')
      rectangle(f, 0, 0, 4, 3)
      f.rooms.push({ name, cx: 2, cy: 1.5 })

      const text = planFacts(f)

      expect(text).toContain(`tipo: ${expectedType}`)
    })

    it('un nombre sin ninguna palabra clave conocida sigue reportando el cuarto sin romper y sin artefacto vacío', () => {
      const f = emptyFloorGraph('Test')
      rectangle(f, 0, 0, 4, 3)
      f.rooms.push({ name: 'Zzyx Inventado', cx: 2, cy: 1.5 })

      const text = planFacts(f)

      expect(text).toContain('Zzyx Inventado')
      expect(text).not.toContain('(tipo: )')
      expect(text).not.toMatch(/tipo: undefined/i)
    })

    it('la coincidencia de tipo es insensible a mayúsculas/minúsculas', () => {
      const fLower = emptyFloorGraph('Test')
      rectangle(fLower, 0, 0, 4, 3)
      fLower.rooms.push({ name: 'Cocina', cx: 2, cy: 1.5 })
      const textLower = planFacts(fLower)

      const fUpper = emptyFloorGraph('Test')
      rectangle(fUpper, 0, 0, 4, 3)
      fUpper.rooms.push({ name: 'COCINA', cx: 2, cy: 1.5 })
      const textUpper = planFacts(fUpper)

      expect(textLower).toContain('tipo: cocina')
      expect(textUpper).toContain('tipo: cocina')
    })

    // Regresión: matching por subcadena (`String.includes`) hacía que la palabra clave
    // sin acento "bano" (de "baño") coincidiera DENTRO de "urbano" — "PATIO URBANO" es un
    // nombre realista (terraza/patio de una casa "estilo urbano") que terminaba etiquetado
    // como "tipo: baño" en vez de "tipo: patio", dato falso alimentado al prompt de imagen.
    // El mismo riesgo existe con "cubano"/"suburbano". El fix compara por TOKEN completo
    // (la palabra se separa del resto por espacios/no-letras), no por subcadena.
    it('"PATIO URBANO" infiere "patio", no "baño" — "urbano" contiene la subcadena "bano" pero no es la palabra "bano"', () => {
      const f = emptyFloorGraph('Test')
      rectangle(f, 0, 0, 4, 3)
      f.rooms.push({ name: 'PATIO URBANO', cx: 2, cy: 1.5 })

      const text = planFacts(f)

      expect(text).toContain('tipo: patio')
      expect(text).not.toContain('tipo: baño')
    })
  })

  // Fase 1 del diagnóstico de Locales Salón Escobedo: Room.type explícito (dropdown al
  // nivel del plano) reemplaza la inferencia por palabra clave como fuente PRIMARIA.
  describe('room-type explícito (Room.type) gana sobre la inferencia por nombre', () => {
    it('un nombre que no matchea ninguna palabra clave sí obtiene tipo si el Room lo trae explícito', () => {
      const f = emptyFloorGraph('Test')
      rectangle(f, 0, 0, 4, 3)
      f.rooms.push({ name: 'CUARTO 3', cx: 2, cy: 1.5, type: 'bano' })

      const text = planFacts(f)

      expect(text).toContain('tipo: baño')
    })

    it('el type explícito gana aunque el nombre matchee OTRA categoría por palabra clave', () => {
      const f = emptyFloorGraph('Test')
      rectangle(f, 0, 0, 4, 3)
      // El nombre diría "cocina" por palabra clave — el type explícito manda igual.
      f.rooms.push({ name: 'COCINA VIEJA (ahora escalera)', cx: 2, cy: 1.5, type: 'escalera' })

      const text = planFacts(f)

      expect(text).toContain('tipo: escalera')
      expect(text).not.toContain('tipo: cocina')
    })

    it('type: "otro" NO se imprime literal — cae al inferido por nombre', () => {
      const f = emptyFloorGraph('Test')
      rectangle(f, 0, 0, 4, 3)
      f.rooms.push({ name: 'COCINA DP1', cx: 2, cy: 1.5, type: 'otro' })

      const text = planFacts(f)

      expect(text).toContain('tipo: cocina') // inferido por nombre, no "tipo: otro"
      expect(text).not.toContain('tipo: otro')
    })

    it('type: "otro" con un nombre que tampoco matchea nada omite la anotación por completo', () => {
      const f = emptyFloorGraph('Test')
      rectangle(f, 0, 0, 4, 3)
      f.rooms.push({ name: 'Zzyx Inventado', cx: 2, cy: 1.5, type: 'otro' })

      const text = planFacts(f)

      expect(text).not.toMatch(/tipo:/i)
    })

    it('sin type en el Room, el comportamiento es idéntico al de hoy (fallback por nombre)', () => {
      const f = emptyFloorGraph('Test')
      rectangle(f, 0, 0, 4, 3)
      f.rooms.push({ name: 'BAÑO DP1', cx: 2, cy: 1.5 })

      const text = planFacts(f)

      expect(text).toContain('tipo: baño')
    })
  })

  // Task 21c — dimensiones aproximadas (bounding box) por cuarto, además del área.
  describe('per-room dimensions', () => {
    it('reports the bounding box (width x depth) of a known rectangular room, alongside its area', () => {
      const f = emptyFloorGraph('Test')
      // Dos cuartos de 4x3 uno junto al otro: el bounding box del PISO completo es 8x3,
      // distinto del bounding box de CADA cuarto (4x3) — así la aserción solo puede pasar
      // vía dimensiones por cuarto reales, no por una coincidencia con la línea de
      // "Dimensiones generales del piso" (que este mismo archivo ya cubre aparte).
      rectangle(f, 0, 0, 4, 3)
      const a2 = addVertex(f, 4, 0), b2 = addVertex(f, 8, 0), c2 = addVertex(f, 8, 3), d2 = addVertex(f, 4, 3)
      addEdge(f, a2, b2, 0.15); addEdge(f, b2, c2, 0.15); addEdge(f, c2, d2, 0.15); addEdge(f, d2, a2, 0.15)
      f.rooms.push({ name: 'Sala', cx: 2, cy: 1.5 })

      const text = planFacts(f)

      expect(text).toContain('Sala')
      expect(text).toContain('12.00 m²')
      expect(text).toContain('4.00 m × 3.00 m')
      const idx = text.indexOf('Sala')
      const roomDetail = text.slice(idx, text.indexOf(')', idx))
      expect(roomDetail).toContain('4.00 m × 3.00 m')
    })

    it('a free-floating labeled room with no closed polygon reports no dimensions and does not crash', () => {
      const f = emptyFloorGraph('Test')
      const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3)
      addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15)
      f.rooms.push({ name: 'Terraza', cx: 2, cy: 1.5 })

      const text = planFacts(f)

      expect(text).toContain('Terraza')
      // El detalle de ESTE cuarto (entre su nombre y el cierre del paréntesis) no trae
      // dimensiones — está marcado como espacio abierto (bug #3: un cuarto sin muros no debe
      // leerse igual que uno cerrado). No se busca "×" en todo el texto porque la línea de
      // "Dimensiones generales del piso" (bounding box del PISO, no del cuarto) sí usa "×" y
      // siempre está presente cuando hay vértices.
      const idx = text.indexOf('Terraza')
      const roomDetail = text.slice(idx, text.indexOf(')', idx))
      expect(roomDetail).toContain('espacio abierto')
      expect(roomDetail).not.toMatch(/×/)
      expect(text).not.toMatch(/nan/i)
      expect(text).not.toMatch(/undefined/i)
      expect(text).not.toMatch(/null/i)
    })

    it('an unlabeled closed room (no name) does not crash planFacts and leaves no dimension artifact', () => {
      const f = emptyFloorGraph('Test')
      rectangle(f, 0, 0, 4, 3) // cerrado, pero sin punto de nombre en f.rooms

      expect(() => planFacts(f)).not.toThrow()
      const text = planFacts(f)
      expect(text).not.toMatch(/nan/i)
      expect(text).not.toMatch(/undefined/i)
      expect(text).not.toMatch(/null/i)
    })

    // Regresión: un lookup keyed by name (Map<nombre, vértices>) colisiona cuando dos
    // cuartos comparten nombre — nada en el reducer exige nombres de cuarto únicos, y
    // "Recámara" repetida sin numerar es un caso real de una casa con varias recámaras. El
    // bug hacía que el ÚLTIMO cuarto con ese nombre pisara los vértices del primero, así
    // que el primer cuarto imprimía su área real junto al bounding box del OTRO cuarto.
    it('two rooms with the SAME name but different sizes never mix one room\'s area with the other\'s dimensions', () => {
      const f = emptyFloorGraph('Test')
      // Un solo rectángulo 6x4 dividido ASIMÉTRICAMENTE en x=2 (no en x=3 como
      // `dividedRooms`, que da mitades iguales — aquí necesitamos tamaños DISTINTOS para
      // poder detectar si se mezclan): izquierda 2x4=8 m², derecha 4x4=16 m², mismo nombre
      // en ambas. Un solo componente conexo (a diferencia de dos rectángulos sueltos) para
      // no tropezar con la limitación conocida y aparte de `interiorPolygons`/`outerFace`
      // de solo reconocer una cara exterior global entre componentes desconectados.
      const a = addVertex(f, 0, 0), b = addVertex(f, 6, 0), c = addVertex(f, 6, 4), d = addVertex(f, 0, 4)
      const eBottom = addEdge(f, a, b, 0.15)
      addEdge(f, b, c, 0.15)
      const eTop = addEdge(f, c, d, 0.15)
      addEdge(f, d, a, 0.15)
      const botMid = addVertex(f, 2, 0)
      const topMid = addVertex(f, 2, 4)
      splitEdgeAtVertex(f, eBottom, botMid)
      splitEdgeAtVertex(f, eTop, topMid)
      addEdge(f, botMid, topMid, 0.10)
      f.rooms.push({ name: 'Recámara', cx: 1, cy: 2 }, { name: 'Recámara', cx: 4, cy: 2 })

      const text = planFacts(f)

      const firstIdx = text.indexOf('Recámara')
      const firstDetail = text.slice(firstIdx, text.indexOf(')', firstIdx))
      const secondIdx = text.indexOf('Recámara', firstIdx + 1)
      const secondDetail = text.slice(secondIdx, text.indexOf(')', secondIdx))

      // Cada cuarto reporta SU PROPIA área junto a SU PROPIO bounding box — nunca el área
      // de uno junto a las dimensiones del otro (8 m² es 2x4, no 4x4; 16 m² es 4x4, no 2x4).
      expect(firstDetail).toContain('8.00 m²')
      expect(firstDetail).toContain('2.00 m × 4.00 m')
      expect(secondDetail).toContain('16.00 m²')
      expect(secondDetail).toContain('4.00 m × 4.00 m')
    })
  })

  // Fase 2 del diagnóstico de Locales Salón Escobedo: resolveRoomType es el único punto
  // de verdad de "cuál es el tipo efectivo de este cuarto", reusado por planImage.ts
  // (relleno de color) — cubierto directo aquí, no solo indirectamente vía planFacts().
  describe('resolveRoomType (exportada)', () => {
    it('el type explícito gana', () => {
      expect(resolveRoomType('CUARTO 3', 'bano')).toBe('bano')
    })

    it("'otro' cae al inferido por nombre", () => {
      expect(resolveRoomType('COCINA DP1', 'otro')).toBe('cocina')
    })

    it("'otro' con un nombre que tampoco matchea nada regresa null", () => {
      expect(resolveRoomType('Zzyx Inventado', 'otro')).toBeNull()
    })

    it('sin type explícito, cae al inferido por nombre', () => {
      expect(resolveRoomType('BAÑO DP1', undefined)).toBe('bano')
    })

    it('sin type explícito y sin match de nombre, regresa null', () => {
      expect(resolveRoomType('Zzyx Inventado', undefined)).toBeNull()
    })
  })

  describe('includeColorLegend', () => {
    it('por default (sin opts) no agrega ninguna leyenda de color', () => {
      const f = emptyFloorGraph('Test')
      rectangle(f, 0, 0, 4, 3)
      f.rooms.push({ name: 'Escalera PA', cx: 2, cy: 1.5, type: 'escalera' })
      const text = planFacts(f)
      expect(text).not.toContain('Colores de referencia')
    })

    it('con includeColorLegend:true, lista el color del tipo resuelto', () => {
      const f = emptyFloorGraph('Test')
      rectangle(f, 0, 0, 4, 3)
      f.rooms.push({ name: 'Escalera PA', cx: 2, cy: 1.5, type: 'escalera' })
      const text = planFacts(f, { includeColorLegend: true })
      expect(text).toContain('Colores de referencia')
      expect(text).toContain(`${ROOM_TYPE_CATALOG.escalera.color} = escalera`)
    })

    it('no repite un color dos veces cuando dos cuartos comparten tipo', () => {
      const f = emptyFloorGraph('Test')
      dividedRooms(f, 'Recámara 1', 'Recámara 2')
      const text = planFacts(f, { includeColorLegend: true })
      const occurrences = text.split(`${ROOM_TYPE_CATALOG.recamara.color} = recámara`).length - 1
      expect(occurrences).toBe(1)
    })

    it('nunca lista un color no usado en este piso (solo cocina, no las otras 15 entradas)', () => {
      const f = emptyFloorGraph('Test')
      rectangle(f, 0, 0, 4, 3)
      f.rooms.push({ name: 'Cocina DP1', cx: 2, cy: 1.5 })
      const text = planFacts(f, { includeColorLegend: true })
      expect(text).toContain(`${ROOM_TYPE_CATALOG.cocina.color} = cocina`)
      expect(text).not.toContain(ROOM_TYPE_CATALOG.bano.color!)
      expect(text).not.toContain(ROOM_TYPE_CATALOG.escalera.color!)
    })

    it('omite el párrafo por completo si ningún cuarto tiene tipo resoluble', () => {
      const f = emptyFloorGraph('Test')
      rectangle(f, 0, 0, 4, 3)
      f.rooms.push({ name: 'Zzyx Inventado', cx: 2, cy: 1.5 })
      const text = planFacts(f, { includeColorLegend: true })
      expect(text).not.toContain('Colores de referencia')
    })
  })
})
