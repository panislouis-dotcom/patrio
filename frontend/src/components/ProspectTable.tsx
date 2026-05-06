import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { fetchProspects } from '../lib/api'
import { computeScores, DEFAULT_WEIGHTS } from '../lib/scoring'
import type { Prospect, ScoreWeights } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { ScoreWeights as ScoreWeightsPanel } from './ScoreWeights'
import { ProspectDrawer } from './ProspectDrawer'
import { QuickCaptureModal } from './QuickCaptureModal'

type SortKey = 'score' | 'roi' | 'capRate' | 'profit' | 'totalInvestment'

function fmt(n: number, type: 'pct' | 'mxn' | 'score') {
  if (type === 'pct') return n ? `${(n * 100).toFixed(1)}%` : '—'
  if (type === 'mxn') return n ? `$${(n / 1_000_000).toFixed(1)}M` : '—'
  return String(n)
}

export function ProspectTable() {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [weights, setWeights] = useState<ScoreWeights>(DEFAULT_WEIGHTS)
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortAsc, setSortAsc] = useState(false)
  const [weightsOpen, setWeightsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCapture, setShowCapture] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const selectedId = searchParams.get('id') ? Number(searchParams.get('id')) : null
  const selected = prospects.find(p => p.id === selectedId) ?? null

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

  const colHeader = (key: SortKey, label: string) => (
    <th
      onClick={() => toggleSort(key)}
      style={{ padding: '10px 12px', fontFamily: fonts.label, fontSize: '10px', color: sortKey === key ? colors.tertiary : colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', textAlign: 'right', whiteSpace: 'nowrap' }}
    >
      {label} {sortKey === key ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  )

  if (loading) return <div style={{ padding: '32px', color: colors.secondary }}>Cargando…</div>
  if (error) return <div style={{ padding: '32px', color: 'tomato' }}>Error: {error}</div>

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 49px)' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: `1px solid ${colors.border}` }}>
          <ScoreWeightsPanel weights={weights} onChange={setWeights} open={weightsOpen} onToggle={() => setWeightsOpen(o => !o)} />
          {(totalErrors > 0 || totalWarnings > 0) && (
            <div style={{ display: 'flex', gap: '10px', fontFamily: fonts.label, fontSize: '10px', letterSpacing: '0.08em' }}>
              {totalErrors > 0 && <span style={{ color: 'tomato' }}>🔴 {totalErrors}</span>}
              {totalWarnings > 0 && <span style={{ color: '#D4891A' }}>⚠️ {totalWarnings}</span>}
            </div>
          )}
          <button
            onClick={() => setShowCapture(true)}
            style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '11px', letterSpacing: '0.1em', padding: '7px 14px', flexShrink: 0 }}
          >
            + NUEVO
          </button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: colors.dark, zIndex: 10 }}>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              <th style={{ padding: '10px 12px', fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'left' }}>PROSPECTO</th>
              {colHeader('score', 'SCORE')}
              {colHeader('roi', 'ROI')}
              {colHeader('capRate', 'CAP RATE')}
              {colHeader('profit', 'PROFIT')}
              {colHeader('totalInvestment', 'INVERSIÓN')}
              <th style={{ padding: '10px 12px', width: '32px' }}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(p => {
              const errors = p.issues.filter(i => i.severity === 'error').length
              const warnings = p.issues.filter(i => i.severity === 'warning').length
              const isSelected = p.id === selectedId
              return (
                <tr
                  key={p.id}
                  onClick={() => setSearchParams({ id: String(p.id) })}
                  style={{ borderBottom: `1px solid ${colors.border}`, cursor: 'pointer', background: isSelected ? `${colors.tertiary}18` : 'transparent' }}
                  onMouseEnter={e => (e.currentTarget.style.background = isSelected ? `${colors.tertiary}18` : `${colors.border}55`)}
                  onMouseLeave={e => (e.currentTarget.style.background = isSelected ? `${colors.tertiary}18` : 'transparent')}
                >
                  <td style={{ padding: '10px 12px', color: colors.neutral, fontFamily: fonts.sans, maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <span style={{ background: p.score >= 70 ? colors.tertiary : p.score >= 40 ? colors.accent1 : colors.secondary, color: colors.neutral, fontFamily: fonts.label, fontSize: '11px', padding: '2px 7px', borderRadius: '2px' }}>{p.score}</span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: colors.tertiary, fontFamily: fonts.label, fontSize: '12px' }}>{fmt(p.roi, 'pct')}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: colors.primary, fontFamily: fonts.label, fontSize: '12px' }}>{fmt(p.capRate, 'pct')}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: colors.neutral, fontFamily: fonts.label, fontSize: '12px' }}>{fmt(p.profit, 'mxn')}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: colors.secondary, fontFamily: fonts.label, fontSize: '12px' }}>{fmt(p.totalInvestment, 'mxn')}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '13px' }}>
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
      <ProspectDrawer
        prospect={selected}
        onClose={() => setSearchParams({})}
        onOpenDetail={id => navigate(`/tabla/${id}`)}
        onUpdated={updated => setProspects(prev => computeScores(prev.map(p => p.id === updated.id ? updated : p), weights))}
      />
      {showCapture && (
        <QuickCaptureModal
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
