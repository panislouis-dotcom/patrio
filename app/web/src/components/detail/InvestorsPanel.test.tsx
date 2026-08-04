import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InvestorsPanel } from './InvestorsPanel'
import type { Investor, PropertyInvestor } from '../../lib/types'
import * as api from '../../lib/api'

vi.mock('../../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    addPropertyInvestor: vi.fn(),
    updatePropertyInvestment: vi.fn(),
    deletePropertyInvestment: vi.fn(),
  }
})

const ANA: Investor = {
  id: 3, name: 'Ana', apellidos: 'Ruiz', email: '', phone: '', notes: '',
  temperatura: null, capacidad: null, fuente: null, confianza: null,
  createdAt: '2026-01-01', totalInterested: 0, totalCommitted: 0, totalFunded: 0,
}

const POSITION: PropertyInvestor = {
  id: 11, propertyId: 7, investorId: 3, investorName: 'Ana Ruiz', propertyName: 'Lote',
  status: 'comprometido', interestedAmount: 800_000, committedAmount: 500_000, fundedAmount: 0,
  interestRateAnnual: 0.12, investmentDate: null, returnAmount: null, returnDate: null,
  notes: '', createdAt: '2026-01-01',
  holdMonths: 0, interestAmount: 0, expectedReturn: 0, returnPct: 0,
}

beforeEach(() => { vi.clearAllMocks() })

describe('InvestorsPanel', () => {
  it('el alta captura los tres montos del embudo, no solo el fondeado', async () => {
    vi.mocked(api.addPropertyInvestor).mockResolvedValue(POSITION)
    render(<InvestorsPanel propertyId={7} investors={[]} allInvestors={[ANA]}
      waterfall={null} onChange={() => {}} />)
    fireEvent.click(screen.getByText('+ AGREGAR'))
    fireEvent.change(screen.getByLabelText('Inversionista'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('INTERESADO'), { target: { value: '800000' } })
    fireEvent.change(screen.getByLabelText('COMPROMETIDO'), { target: { value: '500000' } })
    fireEvent.click(screen.getByText('AGREGAR'))
    await waitFor(() => expect(api.addPropertyInvestor).toHaveBeenCalled())
    expect(vi.mocked(api.addPropertyInvestor).mock.calls[0][1]).toMatchObject({
      investorId: 3, interestedAmount: 800_000, committedAmount: 500_000, fundedAmount: 0,
    })
  })

  it('"comprometido" es un estado alcanzable y se muestra', () => {
    render(<InvestorsPanel propertyId={7} investors={[POSITION]} allInvestors={[ANA]}
      waterfall={null} onChange={() => {}} />)
    expect(screen.getByText('COMPROMETIDO', { selector: 'td' })).not.toBeNull()
    expect(screen.getByText('$500,000')).not.toBeNull()
  })

  it('el interesado y el comprometido se pueden editar después del alta', async () => {
    vi.mocked(api.updatePropertyInvestment).mockResolvedValue(POSITION)
    render(<InvestorsPanel propertyId={7} investors={[POSITION]} allInvestors={[ANA]}
      waterfall={null} onChange={() => {}} />)
    fireEvent.click(screen.getByText('EDITAR'))
    fireEvent.change(screen.getByLabelText('INTERESADO'), { target: { value: '900000' } })
    fireEvent.change(screen.getByLabelText('COMPROMETIDO'), { target: { value: '600000' } })
    fireEvent.click(screen.getByText('OK'))
    await waitFor(() => expect(api.updatePropertyInvestment).toHaveBeenCalled())
    expect(vi.mocked(api.updatePropertyInvestment).mock.calls[0][2]).toMatchObject({
      interestedAmount: 900_000, committedAmount: 600_000,
    })
  })

  it('no manda el estado: lo deriva el servidor de los montos', async () => {
    vi.mocked(api.addPropertyInvestor).mockResolvedValue(POSITION)
    render(<InvestorsPanel propertyId={7} investors={[]} allInvestors={[ANA]}
      waterfall={null} onChange={() => {}} />)
    fireEvent.click(screen.getByText('+ AGREGAR'))
    fireEvent.change(screen.getByLabelText('Inversionista'), { target: { value: '3' } })
    fireEvent.click(screen.getByText('AGREGAR'))
    await waitFor(() => expect(api.addPropertyInvestor).toHaveBeenCalled())
    expect(vi.mocked(api.addPropertyInvestor).mock.calls[0][1]).not.toHaveProperty('status')
  })
})
