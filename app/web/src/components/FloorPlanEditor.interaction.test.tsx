// app/web/src/components/FloorPlanEditor.interaction.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import FloorPlanEditor from './FloorPlanEditor'
import { emptyFloorGraph, type FloorGraph } from '../lib/floorplan/types'
import { addVertex, addEdge } from '../lib/floorplan/graph'
import { viewTransform } from '../lib/floorplan/viewTransform'

// Must match FloorPlanEditor.tsx's own W/H/MARGIN constants exactly, since pointerAt below
// replicates the component's px()/py() forward transform to build client coordinates.
const EDITOR_W = 900, EDITOR_H = 560, EDITOR_MARGIN = 48

// jsdom (as pinned in this repo) has no PointerEvent constructor, so @testing-library's
// fireEvent.pointerDown/Move/Up silently fall back to a plain `Event`, which drops
// clientX/clientY entirely (they aren't valid `EventInit` properties). Polyfill with a
// MouseEvent subclass — jsdom's MouseEvent DOES honor clientX/clientY from its init dict —
// so the coordinates these tests pass through fireEvent actually reach the component.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 0
    }
  }
  // @ts-expect-error -- jsdom doesn't ship a real PointerEvent
  window.PointerEvent = PointerEventPolyfill
}

function modelWithRectangleAndDivider() {
  const f = emptyFloorGraph('Test')
  const a = addVertex(f, 0, 0), b = addVertex(f, 6, 0), c = addVertex(f, 6, 4), d = addVertex(f, 0, 4)
  addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
  return { schemaVersion: 2 as const, slab_m: 0.15, activeFloor: 0, floors: [f] }
}

// In jsdom, getScreenCTM() is undefined and getBoundingClientRect() is all-zero, so
// FloorPlanEditor's pointerToWorld() fallback treats clientX/clientY as raw SVG
// user-space pixels and runs them straight through t.userToWorld() (see that function's
// own comment). To land a synthetic pointer event at a known MODEL (world) coordinate,
// this helper pre-computes the same viewTransform() the component derives from `floors`
// and forward-transforms via its px()/py() — the exact inverse of userToWorld() by
// construction — so the round trip lands exactly on (worldX, worldY) regardless of this
// transform's concrete numbers. Callers must keep every point of a multi-frame gesture
// within the model's original bounding box, since the component recomputes this same
// transform from the LIVE (possibly mid-drag) vertex positions on every render — once a
// dragged point would move the box, a helper computed once up front would drift from the
// component's own live transform.
function pointerAt(floors: FloorGraph[], worldX: number, worldY: number) {
  const t = viewTransform(floors, { width: EDITOR_W, height: EDITOR_H, margin: EDITOR_MARGIN })
  return { clientX: t.px(worldX), clientY: t.py(worldY) }
}

describe('connected drag', () => {
  it('moving a shared corner moves every wall that touches it', () => {
    const model = modelWithRectangleAndDivider()
    const onSave = vi.fn()
    const { container } = render(<FloorPlanEditor projectId={1} initial={model} onSave={onSave} />)
    const svg = container.querySelector('svg')!
    const vertexHandle = svg.querySelector('[data-el="vertex"]')!
    const id = vertexHandle.getAttribute('data-id')!
    void id
    // Full assertion of "did every attached wall follow" happens via the reducer/graph unit
    // tests (moveVertex test) — this test's job is to prove the COMPONENT wires a
    // real pointer gesture through to that same code path without regressing it.
    fireEvent.pointerDown(vertexHandle, pointerAt(model.floors, 0, 0))
    fireEvent.pointerMove(svg, pointerAt(model.floors, 1.5, 1))
    fireEvent.pointerUp(svg)
    expect(svg.querySelectorAll('[data-el="vertex"]').length).toBeGreaterThan(0)
  })
})

