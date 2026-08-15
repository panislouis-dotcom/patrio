// app/web/src/components/FloorPlanPanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import FloorPlanPanel from './FloorPlanPanel'
import { emptyFloorGraph, GHOST_THICKNESS_M, FIXTURE_CATALOG, type Fixture } from '../lib/floorplan/types'
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

  it('shows the room type label next to its name in the stats section, when the room has one', () => {
    const f = emptyFloorGraph('Planta baja')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3), d = addVertex(f, 0, 3)
    addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
    f.rooms.push({ name: 'Escaleras', cx: 2, cy: 1.5, type: 'escalera' })
    const model = { slab_m: 0.15, activeFloor: 0, floors: [f] }
    const state = initialState(model)
    render(<FloorPlanPanel model={state.model} floor={f} rooms={roomAreas(f)} geoJson="{}" ui={state.ui} dispatch={vi.fn()} />)
    const nameNode = screen.getByText('Escaleras')
    expect(nameNode.closest('span')?.textContent).toBe('Escaleras · Escalera')
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

  describe('inspector de mueble seleccionado', () => {
    function setupWithFixture(overrides: Partial<Fixture> = {}) {
      const base: Fixture = { id: 'fx1', kind: 'silla', x: 1, y: 1, rot: 0, w_m: FIXTURE_CATALOG.silla.w_m, h_m: FIXTURE_CATALOG.silla.h_m }
      const fx: Fixture = { ...base, ...overrides }
      return setup(f => { f.fixtures = [fx]; return { t: 'fixture', id: fx.id } })
    }

    it('muestra el label del catálogo (kind de solo lectura)', () => {
      setupWithFixture({ kind: 'cama_matrimonial' })
      expect(screen.getByText(FIXTURE_CATALOG.cama_matrimonial.label)).toBeTruthy()
    })

    it('dispatches SET_FIXTURE_PARAM al editar ancho (w_m)', () => {
      const { dispatch } = setupWithFixture({ w_m: 1.4 })
      const wInput = screen.getByLabelText(/ancho/i) as HTMLInputElement
      fireEvent.change(wInput, { target: { value: '1.6' } })
      expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FIXTURE_PARAM', id: 'fx1', patch: { w_m: 1.6 } })
    })

    it('dispatches SET_FIXTURE_PARAM al editar largo (h_m)', () => {
      const { dispatch } = setupWithFixture({ h_m: 1.9 })
      const hInput = screen.getByLabelText(/largo/i) as HTMLInputElement
      fireEvent.change(hInput, { target: { value: '2.0' } })
      expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FIXTURE_PARAM', id: 'fx1', patch: { h_m: 2.0 } })
    })

    it('dispatches SET_FIXTURE_PARAM al editar la rotación numéricamente', () => {
      const { dispatch } = setupWithFixture({ rot: 0 })
      const rotInput = screen.getByLabelText(/rotaci/i) as HTMLInputElement
      fireEvent.change(rotInput, { target: { value: '45' } })
      expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FIXTURE_PARAM', id: 'fx1', patch: { rot: 45 } })
    })

    it('el botón 90° suma 90 grados', () => {
      const { dispatch } = setupWithFixture({ rot: 0 })
      fireEvent.click(screen.getByText('90°'))
      expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FIXTURE_PARAM', id: 'fx1', patch: { rot: 90 } })
    })

    it('el botón 90° hace wraparound de 270 a 0 (módulo 360)', () => {
      const { dispatch } = setupWithFixture({ rot: 270 })
      fireEvent.click(screen.getByText('90°'))
      expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FIXTURE_PARAM', id: 'fx1', patch: { rot: 0 } })
    })

    it('muestra un botón de borrar que dispatcha DELETE_SEL', () => {
      const { dispatch } = setupWithFixture()
      fireEvent.click(screen.getByText('ELIMINAR'))
      expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_SEL' })
    })
  })

  describe('inspector de cota manual seleccionada', () => {
    function setupWithManualDim(p1 = { x: 0, y: 0 }, p2 = { x: 3, y: 0 }) {
      return setup(f => { f.manualDimensions = [{ id: 'd1', p1, p2 }]; return { t: 'manualDim', id: 'd1' } })
    }

    it('muestra el largo calculado (derivado, no un campo propio)', () => {
      setupWithManualDim({ x: 0, y: 0 }, { x: 3, y: 4 })
      expect(screen.getByText(/5\.00 m/)).toBeTruthy() // 3-4-5
    })

    it('dispatches SET_MANUAL_DIM_POINT al editar X del punto 1, sin tocar el punto 2', () => {
      const { dispatch } = setupWithManualDim({ x: 0, y: 0 }, { x: 3, y: 0 })
      const xInputs = screen.getAllByLabelText(/x \(m\)/i) as HTMLInputElement[]
      fireEvent.change(xInputs[0], { target: { value: '1.5' } })
      expect(dispatch).toHaveBeenCalledWith({ type: 'SET_MANUAL_DIM_POINT', id: 'd1', which: 'p1', x: 1.5, y: 0 })
    })

    it('dispatches SET_MANUAL_DIM_POINT al editar Y del punto 2 — esto es el resize por input preciso', () => {
      const { dispatch } = setupWithManualDim({ x: 0, y: 0 }, { x: 3, y: 0 })
      const yInputs = screen.getAllByLabelText(/y \(m\)/i) as HTMLInputElement[]
      fireEvent.change(yInputs[1], { target: { value: '2' } })
      expect(dispatch).toHaveBeenCalledWith({ type: 'SET_MANUAL_DIM_POINT', id: 'd1', which: 'p2', x: 3, y: 2 })
    })

    it('muestra un botón de borrar que dispatcha DELETE_SEL', () => {
      const { dispatch } = setupWithManualDim()
      fireEvent.click(screen.getByText('ELIMINAR'))
      expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_SEL' })
    })
  })

  it('renders the BIM export section regardless of showDims — it is not dimension clutter, just a side panel', () => {
    // Antes reusaba showDims prestado (acoplamiento incidental, sin relación real):
    // se desacopló al cambiar el default de showDims a false, para no esconder el
    // export BIM sin que nadie lo haya pedido.
    const f = emptyFloorGraph('Planta baja')
    const model = { slab_m: 0.15, activeFloor: 0, floors: [f] }
    let state = initialState(model)
    expect(state.ui.showDims).toBe(false) // default actual
    const { rerender } = render(
      <FloorPlanPanel model={state.model} floor={f} rooms={[]} geoJson='{"foo":1}' ui={state.ui} dispatch={vi.fn()} />
    )
    expect(screen.getByText('Exportar BIM (JSON)')).toBeTruthy()
    state = { ...state, ui: { ...state.ui, showDims: true } }
    rerender(<FloorPlanPanel model={state.model} floor={f} rooms={[]} geoJson="{}" ui={state.ui} dispatch={vi.fn()} />)
    expect(screen.getByText('Exportar BIM (JSON)')).toBeTruthy()
  })
})
