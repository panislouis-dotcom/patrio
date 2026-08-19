import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Property } from '../lib/types'
import { PropiedadesTable } from './PropiedadesTable'
import * as api from '../lib/api'

vi.mock('../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, fetchProperties: vi.fn(), updateProperty: vi.fn() }
})

/**
 * El resumen del portafolio es la única cifra agregada del sistema y encabeza la
 * pantalla principal, así que cada grupo tiene que estar cerrado sobre su propio
 * conjunto: capital que sigue adentro, marca de lo que sí está avaluado, y lo
 * que ya se cobró. Mezclarlos obligaba a llamar «valuación total» a la suma del
 * precio de una venta con el avalúo de lo que sigue en pie, y a contar $0 por
 * cada propiedad que nadie ha avaluado.
 */
const base = (over: Partial<Property>): Property => ({
  id: 1, status: 'desarrollo', name: 'P', assetType: 'casa', strategyType: null,
  address: 'A', city: 'Monterrey', url: '', latitude: 0, longitude: 0,
  notes: '', isFavorite: false, createdAt: '', updatedAt: '',
  images: [], geometry: {}, milestones: {},
  sqmLand: 0, sqmConstruction: 0, purchasePrice: null, acquisitionCostPct: 0.065,
  permitsCost: null, subdivisionCost: null, constructionCostPerSqm: null,
  projectedSale: null, holdMonths: 12,
  rentMonthlyProjected: null, rentMonthlyActual: null,
  exitStrategy: null,
  landCommissionPct: 0.05, constructionCommissionPct: 0.15,
  exitSaleCommissionPct: 0.05, exitRentMonths: 3,
  assumptions: {
    acquisitionCostPct: { value: 0.065, source: 'default' },
    holdMonths: { value: 12, source: 'default' },
    landCommissionPct: { value: 0.05, source: 'default' },
    constructionCommissionPct: { value: 0.15, source: 'default' },
    exitSaleCommissionPct: { value: 0.05, source: 'default' },
    exitRentMonths: { value: 3, source: 'default' },
  },
  totalInvestment: null,
  landFee: 0, constructionFee: 0, exitFee: null, exitFeeMode: null,
  totalFees: null, totalInvestmentWithFees: null, feesMissingInputs: ['exitStrategy'],
  totalUnits: null, acquisitionDate: null, firstRentDate: null,
  valuationDate: null, currentValuation: null, saleDate: null, salePrice: null,
  acquisitionCosts: null, acquisitionTotal: null,
  constructionBudgeted: null, constructionCommitted: null, constructionPaid: null,
  constructionCommittedVariance: null, constructionPaidVariance: null,
  projectedProfit: null, projectedRoi: null,
  projectedRoiTotal: null, capRate: null, rentAnnual: null,
  unrealizedGain: null, unrealizedGainPct: null, roi: null, holdMonthsActual: null,
  capRateActual: null, rentAnnualActual: null,
  realizedGain: null, realizedGainPct: null, realizedRoi: null,
  score: null, issues: [],
  ...over,
})

const PORTFOLIO: Property[] = [
  // Avaluada: 6M sobre 4M adentro
  base({ id: 1, status: 'en_renta', totalInvestment: 4_000_000, currentValuation: 6_000_000, unrealizedGain: 2_000_000 }),
  // Comprada y sin avalúo: su capital cuenta, su valuación no existe
  base({ id: 2, status: 'desarrollo', totalInvestment: 5_000_000 }),
  // Vendida: ese dinero ya regresó, no es capital en operación
  base({ id: 3, status: 'vendida', totalInvestment: 3_000_000, salePrice: 7_000_000, realizedGain: 4_000_000 }),
  // Prospecto: nada adentro todavía
  base({ id: 4, status: 'prospecto', totalInvestment: 9_000_000 }),
]

async function renderTable(properties: Property[]) {
  vi.mocked(api.fetchProperties).mockResolvedValue(properties)
  render(<MemoryRouter><PropiedadesTable /></MemoryRouter>)
  await waitFor(() => expect(screen.queryByText('Cargando…')).toBeNull())
}

/** Un grupo del resumen, acotado — las mismas cifras salen abajo en la tabla. */
const group = (name: string) => within(screen.getByText(name).parentElement!)

describe('PropiedadesTable · resumen del portafolio', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('el capital en operación excluye lo vendido y lo que todavía no se compra', async () => {
    await renderTable(PORTFOLIO)

    // 4M + 5M. Ni los 3M de la vendida (ya regresaron) ni los 9M del prospecto.
    expect(group('EN OPERACIÓN 2').getByText('$9.0M')).not.toBeNull()
  })

  it('la valuación cubre solo lo avaluado, y lo dice', async () => {
    await renderTable(PORTFOLIO)

    // Una de las dos en operación tiene avalúo: la otra no entra como $0.
    const appraised = group('AVALUADAS 1')
    expect(appraised.getByText('$6.0M')).not.toBeNull()
    // Y la ganancia se lee contra el capital de esas mismas: 2M sobre 4M.
    // El porcentaje va firmado, igual que en el héroe de la ficha: un mismo dato
    // no puede salir «+50.0%» arriba y «50.0%» abajo.
    expect(appraised.getByText('$2.0M +50.0%')).not.toBeNull()
  })

  it('cada ganancia se llama por su nombre: son tres y una ya se cobró', async () => {
    // «Plusvalía» es palabra prohibida en docs/glosario.md — llegó a nombrar tres
    // conceptos distintos. Y «Ganancia» a secas no dice cuál de los tres es.
    await renderTable(PORTFOLIO)

    expect(screen.getByText('Ganancia no realizada:')).not.toBeNull()
    expect(screen.getByText('Ganancia realizada:')).not.toBeNull()
    expect(screen.queryByText(/Plusval/)).toBeNull()
  })

  it('lo vendido va en su propio grupo, nunca sumado a una valuación', async () => {
    await renderTable(PORTFOLIO)

    const closed = group('VENDIDAS 1')
    expect(closed.getByText('$7.0M')).not.toBeNull()
    expect(closed.getByText('$4.0M')).not.toBeNull()
  })

  it('un grupo sin propiedades no se dibuja', async () => {
    await renderTable([PORTFOLIO[3]])

    expect(screen.queryByText(/^EN OPERACIÓN/)).toBeNull()
    expect(screen.queryByText(/^AVALUADAS/)).toBeNull()
    expect(screen.queryByText(/^VENDIDAS/)).toBeNull()
  })
})
