import { colors, fonts } from '../../lib/theme'

/** La historia de la propiedad en fechas: `{"YYYY-MM": "lo que pasó"}`. */
export function MilestoneTimeline({ milestones }: { milestones: Record<string, string> }) {
  const entries = Object.entries(milestones).sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return null

  return (
    <div style={{ marginTop: '20px' }}>
      <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '16px' }}>HITOS</div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {entries.map(([date, label], i) => (
          <div key={date} style={{ display: 'flex', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: '8px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: colors.primary, flexShrink: 0, boxShadow: `0 0 6px ${colors.primary}66` }} />
              {i < entries.length - 1 && (
                <div style={{ width: '1px', flex: 1, minHeight: '20px', background: colors.border }} />
              )}
            </div>
            <div style={{ paddingBottom: '16px' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.05em' }}>{date}</div>
              <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral, marginTop: '2px' }}>{label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
