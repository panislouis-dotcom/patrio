// app/web/src/components/FloorPlanEditor.calibrate.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import FloorPlanEditor, { type PlanApi } from './FloorPlanEditor'
import { emptyFloorGraph, type FloorPlanModel } from '../lib/floorplan/types'
import { viewTransform } from '../lib/floorplan/viewTransform'

// Same jsdom PointerEvent gap as FloorPlanEditor.interaction.test.tsx: jsdom ships no
// PointerEvent constructor, so @testing-library's fireEvent.pointerDown/Move/Up would
// otherwise fall back to a plain Event that silently drops clientX/clientY.
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

const EDITOR_W = 900, EDITOR_H = 560, EDITOR_MARGIN = 48

// See FloorPlanEditor.interaction.test.tsx's pointerAt for the full rationale: this
// forward-transforms a MODEL-space point through the same viewTransform the component
// derives from `floors`, landing pointerToWorld's fallback path exactly on that point.
function pointerAt(floors: FloorPlanModel['floors'], worldX: number, worldY: number) {
  const t = viewTransform(floors, { width: EDITOR_W, height: EDITOR_H, margin: EDITOR_MARGIN })
  return { clientX: t.px(worldX), clientY: t.py(worldY) }
}

function modelWithReference(): FloorPlanModel {
  const f = emptyFloorGraph('Test')
  f.reference = { imageKey: 'ref-abc123', scale_m_per_px: 0.01, origin_px: [0, 0], opacity: 0.5 }
  return { schemaVersion: 2, slab_m: 0.15, activeFloor: 0, floors: [f] }
}

describe('reference underlay controls', () => {
  it('renders the opacity slider and Calibrate toggle when a reference image is set', () => {
    const model = modelWithReference()
    const onSave = vi.fn()
    render(<FloorPlanEditor projectId={1} initial={model} onSave={onSave} />)
    expect(screen.getByLabelText('Underlay opacity')).toBeTruthy()
    expect(screen.getByText('Calibrate')).toBeTruthy()
  })
})

describe('calibration flow', () => {
  it('draws a line, enters its real length, and applies a new scale_m_per_px', () => {
    const model = modelWithReference()
    const onSave = vi.fn()
    let api: PlanApi | null = null
    const { container } = render(
      <FloorPlanEditor projectId={1} initial={model} onSave={onSave} onReady={a => { api = a }} />,
    )
    const svg = container.querySelector('svg')!

    // Toggle calibrating mode on.
    fireEvent.click(screen.getByText('Calibrate'))
    expect(screen.getByText('Drag a line over a known dimension.')).toBeTruthy()

    // Draw a calibration line from (0.1, 0.1) to (0.1, 0.9) in model space.
    fireEvent.pointerDown(svg, pointerAt(model.floors, 0.1, 0.1))
    fireEvent.pointerMove(svg, pointerAt(model.floors, 0.1, 0.9))
    fireEvent.pointerUp(svg)

    // Once a draft line exists, the length input and Apply button appear.
    const lenInput = screen.getByPlaceholderText('Length (m)')
    fireEvent.change(lenInput, { target: { value: '2' } })

    const applyBtn = screen.getByText('Apply') as HTMLButtonElement
    expect(applyBtn.disabled).toBe(false)
    fireEvent.click(applyBtn)

    expect(api).not.toBeNull()
    const finalModel = api!.getModel()
    const finalScale = finalModel.floors[0].reference!.scale_m_per_px
    expect(finalScale).not.toBe(0.01)
    // pixel distance for this draft line, at the model's ORIGINAL scale_m_per_px (0.01), is
    // |0.1/0.01 - 0.9/0.01| = 80px; entering a real length of 2m means 2 / 80 = 0.025.
    expect(finalScale).toBeCloseTo(0.025, 6)
  })
})
