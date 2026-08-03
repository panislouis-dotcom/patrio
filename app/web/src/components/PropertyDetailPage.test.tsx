import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Property } from '../lib/types'
import { PropertyDetailPage } from './PropertyDetailPage'
import * as api from '../lib/api'

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  CircleMarker: () => null,
  useMapEvents: () => null,
}))

vi.mock('../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    fetchProperty: vi.fn(),
    updateProperty: vi.fn(),
    deleteProperty: vi.fn(),
    clearPropertyFields: vi.fn(),
    transitionProperty: vi.fn(),
    fetchPropertyGeometry: vi.fn(async () => ({})),
    fetchPropertyInvestors: vi.fn(async () => []),
    fetchInvestors: vi.fn(async () => []),
    fetchInstances: vi.fn(async () => []),
    fetchTeam: vi.fn(async () => []),
    fetchAnalyses: vi.fn(async () => []),
    // Fuera de su ventana el servidor responde 422; la ficha lo absorbe.
    fetchPropertyProfit: vi.fn(async () => { throw new Error('fuera de ventana') }),
  }
})

const BASE_PROPERTY: Property = {
  id: 7, status: 'prospecto', name: 'Lote Contry',
  assetType: 'lote', strategyType: null,
  address: 'Contry 55', city: 'Monterrey', url: 'https://example.com',
  latitude: 25.63, longitude: -100.27, notes: 'buena zona', isFavorite: false,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  images: [], geometry: {}, milestones: {},
  sqmLand: 400, sqmConstruction: 250, purchasePrice: 3_000_000,
  acquisitionCostPct: 0.065, permitsCost: 150_000, subdivisionCost: 50_000,
  constructionCostPerSqm: 12_000, constructionOverhead: 1.3,
  projectedSale: 9_000_000, holdMonths: 12,
  rentMonthlyProjected: 30_000, rentMonthlyActual: null,
  assumptions: {
    acquisitionCostPct: { value: 0.065, source: 'captured' },
    constructionOverhead: { value: 1.3, source: 'captured' },
    holdMonths: { value: 12, source: 'captured' },
  },
  totalInvestmentCaptured: null,
  totalInvestment: 7_295_000, investmentBasis: 'underwriting',
  totalUnits: null, acquisitionDate: null, firstRentDate: null,
  valuationDate: null, currentValuation: null, saleDate: null, salePrice: null,
  acquisitionCosts: 195_000, acquisitionTotal: 3_195_000,
  constructionBase: 3_000_000, constructionTotal: 3_900_000,
  purchasePricePerSqm: 7_500, salePerSqm: 36_000, investmentPerSqm: 29_180,
  projectedProfit: 1_705_000, projectedRoi: 0.23, projectedRoiTotal: 0.23,
  capRate: 0.049, rentAnnual: 360_000,
  unrealizedGain: null, unrealizedGainPct: null, roi: null, holdMonthsActual: null,
  capRateActual: null, rentAnnualActual: null,
  realizedGain: null, realizedGainPct: null, realizedRoi: null,
  score: 78, issues: [],
}

const RENTED: Property = {
  ...BASE_PROPERTY, status: 'en_renta', name: 'Casa Centro',
  totalUnits: 3, acquisitionDate: '2022-09-01', firstRentDate: '2023-09-01',
  valuationDate: '2026-04-01', currentValuation: 6_200_000,
  investmentBasis: 'manual', totalInvestment: 3_730_000, totalInvestmentCaptured: 3_730_000,
  rentMonthlyActual: 34_000, capRateActual: 0.1094, rentAnnualActual: 408_000,
  unrealizedGain: 2_470_000, unrealizedGainPct: 0.6622, roi: 0.1385, holdMonthsActual: 47,
  score: null,
}

const SOLD: Property = {
  ...RENTED, status: 'vendida', name: 'Edificio Uno',
  saleDate: '2026-06-01', salePrice: 8_000_000,
  projectedProfit: null, projectedRoi: null, projectedRoiTotal: null,
  capRate: null, rentAnnual: null, capRateActual: null, rentAnnualActual: null,
  unrealizedGain: null, unrealizedGainPct: null, roi: null,
  realizedGain: 4_270_000, realizedGainPct: 1.1448, realizedRoi: 0.2251,
}

