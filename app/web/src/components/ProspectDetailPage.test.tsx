import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Prospect } from '../lib/types'
import { ProspectDetailPage } from './ProspectDetailPage'
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
    fetchProspect: vi.fn(),
    updateProspect: vi.fn(),
    deleteProspect: vi.fn(),
    fetchProspectGeometry: vi.fn(async () => ({})),
  }
})

const PROSPECT: Prospect = {
  id: 7, name: 'Lote Contry', address: 'Contry 55', city: 'Monterrey',
  status: 'evaluating', type: 'Lote', url: 'https://example.com',
  latitude: 25.63, longitude: -100.27,
  sqmLand: 400, sqmConstruction: 250, landPrice: 3_000_000,
  acquisitionCostPct: 0.065, acquisitionCosts: 195_000, acquisitionTotal: 3_195_000,
  permitsCost: 150_000, subdivisionCost: 50_000,
  constructionBase: 3_000_000, constructionTotal: 3_900_000,
  constructionCostPerSqm: 12_000, constructionOverhead: 1.3,
  totalInvestment: 7_295_000, projectedSale: 9_000_000, profit: 1_705_000,
  roi: 0.23, roiTotal: 0.23, capRate: 0.05,
  landPricePerSqm: 7_500, salePerSqm: 36_000, investmentPerSqm: 29_180,
  rentMonthly: 30_000, rentAnnual: 360_000, holdMonths: 12,
  notes: 'buena zona', isFavorite: false, images: [], score: 78, issues: [],
}

async function renderPage() {
  vi.mocked(api.fetchProspect).mockResolvedValue(PROSPECT)
  vi.mocked(api.updateProspect).mockResolvedValue(PROSPECT)
  render(
    <MemoryRouter initialEntries={['/prospectos/tabla/7']}>
      <Routes><Route path="/prospectos/tabla/:id" element={<ProspectDetailPage />} /></Routes>
    </MemoryRouter>,
  )
  await screen.findByText('INVERSIÓN')
}

describe('ProspectDetailPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('keeps the derived metrics and the convert action in the general panel', async () => {
    await renderPage()
    // PROFIT labels both the metric row and the venta/profit summary, as before
    expect(screen.getAllByText('PROFIT')).toHaveLength(2)
    expect(screen.getByText('CAP RATE')).not.toBeNull()
    expect(screen.getByText('CONVERTIR ▸ PROYECTO')).not.toBeNull()
    expect(screen.getByText('5.0%')).not.toBeNull()
  })

  it('swaps values for inputs in place when entering edit mode', async () => {
    await renderPage()
    expect(screen.queryByLabelText('VENTA')).toBeNull()
    fireEvent.click(screen.getByText('EDITAR'))
    expect(screen.getByLabelText('VENTA')).not.toBeNull()
    expect(screen.getByLabelText('RENTA/MES')).not.toBeNull()
    expect(screen.getByLabelText('PRECIO TERRENO')).not.toBeNull()
    // Derived rows stay read-only even while editing
    expect(screen.queryByLabelText('INVERSIÓN')).toBeNull()
    expect(screen.queryByLabelText('CAP RATE')).toBeNull()
  })

  it('reverts an emptied box instead of sending null over a NOT NULL column', async () => {
    await renderPage()
    fireEvent.click(screen.getByText('EDITAR'))
    fireEvent.change(screen.getByLabelText('PLAZO'), { target: { value: '24' } })
    fireEvent.change(screen.getByLabelText('VENTA'), { target: { value: '' } })
    fireEvent.click(screen.getByText('GUARDAR ▸'))
    await waitFor(() => expect(api.updateProspect).toHaveBeenCalledWith(7, { holdMonths: 24 }))
    const payload = vi.mocked(api.updateProspect).mock.calls[0][1]
    expect('projectedSale' in payload).toBe(false)
    expect(Object.values(payload).some(v => v === null)).toBe(false)
  })

  it('drops pending edits on cancel and leaves edit mode', async () => {
    await renderPage()
    fireEvent.click(screen.getByText('EDITAR'))
    fireEvent.change(screen.getByLabelText('CIUDAD'), { target: { value: 'Saltillo' } })
    fireEvent.click(screen.getByText('CANCELAR'))
    expect(api.updateProspect).not.toHaveBeenCalled()
    expect(screen.getByText('EDITAR')).not.toBeNull()
    expect(screen.getByText('Monterrey')).not.toBeNull()
  })
})
