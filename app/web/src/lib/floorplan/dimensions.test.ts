import { describe, it, expect } from 'vitest'
import { emptyFloorGraph, GHOST_THICKNESS_M } from './types'
import { addVertex, addEdge, splitEdgeAtVertex } from './graph'
import { widthHeightChains, cornerAngles, cotaEdges } from './dimensions'

function closedRect(f: ReturnType<typeof emptyFloorGraph>, x0: number, y0: number, x1: number, y1: number) {
  const a = addVertex(f, x0, y0), b = addVertex(f, x1, y0), c = addVertex(f, x1, y1), d = addVertex(f, x0, y1)
  const eTop = addEdge(f, a, b, 0.15), eRight = addEdge(f, b, c, 0.15)
  const eBottom = addEdge(f, c, d, 0.15), eLeft = addEdge(f, d, a, 0.15)
  return { a, b, c, d, eTop, eRight, eBottom, eLeft }
}

describe('widthHeightChains', () => {
  it('reports one span with no dividing interior wall', () => {
    const f = emptyFloorGraph('Test')
    closedRect(f, 0, 0, 6, 4)
    const { widthMarks, heightMarks } = widthHeightChains(f)
    expect(widthMarks).toEqual([0, 6])
    expect(heightMarks).toEqual([0, 4])
  })

  it('splits the width chain when a near-full-height interior wall crosses it', () => {
    const f = emptyFloorGraph('Test')
    const { eTop, eBottom } = closedRect(f, 0, 0, 6, 4)
    const topMid = addVertex(f, 3, 0), botMid = addVertex(f, 3, 4)
    splitEdgeAtVertex(f, eTop, topMid)
    splitEdgeAtVertex(f, eBottom, botMid)
    addEdge(f, topMid, botMid, 0.10)
    const { widthMarks } = widthHeightChains(f)
    expect(widthMarks).toEqual([0, 3, 6])
  })

  it('does NOT split the width chain when the same full-span divider is a ghost', () => {
    // Misma geometría que el test anterior, solo que la arista divisoria es 'ghost': una
    // división de cuarto no es un muro para efectos de cotas — el plano se sigue acotando
    // como un solo espacio de ancho completo.
    const f = emptyFloorGraph('Test')
    const { eTop, eBottom } = closedRect(f, 0, 0, 6, 4)
    const topMid = addVertex(f, 3, 0), botMid = addVertex(f, 3, 4)
    splitEdgeAtVertex(f, eTop, topMid)
    splitEdgeAtVertex(f, eBottom, botMid)
    addEdge(f, topMid, botMid, GHOST_THICKNESS_M, 'ghost')
    const { widthMarks } = widthHeightChains(f)
    expect(widthMarks).toEqual([0, 6])
  })

  it('splits the width chain when a T-junction breaks the divider into two short segments', () => {
    // Reproduce el hallazgo real: un levantamiento normal parte los muros interiores en las
    // T (splitEdgeAtVertex), así que la pared divisoria de 8 m de alto nunca es UNA arista de
    // 8 m — son dos de 4 m, y ninguna por sí sola llega al 90% de 8 m (7.2 m). El muro sigue
    // dividiendo el piso completo (0→8 sin huecos), solo que partido por otra pared que lo
    // cruza a medio camino — la cadena de ancho debe marcar x=5 igual que si fuera una sola
    // arista continua.
    const f = emptyFloorGraph('Test')
    const { eTop, eBottom } = closedRect(f, 0, 0, 10, 8)
    const topMid = addVertex(f, 5, 0), botMid = addVertex(f, 5, 8)
    splitEdgeAtVertex(f, eTop, topMid)
    splitEdgeAtVertex(f, eBottom, botMid)
    const divider = addEdge(f, topMid, botMid, 0.10)
    const tJunction = addVertex(f, 5, 4)
    splitEdgeAtVertex(f, divider, tJunction)
    // La pared que produce la T: cruza el divisor pero solo cubre la mitad derecha del
    // ancho total (5→10 de 0→10, 50%) — no debe generar su propia marca en la cadena de
    // alto, porque no divide el piso completo (preserva la intención original del umbral:
    // excluir particiones parciales, tipo columna aislada).
    addEdge(f, tJunction, addVertex(f, 10, 4), 0.10)

    const { widthMarks, heightMarks } = widthHeightChains(f)
    expect(widthMarks).toEqual([0, 5, 10])
    expect(heightMarks).toEqual([0, 8])
  })

  it('does NOT split the chain from an isolated stub that never reaches the far side', () => {
    // Una columna/nub decorativa de 1 m en medio de un cuarto de 8 m de alto: ni sola ni
    // "acumulada" (no hay nada más con qué acumular) llega al 90% — debe seguir excluida.
    const f = emptyFloorGraph('Test')
    closedRect(f, 0, 0, 10, 8)
    addEdge(f, addVertex(f, 5, 3), addVertex(f, 5, 4), 0.10)
    const { widthMarks, heightMarks } = widthHeightChains(f)
    expect(widthMarks).toEqual([0, 10])
    expect(heightMarks).toEqual([0, 8])
  })

  it('does NOT invent a mark from naive summing when disjoint segments individually fall short but sum past the threshold', () => {
    // Caso adversarial real: dos tramos separados por un hueco real (0.5 m, muy por encima de
    // SPLIT_EPS), elegidos para que la SUMA ingenua de sus longitudes cruce el 90% aunque
    // ninguno de los dos, ni el tramo continuo real que forman, lo haga.
    //   naive sum = (4 + 3.5) / 8 = 93.75%  → cruzaría el umbral si el código sumara segmentos
    //   tramo continuo real = max(4, 3.5) / 8 = 50%  → no debe cruzarlo
    // Esta es la única forma de test que distingue "fusionar tramos que se tocan" (el fix)
    // de "sumar todos los segmentos del grupo sin verificar que se toquen" (el bug original):
    // un test con sumas que nunca cruzan el umbral (p.ej. 3+3 de 8) pasa igual con ambas
    // implementaciones y no prueba nada.
    const f = emptyFloorGraph('Test')
    closedRect(f, 0, 0, 10, 8)
    addEdge(f, addVertex(f, 5, 0), addVertex(f, 5, 4), 0.10)     // 4 m, toca el borde inferior
    addEdge(f, addVertex(f, 5, 4.5), addVertex(f, 5, 8), 0.10)   // 3.5 m, toca el borde superior
    const { widthMarks } = widthHeightChains(f)
    expect(widthMarks).toEqual([0, 10])
  })
})

describe('cotaEdges', () => {
  it('excludes ghosts from the edges that get their own per-edge length cota', () => {
    const f = emptyFloorGraph('Test')
    const { eTop, eLeft } = closedRect(f, 0, 0, 6, 4)
    const a = addVertex(f, 1, 1), b = addVertex(f, 5, 1)
    const ghost = addEdge(f, a, b, GHOST_THICKNESS_M, 'ghost')
    const ids = cotaEdges(f).map(e => e.id)
    expect(ids).toContain(eTop)
    expect(ids).toContain(eLeft)
    expect(ids).not.toContain(ghost)
  })
})

describe('cornerAngles', () => {
  it('finds a 90 degree angle at every corner of a plain rectangle', () => {
    const f = emptyFloorGraph('Test')
    closedRect(f, 0, 0, 6, 4)
    const angles = cornerAngles(f)
    expect(angles).toHaveLength(4)
    angles.forEach(a => expect(a.deg).toBeCloseTo(90, 0))
    angles.forEach(a => expect(a.isRight).toBe(true))
  })
})
