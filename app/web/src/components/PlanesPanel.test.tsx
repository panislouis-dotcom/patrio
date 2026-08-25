import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { PlanesPanel } from './PlanesPanel'
import {
  withOriginal, withPlan, emptyFloorSet, LEGACY_PLAN_ID,
  type FloorPlanModel, type ProjectPlan,
} from '../lib/floorplan/types'
import { LevantamientoPanel } from './LevantamientoPanel'
import type { PropertyRender } from '../lib/types'

// PlanesPanel es una cáscara de selección: CUÁL plan está activo y las
// operaciones de la colección. El interior (editor, rehacer, RENDERS) ya tiene
// su propia batería en LevantamientoPanel.test.tsx — aquí se mockea, mismo
// criterio que FotosPanel.test.tsx con RendersPanel.
vi.mock('./LevantamientoPanel', () => ({
  LevantamientoPanel: vi.fn(() => <div data-testid="levantamiento-panel" />),
}))

const mounted = vi.mocked(LevantamientoPanel)
const lastProps = () => mounted.mock.calls[mounted.mock.calls.length - 1][0]

function plan(id: string, name: string): ProjectPlan {
  const fs = emptyFloorSet()
  fs.floors[0].name = `Planta de ${name}`
  return { id, name, fs }
}

function geometryWith(...plans: ProjectPlan[]): FloorPlanModel {
  return plans.reduce((g, p) => withPlan(g, p), withOriginal(null, emptyFloorSet()))
}

function planRender(id: number, variant: string): PropertyRender {
  return {
    id, propertyId: 7, sourceImageId: null, sourcePlanPath: `p/${id}.png`, sourceVariant: variant,
    floorId: 'f1', floorName: 'PB', parentRenderId: null, filePath: `r/${id}.png`,
    contentType: 'image/png', promptId: null, promptText: 'x', provider: 'openai',
    model: 'gpt-image-2', createdAt: '2026-08-01T00:00:00Z', isChosen: false,
  }
}

function setup(geometry: FloorPlanModel | null, over: Partial<Parameters<typeof PlanesPanel>[0]> = {}) {
  const props = {
    geometry,
    onSave: vi.fn(),
    onCreatePlan: vi.fn().mockResolvedValue(undefined),
    onRenamePlan: vi.fn().mockResolvedValue(undefined),
    onDeletePlan: vi.fn().mockResolvedValue(undefined),
    onUploadImage: vi.fn(async () => ({ imageKey: 'k' })),
    onDirtyChange: vi.fn(),
    base: '',
    prompts: [],
    renders: [] as PropertyRender[],
    onGenerateRender: vi.fn(),
    onSavePrompt: vi.fn(),
    onDeleteRender: vi.fn(),
    onChoose: vi.fn(),
    onUnchoose: vi.fn(),
    ...over,
  }
  render(<PlanesPanel {...(props as unknown as Parameters<typeof PlanesPanel>[0])} />)
  return props
}

