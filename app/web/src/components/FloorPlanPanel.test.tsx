// app/web/src/components/FloorPlanPanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import FloorPlanPanel from './FloorPlanPanel'
import { emptyFloorGraph, GHOST_THICKNESS_M } from '../lib/floorplan/types'
import { addVertex, addEdge } from '../lib/floorplan/graph'
import { roomAreas } from '../lib/floorplan/rooms'
import { initialState, reducer } from '../lib/floorplan/reducer'
import type { Sel } from '../lib/floorplan/reducer'

// setup builds a fresh floor per call (vertex ids are crypto.randomUUID()), so a selection
// must reference one of THIS call's vertex/edge ids — hence `makeSel` receives the fully
// built floor plus the real vertex ids, and may mutate it (e.g. push an opening) before
// returning the Sel to select.
function setup(makeSel?: (f: ReturnType<typeof emptyFloorGraph>, ids: { a: string; b: string; c: string; d: string }) => Sel) {
  const f = emptyFloorGraph('Planta baja')
  const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3), d = addVertex(f, 0, 3)
  addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
  const model = { slab_m: 0.15, activeFloor: 0, floors: [f] }
  let state = initialState(model)
  if (makeSel) state = reducer(state, { type: 'SET_SEL', sel: makeSel(f, { a, b, c, d }) })
  const dispatch = vi.fn()
  const rooms = roomAreas(f)
  const geoJson = '{}'
  render(<FloorPlanPanel model={state.model} floor={f} rooms={rooms} geoJson={geoJson} ui={state.ui} dispatch={dispatch} />)
  return { dispatch, f, ids: { a, b, c, d } }
}

