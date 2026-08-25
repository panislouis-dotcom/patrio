import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PresupuestosPanel } from './PresupuestosPanel'
import { BudgetPanel } from './BudgetPanel'
import * as api from '../../lib/api'
import { withOriginal, withPlan, emptyFloorSet, type ProjectPlan } from '../../lib/floorplan/types'
import type { Budget, Property } from '../../lib/types'

// El interior ya tiene su batería (BudgetPanel + backend); aquí se prueba el
// wrapper: ámbitos, nacimiento explícito del escenario, USAR, y el disfraz de
// cifras. Mismo patrón cáscara que PlanesPanel.test.
vi.mock('./BudgetPanel', () => ({ BudgetPanel: vi.fn(() => <div data-testid="budget-panel" />) }))
vi.mock('../../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  fetchBudget: vi.fn(),
  fetchBudgetSources: vi.fn(async () => []),
  createPlanBudget: vi.fn(),
  usePlanBudget: vi.fn(),
}))

const mounted = vi.mocked(BudgetPanel)
const lastProps = () => mounted.mock.calls[mounted.mock.calls.length - 1][0]

const PROPERTY = { id: 7, name: 'Test', constructionBudgeted: 555 } as unknown as Property

function plan(id: string, name: string): ProjectPlan {
  return { id, name, fs: emptyFloorSet() }
}

const geoConPlanes = withPlan(withPlan(withOriginal(null, emptyFloorSet()),
  plan('plan-a', 'Plan A')), plan('plan-b', 'Plan B'))

function scenarioBudget(): Budget {
  return {
    id: 99, propertyId: 7, planId: 'plan-a',
    lines: [
      { id: 1, chapterName: 'Obra', name: 'Albañilería', unit: 'lote', quantity: 2,
        unitPrice: 100, isResidual: false, committedAmount: 150, closedAt: null,
        supplierId: null, actualQuantity: null, isProportional: true, payments: [] },
      { id: 2, chapterName: 'Otros', name: 'Por detallar', unit: 'lote', quantity: 1,
        unitPrice: 300, isResidual: true, committedAmount: null, closedAt: null,
        supplierId: null, actualQuantity: null, isProportional: true, payments: [] },
    ],
    chapters: ['Obra', 'Otros'],
  } as unknown as Budget
}

function setup(geometry = geoConPlanes) {
  const onPropertyChange = vi.fn()
  render(<PresupuestosPanel property={PROPERTY} geometry={geometry} onPropertyChange={onPropertyChange} />)
  return { onPropertyChange }
}

