import { colors, fonts } from '../../lib/theme'
import { fmtMXN } from '../../lib/fmt'
import type { ProfitWaterfall, WaterfallInput } from '../../lib/types'

/** De dónde salió cada insumo, dicho en la fila que lo usa. */
const EXIT_PRICE_ORIGIN: Record<string, string> = {
  capturado: 'capturado en este reparto',
  venta: 'precio al que se vendió',
  valuacion: 'última valuación',
}

const MONTHS_ORIGIN: Record<string, string> = {
  capturado: 'capturado en este reparto',
  real: 'plazo real transcurrido',
  proyectado: 'plazo proyectado de la propiedad',
  supuesto: 'supuesto por omisión',
}

/** Qué falta capturar, y por qué el renglón está en blanco. */
const MISSING_LABEL: Record<WaterfallInput, string> = {
  investment: 'Falta la inversión total: captúrala o completa el desglose de costos.',
  exitPrice: 'Falta el precio de salida: captúralo aquí, o espera al avalúo o a la venta.',
  investorCapital: 'No hay inversionistas fondeados: el reparto no descuenta costo de capital de terceros.',
}

interface Row {
  label: string
  origin?: string
  value: number | null
  /** Un renglón de subtotal: lleva línea arriba y el nombre en tinta fuerte. */
  subtotal?: boolean
  highlight?: boolean
}

/**
 * El estado financiero del reparto. Cada renglón derivado vale null mientras le
 * falte un insumo, y cada insumo dice de dónde salió: el mismo número puede
 * venir de una venta real o del último avalúo, y no es lo mismo.
 */
export function WaterfallTable({ waterfall, title = 'FLUJO FINANCIERO' }: {
  waterfall: ProfitWaterfall
  title?: string
}) {
  const w = waterfall
  const rows: Row[] = [
    {
      label: 'PRECIO DE SALIDA',
      origin: w.exitPriceSource ? EXIT_PRICE_ORIGIN[w.exitPriceSource] : undefined,
      value: w.exitPrice,
    },
    { label: '− INVERSIÓN TOTAL', value: w.investment },
    { label: 'GANANCIA BRUTA', value: w.grossProfit, subtotal: true },
    {
      label: '− CUOTA INVERSORES',
      origin: w.investorCapitalSource
        ? `${fmtMXN(w.investorCapital)} · ${w.months} meses (${MONTHS_ORIGIN[w.monthsSource]})`
        : undefined,
      value: w.investorCuota,
    },
    { label: 'GANANCIA OPERADOR', value: w.operatorGross, subtotal: true },
    { label: `− ISR (${Math.round(w.isrRate * 100)}%)`, value: w.isr },
    { label: 'DISTRIBUIBLE', value: w.distributable, subtotal: true, highlight: true },
  ]

  const lbl: React.CSSProperties = {
    fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', color: colors.secondary,
  }

  return (
    <div>
      <div style={{ ...lbl, fontSize: '8px', letterSpacing: '0.15em', marginBottom: '8px' }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map(row => (
            <tr key={row.label} style={{ borderTop: row.subtotal ? `1px solid ${colors.border}` : undefined }}>
              <td style={{ padding: '5px 0', paddingLeft: row.subtotal ? '10px' : 0 }}>
                <span style={{ ...lbl, color: row.subtotal ? colors.neutral : colors.secondary }}>
                  {row.label}
                </span>
                {row.origin && (
                  <div style={{ fontFamily: fonts.sans, fontSize: '9px', color: colors.secondary, marginTop: '1px' }}>
                    {row.origin}
                  </div>
                )}
              </td>
              <td style={{
                padding: '5px 0', textAlign: 'right', verticalAlign: 'top',
                fontFamily: fonts.sans,
                fontSize: row.highlight ? '12px' : '11px',
                fontWeight: row.highlight ? 700 : 400,
                color: row.highlight ? colors.primary : colors.neutral,
              }}>
                {row.value == null ? '—' : fmtMXN(row.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {w.missingInputs.length > 0 && (
        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {w.missingInputs.map(key => (
            <div key={key} style={{
              fontFamily: fonts.sans, fontSize: '10px', color: colors.neutral, lineHeight: 1.5,
              padding: '5px 8px', background: colors.surfaceAlt,
              borderLeft: `2px solid ${colors.tertiary}`,
            }}>
              {MISSING_LABEL[key]}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