describe('FloorPlanPanel', () => {
  it('shows editable x/y fields when a vertex is selected', () => {
    const { dispatch, ids } = setup((_f, vids) => ({ t: 'vertex', id: vids.a }))
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

  it('dispatches SET_FLOOR_PARAM when the interior wall default changes', () => {
    const { dispatch } = setup()
    const intInput = screen.getByLabelText(/muro int/i) as HTMLInputElement
    fireEvent.change(intInput, { target: { value: '0.12' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FLOOR_PARAM', key: 'intWall_m', value: 0.12 })
  })

  it('dispatches SET_FLOOR_FIELD when the floor height changes', () => {
    const { dispatch } = setup()
    const heightInput = screen.getByLabelText(/altura/i) as HTMLInputElement
    fireEvent.change(heightInput, { target: { value: '2.8' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FLOOR_FIELD', key: 'height_m', value: 2.8 })
  })

  it('dispatches SET_SLAB when the slab thickness changes', () => {
    const { dispatch } = setup()
    const slabInput = screen.getByLabelText(/losa/i) as HTMLInputElement
    fireEvent.change(slabInput, { target: { value: '0.2' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SLAB', value: 0.2 })
  })

  it('lists computed room areas in the stats section', () => {
    // This fixture is a plain rectangle with no interior partition walls, so the sole
    // traced "room" face is the whole floor — its area legitimately matches the gross
    // area readout too, hence getAllByText (not getByText) for the shared "12.0" text.
    setup()
    expect(screen.getAllByText(/12\.0/).length).toBeGreaterThan(0) // 4m x 3m room = 12 m²
  })

  it('shows the empty-rooms message when no rooms are detected', () => {
    const f = emptyFloorGraph('Planta baja')
    const model = { slab_m: 0.15, activeFloor: 0, floors: [f] }
    const state = initialState(model)
    render(<FloorPlanPanel model={state.model} floor={f} rooms={[]} geoJson="{}" ui={state.ui} dispatch={vi.fn()} />)
    expect(screen.getByText('Sin cuartos detectados')).toBeTruthy()
  })

  it('shows editable thickness field when an edge is selected', () => {
    const { dispatch, f, ids } = setup((f, vids) => {
      const edgeId = Object.values(f.edges).find(e => e.v1 === vids.a && e.v2 === vids.b)!.id
      return { t: 'edge', id: edgeId }
    })
    const edgeId = Object.values(f.edges).find(e => e.v1 === ids.a && e.v2 === ids.b)!.id
    const thicknessInput = screen.getByLabelText(/espesor/i) as HTMLInputElement
    fireEvent.change(thicknessInput, { target: { value: '0.25' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_EDGE_THICKNESS', edgeId, value: 0.25 })
  })

  it('shows the door title and dispatches SET_OPENING_FIELD when an opening is selected', () => {
    const { dispatch, f, ids } = setup((f, vids) => {
      const edgeId = Object.values(f.edges).find(e => e.v1 === vids.a && e.v2 === vids.b)!.id
      f.edges[edgeId].openings.push({ kind: 'door', offset: 1, width: 0.9 })
      return { t: 'opening', edgeId, index: 0 }
    })
    const edgeId = Object.values(f.edges).find(e => e.v1 === ids.a && e.v2 === ids.b)!.id
    expect(screen.getByText('Puerta seleccionada')).toBeTruthy()
    const widthInput = screen.getByLabelText(/ancho/i) as HTMLInputElement
    fireEvent.change(widthInput, { target: { value: '1.1' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_OPENING_FIELD', edgeId, index: 0, key: 'width', value: 1.1 })
  })

  it('shows the window title when a window opening is selected', () => {
    setup((f, vids) => {
      const edgeId = Object.values(f.edges).find(e => e.v1 === vids.a && e.v2 === vids.b)!.id
      f.edges[edgeId].openings.push({ kind: 'window', offset: 1, width: 1.2 })
      return { t: 'opening', edgeId, index: 0 }
    })
    expect(screen.getByText('Ventana seleccionada')).toBeTruthy()
  })

  it('una división seleccionada: sin campo de espesor, con CONVERTIR EN MURO', () => {
    const { dispatch, f } = setup((f, vids) => {
      const ghostId = addEdge(f, vids.a, vids.c, GHOST_THICKNESS_M, 'ghost')
      return { t: 'edge', id: ghostId }
    })
    expect(screen.getByText('División seleccionada')).toBeTruthy()
    // Una división no es muro: ni espesor editable ni nada de vanos en su inspector.
    expect(screen.queryByLabelText(/espesor/i)).toBeNull()
    const ghostId = Object.values(f.edges).find(e => e.kind === 'ghost')!.id
    fireEvent.click(screen.getByText('CONVERTIR EN MURO'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_EDGE_KIND', edgeId: ghostId, kind: 'wall' })
  })

  it('un muro sin vanos ofrece CONVERTIR EN DIVISIÓN habilitado', () => {
    const { dispatch, f, ids } = setup((f, vids) => {
      const edgeId = Object.values(f.edges).find(e => e.v1 === vids.a && e.v2 === vids.b)!.id
      return { t: 'edge', id: edgeId }
    })
    const edgeId = Object.values(f.edges).find(e => e.v1 === ids.a && e.v2 === ids.b)!.id
    const convertBtn = screen.getByText('CONVERTIR EN DIVISIÓN') as HTMLButtonElement
    expect(convertBtn.disabled).toBe(false)
    fireEvent.click(convertBtn)
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_EDGE_KIND', edgeId, kind: 'ghost' })
  })

  it('un muro con vanos deshabilita CONVERTIR EN DIVISIÓN y explica por qué', () => {
    const { dispatch } = setup((f, vids) => {
      const edgeId = Object.values(f.edges).find(e => e.v1 === vids.a && e.v2 === vids.b)!.id
      f.edges[edgeId].openings.push({ kind: 'door', offset: 0.5, width: 0.9 })
      return { t: 'edge', id: edgeId }
    })
    const convertBtn = screen.getByText('CONVERTIR EN DIVISIÓN') as HTMLButtonElement
    expect(convertBtn.disabled).toBe(true)
    // La UI comunica el porqué; no delega en el no-op silencioso del reducer. Y la razón
    // queda asociada al botón para lectores de pantalla, no solo visualmente cerca.
    const reason = screen.getByText(/quita sus puertas y ventanas/i)
    expect(convertBtn.getAttribute('aria-describedby')).toBe(reason.id)
    fireEvent.click(convertBtn)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('renders the BIM export section only when showDims is enabled', () => {
    // initialState defaults ui.showDims to true, so the section is present out of the box.
    const f = emptyFloorGraph('Planta baja')
    const model = { slab_m: 0.15, activeFloor: 0, floors: [f] }
    let state = initialState(model)
    const { rerender } = render(
      <FloorPlanPanel model={state.model} floor={f} rooms={[]} geoJson='{"foo":1}' ui={state.ui} dispatch={vi.fn()} />
    )
    expect(screen.getByText('Exportar BIM (JSON)')).toBeTruthy()
    state = { ...state, ui: { ...state.ui, showDims: false } }
    rerender(<FloorPlanPanel model={state.model} floor={f} rooms={[]} geoJson="{}" ui={state.ui} dispatch={vi.fn()} />)
    expect(screen.queryByText('Exportar BIM (JSON)')).toBeNull()
  })
})
