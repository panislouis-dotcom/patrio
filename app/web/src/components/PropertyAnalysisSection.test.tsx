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

async function openForm(holdMonths?: Assumption,
                        property: { assetType?: string; sqmConstruction?: number } = {}) {
  render(
    <MemoryRouter>
      <PropertyAnalysisSection propertyId={7} canRun holdMonths={holdMonths ?? null}
        assetType={property.assetType ?? 'casa'}
        sqmConstruction={property.sqmConstruction ?? 200} />
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

  // ── El escenario se propone a la vista, no se decide en silencio ──────────

  it('un lote sin obra capturada abre con obra nueva propuesta, y se ve', async () => {
    await openForm(undefined, { assetType: 'lote', sqmConstruction: 0 })
    expect((screen.getByLabelText('INTERVENCIÓN') as HTMLSelectElement).value).toBe('obra_nueva')
    expect(screen.getByText('propuesto: es un lote sin obra capturada')).not.toBeNull()
  })

  it('la propuesta se puede cambiar y es lo cambiado lo que corre', async () => {
    await openForm(undefined, { assetType: 'lote', sqmConstruction: 0 })
    fireEvent.change(screen.getByLabelText('INTERVENCIÓN'), { target: { value: 'cosmetica' } })
    expect(screen.queryByText('propuesto: es un lote sin obra capturada')).toBeNull()
    fireEvent.click(screen.getByText('EJECUTAR'))
    await waitFor(() => expect(api.runAnalysis).toHaveBeenCalled())
    expect(vi.mocked(api.runAnalysis).mock.calls[0][0].interventionLevel).toBe('cosmetica')
  })

  it('una casa sin obra capturada NO se propone construir de cero', async () => {
    await openForm(undefined, { assetType: 'casa', sqmConstruction: 0 })
    expect((screen.getByLabelText('INTERVENCIÓN') as HTMLSelectElement).value).toBe('media')
    expect(screen.queryByText(/propuesto/)).toBeNull()
  })

  it('un lote con obra ya capturada tampoco: hay metros que respetar', async () => {
    await openForm(undefined, { assetType: 'lote', sqmConstruction: 150 })
    expect((screen.getByLabelText('INTERVENCIÓN') as HTMLSelectElement).value).toBe('media')
  })

  it('el nivel propuesto viaja al servidor tal como se ve', async () => {
    await openForm(undefined, { assetType: 'lote', sqmConstruction: 0 })
    fireEvent.click(screen.getByText('EJECUTAR'))
    await waitFor(() => expect(api.runAnalysis).toHaveBeenCalled())
    expect(vi.mocked(api.runAnalysis).mock.calls[0][0].interventionLevel).toBe('obra_nueva')
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
