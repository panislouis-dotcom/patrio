import { colors, fonts } from '../../lib/theme'
import { fmtMXN } from '../../lib/fmt'

const BAR_COLORS = [colors.primary, '#654F6F', '#5C5D8D', colors.tertiary, colors.secondary]

export interface BreakdownItem { label: string; amount: number }

/**
 * The serif-total + animated per-item bars block, shared by the prospect and
 * project detail pages. Zero-amount items are filtered; renders null when empty.
 */
export function InvestmentBreakdown({ label, total, items, barsReady }: {
  label: string; total: number; items: BreakdownItem[]; barsReady: boolean
}) {
  const visible = items.filter(i => i.amount > 0)
  if (visible.length === 0) return null
  return (
    <div style={{ marginTop: '20px' }}>
      <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, padding: '12px 0 6px', borderBottom: `1px solid ${colors.border}`, marginBottom: '8px', marginTop: '4px' }}>
        {label}
      </div>
      <div style={{ fontFamily: fonts.serif, fontSize: '28px', color: colors.neutral, marginBottom: '20px' }}>{fmtMXN(total)}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {visible.map(({ label: l, amount }, i) => {
          const pct = total > 0 ? (amount / total) * 100 : 0
          return (
            <div key={l}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em' }}>
                  {l.toUpperCase()}
                </span>
                <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>{fmtMXN(amount)}</span>
              </div>
              <div style={{ height: '3px', background: colors.border, borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: barsReady ? `${pct}%` : '0%',
                  background: BAR_COLORS[i % BAR_COLORS.length],
                  borderRadius: '2px',
                  transition: `width 0.9s cubic-bezier(0.4, 0, 0.2, 1) ${i * 70}ms`,
                }} />
              </div>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.border, marginTop: '3px', textAlign: 'right' }}>
                {pct.toFixed(0)}%
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
