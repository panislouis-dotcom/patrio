import { colors, fonts } from '../../lib/theme'

/**
 * The serif hero number + optional progress bar + caption, shared by the
 * prospect and project detail pages. `size` controls the number font size
 * (42px hero, 24px secondary metric).
 */
export function MetricHero({ label, value, color, barPct, barsReady, caption, size = 42 }: {
  label: string; value: string; color: string; barPct?: number; barsReady?: boolean
  caption?: string; size?: number
}) {
  return (
    <div style={{ paddingBottom: '16px', borderBottom: `1px solid ${colors.border}`, marginBottom: '4px' }}>
      <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '10px' }}>{label}</div>
      <div style={{ fontFamily: fonts.serif, fontSize: `${size}px`, color, lineHeight: 1 }}>{value}</div>
      {barPct !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
          <div style={{ flex: 1, height: '3px', background: colors.border, borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: barsReady ? `${Math.min(100, Math.max(0, barPct))}%` : '0%',
              background: color,
              transition: 'width 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
            }} />
          </div>
          {caption && <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, flexShrink: 0 }}>{caption}</span>}
        </div>
      )}
    </div>
  )
}
