// app/web/src/components/FloorPlanPanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import FloorPlanPanel from './FloorPlanPanel'
import { emptyFloorGraph } from '../lib/floorplan/types'
import { addVertex, addEdge } from '../lib/floorplan/graph'
import { roomAreas } from '../lib/floorplan/rooms'
import { initialState, reducer } from '../lib/floorplan/reducer'
import type { Sel } from '../lib/floorplan/reducer'

// setup builds a fresh floor per call (vertex ids are crypto.randomUUID()), so a selection
// must reference one of THIS call's vertex ids — hence `makeSel` is handed the real ids
// instead of the caller passing in an id from an unrelated floor.
function setup(makeSel?: (ids: { a: string; b: string; c: string; d: string }) => Sel) {
  const f = emptyFloorGraph('Planta baja')
  const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3), d = addVertex(f, 0, 3)
  addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
  const model = { schemaVersion: 2 as const, slab_m: 0.15, activeFloor: 0, floors: [f] }
  let state = initialState(model)
  if (makeSel) state = reducer(state, { type: 'SET_SEL', sel: makeSel({ a, b, c, d }) })
  const dispatch = vi.fn()
  const rooms = roomAreas(f)
  const geoJson = '{}'
  render(<FloorPlanPanel model={state.model} floor={f} rooms={rooms} geoJson={geoJson} ui={state.ui} dispatch={dispatch} />)
  return { dispatch, f, ids: { a, b, c, d } }
}

describe('FloorPlanPanel', () => {
  it('shows editable x/y fields when a vertex is selected', () => {
    const { dispatch, ids } = setup(vids => ({ t: 'vertex', id: vids.a }))
    const xInput = screen.getByLabelText(/x \(m\)/i) as HTMLInputElement
    fireEvent.change(xInput, { target: { value: '2.5' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_VERTEX_POINT', id: ids.a, x: 2.5, y: 0 })
  })

  it('dispatches SET_FLOOR_PARAM when the exterior wall default changes', () => {
    const { dispatch } = setup()
    const extInput = screen.getByLabelText(/muro ext/i) as HTMLInputElement
    fireEvent.change(extInput, { target: { value: '0.2' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FLOOR_PARAM', key: 'extWall_m', value: 0.2 })
  })

  it('lists computed room areas in the stats section', () => {
    // This fixture is a plain rectangle with no interior partition walls, so the sole
    // traced "room" face is the whole floor — its area legitimately matches the gross
    // area readout too, hence getAllByText (not getByText) for the shared "12.0" text.
    setup()
    expect(screen.getAllByText(/12\.0/).length).toBeGreaterThan(0) // 4m x 3m room = 12 m²
  })
})