describe('PresupuestosPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.fetchBudgetSources).mockResolvedValue([])
  })

  it('sin planes: sin barra de ámbito, el BudgetPanel de la propiedad tal cual', () => {
    setup(withOriginal(null, emptyFloorSet()))
    expect(screen.queryByText('PRESUPUESTO DE')).toBeNull()
    expect(lastProps().planId).toBeUndefined()
    expect(lastProps().property).toBe(PROPERTY)
  })

  it('un plan sin escenario aterriza en el nacimiento explícito, nunca auto-crea', async () => {
    vi.mocked(api.fetchBudget).mockRejectedValue(new Error('El plan plan-a no tiene presupuesto todavía'))
    setup()
    fireEvent.click(screen.getByText('Plan A'))
    expect(await screen.findByText('ESTE PLAN NO TIENE PRESUPUESTO TODAVÍA')).toBeTruthy()
    expect(api.createPlanBudget).not.toHaveBeenCalled()
  })

  it('COPIADO DE LA PROPIEDAD nace el escenario y monta el panel con planId y cifras del escenario', async () => {
    vi.mocked(api.fetchBudget).mockRejectedValue(new Error('El plan plan-a no tiene presupuesto todavía'))
    vi.mocked(api.createPlanBudget).mockResolvedValue({
      budget: scenarioBudget(), linesAdded: 1, linesSkipped: 0 })
    setup()
    fireEvent.click(screen.getByText('Plan A'))
    fireEvent.click(await screen.findByText('COPIADO DE LA PROPIEDAD'))
    await waitFor(() => expect(api.createPlanBudget).toHaveBeenCalledWith(7, 'plan-a', true, undefined))
    await waitFor(() => expect(lastProps().planId).toBe('plan-a'))
    // El pie disfrazado: 2×100 + 1×300 = 500 (las cifras del ESCENARIO, no 555
    // de la propiedad); comprometido = suma de los que lo traen.
    const disfrazada = lastProps().property as Property
    expect(disfrazada.constructionBudgeted).toBe(500)
    expect(disfrazada.constructionCommitted).toBe(150)
    expect(disfrazada.constructionPaid).toBeNull()
  })

  it('USAR EN LA PROPIEDAD confirma en dos pasos, reporta conteos y sube la Property real', async () => {
    vi.mocked(api.fetchBudget).mockResolvedValue(scenarioBudget())
    const real = { ...PROPERTY, constructionBudgeted: 999 } as Property
    vi.mocked(api.usePlanBudget).mockResolvedValue(
      { property: real, budget: scenarioBudget(), linesAdded: 3, linesSkipped: 1, budgetIncrease: 0 } as never)
    const { onPropertyChange } = setup()
    fireEvent.click(screen.getByText('Plan A'))
    fireEvent.click(await screen.findByText('USAR EN LA PROPIEDAD'))
    expect(api.usePlanBudget).not.toHaveBeenCalled()   // primer paso solo avisa
    fireEvent.click(screen.getByText('¿CONFIRMAR USAR?'))
    await waitFor(() => expect(api.usePlanBudget).toHaveBeenCalledWith(7, 'plan-a'))
    expect(onPropertyChange).toHaveBeenCalledWith(real)
    expect(await screen.findByText(/3 renglones entraron/)).toBeTruthy()
    expect(screen.getByText(/1 ya estaban/)).toBeTruthy()
  })

  it('volver al ámbito PROPIEDAD restaura el panel sin planId', async () => {
    vi.mocked(api.fetchBudget).mockResolvedValue(scenarioBudget())
    setup()
    fireEvent.click(screen.getByText('Plan A'))
    await waitFor(() => expect(lastProps().planId).toBe('plan-a'))
    fireEvent.click(screen.getByText('PROPIEDAD'))
    expect(lastProps().planId).toBeUndefined()
  })
})

describe('nacimiento copiado de otro presupuesto (plan a plan)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.fetchBudgetSources).mockResolvedValue([])
  })

  it('el nacimiento ofrece cualquier presupuesto como origen y nace de él', async () => {
    vi.mocked(api.fetchBudget).mockRejectedValue(new Error('El plan plan-a no tiene presupuesto todavía'))
    vi.mocked(api.fetchBudgetSources).mockResolvedValue([
      { id: 77, name: 'Locales Salon Escobedo', propertyId: 7, planId: 'plan-b',
        planName: 'Plan B', lineCount: 4, total: 400_000, fullTotal: 900_000,
        sqmConstruction: null, constructionCostPerSqm: null },
    ])
    vi.mocked(api.createPlanBudget).mockResolvedValue({
      budget: scenarioBudget(), linesAdded: 4, linesSkipped: 0 })
    setup()
    fireEvent.click(screen.getByText('Plan A'))
    await screen.findByText('ESTE PLAN NO TIENE PRESUPUESTO TODAVÍA')

    const selector = await screen.findByLabelText('Copiar de otro presupuesto')
    expect(screen.getByText('Locales Salon Escobedo · Plan B · 4 renglones')).toBeTruthy()
    fireEvent.change(selector, { target: { value: '77' } })
    fireEvent.click(screen.getByText('COPIAR DE ESTE'))

    await waitFor(() =>
      expect(api.createPlanBudget).toHaveBeenCalledWith(7, 'plan-a', false, 77))
    await waitFor(() => expect(lastProps().planId).toBe('plan-a'))
  })

  it('sin origen elegido el botón COPIAR DE ESTE no dispara nada', async () => {
    vi.mocked(api.fetchBudget).mockRejectedValue(new Error('El plan plan-a no tiene presupuesto todavía'))
    vi.mocked(api.fetchBudgetSources).mockResolvedValue([
      { id: 77, name: 'X', propertyId: 9, planId: null, planName: null,
        lineCount: 1, total: 1, fullTotal: 1, sqmConstruction: null, constructionCostPerSqm: null },
    ])
    setup()
    fireEvent.click(screen.getByText('Plan A'))
    await screen.findByLabelText('Copiar de otro presupuesto')
    fireEvent.click(screen.getByText('COPIAR DE ESTE'))
    expect(api.createPlanBudget).not.toHaveBeenCalled()
  })
})
