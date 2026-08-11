// app/web/src/components/FloorPlanEditor.interaction.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import FloorPlanEditor from './FloorPlanEditor'
import { emptyFloorGraph, GHOST_THICKNESS_M, FIXTURE_CATALOG, type FloorGraph, type Fixture } from '../lib/floorplan/types'
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
  return { slab_m: 0.15, activeFloor: 0, floors: [f] }
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
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'test-key' })} initial={model} onSave={onSave} />)
    const svg = container.querySelector('svg')!
    const vertexHandle = svg.querySelector('[data-el="vertex"]')!
    const id = vertexHandle.getAttribute('data-id')!
    const before = { cx: vertexHandle.getAttribute('cx'), cy: vertexHandle.getAttribute('cy') }
    // Full assertion of "did every attached wall follow" happens via the reducer/graph unit
    // tests (moveVertex test) — this test's job is to prove the COMPONENT wires a
    // real pointer gesture through to that same code path without regressing it, which
    // requires re-querying THIS SAME vertex (by its captured id) after the gesture and
    // confirming its rendered position actually changed — a bare "some vertex handle still
    // exists" check would pass even if the drag wiring did nothing at all.
    fireEvent.pointerDown(vertexHandle, pointerAt(model.floors, 0, 0))
    fireEvent.pointerMove(svg, pointerAt(model.floors, 1.5, 1))
    fireEvent.pointerUp(svg)
    const moved = svg.querySelector(`[data-el="vertex"][data-id="${id}"]`)!
    expect(moved.getAttribute('cx')).not.toBe(before.cx)
    expect(moved.getAttribute('cy')).not.toBe(before.cy)
  })
})

describe('edge-midpoint split without a following drag', () => {
  it('clicking a wall midpoint to add a corner, then releasing without moving, produces exactly one undo step', () => {
    const model = modelWithRectangleAndDivider()
    const onSave = vi.fn()
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'test-key' })} initial={model} onSave={onSave} />)
    const svg = container.querySelector('svg')!
    const before = svg.querySelectorAll('[data-el="edge"]').length
    const midHandle = svg.querySelector('[data-el="edgeMid"]')!
    // Click-and-release with NO pointermove in between — the ordinary "just add a corner
    // here" gesture. This must not leave the drag machinery thinking a real drag happened.
    fireEvent.pointerDown(midHandle, pointerAt(model.floors, 3, 0))
    fireEvent.pointerUp(svg)
    expect(svg.querySelectorAll('[data-el="edge"]').length).toBe(before + 1) // the split committed
    // A single Ctrl+Z must fully revert the split in one step — not leave a spurious
    // duplicate history entry that makes the first Ctrl+Z a no-op.
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(svg.querySelectorAll('[data-el="edge"]').length).toBe(before)
  })
})

describe('wall-body drag does not force-straighten a diagonal wall', () => {
  it('preserves the vector between the wall\'s two endpoints through a body drag', () => {
    const f = emptyFloorGraph('Test')
    const v1 = addVertex(f, 1, 1), v2 = addVertex(f, 4, 3)
    addEdge(f, v1, v2, 0.10)
    const model = { slab_m: 0.15, activeFloor: 0, floors: [f] }
    const onSave = vi.fn()
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'test-key' })} initial={model} onSave={onSave} />)
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
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'test-key' })} initial={model} onSave={onSave} />)
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
    const model = { slab_m: 0.15, activeFloor: 0, floors: [f] }
    const onSave = vi.fn()
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'test-key' })} initial={model} onSave={onSave} />)
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

