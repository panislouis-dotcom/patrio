import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchProjects } from '../lib/api'
import type { Project } from '../lib/types'
import { colors, fonts } from '../lib/theme'

type SortKey = 'unrealizedGainPct' | 'unrealizedGain' | 'totalInvestment' | 'currentValuation' | 'holdMonthsActual'

function fmtM(n: number) { return n ? `$${(n / 1_000_000).toFixed(1)}M` : '—' }

const STATUS_COLOR: Record<string, string> = {
  construction: '#D4891A',
  stabilizing: colors.accent1,
  operating: colors.primary,
  exited: colors.secondary,
}

export function ProjectsTab() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('unrealizedGainPct')
  const [sortAsc, setSortAsc] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    fetchProjects()
      .then(setProjects)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const sorted = [...projects].sort((a, b) => {
    const diff = (a[sortKey] as number) - (b[sortKey] as number)
    return sortAsc ? diff : -diff
  })

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

  const totalInvestment = projects.reduce((s, p) => s + p.totalInvestment, 0)
  const totalValuation = projects.reduce((s, p) => s + p.currentValuation, 0)
  const totalGain = projects.reduce((s, p) => s + p.unrealizedGain, 0)
  const activeCount = projects.filter(p => p.status === 'operating' || p.status === 'stabilizing').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 49px)' }}>
      {/* Portfolio summary strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', borderBottom: `1px solid ${colors.border}`, fontFamily: fonts.label, fontSize: '11px', color: colors.secondary, flexWrap: 'wrap' }}>
        <span>Capital desplegado:</span>
        <span style={{ color: colors.neutral }}>{fmtM(totalInvestment)}</span>
        <span style={{ margin: '0 4px' }}>·</span>
        <span>Valoración total:</span>
        <span style={{ color: colors.neutral }}>{fmtM(totalValuation)}</span>
        <span style={{ margin: '0 4px' }}>·</span>
        <span>Ganancia no realizada:</span>
        <span style={{ color: colors.neutral }}>{fmtM(totalGain)}</span>
        <span style={{ margin: '0 4px' }}>·</span>
        <span style={{ color: colors.neutral }}>{activeCount}</span>
        <span>proyectos activos</span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: colors.dark, zIndex: 10 }}>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              <th style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', textAlign: 'left', whiteSpace: 'nowrap' }}>PROYECTO</th>
              {th('totalInvestment', 'INVERSIÓN')}
              {th('currentValuation', 'VALORACIÓN')}
              {th('unrealizedGain', 'GANANCIA')}
              {th('unrealizedGainPct', 'GANANCIA%')}
              {th('holdMonthsActual', 'PLAZO')}
            </tr>
          </thead>
          <tbody>
            {sorted.map(p => {
              const statusDot = STATUS_COLOR[p.status] ?? colors.secondary
              const gainColor = p.unrealizedGain >= 0 ? colors.tertiary : 'tomato'
              const gainPctColor = p.unrealizedGainPct >= 0 ? colors.tertiary : 'tomato'

              return (
                <tr
                  key={p.id}
                  onClick={() => navigate(`/proyectos/${p.id}`)}
                  style={{ borderBottom: `1px solid ${colors.border}`, cursor: 'pointer', background: 'transparent' }}
                  onMouseEnter={e => (e.currentTarget.style.background = `${colors.border}55`)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* Name + type + status dot */}
                  <td style={{ padding: '5px 10px', maxWidth: '240px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <span
                        style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusDot, flexShrink: 0 }}
                        title={p.status}
                      />
                      <div style={{ overflow: 'hidden' }}>
                        <div style={{ color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                        <div style={{ color: colors.secondary, fontFamily: fonts.label, fontSize: '10px', letterSpacing: '0.04em', marginTop: '1px' }}>{p.type}</div>
                      </div>
                    </div>
                  </td>

                  {/* Inversión */}
                  <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>{fmtM(p.totalInvestment)}</td>

                  {/* Valoración */}
                  <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.neutral, fontFamily: fonts.label, fontSize: '11px' }}>{fmtM(p.currentValuation)}</td>

                  {/* Ganancia */}
                  <td style={{ padding: '5px 10px', textAlign: 'right', color: gainColor, fontFamily: fonts.label, fontSize: '11px' }}>{fmtM(p.unrealizedGain)}</td>

                  {/* Ganancia% */}
                  <td style={{ padding: '5px 10px', textAlign: 'right', color: gainPctColor, fontFamily: fonts.label, fontSize: '11px' }}>
                    {p.unrealizedGainPct ? `${(p.unrealizedGainPct * 100).toFixed(1)}%` : '—'}
                  </td>

                  {/* Plazo */}
                  <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>
                    {p.holdMonthsActual > 0 ? `${p.holdMonthsActual}m` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
