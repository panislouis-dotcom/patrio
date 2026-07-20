import { describe, it, expect } from 'vitest'
import { viewTransform } from './viewTransform'
import { emptyFloorGraph } from './types'
import { addVertex } from './graph'

describe('viewTransform', () => {
  it('fits all vertices across all floors into the viewport with margin', () => {
    const f1 = emptyFloorGraph('A')
    addVertex(f1, 0, 0); addVertex(f1, 6, 5)
    const t = viewTransform([f1], { width: 900, height: 560, margin: 48 })
    expect(t.px(0)).toBeCloseTo(48)
    expect(t.py(0)).toBeCloseTo(560 - 48)
  })
  it('userToWorld inverts px/py', () => {
    const f1 = emptyFloorGraph('A')
    addVertex(f1, 0, 0); addVertex(f1, 6, 5)
    const t = viewTransform([f1], { width: 900, height: 560, margin: 48 })
    const world = t.userToWorld(t.px(3), t.py(2))
    expect(world.x).toBeCloseTo(3)
    expect(world.y).toBeCloseTo(2)
  })
  it('defaults to a sane box when there are no vertices yet', () => {
    const t = viewTransform([emptyFloorGraph('A')], { width: 900, height: 560, margin: 48 })
    expect(Number.isFinite(t.scale)).toBe(true)
    expect(t.scale).toBeGreaterThan(0)
  })
})
