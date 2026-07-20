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

describe('with a camera', () => {
  it('centers px/py on camera.centerX/centerY at the given scale, ignoring content bounds', () => {
    const f1 = emptyFloorGraph('A')
    addVertex(f1, 0, 0); addVertex(f1, 6, 5)
    const camera = { scale: 100, centerX: 3, centerY: 2 }
    const t = viewTransform([f1], { width: 900, height: 560, margin: 48 }, camera)
    expect(t.px(3)).toBeCloseTo(450) // width/2
    expect(t.py(2)).toBeCloseTo(280) // height/2
    expect(t.scale).toBe(100)
  })

  it('userToWorld inverts px/py under a camera', () => {
    const f1 = emptyFloorGraph('A')
    const camera = { scale: 150, centerX: 1, centerY: 1 }
    const t = viewTransform([f1], { width: 900, height: 560, margin: 48 }, camera)
    const world = t.userToWorld(t.px(4), t.py(-2))
    expect(world.x).toBeCloseTo(4)
    expect(world.y).toBeCloseTo(-2)
  })

  it('a null camera falls back to the existing auto-fit behavior exactly', () => {
    const f1 = emptyFloorGraph('A')
    addVertex(f1, 0, 0); addVertex(f1, 6, 5)
    const withoutArg = viewTransform([f1], { width: 900, height: 560, margin: 48 })
    const withNull = viewTransform([f1], { width: 900, height: 560, margin: 48 }, null)
    expect(withNull.scale).toBe(withoutArg.scale)
    expect(withNull.px(3)).toBe(withoutArg.px(3))
    expect(withNull.py(2)).toBe(withoutArg.py(2))
  })
})