describe('zoom buttons', () => {
  it('clicking + zooms in around the canvas center, pushing off-center vertices farther from center on screen', () => {
    const model = modelWithRectangleAndDivider()
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const vertexHandle = container.querySelectorAll('[data-el="vertex"]')[0] // (0,0) -- far from canvas center
    const beforeCx = Number(vertexHandle.getAttribute('cx'))
    fireEvent.click(container.querySelector('[aria-label="Zoom in"]')!)
    const afterCx = Number(container.querySelectorAll('[data-el="vertex"]')[0].getAttribute('cx'))
    expect(Math.abs(afterCx - 450)).toBeGreaterThan(Math.abs(beforeCx - 450)) // 450 = W/2
  })

  it('clicking - zooms out, pulling vertices closer to the canvas center', () => {
    const model = modelWithRectangleAndDivider()
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const vertexHandle = container.querySelectorAll('[data-el="vertex"]')[0]
    const beforeCx = Number(vertexHandle.getAttribute('cx'))
    fireEvent.click(container.querySelector('[aria-label="Zoom out"]')!)
    const afterCx = Number(container.querySelectorAll('[data-el="vertex"]')[0].getAttribute('cx'))
    expect(Math.abs(afterCx - 450)).toBeLessThan(Math.abs(beforeCx - 450))
  })

  it('the fit button restores the original auto-fit view after zooming', () => {
    const model = modelWithRectangleAndDivider()
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const vertexHandle = container.querySelectorAll('[data-el="vertex"]')[0]
    const beforeCx = vertexHandle.getAttribute('cx'), beforeCy = vertexHandle.getAttribute('cy')
    fireEvent.click(container.querySelector('[aria-label="Zoom in"]')!)
    fireEvent.click(container.querySelector('[aria-label="Zoom in"]')!)
    fireEvent.click(container.querySelector('[aria-label="Fit to screen"]')!)
    const after = container.querySelectorAll('[data-el="vertex"]')[0]
    expect(after.getAttribute('cx')).toBe(beforeCx)
    expect(after.getAttribute('cy')).toBe(beforeCy)
  })
})

describe('scroll-wheel zoom', () => {
  it('scrolling up over a vertex zooms in anchored at the cursor, keeping that vertex fixed on screen', () => {
    const model = modelWithRectangleAndDivider()
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    const anchorPos = pointerAt(model.floors, 0, 0) // vertex a=(0,0)'s own screen position
    const before = svg.querySelectorAll('[data-el="vertex"]')
    const beforeAnchorCx = before[0].getAttribute('cx'), beforeAnchorCy = before[0].getAttribute('cy')
    const beforeFarCx = Number(before[2].getAttribute('cx')) // vertex c=(6,4), far from the anchor
    fireEvent.wheel(svg, { ...anchorPos, deltaY: -100 })
    const after = svg.querySelectorAll('[data-el="vertex"]')
    expect(Number(after[0].getAttribute('cx'))).toBeCloseTo(Number(beforeAnchorCx))
    expect(Number(after[0].getAttribute('cy'))).toBeCloseTo(Number(beforeAnchorCy))
    expect(Number(after[2].getAttribute('cx'))).toBeGreaterThan(beforeFarCx) // scale increased, far corner pushed further away
  })

  it('scrolling down zooms out', () => {
    const model = modelWithRectangleAndDivider()
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    const beforeFarCx = Number(svg.querySelectorAll('[data-el="vertex"]')[2].getAttribute('cx'))
    fireEvent.wheel(svg, { ...pointerAt(model.floors, 0, 0), deltaY: 100 })
    const afterFarCx = Number(svg.querySelectorAll('[data-el="vertex"]')[2].getAttribute('cx'))
    expect(afterFarCx).toBeLessThan(beforeFarCx)
  })
})

describe('pan via drag on empty canvas', () => {
  it('clicking empty canvas with no movement still clears the selection', () => {
    const model = modelWithRectangleAndDivider()
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    const vertexHandle = svg.querySelectorAll('[data-el="vertex"]')[0]
    fireEvent.pointerDown(vertexHandle, pointerAt(model.floors, 0, 0))
    fireEvent.pointerUp(svg)
    expect(svg.querySelectorAll('[data-el="vertex"]')[0].getAttribute('r')).toBe('6') // selected
    // (850, 30) is well outside the model's auto-fit bounding box (screen x:[48,744], y:[48,512]
    // for this model), so it hits no vertex/edge/room element -- truly empty canvas.
    fireEvent.pointerDown(svg, { clientX: 850, clientY: 30 })
    fireEvent.pointerUp(svg)
    expect(svg.querySelectorAll('[data-el="vertex"]')[0].getAttribute('r')).toBe('4.5') // deselected
  })

  it('dragging on empty canvas pans the view instead of clearing the selection', () => {
    const model = modelWithRectangleAndDivider()
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    const vertexHandle = svg.querySelectorAll('[data-el="vertex"]')[0]
    fireEvent.pointerDown(vertexHandle, pointerAt(model.floors, 0, 0))
    fireEvent.pointerUp(svg)
    const beforeCx = Number(vertexHandle.getAttribute('cx'))
    fireEvent.pointerDown(svg, { clientX: 850, clientY: 30 })
    fireEvent.pointerMove(svg, { clientX: 800, clientY: 80 })
    fireEvent.pointerUp(svg)
    const after = svg.querySelectorAll('[data-el="vertex"]')[0]
    expect(Number(after.getAttribute('cx'))).not.toBe(beforeCx) // the view panned
    expect(after.getAttribute('r')).toBe('6') // selection preserved, NOT cleared by the drag
  })
})