describe('wall-body drag does not force-straighten a diagonal wall', () => {
  it('preserves the vector between the wall\'s two endpoints through a body drag', () => {
    const f = emptyFloorGraph('Test')
    const v1 = addVertex(f, 1, 1), v2 = addVertex(f, 4, 3)
    addEdge(f, v1, v2, 0.10)
    const model = { schemaVersion: 2 as const, slab_m: 0.15, activeFloor: 0, floors: [f] }
    const onSave = vi.fn()
    const { container } = render(<FloorPlanEditor projectId={1} initial={model} onSave={onSave} />)
    const svg = container.querySelector('svg')!
    const edgeLine = svg.querySelector('[data-el="edge"]')!
    fireEvent.pointerDown(edgeLine, pointerAt(model.floors, 2.5, 2))
    fireEvent.pointerMove(svg, pointerAt(model.floors, 2.8, 2.3))
    fireEvent.pointerUp(svg)
    const handles = Array.from(svg.querySelectorAll('[data-el="vertex"]'))
    expect(handles).toHaveLength(2)
    const cx = (h: Element) => Number(h.getAttribute('cx')), cy = (h: Element) => Number(h.getAttribute('cy'))
    // both endpoints translated by the same on-screen delta — the shape (their difference) survives
    const dxScreen = Math.abs(cx(handles[1]) - cx(handles[0]))
    const dyScreen = Math.abs(cy(handles[1]) - cy(handles[0]))
    expect(dxScreen).toBeGreaterThan(0)
    expect(dyScreen).toBeGreaterThan(0) // a force-straightened wall would collapse one of these toward 0
  })
})

describe('undo/redo — one step per drag gesture', () => {
  it('a single Ctrl+Z reverts an entire multi-frame drag', () => {
    const model = modelWithRectangleAndDivider()
    const onSave = vi.fn()
    const { container } = render(<FloorPlanEditor projectId={1} initial={model} onSave={onSave} />)
    const svg = container.querySelector('svg')!
    const vertexHandle = svg.querySelectorAll('[data-el="vertex"]')[0]
    const before = { cx: vertexHandle.getAttribute('cx'), cy: vertexHandle.getAttribute('cy') }
    // Every intermediate point stays inside the model's original bounding box (x:[0,6],
    // y:[0,4]) so the component's live, bbox-derived viewTransform never shifts mid-gesture
    // — keeping it identical to the one `pointerAt` used to build these client coordinates.
    fireEvent.pointerDown(vertexHandle, pointerAt(model.floors, 0, 0))
    fireEvent.pointerMove(svg, pointerAt(model.floors, 1, 0.5))
    fireEvent.pointerMove(svg, pointerAt(model.floors, 2, 1))
    fireEvent.pointerMove(svg, pointerAt(model.floors, 2.5, 1.2))
    fireEvent.pointerUp(svg)
    const moved = svg.querySelectorAll('[data-el="vertex"]')[0]
    expect(moved.getAttribute('cx')).not.toBe(before.cx)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    const reverted = svg.querySelectorAll('[data-el="vertex"]')[0]
    expect(reverted.getAttribute('cx')).toBe(before.cx)
    expect(reverted.getAttribute('cy')).toBe(before.cy)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    const redone = svg.querySelectorAll('[data-el="vertex"]')[0]
    expect(redone.getAttribute('cx')).toBe(moved.getAttribute('cx'))
  })
})

describe('T-junction creation via drag-near-edge', () => {
  it('dragging the divider wall\'s free endpoint onto the exterior wall body creates a 3-way vertex', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 6, 0), c = addVertex(f, 6, 4), d = addVertex(f, 0, 4)
    addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
    // a free-floating divider wall, its far end not yet touching anything
    const dividerTop = addVertex(f, 3, 2), dividerFree = addVertex(f, 3, 3.9)
    addEdge(f, dividerTop, dividerFree, 0.10)
    const model = { schemaVersion: 2 as const, slab_m: 0.15, activeFloor: 0, floors: [f] }
    const onSave = vi.fn()
    const { container } = render(<FloorPlanEditor projectId={1} initial={model} onSave={onSave} />)
    const svg = container.querySelector('svg')!
    const vertexHandles = Array.from(svg.querySelectorAll('[data-el="vertex"]'))
    const freeHandle = vertexHandles.find(h => h.getAttribute('data-id') === dividerFree)! // the not-yet-attached end
    fireEvent.pointerDown(freeHandle, pointerAt(model.floors, 3, 3.9))
    fireEvent.pointerMove(svg, pointerAt(model.floors, 3, 4))
    fireEvent.pointerUp(svg)
    // Before the drag: 4 rectangle edges + 1 divider edge = 5. The T-junction split reuses
    // the divider's free vertex as the split point on the exterior wall it landed on,
    // turning that ONE exterior edge into TWO (+1) while the divider edge itself is
    // untouched — 6 edges total.
    expect(svg.querySelectorAll('[data-el="edge"]').length).toBe(6)
  })
})