describe('PlanesPanel', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('sin planes: sin cromo, y el panel se monta con el id legado (su empty state nace el primer plan)', () => {
    setup(withOriginal(null, emptyFloorSet()))
    expect(screen.queryByText('RENOMBRAR')).toBeNull()
    expect(screen.queryByText('+ NUEVO PLAN')).toBeNull()
    expect(lastProps().variant).toBe(LEGACY_PLAN_ID)
  })

  it('con UN plan: nombre visible sin selector, y acciones de colección presentes', () => {
    setup(geometryWith(plan('planned', 'Plan de proyecto')))
    expect(screen.getByText('Plan de proyecto')).toBeTruthy()
    expect(screen.queryByLabelText('Plan de proyecto activo')).toBeNull()   // sin <select>
    expect(screen.getByText('RENOMBRAR')).toBeTruthy()
    expect(screen.getByText('BORRAR')).toBeTruthy()
    expect(screen.getByText('+ NUEVO PLAN')).toBeTruthy()
    expect(lastProps().variant).toBe('planned')
  })

  it('con DOS planes: el selector cambia el plan activo y REMONTA el panel con esa variante', () => {
    setup(geometryWith(plan('plan-a', 'Plan A'), plan('plan-b', 'Plan B')))
    expect(lastProps().variant).toBe('plan-a')   // default: el primero
    fireEvent.change(screen.getByLabelText('Plan de proyecto activo'), { target: { value: 'plan-b' } })
    expect(lastProps().variant).toBe('plan-b')
  })

  it('cambiar de plan con el editor SUCIO pide confirmación de dos pasos', () => {
    setup(geometryWith(plan('plan-a', 'Plan A'), plan('plan-b', 'Plan B')))
    act(() => { (lastProps().onDirtyChange as (d: boolean) => void)(true) })
    fireEvent.change(screen.getByLabelText('Plan de proyecto activo'), { target: { value: 'plan-b' } })
    // No cambió todavía: avisa primero.
    expect(lastProps().variant).toBe('plan-a')
    expect(screen.getByText('SE PIERDE LO NO GUARDADO DE ESTE PLAN')).toBeTruthy()
    fireEvent.click(screen.getByText('¿CAMBIAR DE PLAN?'))
    expect(lastProps().variant).toBe('plan-b')
  })

  it('cancelar el cambio sucio se queda en el plan actual', () => {
    setup(geometryWith(plan('plan-a', 'Plan A'), plan('plan-b', 'Plan B')))
    act(() => { (lastProps().onDirtyChange as (d: boolean) => void)(true) })
    fireEvent.change(screen.getByLabelText('Plan de proyecto activo'), { target: { value: 'plan-b' } })
    fireEvent.click(screen.getByText('CANCELAR'))
    expect(lastProps().variant).toBe('plan-a')
  })

  it('DUPLICAR ESTE crea un plan nuevo con clon del fs activo y nombre "Copia de …"', async () => {
    const a = plan('plan-a', 'Plan A')
    const props = setup(geometryWith(a))
    fireEvent.click(screen.getByText('+ NUEVO PLAN'))
    fireEvent.click(screen.getByText('DUPLICAR ESTE'))
    await waitFor(() => expect(props.onCreatePlan).toHaveBeenCalled())
    const created = (props.onCreatePlan as ReturnType<typeof vi.fn>).mock.calls[0][0] as ProjectPlan
    expect(created.name).toBe('Copia de Plan A')
    expect(created.id).not.toBe('plan-a')          // identidad propia
    expect(created.fs).toEqual(a.fs)               // mismo contenido
    expect(created.fs).not.toBe(a.fs)              // clon profundo, no referencia
    // Los floor ids se CONSERVAN: linaje con el original, misma decisión que PARTIR.
    expect(created.fs.floors[0].id).toBe(a.fs.floors[0].id)
  })

  it('PARTIR DEL ORIGINAL crea el plan clonando el original con sus floor ids', async () => {
    const original = emptyFloorSet()
    original.floors[0].vertices = { v1: { id: 'v1', x: 0, y: 0 } }
    const g = withPlan(withOriginal(null, original), plan('plan-a', 'Plan A'))
    const props = setup(g)
    fireEvent.click(screen.getByText('+ NUEVO PLAN'))
    fireEvent.click(screen.getByText('PARTIR DEL ORIGINAL'))
    await waitFor(() => expect(props.onCreatePlan).toHaveBeenCalled())
    const created = (props.onCreatePlan as ReturnType<typeof vi.fn>).mock.calls[0][0] as ProjectPlan
    expect(created.fs.floors[0].id).toBe(original.floors[0].id)
    expect(created.name).toBe('Plan 2')
  })

  it('RENOMBRAR llama onRenamePlan con el nombre nuevo', async () => {
    const props = setup(geometryWith(plan('plan-a', 'Plan A')))
    fireEvent.click(screen.getByText('RENOMBRAR'))
    fireEvent.change(screen.getByLabelText('Nuevo nombre del plan'), { target: { value: 'Plan A: locales' } })
    fireEvent.click(screen.getByText('GUARDAR NOMBRE'))
    await waitFor(() => expect(props.onRenamePlan).toHaveBeenCalledWith('plan-a', 'Plan A: locales'))
  })

  it('BORRAR muestra el conteo REAL de renders del plan y confirma en dos pasos', async () => {
    const props = setup(geometryWith(plan('plan-a', 'Plan A'), plan('plan-b', 'Plan B')), {
      renders: [planRender(1, 'plan-a'), planRender(2, 'plan-a'), planRender(3, 'plan-b')],
    })
    fireEvent.click(screen.getByText('BORRAR'))
    expect(props.onDeletePlan).not.toHaveBeenCalled()   // primer paso solo avisa
    expect(screen.getByText('SE BORRARÁN 2 RENDERS DE ESTE PLAN')).toBeTruthy()
    fireEvent.click(screen.getByText('¿CONFIRMAR BORRAR?'))
    await waitFor(() => expect(props.onDeletePlan).toHaveBeenCalledWith('plan-a'))
  })

  it('BORRAR sin renders avisa sin conteo', () => {
    setup(geometryWith(plan('plan-a', 'Plan A')))
    fireEvent.click(screen.getByText('BORRAR'))
    expect(screen.getByText('SE BORRA ESTE PLAN')).toBeTruthy()
  })
})

describe('PlanesPanel: crear con edición sucia', () => {
  it('+ NUEVO PLAN se deshabilita con el editor sucio — crear remonta y perdería lo no guardado', () => {
    setup(geometryWith(plan('plan-a', 'Plan A')))
    act(() => { (lastProps().onDirtyChange as (d: boolean) => void)(true) })
    expect((screen.getByText('+ NUEVO PLAN') as HTMLButtonElement).disabled).toBe(true)
    act(() => { (lastProps().onDirtyChange as (d: boolean) => void)(false) })
    expect((screen.getByText('+ NUEVO PLAN') as HTMLButtonElement).disabled).toBe(false)
  })
})
