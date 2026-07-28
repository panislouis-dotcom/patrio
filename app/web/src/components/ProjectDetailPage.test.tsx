import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Project } from '../lib/types'
import { ProjectDetailPage } from './ProjectDetailPage'
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
    fetchProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
    fetchInstances: vi.fn(async () => []),
    fetchTeam: vi.fn(async () => []),
    fetchProjectInvestors: vi.fn(async () => []),
    fetchInvestors: vi.fn(async () => []),
    fetchProjectProfit: vi.fn(async () => ({ waterfall: null })),
    fetchProjectGeometry: vi.fn(async () => ({})),
  }
})

const BASE_PROJECT: Project = {
  id: 1, name: 'Casa Roble', type: 'Casa', address: 'Roble 100', city: 'Monterrey',
  status: 'operating', totalUnits: 2, acquisitionDate: '2024-01', conclusionDate: '2024-10',
  totalInvestment: 4_000_000, currentValuation: 5_000_000, valuationDate: '2025-01',
  url: 'https://example.com', latitude: 25.68, longitude: -100.31,
  milestones: {}, budget: {}, notes: 'sin novedades', isFavorite: false, images: [],
  unrealizedGain: 1_000_000, unrealizedGainPct: 0.25, holdMonthsActual: 9, roi: 0.33,
  prospectId: null,
  sqmLand: null, sqmConstruction: null, landPrice: null, acquisitionCostPct: null,
  permitsCost: null, subdivisionCost: null, constructionCostPerSqm: null,
  constructionOverhead: null, projectedSale: null, rentMonthly: 20_000, holdMonths: null,
  acquisitionCosts: null, acquisitionTotal: null, constructionBase: null, constructionTotal: null,
  rentAnnual: 240_000, landPricePerSqm: null, salePerSqm: null, investmentPerSqm: null,
  capRate: 0.06, projectedProfit: null, projectedRoi: null, projectedRoiTotal: null,
}

const WITH_BREAKDOWN: Project = {
  ...BASE_PROJECT,
  landPrice: 2_000_000, sqmLand: 300, sqmConstruction: 200, acquisitionCostPct: 0.065,
  permitsCost: 100_000, subdivisionCost: 0, constructionCostPerSqm: 12_000,
  constructionOverhead: 1.3, projectedSale: 6_000_000, holdMonths: 12,
  acquisitionCosts: 130_000, acquisitionTotal: 2_130_000, constructionBase: 2_400_000,
  constructionTotal: 3_120_000, investmentPerSqm: 20_000, salePerSqm: 30_000,
  projectedProfit: 1_000_000, projectedRoi: 0.2,
}

async function renderPage(project: Project) {
  vi.mocked(api.fetchProject).mockResolvedValue(project)
  vi.mocked(api.updateProject).mockResolvedValue(project)
  render(
    <MemoryRouter initialEntries={['/proyectos/1']}>
      <Routes><Route path="/proyectos/:id" element={<ProjectDetailPage />} /></Routes>
    </MemoryRouter>,
  )
  await screen.findByText('INVERSIÓN')
}

describe('ProjectDetailPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows the cap rate of a project without a breakdown', async () => {
    await renderPage(BASE_PROJECT)
    expect(screen.getByText('CAP RATE')).not.toBeNull()
    expect(screen.getByText('6.0%')).not.toBeNull()
  })

  it('swaps values for inputs in place when entering edit mode', async () => {
    await renderPage(BASE_PROJECT)
    expect(screen.queryByLabelText('VALORACIÓN')).toBeNull()
    fireEvent.click(screen.getByText('EDITAR'))
    expect(screen.getByLabelText('VALORACIÓN')).not.toBeNull()
    expect(screen.getByLabelText('RENTA/MES')).not.toBeNull()
    // Derived rows stay read-only even while editing
    expect(screen.queryByLabelText('CAP RATE')).toBeNull()
    expect(screen.queryByLabelText('PLAZO REAL')).toBeNull()
  })

  it('captures the investment by hand only while there is no breakdown', async () => {
    await renderPage(WITH_BREAKDOWN)
    fireEvent.click(screen.getByText('EDITAR'))
    expect(screen.queryByLabelText('INVERSIÓN')).toBeNull()
    expect(screen.getByText('CALCULADA DEL DESGLOSE')).not.toBeNull()

    fireEvent.change(screen.getByLabelText('PRECIO TERRENO'), { target: { value: '' } })
    expect(screen.getByLabelText('INVERSIÓN')).not.toBeNull()
    expect(screen.getByText('CAPTURA MANUAL')).not.toBeNull()
  })

  it('clears a nullable underwriting column with null', async () => {
    await renderPage(WITH_BREAKDOWN)
    fireEvent.click(screen.getByText('EDITAR'))
    fireEvent.change(screen.getByLabelText('PRECIO TERRENO'), { target: { value: '' } })
    fireEvent.click(screen.getByText('GUARDAR ▸'))
    await waitFor(() => expect(api.updateProject).toHaveBeenCalledWith(1, { landPrice: null }))
  })

  it('never sends null for a NOT NULL column — an emptied box means 0', async () => {
    await renderPage(BASE_PROJECT)
    fireEvent.click(screen.getByText('EDITAR'))
    fireEvent.change(screen.getByLabelText('VALORACIÓN'), { target: { value: '' } })
    fireEvent.click(screen.getByText('GUARDAR ▸'))
    await waitFor(() => expect(api.updateProject).toHaveBeenCalledWith(1, { currentValuation: 0 }))
  })

  it('leaves edit mode after saving and after cancelling', async () => {
    await renderPage(BASE_PROJECT)
    fireEvent.click(screen.getByText('EDITAR'))
    fireEvent.change(screen.getByLabelText('UNIDADES'), { target: { value: '5' } })
    fireEvent.click(screen.getByText('CANCELAR'))
    expect(screen.getByText('EDITAR')).not.toBeNull()
    expect(screen.queryByLabelText('UNIDADES')).toBeNull()
    expect(api.updateProject).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('EDITAR'))
    fireEvent.change(screen.getByLabelText('UNIDADES'), { target: { value: '5' } })
    fireEvent.click(screen.getByText('GUARDAR ▸'))
    await waitFor(() => expect(api.updateProject).toHaveBeenCalledWith(1, { totalUnits: 5 }))
    await waitFor(() => expect(screen.queryByLabelText('UNIDADES')).toBeNull())
  })
})
