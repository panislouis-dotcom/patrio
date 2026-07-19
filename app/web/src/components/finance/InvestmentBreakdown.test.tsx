import { render, screen } from '@testing-library/react'
import { InvestmentBreakdown } from './InvestmentBreakdown'

describe('InvestmentBreakdown', () => {
  it('renders total and filters zero items', () => {
    render(<InvestmentBreakdown label="INVERSIÓN TOTAL" total={3480000} barsReady
      items={[{ label: 'Precio terreno', amount: 1000000 }, { label: 'Permisos', amount: 0 }]} />)
    expect(screen.getByText('INVERSIÓN TOTAL')).not.toBeNull()
    expect(screen.queryByText('PERMISOS')).toBeNull()  // zero filtered out
  })

  it('renders nothing when every item is zero', () => {
    const { container } = render(<InvestmentBreakdown label="INVERSIÓN" total={0} barsReady
      items={[{ label: 'Precio terreno', amount: 0 }]} />)
    expect(container.firstChild).toBeNull()
  })
})
