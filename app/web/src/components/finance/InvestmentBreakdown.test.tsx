import { render, screen } from '@testing-library/react'
import { InvestmentBreakdown } from './InvestmentBreakdown'

describe('InvestmentBreakdown', () => {
  it('renders total and filters zero items', () => {
    render(<InvestmentBreakdown label="INVERSIÓN TOTAL" barsReady
      items={[{ label: 'Precio de compra', amount: 1000000 }, { label: 'Permisos', amount: 0 }]} />)
    expect(screen.getByText('INVERSIÓN TOTAL')).not.toBeNull()
    // El total y su única partida son el mismo número: sale dos veces, arriba y
    // en su renglón, que es justo lo que quiere decir que el total sea la suma.
    expect(screen.getAllByText('$1,000,000')).toHaveLength(2)
    expect(screen.queryByText('PERMISOS')).toBeNull()  // zero filtered out
  })

  it('renders nothing when every item is zero', () => {
    const { container } = render(<InvestmentBreakdown label="INVERSIÓN" barsReady
      items={[{ label: 'Precio de compra', amount: 0 }]} />)
    expect(container.firstChild).toBeNull()
  })

  it('el total es la suma de sus partidas y los porcentajes cierran en 100%', () => {
    // Recibiendo el total aparte, el componente anunciaba $10M y pintaba barras
    // de 70% y 30% de… $7M. Ahora la cifra grande ES lo que las barras explican.
    render(<InvestmentBreakdown label="DESGLOSE" barsReady items={[
      { label: 'Precio de compra', amount: 7_000_000 },
      { label: 'Sin desglosar', amount: 3_000_000 },
    ]} />)

    expect(screen.getByText('$10,000,000')).not.toBeNull()
    const pcts = screen.getAllByText(/^\d+%$/).map(n => Number(n.textContent!.replace('%', '')))
    expect(pcts).toEqual([70, 30])
    expect(pcts.reduce((a, b) => a + b, 0)).toBe(100)
  })
})
