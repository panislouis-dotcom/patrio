import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PropertyAnalysisSection } from './PropertyAnalysisSection'
import { ANALYSIS_DEFAULTS } from '../lib/types'
import type { Assumption } from '../lib/types'
import * as api from '../lib/api'

vi.mock('../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, fetchAnalyses: vi.fn(async () => []), runAnalysis: vi.fn() }
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.fetchAnalyses).mockResolvedValue([])
  vi.mocked(api.runAnalysis).mockResolvedValue({ id: 42 } as never)
})

async function openForm(holdMonths?: Assumption) {
  render(
    <MemoryRouter>
      <PropertyAnalysisSection propertyId={7} canRun holdMonths={holdMonths ?? null} />
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByText('CORRER ANÁLISIS')).not.toBeNull())
  fireEvent.click(screen.getByText('CORRER ANÁLISIS'))
}

describe('PropertyAnalysisSection', () => {
  it('el plazo arranca en el que la propiedad ya tiene proyectado', async () => {
    await openForm({ value: 18, source: 'captured' })
    expect((screen.getByLabelText('PLAZO (MESES)') as HTMLInputElement).value).toBe('18')
    expect(screen.getByText('plazo proyectado de la propiedad')).not.toBeNull()
  })

  it('un plazo que nadie eligió se marca como supuesto, aunque tenga valor', async () => {
    await openForm({ value: 12, source: 'default' })
    expect((screen.getByLabelText('PLAZO (MESES)') as HTMLInputElement).value).toBe('12')
    expect(screen.getByText('supuesto por omisión')).not.toBeNull()
  })

  it('los siete supuestos son visibles y editables', async () => {
    await openForm()
    fireEvent.click(screen.getByText(/SUPUESTOS DEL MODELO/))
    for (const label of ['COSTOS TRANSACCIÓN %', 'CASTIGO ANUNCIO→VENTA %', 'TASA DE DESCUENTO %',
      'FINANCIAMIENTO %', 'TASA CRÉDITO %', 'GASTOS OPERATIVOS %', 'PLAZO CRÉDITO (MESES)']) {
      expect(screen.getByLabelText(label)).not.toBeNull()
    }
    expect((screen.getByLabelText('CASTIGO ANUNCIO→VENTA %') as HTMLInputElement).value).toBe('6')
  })

  it('los supuestos viajan al servidor con la corrida', async () => {
    await openForm()
    fireEvent.click(screen.getByText(/SUPUESTOS DEL MODELO/))
    fireEvent.change(screen.getByLabelText('CASTIGO ANUNCIO→VENTA %'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('TASA DE DESCUENTO %'), { target: { value: '15' } })
    fireEvent.click(screen.getByText('EJECUTAR'))
    await waitFor(() => expect(api.runAnalysis).toHaveBeenCalled())
    expect(vi.mocked(api.runAnalysis).mock.calls[0][0]).toMatchObject({
      propertyId: 7,
      listingHaircut: 0.10,
      discountRate: 0.15,
      // Los que no se tocaron viajan con su valor por omisión, no ausentes.
      transactionCostPct: ANALYSIS_DEFAULTS.transactionCostPct,
      financiamientoPct: ANALYSIS_DEFAULTS.financiamientoPct,
      plazoCreditoMeses: ANALYSIS_DEFAULTS.plazoCreditoMeses,
    })
  })
})
