import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PropertyProfitSection } from './PropertyProfitSection'
import type { ProfitSplitConfig, ProfitWaterfall } from '../lib/types'
import * as api from '../lib/api'

vi.mock('../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, fetchPropertyProfit: vi.fn(), updatePropertyProfit: vi.fn() }
})

const CONFIG: ProfitSplitConfig = {
  id: 1, propertyId: 7,
  exitPrice: null, investorCapital: null,
  investorRateAnnual: 0.12, investorMonths: null, isrRate: 0.30,
  finderFeePct: 0, directorPct: 0, responsablePct: 0,
  liderPct: 0, maestroPct: 0, ayudantePct: 0,
  finderMemberId: null, responsableMemberId: null, liderMemberId: null,
  maestroMemberIds: [], ayudanteMemberIds: [],
  maestroCount: null, ayudanteCount: null,
  plannedEndDate: null, actualEndDate: null, bufferDays: 0, notes: '',
}

const EMPTY_SCENARIO = { splits: [], companyResidual: null }

const WATERFALL: ProfitWaterfall = {
  exitPrice: 7_000_000, exitPriceSource: 'valuacion',
  investment: 5_000_000, grossProfit: 2_000_000,
  investorCapital: 0, investorCapitalSource: null, investorCuota: 0,
  operatorGross: 2_000_000, isrRate: 0.30, isr: 600_000,
  netProfit: 1_400_000, distributable: 1_400_000,
  activeTier: null, bonusInputsMissing: ['plannedEndDate', 'bufferDays'],
  months: 12, monthsSource: 'real', missingInputs: ['investorCapital'],
  investorBreakdown: [],
  scenarios: { sin_bono: EMPTY_SCENARIO, bono_25: EMPTY_SCENARIO, bono_50: EMPTY_SCENARIO },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.fetchPropertyProfit).mockResolvedValue({ config: CONFIG, waterfall: WATERFALL })
  vi.mocked(api.updatePropertyProfit).mockResolvedValue({ config: CONFIG, waterfall: WATERFALL })
})

async function renderSection() {
  render(<PropertyProfitSection propertyId={7} team={[]} />)
  await waitFor(() => expect(screen.getByText('SUPUESTOS DEL REPARTO')).not.toBeNull())
}

describe('PropertyProfitSection', () => {
  it('expone los ocho campos escribibles que el reparto usa', async () => {
    await renderSection()
    for (const label of ['PRECIO DE SALIDA', 'CAPITAL INVERSOR', 'TASA INVERSOR', 'PLAZO', 'ISR',
      'FECHA PLANEADA', 'FECHA REAL', 'HOLGURA']) {
      expect(screen.getByLabelText(label)).not.toBeNull()
    }
  })

  it('los supuestos vacíos dicen qué se está usando en su lugar', async () => {
    await renderSection()
    // Aparece dos veces: en el renglón del flujo y bajo el campo vacío.
    expect(screen.getAllByText(/última valuación/).length).toBeGreaterThan(0)
    expect(screen.getByText(/sin inversionistas fondeados: no se cobra/i)).not.toBeNull()
  })

  it('el bono dice qué le falta para poder encenderse', async () => {
    await renderSection()
    expect(screen.getByText(/falta la fecha planeada de entrega, la holgura en días/)).not.toBeNull()
  })

  it('la captura de entrega viaja al servidor, así que el bono sí puede activarse', async () => {
    await renderSection()
    fireEvent.change(screen.getByLabelText('FECHA PLANEADA'), { target: { value: '2026-06-30' } })
    fireEvent.change(screen.getByLabelText('HOLGURA'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('FECHA REAL'), { target: { value: '2026-05-01' } })
    fireEvent.click(screen.getByText('GUARDAR'))
    await waitFor(() => expect(api.updatePropertyProfit).toHaveBeenCalled())
    expect(vi.mocked(api.updatePropertyProfit).mock.calls[0][1]).toMatchObject({
      plannedEndDate: '2026-06-30', bufferDays: 30, actualEndDate: '2026-05-01',
    })
  })

  it('un supuesto vacío viaja como null, no como cero', async () => {
    await renderSection()
    fireEvent.change(screen.getByLabelText('CAPITAL INVERSOR'), { target: { value: '3000000' } })
    fireEvent.click(screen.getByText('GUARDAR'))
    await waitFor(() => expect(api.updatePropertyProfit).toHaveBeenCalled())
    const draft = vi.mocked(api.updatePropertyProfit).mock.calls[0][1]
    expect(draft.investorCapital).toBe(3_000_000)
    expect(draft.exitPrice).toBeNull()
    expect(draft.investorMonths).toBeNull()
    expect(draft.isrRate).toBe(0.30)
  })
})
