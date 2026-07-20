import { describe, it, expect } from 'vitest'
import { emptyFloorGraph } from './types'
import { addVertex, addEdge, splitEdgeAtVertex } from './graph'
import { widthHeightChains, cornerAngles } from './dimensions'

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
