import { colors, fonts } from '../lib/theme'
import type { ScoreWeights } from '../lib/types'

interface Props {
  weights: ScoreWeights
  onChange: (w: ScoreWeights) => void
  open: boolean
  onToggle: () => void
}

export function ScoreWeights({ weights, onChange, open, onToggle }: Props) {
  const set = (key: keyof ScoreWeights, raw: number) => {
    const updated = { ...weights, [key]: raw / 100 }
    const sum = updated.roi + updated.capRate + updated.profit
    onChange({ roi: updated.roi / sum, capRate: updated.capRate / sum, profit: updated.profit / sum })
  }

  return (
    <div style={{ borderBottom: `1px solid ${colors.border}` }}>
      <button
        onClick={onToggle}
        style={{ width: '100%', padding: '10px 20px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px', letterSpacing: '0.1em' }}
      >
        {open ? '▼' : '▶'} &nbsp; PESOS DEL SCORE &nbsp;
        <span style={{ color: colors.tertiary }}>ROI {(weights.roi * 100).toFixed(0)}% · Cap {(weights.capRate * 100).toFixed(0)}% · Profit {(weights.profit * 100).toFixed(0)}%</span>
      </button>
      {open && (
        <div style={{ padding: '12px 20px 16px', display: 'flex', gap: '24px', background: colors.surfaceAlt }}>
          {(['roi', 'capRate', 'profit'] as const).map(key => (
            <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
              <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {key === 'roi' ? 'ROI' : key === 'capRate' ? 'Cap Rate' : 'Profit'} — {(weights[key] * 100).toFixed(0)}%
              </span>
              <input
                type="range" min={0} max={100} value={Math.round(weights[key] * 100)}
                onChange={e => set(key, Number(e.target.value))}
                style={{ accentColor: colors.tertiary }}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
