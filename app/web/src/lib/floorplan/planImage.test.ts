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
  it('draws a door opening as a real gap (two wall segments) plus its swing arc', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0)
    const e = addEdge(f, a, b, 0.15)
    f.edges[e].openings.push({ kind: 'door', offset: 0.5, width: 0.9 }) // hueco de 1.55 a 2.45 (mundo)
    const svg = floorToSvgString(f)
    const walls = [...svg.matchAll(/<line data-wall="[^"]*"[^>]*x1="([\d.-]+)"[^>]*x2="([\d.-]+)"/g)]
    expect(walls.length).toBe(2)   // dos segmentos de muro, no uno continuo
    // El primer segmento termina antes de donde empieza el segundo — hueco real y numérico.
    const seg1End = Number(walls[0][2]), seg2Start = Number(walls[1][1])
    const gap = Math.abs(seg2Start - seg1End)
    expect(gap).toBeGreaterThan(50)   // 0.9m de hueco * 100px/m = 90px, con margen
    expect(svg).toMatch(/<path[^>]*d="M [\d.-]+ [\d.-]+ A [\d.-]+ [\d.-]+ 0 0 0 [\d.-]+ [\d.-]+"/)
  })

  it('draws a window opening as a real gap plus its perpendicular marker (no swing arc)', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0)
    const e = addEdge(f, a, b, 0.15)
    f.edges[e].openings.push({ kind: 'window', offset: 0.5, width: 1.2 })
    const svg = floorToSvgString(f)
    const walls = [...svg.matchAll(/<line data-wall="[^"]*"/g)]
    expect(walls.length).toBe(2)
    expect(svg).toContain('data-opening="window-marker"')
    expect(svg).not.toContain('data-opening="door-arc"')
    expect(svg).not.toMatch(/<path[^>]*A /)   // sin arco de puerta
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
})
