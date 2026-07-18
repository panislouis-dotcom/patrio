import { colors } from '../lib/theme'

interface Props {
  value: number | null
  mode?: 'dots' | 'number'
  size?: number
}

export function RatingDisplay({ value, mode = 'dots', size = 8 }: Props) {
  if (value == null) {
    return <span style={{ color: colors.secondary, fontSize: '11px' }}>—</span>
  }
  if (mode === 'number') {
    return <span style={{ color: colors.neutral, fontSize: '11px', fontWeight: 600 }}>{value}/5</span>
  }
  return (
    <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} style={{
          width: size, height: size, borderRadius: '50%',
          background: i <= value ? colors.primary : colors.border,
        }} />
      ))}
    </div>
  )
}
