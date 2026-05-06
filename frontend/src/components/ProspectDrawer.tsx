import type { Prospect } from '../lib/types'
import { colors, fonts } from '../lib/theme'

interface Props {
  prospect: Prospect | null
  onClose: () => void
  onOpenDetail: (id: number) => void
}

function MetricBlock({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ background: colors.border, borderRadius: '2px', padding: '12px', flex: 1 }}>
      <div style={{ fontFamily: fonts.serif, fontSize: '22px', color: accent ? colors.tertiary : colors.neutral, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '4px' }}>{label}</div>
    </div>
  )
}

function fmt(n: number, type: 'pct' | 'mxn') {
  if (!n) return '—'
  if (type === 'pct') return `${(n * 100).toFixed(1)}%`
  return `$${(n / 1_000_000).toFixed(1)}M`
}

export function ProspectDrawer({ prospect, onClose, onOpenDetail }: Props) {
  if (!prospect) return null

  const errors = prospect.issues.filter(i => i.severity === 'error')
  const warnings = prospect.issues.filter(i => i.severity === 'warning')

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 199 }}
      />
      <aside style={{
        position: 'fixed', right: 0, top: 49, bottom: 0, width: '380px',
        background: colors.surfaceAlt, borderLeft: `1px solid ${colors.border}`,
        overflowY: 'auto', zIndex: 200, padding: '20px',
        display: 'flex', flexDirection: 'column', gap: '16px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontFamily: fonts.serif, fontSize: '18px', color: colors.neutral, lineHeight: 1.2 }}>{prospect.name}</div>
            <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary, marginTop: '4px' }}>{prospect.address}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: colors.secondary, cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <span style={{ background: colors.tertiary, color: colors.neutral, fontFamily: fonts.label, fontSize: '12px', padding: '3px 8px', borderRadius: '2px' }}>Score {prospect.score}</span>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <MetricBlock label="ROI" value={fmt(prospect.roi, 'pct')} accent />
          <MetricBlock label="Cap Rate" value={fmt(prospect.capRate, 'pct')} />
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <MetricBlock label="Profit" value={fmt(prospect.profit, 'mxn')} accent />
          <MetricBlock label="Inversión" value={fmt(prospect.totalInvestment, 'mxn')} />
        </div>

        {(errors.length > 0 || warnings.length > 0) && (
          <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: '12px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>Calidad de datos</div>
            {errors.map((issue, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', fontSize: '12px' }}>
                <span>🔴</span><span style={{ color: colors.neutral }}>{issue.message}</span>
              </div>
            ))}
            {warnings.map((issue, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', fontSize: '12px' }}>
                <span>⚠️</span><span style={{ color: colors.secondary }}>{issue.message}</span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => onOpenDetail(prospect.id)}
          style={{
            marginTop: 'auto', padding: '12px', background: colors.tertiary, color: colors.neutral,
            border: 'none', borderRadius: '2px', cursor: 'pointer',
            fontFamily: fonts.label, fontSize: '12px', letterSpacing: '0.1em',
          }}
        >
          ABRIR DETALLE →
        </button>
      </aside>
    </>
  )
}
