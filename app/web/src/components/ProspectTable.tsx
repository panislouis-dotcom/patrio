import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchProspects, updateProspect, generateProspectus } from '../lib/api'
import { computeScores, DEFAULT_WEIGHTS } from '../lib/scoring'
import type { Prospect, ScoreWeights } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { fmtPct, fmtM } from '../lib/fmt'
import { ScoreWeights as ScoreWeightsPanel } from './ScoreWeights'
import { SmartProspectModal } from './SmartProspectModal'
import { PROSPECT_STATUS_COLOR } from '../lib/status'

type SortKey = 'score' | 'roi' | 'capRate' | 'profit' | 'totalInvestment' | 'projectedSale' | 'holdMonths'

export function ProspectTable() {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [weights, setWeights] = useState<ScoreWeights>(DEFAULT_WEIGHTS)
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortAsc, setSortAsc] = useState(false)
  const [weightsOpen, setWeightsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCapture, setShowCapture] = useState(false)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    fetchProspects()
      .then(data => setProspects(computeScores(data, weights)))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    setProspects(prev => computeScores(prev, weights))
  }, [weights])

  const sorted = [...prospects].sort((a, b) => {
    const diff = (a[sortKey] as number) - (b[sortKey] as number)
    return sortAsc ? diff : -diff
  })

  const totalErrors = prospects.flatMap(p => p.issues).filter(i => i.severity === 'error').length
  const totalWarnings = prospects.flatMap(p => p.issues).filter(i => i.severity === 'warning').length

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  const th = (key: SortKey, label: string) => (
    <th
      onClick={() => toggleSort(key)}
      style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: sortKey === key ? colors.tertiary : colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', cursor: 'pointer', textAlign: 'right', whiteSpace: 'nowrap', userSelect: 'none' }}
    >
      {label}{sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </th>
  )

  if (loading) return <div style={{ padding: '32px', color: colors.secondary }}>Cargando…</div>
  if (error) return <div style={{ padding: '32px', color: 'tomato' }}>Error: {error}</div>

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 49px)' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', borderBottom: `1px solid ${colors.border}` }}>
          <ScoreWeightsPanel weights={weights} onChange={setWeights} open={weightsOpen} onToggle={() => setWeightsOpen(o => !o)} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {(totalErrors > 0 || totalWarnings > 0) && (
              <div style={{ display: 'flex', gap: '8px', fontFamily: fonts.label, fontSize: '10px', letterSpacing: '0.08em' }}>
                {totalErrors > 0 && <span style={{ color: 'tomato' }}>🔴 {totalErrors}</span>}
                {totalWarnings > 0 && <span style={{ color: '#a46a14' }}>⚠️ {totalWarnings}</span>}
              </div>
            )}
            <button
              onClick={async () => {
                setGeneratingPdf(true)
                try {
                  const blob = await generateProspectus()
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = 'prospecto.pdf'
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                  URL.revokeObjectURL(url)
                } catch (err) {
                  alert((err as Error).message)
                } finally {
                  setGeneratingPdf(false)
                }
              }}
              disabled={generatingPdf}
              style={{
                background: 'transparent',
                border: `1px solid ${colors.primary}`,
                color: colors.tertiary,
                cursor: generatingPdf ? 'wait' : 'pointer',
                fontFamily: fonts.label,
                fontSize: '10px',
                letterSpacing: '0.1em',
                padding: '5px 12px',
                opacity: generatingPdf ? 0.7 : 1,
              }}
            >
              {generatingPdf ? '⏳ GENERANDO…' : '📄 PROSPECTO'}
            </button>
            <button
              onClick={() => setShowCapture(true)}
              style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '10px', letterSpacing: '0.1em', padding: '5px 12px' }}
            >
              + NUEVO
            </button>
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: colors.dark, zIndex: 10 }}>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              <th style={{ width: '28px', padding: '0 4px' }} />
              <th style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', textAlign: 'left', whiteSpace: 'nowrap' }}>PROSPECTO</th>
              {th('score', 'SCORE')}
              {th('roi', 'ROI')}
              {th('capRate', 'CAP RATE')}
              {th('profit', 'PROFIT')}
              {th('totalInvestment', 'INVERSIÓN')}
              {th('projectedSale', 'VENTA')}
              {th('holdMonths', 'PLAZO')}
              <th style={{ padding: '6px 10px', width: '24px' }} />
            </tr>
          </thead>
          <tbody>
            {sorted.map(p => {
              const errors = p.issues.filter(i => i.severity === 'error').length
              const warnings = p.issues.filter(i => i.severity === 'warning').length
              const roiColor = (p.roi ?? 0) < 0 ? 'tomato' : (p.roi ?? 0) > 0.15 ? colors.tertiary : colors.neutral
              const statusDot = PROSPECT_STATUS_COLOR[p.status] ?? colors.secondary

              return (
                <tr
                  key={p.id}
                  onClick={() => navigate(`/prospectos/tabla/${p.id}`)}
                  style={{ borderBottom: `1px solid ${colors.border}`, cursor: 'pointer', background: 'transparent' }}
                  onMouseEnter={e => (e.currentTarget.style.background = `${colors.border}55`)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* Favorite */}
                  <td
                    style={{ padding: '0 4px', textAlign: 'center', cursor: 'pointer', width: '28px' }}
                    onClick={e => {
                      e.stopPropagation()
                      updateProspect(p.id, { isFavorite: !p.isFavorite })
                        .then(updated => setProspects(prev => prev.map(x => x.id === updated.id ? { ...x, isFavorite: updated.isFavorite } : x)))
                    }}
                  >
                    <span style={{ color: p.isFavorite ? colors.tertiary : colors.border, fontSize: '14px' }}>
                      {p.isFavorite ? '★' : '☆'}
                    </span>
                  </td>
                  {/* Name + city + status dot */}
                  <td style={{ padding: '5px 10px', maxWidth: '200px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <span
                        style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusDot, flexShrink: 0 }}
                        title={p.status}
                      />
                      <div style={{ overflow: 'hidden' }}>
                        <div style={{ color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                        <div style={{ color: colors.secondary, fontFamily: fonts.label, fontSize: '10px', letterSpacing: '0.04em', marginTop: '1px' }}>{p.city}</div>
                      </div>
                    </div>
                  </td>

                  {/* Score */}
                  <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                    <span style={{ background: p.score >= 70 ? colors.tertiary : p.score >= 40 ? colors.accent1 : colors.secondary, color: colors.neutral, fontFamily: fonts.label, fontSize: '10px', padding: '2px 6px', borderRadius: '2px' }}>{p.score}</span>
                  </td>

                  {/* ROI */}
                  <td style={{ padding: '5px 10px', textAlign: 'right', color: roiColor, fontFamily: fonts.label, fontSize: '11px' }}>{fmtPct(p.roi)}</td>

                  {/* Cap Rate */}
                  <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.primary, fontFamily: fonts.label, fontSize: '11px' }}>{fmtPct(p.capRate)}</td>

                  {/* Profit */}
                  <td style={{ padding: '5px 10px', textAlign: 'right', color: p.profit < 500_000 ? '#a46a14' : colors.neutral, fontFamily: fonts.label, fontSize: '11px' }}>{fmtM(p.profit)}</td>

                  {/* Inversión */}
                  <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>{fmtM(p.totalInvestment)}</td>

                  {/* Venta */}
                  <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>{fmtM(p.projectedSale)}</td>

                  {/* Plazo */}
                  <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>{p.holdMonths > 0 ? `${p.holdMonths}m` : '—'}</td>

                  {/* Quality */}
                  <td style={{ padding: '5px 10px', textAlign: 'center', fontSize: '11px' }}>
                    {(errors > 0 || warnings > 0) && (
                      <span
                        title={p.issues.map(i => `${i.severity === 'error' ? '🔴' : '⚠️'} ${i.message}`).join('\n')}
                        style={{ cursor: 'help' }}
                      >
                        {errors > 0 ? '🔴' : '⚠️'}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showCapture && (
        <SmartProspectModal
          onClose={() => setShowCapture(false)}
          onCreated={() => {
            setShowCapture(false)
            fetchProspects().then(data => setProspects(computeScores(data, weights)))
          }}
        />
      )}
    </div>
  )
}
