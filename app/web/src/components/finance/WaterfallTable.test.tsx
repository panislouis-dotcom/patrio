import { render, screen } from '@testing-library/react'
import { WaterfallTable } from './WaterfallTable'
import type { ProfitWaterfall } from '../../lib/types'

const EMPTY_SCENARIO = { splits: [], companyResidual: null }

/** Un reparto completo: 7M de salida sobre 5M de inversión, 1M fondeado al 12%. */
const COMPLETE: ProfitWaterfall = {
  exitPrice: 7_000_000, exitPriceSource: 'valuacion',
  investment: 5_000_000, grossProfit: 2_000_000,
  investorCapital: 1_000_000, investorCapitalSource: 'fondeado',
  investorCuota: 120_000, operatorGross: 1_880_000,
  isrRate: 0.30, isr: 564_000, netProfit: 1_316_000, distributable: 1_316_000,
  activeTier: null, bonusInputsMissing: ['plannedEndDate', 'bufferDays'],
  months: 12, monthsSource: 'real', missingInputs: [],
  investorBreakdown: [],
  scenarios: { sin_bono: EMPTY_SCENARIO, bono_25: EMPTY_SCENARIO, bono_50: EMPTY_SCENARIO },
}

describe('WaterfallTable', () => {
  it('dice de dónde salió el precio de salida', () => {
    render(<WaterfallTable waterfall={COMPLETE} />)
    expect(screen.getByText('$7,000,000')).not.toBeNull()
    expect(screen.getByText('última valuación')).not.toBeNull()
  })

  it('sin inversionistas fondeados no fabrica una cuota: la nombra como faltante', () => {
    render(<WaterfallTable waterfall={{
      ...COMPLETE,
      investorCapital: 0, investorCapitalSource: null, investorCuota: 0,
      operatorGross: 2_000_000, isr: 600_000, netProfit: 1_400_000, distributable: 1_400_000,
      missingInputs: ['investorCapital'],
    }} />)
    expect(screen.getByText(/No hay inversionistas fondeados/)).not.toBeNull()
    // La ganancia del operador es la bruta completa: nada se descontó.
    expect(screen.getAllByText('$2,000,000')).toHaveLength(2)
  })

  it('sin precio de salida no publica ningún renglón derivado', () => {
    render(<WaterfallTable waterfall={{
      ...COMPLETE,
      exitPrice: null, exitPriceSource: null, grossProfit: null,
      operatorGross: null, isr: null, netProfit: null, distributable: null,
      missingInputs: ['exitPrice'],
    }} />)
    expect(screen.getByText(/Falta el precio de salida/)).not.toBeNull()
    // Precio de salida, ganancia bruta, ganancia operador, ISR y distribuible.
    expect(screen.getAllByText('—')).toHaveLength(5)
    expect(screen.queryByText('-$5,000,000')).toBeNull()
  })

  it('nombra la inversión faltante en vez de restar contra cero', () => {
    render(<WaterfallTable waterfall={{
      ...COMPLETE,
      investment: null, grossProfit: null, operatorGross: null,
      isr: null, netProfit: null, distributable: null,
      missingInputs: ['investment'],
    }} />)
    expect(screen.getByText(/Falta la inversión total/)).not.toBeNull()
  })

  it('el plazo de la cuota dice de dónde salió', () => {
    render(<WaterfallTable waterfall={{ ...COMPLETE, monthsSource: 'supuesto' }} />)
    expect(screen.getByText(/supuesto por omisión/)).not.toBeNull()
  })
})