async function renderPage(property: Property) {
  vi.mocked(api.fetchProperty).mockResolvedValue(property)
  vi.mocked(api.updateProperty).mockResolvedValue(property)
  vi.mocked(api.clearPropertyFields).mockResolvedValue({ ...property, rentMonthlyProjected: null })
  vi.mocked(api.transitionProperty).mockResolvedValue({ ...property, status: 'oferta' })
  render(
    <MemoryRouter initialEntries={[`/propiedades/${property.id}`]}>
      <Routes><Route path="/propiedades/:id" element={<PropertyDetailPage />} /></Routes>
    </MemoryRouter>,
  )
  await screen.findByText('DATOS')
}

describe('PropertyDetailPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('un prospecto muestra su score y su proyección, y ningún resultado de venta', async () => {
    await renderPage(BASE_PROPERTY)

    // El titular y el bloque de proyección nombran la misma métrica: resumen arriba, detalle abajo
    expect(screen.getAllByText('ROI PROY. ANUAL').length).toBeGreaterThan(0)
    expect(screen.getByText('Score 78')).not.toBeNull()
    expect(screen.getByText('PROYECCIÓN')).not.toBeNull()
    // El bloque de resultado solo existe cuando hay una venta que reportar
    expect(screen.queryByText('RESULTADO')).toBeNull()
    expect(screen.queryByText('GANANCIA REALIZADA')).toBeNull()
    // Antes de la oferta no hay capital que levantar
    expect(screen.queryByText('FINANZAS')).toBeNull()
  })

  it('una propiedad en renta muestra lo realizado sin esconder lo de antes', async () => {
    await renderPage(RENTED)

    expect(screen.getByText('ROI ANUAL')).not.toBeNull()
    expect(screen.getByText('GANANCIA NO REALIZADA')).not.toBeNull()
    // "En pasos de después ves todo lo de antes": la proyección sigue ahí
    expect(screen.getByText('PROYECCIÓN')).not.toBeNull()
    expect(screen.getByText('VENTA PROYECTADA')).not.toBeNull()
    // El score dejó de existir al comprar: no hay a quién ganarle
    expect(screen.queryByText(/^Score/)).toBeNull()
    // Y las herramientas de etapa ya abrieron
    expect(screen.getByText('FINANZAS')).not.toBeNull()
    expect(screen.getByText('TAREAS')).not.toBeNull()
  })

  it('solo una vendida muestra las métricas realizadas', async () => {
    await renderPage(SOLD)

    expect(screen.getByText('RESULTADO')).not.toBeNull()
    expect(screen.getAllByText('ROI REALIZADO').length).toBeGreaterThan(0)
    expect(screen.getAllByText('$4,270,000').length).toBeGreaterThan(0)
    // Y ya no ofrece a dónde avanzar: vendida es terminal
    expect(screen.queryByText('AVANZAR A ▸')).toBeNull()
    expect(screen.queryByText('ARCHIVAR')).toBeNull()
  })

  it('AVANZAR A ofrece solo los destinos que la etapa permite', async () => {
    await renderPage(BASE_PROPERTY)

    fireEvent.click(screen.getByText('AVANZAR A ▸'))
    expect(screen.getByText('OFERTA')).not.toBeNull()
    for (const forbidden of ['DESARROLLO', 'EN RENTA', 'VENDIDA']) {
      expect(screen.queryByText(forbidden)).toBeNull()
    }
    // Archivar existe, pero como acción aparte: no es avanzar
    expect(screen.getByText('ARCHIVAR')).not.toBeNull()
  })

  it('la transición manda los insumos de la etapa destino, no un PATCH', async () => {
    await renderPage(BASE_PROPERTY)

    fireEvent.click(screen.getByText('AVANZAR A ▸'))
    fireEvent.click(screen.getByText('OFERTA'))
    const modal = screen.getByText('PROSPECTO ▸ OFERTA').parentElement!
    // La venta proyectada ya está capturada, así que llega prellenada
    expect((within(modal).getByLabelText('VENTA PROYECTADA') as HTMLInputElement).value).toBe('9000000')

    fireEvent.click(within(modal).getByText('OFERTA ▸'))
    await waitFor(() => expect(api.transitionProperty).toHaveBeenCalled())
    const [id, body] = vi.mocked(api.transitionProperty).mock.calls[0]
    expect(id).toBe(7)
    expect(body.to).toBe('oferta')
    expect(body).toMatchObject({ projectedSale: 9_000_000 })
    expect(api.updateProperty).not.toHaveBeenCalled()
  })

  it('un PATCH nunca lleva status ni un null: la caja vacía revierte', async () => {
    await renderPage(BASE_PROPERTY)

    fireEvent.click(screen.getByText('EDITAR'))
    fireEvent.change(screen.getByLabelText('CIUDAD'), { target: { value: 'Saltillo' } })
    fireEvent.change(screen.getByLabelText('UNIDADES'), { target: { value: '4' } })
    // Vaciar la caja no es pedir que se borre el dato: es no tocarlo
    fireEvent.change(screen.getByLabelText('UNIDADES'), { target: { value: '' } })
    fireEvent.click(screen.getByText('GUARDAR ▸'))

    await waitFor(() => expect(api.updateProperty).toHaveBeenCalled())
    const payload = vi.mocked(api.updateProperty).mock.calls[0][1] as Record<string, unknown>
    expect(payload).toEqual({ city: 'Saltillo' })
    expect('status' in payload).toBe(false)
    expect(Object.values(payload).some(v => v === null)).toBe(false)
  })

  it('los supuestos se ven siempre y dicen si alguien los eligió', async () => {
    await renderPage({
      ...BASE_PROPERTY,
      assumptions: {
        acquisitionCostPct: { value: 0.065, source: 'default' },
        constructionOverhead: { value: 1.3, source: 'captured' },
        holdMonths: { value: 12, source: 'default' },
      },
    })

    // Sin entrar a edición: eran invisibles y aun así cobraban.
    expect(screen.getByText('SUPUESTOS')).not.toBeNull()
    expect(screen.getByText('COSTOS ADQ. (%)')).not.toBeNull()
    expect(screen.getAllByText('SUPUESTO POR OMISIÓN')).toHaveLength(2)
    expect(screen.getAllByText('CAPTURADO')).toHaveLength(1)
  })

  it('la inversión capturada a mano sigue viéndose aunque mande el desglose', async () => {
    await renderPage({ ...BASE_PROPERTY, totalInvestmentCaptured: 7_000_000 })

    expect(screen.getByText('INVERSIÓN CAPTURADA')).not.toBeNull()
    expect(screen.getByText('NO SE USA: MANDA EL DESGLOSE')).not.toBeNull()
    expect(screen.getByText('SUMA DEL DESGLOSE')).not.toBeNull()
  })

  it('la renta cobrada se pide vacía: confirmar sin leer ya no borra la proyección', async () => {
    const inDevelopment: Property = {
      ...BASE_PROPERTY, status: 'desarrollo', totalUnits: 3,
      acquisitionDate: '2025-01-01', score: null,
      rentMonthlyProjected: 30_000, rentMonthlyActual: null,
    }
    await renderPage(inDevelopment)

    fireEvent.click(screen.getByText('AVANZAR A ▸'))
    fireEvent.click(screen.getByText('EN RENTA'))
    const modal = screen.getByText('DESARROLLO ▸ EN RENTA').parentElement!
    const rent = within(modal).getByLabelText('RENTA MENSUAL COBRADA') as HTMLInputElement
    expect(rent.value).toBe('')
    // La estimación se dice, para poder compararla — no para arrastrarla.
    expect(within(modal).getByText(/Se estimó \$30,000 al mes/)).not.toBeNull()
  })

  it('una propiedad rentada enseña las dos rentas y los dos cap rates', async () => {
    await renderPage(RENTED)

    expect(screen.getByText('RENTA/MES ESTIMADA')).not.toBeNull()
    expect(screen.getByText('RENTA/MES COBRADA')).not.toBeNull()
    expect(screen.getByText('CAP RATE PROY.')).not.toBeNull()
    expect(screen.getByText('CAP RATE REAL')).not.toBeNull()
  })

  it('vaciar un campo pasa por clear-fields, con su propio botón', async () => {
    await renderPage(BASE_PROPERTY)

    fireEvent.click(screen.getByText('EDITAR'))
    fireEvent.click(screen.getByLabelText('Vaciar RENTA/MES ESTIMADA'))

    await waitFor(() => expect(api.clearPropertyFields).toHaveBeenCalledWith(7, ['rentMonthlyProjected']))
    expect(api.updateProperty).not.toHaveBeenCalled()
  })
})
