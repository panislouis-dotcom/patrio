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

  it('sin label no dibuja encabezado propio: quien llama ya puso el suyo', () => {
    // PropertyDetailPage hoisted its own always-visible SectionDivider for
    // "DESGLOSE DE INVERSIÓN"; passing label here too would print it twice.
    render(<InvestmentBreakdown barsReady items={[{ label: 'Precio de compra', amount: 1_000_000 }]} />)
    expect(screen.queryByText('DESGLOSE DE INVERSIÓN')).toBeNull()
    expect(screen.getAllByText('$1,000,000')).toHaveLength(2)
  })

  it('el total es la suma de sus partidas y los porcentajes cierran en 100%', () => {
    // Recibiendo el total aparte, el componente anunciaba $10M y pintaba barras
    // de 70% y 30% de… $7M. Ahora la cifra grande ES lo que las barras explican.
    render(<InvestmentBreakdown label="DESGLOSE" barsReady items={[
      { label: 'Precio de compra', amount: 7_000_000 },
      { label: 'Obra a ejecutar', amount: 3_000_000 },
    ]} />)

    expect(screen.getByText('$10,000,000')).not.toBeNull()
    const pcts = screen.getAllByText(/^\d+%$/).map(n => Number(n.textContent!.replace('%', '')))
    expect(pcts).toEqual([70, 30])
    expect(pcts.reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('showTotal={false} omite la cifra grande cuando quien llama ya la pintó por su cuenta', () => {
    // INVERSIÓN CON COMISIONES (VENTA/RENTA) ya enseña su total antes del
    // toggle "VER DESGLOSE" — sin esto, el mismo número salía dos veces.
    render(<InvestmentBreakdown barsReady showTotal={false} items={[
      { label: 'Precio de compra', amount: 7_000_000 },
      { label: 'Obra a ejecutar', amount: 3_000_000 },
    ]} />)

    expect(screen.queryByText('$10,000,000')).toBeNull()
    expect(screen.getByText('$7,000,000')).not.toBeNull()
    expect(screen.getByText('$3,000,000')).not.toBeNull()
  })
})
