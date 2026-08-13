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
    // data-wall (no un <line /> a secas): Task 19 añade líneas de cota que también son
    // <line>, así que contar el tag genérico ya no identifica solo muros — mismo criterio
    // que data-fixture usa para no confundirse con otros <rect>.
    expect((svg.match(/<line data-wall="/g) || []).length).toBe(4)   // one per wall
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
    expect((svg.match(/<line data-wall="/g) || []).length).toBe(4)   // los 4 muros reales, la fantasma no
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

  // Task 19: el render model no puede inferir dónde está una puerta si el muro se pinta
  // como una línea sólida continua — necesita ver el hueco real, igual que el editor.
  //
  // Bug #2 del plan de Task 33a: stroke-linecap="round" extendía cada segmento de muro
  // media anchura de línea más allá de su punto final, comiéndose el hueco — una puerta de
  // 0.90 m en un muro de 0.15 m salía pintada a solo 0.76 m (medido rasterizando). La
  // coordenada x1/x2 del <line> por sí sola NO revela el bug (es el centerline, no el borde
  // visual renderizado) — hay que sumarle la extensión real del cap, igual que haría un
  // rasterizador, para verificar la posición REAL del borde del hueco tras el fix.
  const visualEdge = (coordPx: number, strokeWidthPx: number, linecap: string, dir: 1 | -1) =>
    coordPx + dir * (linecap === 'round' ? strokeWidthPx / 2 : 0)

  it('renders the door gap at its true real-world width, accounting for the stroke cap (not just the raw centerline coords)', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0)
    const e = addEdge(f, a, b, 0.15)   // muro de 0.15 m, escala default 100 px/m → w = 15px
    f.edges[e].openings.push({ kind: 'door', offset: 0.5, width: 0.9 }) // hueco de 1.55 a 2.45 m (mundo)
    const svg = floorToSvgString(f)
    const walls = [...svg.matchAll(/<line data-wall="[^"]*"[^>]*x1="([\d.-]+)"[^>]*y1="[\d.-]+"[^>]*x2="([\d.-]+)"[^>]*y2="[\d.-]+"[^>]*stroke="[^"]*"[^>]*stroke-width="([\d.]+)"[^>]*stroke-linecap="(\w+)"/g)]
    expect(walls.length).toBe(2)
    const [, , x2a, swA, capA] = walls[0]
    const [, x1b, , swB, capB] = walls[1]
    const rightEdgeSeg1 = visualEdge(Number(x2a), Number(swA), capA, 1)
    const leftEdgeSeg2 = visualEdge(Number(x1b), Number(swB), capB, -1)
    const realGapPx = leftEdgeSeg2 - rightEdgeSeg1
    expect(realGapPx).toBeCloseTo(90, 0)   // 0.9m * 100px/m real, exacto (antes: ~75px, 17% angosto)
    // El hueco de la puerta también debe llevar su arco de abatimiento (aserción heredada
    // del test que este reemplaza, que verificaba lo mismo con un umbral demasiado laxo).
    expect(svg).toMatch(/<path[^>]*d="M [\d.-]+ [\d.-]+ A [\d.-]+ [\d.-]+ 0 0 0 [\d.-]+ [\d.-]+"/)
  })

  // El mismo recorte no debe tocar los extremos de muro que SÍ coinciden con un vértice real
  // (una esquina muro-muro) — esos deben seguir llegando hasta el vértice exacto, sin
  // recortarse, para que el round-cap siga rellenando la esquina como antes.
  it('does not trim the wall-segment end that lands on the wall\'s own true endpoint (no opening there)', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0)
    const e = addEdge(f, a, b, 0.15)
    // Puerta pegada al extremo derecho del muro (atM=3.5, hw=0.5 → el hueco llega EXACTO a
    // L=4): el segundo "segmento" de muro después del hueco no existe (cursor llega a L),
    // así que solo hay un segmento y su INICIO (x=0) es el vértice real del muro — no debe
    // recortarse.
    f.edges[e].openings.push({ kind: 'door', offset: 0.875, width: 1.0 })
    const svg = floorToSvgString(f)
    const walls = [...svg.matchAll(/<line data-wall="[^"]*"[^>]*x1="([\d.-]+)"/g)]
    expect(walls.length).toBe(1)
    // px(0) = (0 - minx) * scale = (0 - -1) * 100 = 100 (pad=1m por defecto) — sin recorte.
    expect(Number(walls[0][1])).toBeCloseTo(100, 5)
  })

  // Bug #3 del plan de Task 33a: el arco de abatimiento (stroke-width 0.8, fijo) y la hoja de
  // puerta (1.3, fijo) eran ~19x más delgados que el trazo del muro (Math.max(4, thickness *
  // scale), típicamente 10-15px) — señal casi invisible tras el reescalado. El fix debe hacer
  // el grosor de esos trazos PROPORCIONAL al grosor real del muro, no un valor fijo: un muro
  // más grueso debe producir un arco/hoja más gruesos.
  it('scales the door leaf/arc stroke-width with the real wall thickness, not a fixed px value', () => {
    const thin = emptyFloorGraph('Test')
    const ta = addVertex(thin, 0, 0), tb = addVertex(thin, 4, 0)
    const te = addEdge(thin, ta, tb, 0.10)   // muro delgado: w = max(4, 10) = 10px
    thin.edges[te].openings.push({ kind: 'door', offset: 0.5, width: 0.9 })
    const thinSvg = floorToSvgString(thin)

    const thick = emptyFloorGraph('Test')
    const ka = addVertex(thick, 0, 0), kb = addVertex(thick, 4, 0)
    const ke = addEdge(thick, ka, kb, 0.30)   // muro grueso: w = max(4, 30) = 30px
    thick.edges[ke].openings.push({ kind: 'door', offset: 0.5, width: 0.9 })
    const thickSvg = floorToSvgString(thick)

    const leafW = (svg: string) => Number(svg.match(/<line data-opening="door-leaf"[^>]*stroke-width="([\d.]+)"/)![1])
    const arcW = (svg: string) => Number(svg.match(/<path data-opening="door-arc"[^>]*stroke-width="([\d.]+)"/)![1])

    expect(leafW(thickSvg)).toBeGreaterThan(leafW(thinSvg))   // antes: 1.3 fijo en ambos casos
    expect(arcW(thickSvg)).toBeGreaterThan(arcW(thinSvg))     // antes: 0.8 fijo en ambos casos
    // El arco ya no debe ser una fracción minúscula del trazo del muro (antes ~1/19 de w=15).
    // Con el muro delgado (w=10px), un arco proporcional debe rondar w/5-w/3, muy por encima
    // del 0.8px fijo de antes.
    expect(arcW(thinSvg)).toBeGreaterThan(2)
    expect(leafW(thinSvg)).toBeGreaterThan(2.5)
  })

  // Bug #1 del plan de Task 33a: antes una ventana solo llevaba una marca perpendicular
  // corta (0.12m a cada lado, 0.24m total) que NO cruzaba el vano — el modelo de render la
  // leía igual que "aquí no hay muro" (mismo tratamiento visual que un hueco de puerta sin
  // hoja ni arco). El fix dibuja una línea de "vidrio" que SÍ atraviesa el vano de punta a
  // punta (misma convención que planta arquitectónica), inconfundible con el hueco desnudo.
  it('draws a window opening as a real gap plus a glass line that spans the full void (no swing arc)', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0)
    const e = addEdge(f, a, b, 0.15)
    f.edges[e].openings.push({ kind: 'window', offset: 0.5, width: 1.2 })
    const svg = floorToSvgString(f)
    const walls = [...svg.matchAll(/<line data-wall="[^"]*"/g)]
    expect(walls.length).toBe(2)
    expect(svg).not.toContain('data-opening="door-arc"')
    expect(svg).not.toContain('data-opening="door-leaf"')
    expect(svg).not.toMatch(/<path[^>]*A /)   // sin arco de puerta

    const glass = svg.match(/<line data-opening="window-glass"[^>]*x1="([\d.-]+)"[^>]*y1="[\d.-]+"[^>]*x2="([\d.-]+)"/)
    expect(glass).not.toBeNull()
    const glassSpan = Math.abs(Number(glass![2]) - Number(glass![1]))
    // El vidrio debe cruzar el vano completo: 1.2m * 100px/m = 120px, no un tick de 24px.
    expect(glassSpan).toBeCloseTo(120, 0)
  })

  it('draws window jamb marks at both ends of the void, distinct from the glass line', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0)
    const e = addEdge(f, a, b, 0.15)
    f.edges[e].openings.push({ kind: 'window', offset: 0.5, width: 1.2 })
    const svg = floorToSvgString(f)
    expect((svg.match(/data-opening="window-jamb"/g) || []).length).toBe(2)
  })

  it('an edge with two openings produces three wall segments, sorted by offset regardless of insertion order', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 10, 0)
    const e = addEdge(f, a, b, 0.15)
    // Se insertan fuera de orden a propósito: la segunda puerta (offset 0.2) queda antes
    // en el muro que la primera (offset 0.7) — el export debe ordenar por offset, no confiar
    // en el orden de inserción.
    f.edges[e].openings.push({ kind: 'door', offset: 0.7, width: 0.9 })
    f.edges[e].openings.push({ kind: 'window', offset: 0.2, width: 1.0 })
    const svg = floorToSvgString(f)
    const walls = [...svg.matchAll(/<line data-wall="[^"]*"[^>]*x1="([\d.-]+)"[^>]*x2="([\d.-]+)"/g)]
    expect(walls.length).toBe(3)
    // Cada segmento debe avanzar (x1 < x2) y el orden de segmentos debe ser creciente en x —
    // si no se hubiera ordenado por offset, el segmento del medio saldría con longitud negativa
    // o los segmentos se traslaparían.
    for (const w of walls) expect(Number(w[2])).toBeGreaterThan(Number(w[1]))
    for (let i = 0; i < walls.length - 1; i++) {
      expect(Number(walls[i + 1][1])).toBeGreaterThanOrEqual(Number(walls[i][2]))
    }
  })

  it('draws width/height dimension chains with the correct numeric values for a simple rectangle', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3), d = addVertex(f, 0, 3)
    addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
    const svg = floorToSvgString(f)
    // widthHeightChains sobre este rectángulo produce una sola cadena de 4.00 m (ancho) y
    // una de 3.00 m (alto) — sin muros interiores que las corten.
    expect(svg).toContain('>4.00 m<')
    expect(svg).toContain('>3.00 m<')
  })

  // Bug #4 del plan de Task 33a: dimText(px(mx) + 11, py(my), ...) usaba un offset FIJO en X
  // — para un muro HORIZONTAL, my cae sobre la línea del muro, así que el texto de la cota
  // quedaba encima del propio trazo negro de 10-15px de grosor, ilegible. El fix calcula un
  // offset perpendicular a la dirección real del muro (edgeAxis) — debe separarse del trazo
  // sin importar la orientación.
  it('offsets the per-wall length label away from the wall trace, perpendicular to a horizontal wall (not overlapping it)', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0)
    addEdge(f, a, b, 0.15)
    const svg = floorToSvgString(f)
    // La cota por muro usa f2(L) SIN sufijo " m" (distinto de las cadenas ancho/alto, que sí
    // lo llevan) — así se aísla el <text> que corresponde a este bug.
    const m = svg.match(/<text x="([\d.-]+)" y="([\d.-]+)"[^>]*>4\.00</)
    expect(m).not.toBeNull()
    const [, tx, ty] = m!
    // El muro (horizontal) se traza en y = py(0) = 200 (con pad=1m, escala 100px/m por
    // defecto, ver los tests de arriba). El texto debe separarse en Y por más que la mitad
    // del grosor del muro (w/2 = 7.5px) — no quedar "encima" del trazo.
    const wallY = 200
    expect(Math.abs(Number(ty) - wallY)).toBeGreaterThan(15)
    // Y no debe desplazarse en X más que un margen chico: la separación es perpendicular al
    // muro (que corre en X), no a lo largo de él.
    const wallMidX = 300   // px(mx) = px(2) = (2 - (-1)) * 100
    expect(Math.abs(Number(tx) - wallMidX)).toBeLessThan(5)
  })

  it('offsets the per-wall length label perpendicular to a vertical wall too (X offset, not a fixed X nudge)', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 0, 3)
    addEdge(f, a, b, 0.15)
    const svg = floorToSvgString(f)
    const m = svg.match(/<text x="([\d.-]+)" y="([\d.-]+)"[^>]*>3\.00</)
    expect(m).not.toBeNull()
    const [, tx, ty] = m!
    // El muro (vertical) se traza en x = px(0) = 100. Perpendicular a un muro vertical es el
    // eje X — el texto debe separarse ahí, no quedarse pegado al trazo.
    const wallX = 100
    expect(Math.abs(Number(tx) - wallX)).toBeGreaterThan(15)
    // Y no debe moverse verticalmente más que un margen chico (la separación es perpendicular
    // al muro, que corre en Y).
    const wallMidY = 250   // py(my) = py(1.5) = (4 - 1.5) * 100
    expect(Math.abs(Number(ty) - wallMidY)).toBeLessThan(5)
  })

  // Bug #5 del plan de Task 33a: los font-size de cotas/nombres eran constantes en px (11,
  // 12, 16) mientras el lienzo crece con `scale` y el tamaño real del plano. Arriba de
  // ~18.5m de lado mayor, el reescalado a MAX_EDGE_PLAN=2048 (app/api/renders.py) reduce el
  // factor de escala real de la imagen final y el texto se vuelve ilegible. Decisión: el
  // font-size se escala como una fracción constante de Math.max(W, H) — el lado mayor del
  // SVG (que ya incorpora `scale` y el tamaño real del bounding box) — así que la razón
  // font-size/lienzo (y por lo tanto la legibilidad relativa, que sobrevive intacta a
  // cualquier reescalado uniforme posterior) es la MISMA sin importar si el plano mide 8m o
  // 30m de lado. Medido con dos plantas reales (8m y 30m), no simulado.
  const svgSpan = (svg: string) => {
    const m = svg.match(/<svg[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/)!
    return Math.max(Number(m[1]), Number(m[2]))
  }
  const buildRect = (side: number, name: string) => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, side, 0), c = addVertex(f, side, side * 0.7), d = addVertex(f, 0, side * 0.7)
    addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
    f.rooms.push({ name, cx: side / 2, cy: (side * 0.7) / 2 })
    return f
  }

  it('keeps the room-label font-size proportional to the plan span — a 30m-side plan and an 8m-side plan read equally legible relative to their canvas', () => {
    const smallSvg = floorToSvgString(buildRect(8, 'Sala'))
    const bigSvg = floorToSvgString(buildRect(30, 'Sala'))
    const roomFontSize = (svg: string) => Number(svg.match(/<text[^>]*font-size="([\d.]+)"[^>]*>Sala</)![1])

    const smallRatio = roomFontSize(smallSvg) / svgSpan(smallSvg)
    const bigRatio = roomFontSize(bigSvg) / svgSpan(bigSvg)
    // Antes: font-size="16" fijo en ambos, así que la razón caía con el tamaño del plano
    // (16/1000 en el chico contra 16/3200 en el grande, ~3x menos legible relativo al
    // lienzo). Después del fix, la razón debe ser prácticamente la misma.
    expect(bigRatio / smallRatio).toBeCloseTo(1, 1)
    // Y el tamaño absoluto SÍ debe crecer con el plano — si no, sería una constante disfrazada.
    expect(roomFontSize(bigSvg)).toBeGreaterThan(roomFontSize(smallSvg))
  })

  it('keeps the dimension-label font-size proportional to the plan span too', () => {
    const smallSvg = floorToSvgString(buildRect(8, 'Sala'))
    const bigSvg = floorToSvgString(buildRect(30, 'Sala'))
    // Cualquier etiqueta "X.XX m" de la cadena de cota (ancho/alto) sirve de muestra.
    const dimFontSize = (svg: string) => Number(svg.match(/<text[^>]*font-size="([\d.]+)"[^>]*>[\d.]+ m</)![1])

    const smallRatio = dimFontSize(smallSvg) / svgSpan(smallSvg)
    const bigRatio = dimFontSize(bigSvg) / svgSpan(bigSvg)
    expect(bigRatio / smallRatio).toBeCloseTo(1, 1)
    expect(dimFontSize(bigSvg)).toBeGreaterThan(dimFontSize(smallSvg))
  })
})