// Rectángulo 6x4 más una división fantasma vertical suelta en x=3 (de (3,0.5) a (3,3.5)).
function modelWithGhostDivision() {
  const f = emptyFloorGraph('Test')
  const a = addVertex(f, 0, 0), b = addVertex(f, 6, 0), c = addVertex(f, 6, 4), d = addVertex(f, 0, 4)
  addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
  const g1 = addVertex(f, 3, 0.5), g2 = addVertex(f, 3, 3.5)
  addEdge(f, g1, g2, GHOST_THICKNESS_M, 'ghost')
  return { slab_m: 0.15, activeFloor: 0, floors: [f] }
}

// El selector distingue divisiones de muros por el atributo que las dibuja punteadas:
// mismo data-el="edge" (mismo hit-testing) pero con stroke-dasharray presente.
const dashedEdges = (svg: SVGSVGElement) => svg.querySelectorAll('[data-el="edge"][stroke-dasharray]')

describe('herramienta DIVISIÓN (paredes fantasma)', () => {
  it('el botón división inserta una arista punteada seleccionada, con su inspector de división', () => {
    const model = modelWithRectangleAndDivider()
    const { container, getByText } = render(
      <FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    expect(dashedEdges(svg).length).toBe(0)
    fireEvent.click(getByText('división'))
    expect(dashedEdges(svg).length).toBe(1)
    // El inspector de la arista recién seleccionada es el de división, no el de muro:
    // prueba que el kind 'ghost' llegó al modelo, no solo al estilo del trazo.
    expect(getByText('CONVERTIR EN MURO')).toBeTruthy()
  })

  it('una división se arrastra como cualquier arista', () => {
    const model = modelWithGhostDivision()
    const { container } = render(
      <FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    const ghostLine = dashedEdges(svg)[0]
    const beforeX1 = ghostLine.getAttribute('x1')
    fireEvent.pointerDown(ghostLine, pointerAt(model.floors, 3, 2))
    fireEvent.pointerMove(svg, pointerAt(model.floors, 3.5, 2))
    fireEvent.pointerUp(svg)
    expect(dashedEdges(svg)[0].getAttribute('x1')).not.toBe(beforeX1)
  })

  it('la herramienta delete elimina una división y deja los muros intactos', () => {
    const model = modelWithGhostDivision()
    const { container, getByText } = render(
      <FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    fireEvent.click(getByText('delete'))
    fireEvent.pointerDown(dashedEdges(svg)[0], pointerAt(model.floors, 3, 2))
    expect(dashedEdges(svg).length).toBe(0)
    expect(svg.querySelectorAll('[data-el="edge"]').length).toBe(4)
  })

  it('la herramienta puerta sobre una división no crea vano (la guarda ADD_OPENING del engine aplica)', () => {
    const model = modelWithGhostDivision()
    const { container, getByText } = render(
      <FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    fireEvent.click(getByText('door'))
    fireEvent.pointerDown(dashedEdges(svg)[0], pointerAt(model.floors, 3, 2))
    expect(svg.querySelectorAll('[data-el="opening"]').length).toBe(0)
  })

  it('la búsqueda del muro más cercano para vanos ignora divisiones', () => {
    const model = modelWithGhostDivision()
    const { container, getByText } = render(
      <FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    fireEvent.click(getByText('door'))
    // Clic en canvas vacío a 0.2m de la división (x=3) y 0.55m del muro inferior (y=0),
    // ambos dentro del radio de 0.6m: si la búsqueda no salta fantasmas, la división
    // gana "más cercana" y el clic muere en el no-op de ADD_OPENING — sin vano y sin aviso.
    fireEvent.pointerDown(svg, pointerAt(model.floors, 2.8, 0.55))
    const openings = svg.querySelectorAll('[data-el="opening"]')
    expect(openings.length).toBeGreaterThan(0)
    // …y el vano cayó en un MURO (arista sin punteado), no en la división.
    const edgeId = openings[0].getAttribute('data-edge')!
    expect(svg.querySelector(`[data-el="edge"][data-id="${edgeId}"]`)!.hasAttribute('stroke-dasharray')).toBe(false)
  })

  it('la herramienta puerta sobre un muro sigue agregando el vano, en UNA sola entrada de historia', () => {
    const model = modelWithGhostDivision()
    const { container, getByText } = render(
      <FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    fireEvent.click(getByText('door'))
    const wallLine = svg.querySelector('[data-el="edge"]:not([stroke-dasharray])')!
    fireEvent.pointerDown(wallLine, pointerAt(model.floors, 1.5, 0))
    expect(svg.querySelectorAll('[data-el="opening"]').length).toBeGreaterThan(0)
    // Un solo Ctrl+Z lo revierte completo — la acción ADD_OPENING empuja exactamente una entrada.
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(svg.querySelectorAll('[data-el="opening"]').length).toBe(0)
  })
})

// Rectángulo 6x4 con un mueble ya colocado en su centro geométrico (3,2), para probar
// arrastre/borrado sin pasar primero por la paleta.
function modelWithFixture(kind: Fixture['kind'] = 'mesa', x = 3, y = 2) {
  const f = emptyFloorGraph('Test')
  const a = addVertex(f, 0, 0), b = addVertex(f, 6, 0), c = addVertex(f, 6, 4), d = addVertex(f, 0, 4)
  addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
  const dims = FIXTURE_CATALOG[kind]
  const fixture: Fixture = { id: 'fx-test', kind, x, y, rot: 0, w_m: dims.w_m, h_m: dims.h_m }
  f.fixtures = [fixture]
  return { slab_m: 0.15, activeFloor: 0, floors: [f] }
}

// El rect de un mueble vive dentro de un <g transform="translate(cx cy) rotate(...)">; leer
// su centro en pantalla exige parsear ese transform en vez de leer x/y directo del rect
// (que están expresados relativos al centro del propio grupo, no al SVG).
function fixtureCenter(rect: Element): { x: number; y: number } {
  const g = rect.parentElement!
  const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(g.getAttribute('transform') || '')
  if (!m) throw new Error('fixture <g> sin transform translate()')
  return { x: Number(m[1]), y: Number(m[2]) }
}

describe('mobiliario: paleta, arrastre, borrado', () => {
  it('el botón MUEBLE abre una paleta; elegir un tipo lo coloca al centro del viewport con las dimensiones del catálogo', () => {
    const model = modelWithRectangleAndDivider()
    const { container, getByText } = render(
      <FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    expect(svg.querySelectorAll('[data-el="fixture"]').length).toBe(0)
    fireEvent.click(getByText('MUEBLE'))
    fireEvent.click(getByText(FIXTURE_CATALOG.cama_matrimonial.label))
    const rects = svg.querySelectorAll('[data-el="fixture"]')
    expect(rects.length).toBe(1)
    const rect = rects[0]
    // Dimensiones del catálogo: la proporción ancho/alto del rect (independiente de la
    // escala del viewTransform) debe coincidir con w_m/h_m de cama_matrimonial (1.40×1.90).
    const ratio = Number(rect.getAttribute('width')) / Number(rect.getAttribute('height'))
    expect(ratio).toBeCloseTo(FIXTURE_CATALOG.cama_matrimonial.w_m / FIXTURE_CATALOG.cama_matrimonial.h_m)
    // Centro del viewport = (EDITOR_W/2, EDITOR_H/2), igual que seedCamera() en ZOOM_AT.
    const center = fixtureCenter(rect)
    expect(center.x).toBeCloseTo(EDITOR_W / 2)
    expect(center.y).toBeCloseTo(EDITOR_H / 2)
  })

  it('colocar dos muebles de tipos distintos produce dimensiones distintas (no un tamaño fijo)', () => {
    const model = modelWithRectangleAndDivider()
    const { container, getByText } = render(
      <FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    fireEvent.click(getByText('MUEBLE'))
    fireEvent.click(getByText(FIXTURE_CATALOG.silla.label))
    fireEvent.click(getByText('MUEBLE'))
    fireEvent.click(getByText(FIXTURE_CATALOG.sillon.label))
    const rects = svg.querySelectorAll('[data-el="fixture"]')
    expect(rects.length).toBe(2)
    const [silla, sillon] = Array.from(rects)
    // La silla es cuadrada (0.45×0.45) y el sillón no (2.00×0.90): sus proporciones deben diferir.
    const sillaRatio = Number(silla.getAttribute('width')) / Number(silla.getAttribute('height'))
    const sillonRatio = Number(sillon.getAttribute('width')) / Number(sillon.getAttribute('height'))
    expect(sillaRatio).toBeCloseTo(1)
    expect(sillonRatio).toBeCloseTo(FIXTURE_CATALOG.sillon.w_m / FIXTURE_CATALOG.sillon.h_m)
    expect(sillonRatio).not.toBeCloseTo(sillaRatio, 1)
  })

  it('seleccionar un mueble en el canvas fija sel={t:"fixture",id} y arrastrarlo cambia su posición en UN solo paso de historia', () => {
    const model = modelWithFixture('mesa', 3, 2)
    const { container } = render(
      <FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    const fixtureRect = svg.querySelector('[data-el="fixture"]')!
    const before = fixtureCenter(fixtureRect)
    // Gesto multi-frame, igual que el test de undo/redo de vértice: cada frame despacha
    // DRAG_MODEL (sin empujar historia) y solo el pointerUp final hace el único SET_MODEL.
    fireEvent.pointerDown(fixtureRect, pointerAt(model.floors, 3, 2))
    fireEvent.pointerMove(svg, pointerAt(model.floors, 3.5, 2.3))
    fireEvent.pointerMove(svg, pointerAt(model.floors, 4, 2.6))
    fireEvent.pointerUp(svg)
    const moved = fixtureCenter(svg.querySelector('[data-el="fixture"]')!)
    expect(moved.x).not.toBeCloseTo(before.x)
    expect(moved.y).not.toBeCloseTo(before.y)
    // Un solo Ctrl+Z revierte TODO el gesto de una vez, no un frame intermedio.
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    const reverted = fixtureCenter(svg.querySelector('[data-el="fixture"]')!)
    expect(reverted.x).toBeCloseTo(before.x)
    expect(reverted.y).toBeCloseTo(before.y)
  })

  it('la herramienta delete borra el mueble seleccionado', () => {
    const model = modelWithFixture('lavabo', 3, 2)
    const { container, getByText } = render(
      <FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    expect(svg.querySelectorAll('[data-el="fixture"]').length).toBe(1)
    fireEvent.click(getByText('delete'))
    fireEvent.pointerDown(svg.querySelector('[data-el="fixture"]')!, pointerAt(model.floors, 3, 2))
    expect(svg.querySelectorAll('[data-el="fixture"]').length).toBe(0)
  })

  it('la rotación del modelo (CCW en mundo) se dibuja con el signo invertido en el <g> de pantalla', () => {
    // fx.rot es CCW en coordenadas de mundo (y-arriba); el mapeo mundo→pantalla invierte el
    // eje Y, así que el <g> debe rotar con -rot para que la orientación visual coincida con
    // el modelo. Este test fija ese signo como regresión — ver el comentario homónimo en
    // FloorPlanCanvas.tsx.
    const model = modelWithFixture('escritorio', 3, 2)
    model.floors[0].fixtures![0].rot = 90
    const { container } = render(
      <FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    const rect = svg.querySelector('[data-el="fixture"]')!
    const transform = rect.parentElement!.getAttribute('transform') || ''
    expect(transform).toContain('rotate(-90')
  })
})

describe('naming any space (the "nombrar" tool)', () => {
  function placeLabel(svg: SVGSVGElement, container: HTMLElement, getByText: (t: string) => HTMLElement,
                      floors: FloorGraph[], worldX: number, worldY: number, name: string) {
    fireEvent.click(getByText('nombrar'))                              // activate the tool
    fireEvent.pointerDown(svg, pointerAt(floors, worldX, worldY))      // click the spot
    const input = container.querySelector('input.roomedit') as HTMLInputElement
    expect(input).toBeTruthy()                                         // the rename input appears
    fireEvent.change(input, { target: { value: name } })
    fireEvent.keyDown(input, { key: 'Enter' })
  }

  it('names an open spot outside the walls, and the name shows on the plan', () => {
    const model = modelWithRectangleAndDivider()
    const { container, getByText } = render(
      <FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    placeLabel(svg, container, getByText, model.floors, 10, 2, 'Jardín')
    expect(getByText('Jardín')).toBeTruthy()
  })

  it('the delete tool removes a placed label', () => {
    const model = modelWithRectangleAndDivider()
    const { container, getByText, queryByText } = render(
      <FloorPlanEditor onUploadImage={async () => ({ imageKey: 'k' })} initial={model} onSave={vi.fn()} />)
    const svg = container.querySelector('svg')!
    placeLabel(svg, container, getByText, model.floors, 10, 2, 'Jardín')
    expect(getByText('Jardín')).toBeTruthy()
    fireEvent.click(getByText('delete'))
    fireEvent.pointerDown(getByText('Jardín'))   // the placed label carries its own data-cx/cy
    expect(queryByText('Jardín')).toBeNull()
  })
})
