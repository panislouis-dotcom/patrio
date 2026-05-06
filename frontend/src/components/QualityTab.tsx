import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { fetchProspects } from '../lib/api'
import { computeScores, DEFAULT_WEIGHTS } from '../lib/scoring'
import type { Prospect } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { ProspectDrawer } from './ProspectDrawer'

export function QualityTab() {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [loading, setLoading] = useState(true)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const selectedId = searchParams.get('id') ? Number(searchParams.get('id')) : null
  const selected = prospects.find(p => p.id === selectedId) ?? null

  useEffect(() => {
    fetchProspects()
      .then(data => setProspects(computeScores(data, DEFAULT_WEIGHTS)))
      .finally(() => setLoading(false))
  }, [])

  const withIssues = prospects
    .filter(p => p.issues.length > 0)
    .sort((a, b) => {
      const aErrors = a.issues.filter(i => i.severity === 'error').length
      const bErrors = b.issues.filter(i => i.severity === 'error').length
      return bErrors !== aErrors ? bErrors - aErrors : b.score - a.score
    })
  const clean = prospects.filter(p => p.issues.length === 0)

  const totalErrors = prospects.flatMap(p => p.issues).filter(i => i.severity === 'error').length
  const totalWarnings = prospects.flatMap(p => p.issues).filter(i => i.severity === 'warning').length

  if (loading) return <div style={{ padding: '32px', color: colors.secondary }}>Cargando…</div>

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 49px)' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        <div style={{ marginBottom: '24px' }}>
          <h2 style={{ fontFamily: fonts.serif, fontSize: '22px', color: colors.neutral, marginBottom: '6px' }}>Calidad de datos</h2>
          <div style={{ fontFamily: fonts.label, fontSize: '11px', color: colors.secondary, letterSpacing: '0.08em' }}>
            {totalErrors > 0 && <span style={{ color: 'tomato', marginRight: '12px' }}>🔴 {totalErrors} errores</span>}
            {totalWarnings > 0 && <span style={{ color: '#D4891A', marginRight: '12px' }}>⚠️ {totalWarnings} advertencias</span>}
            en {withIssues.length} de {prospects.length} prospectos
          </div>
        </div>

        {withIssues.map(p => {
          const errors = p.issues.filter(i => i.severity === 'error')
          const warnings = p.issues.filter(i => i.severity === 'warning')
          return (
            <div
              key={p.id}
              onClick={() => setSearchParams({ id: String(p.id) })}
              style={{ background: colors.surfaceAlt, border: `1px solid ${colors.border}`, borderRadius: '2px', padding: '16px', marginBottom: '12px', cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ fontFamily: fonts.sans, fontSize: '14px', color: colors.neutral }}>{p.name}</span>
                <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary }}>
                  {errors.length > 0 && <span style={{ color: 'tomato', marginRight: '8px' }}>🔴 {errors.length}</span>}
                  {warnings.length > 0 && <span style={{ color: '#D4891A' }}>⚠️ {warnings.length}</span>}
                </span>
              </div>
              {errors.map((issue, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', fontSize: '12px', color: colors.neutral, marginBottom: '4px' }}>
                  <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, minWidth: '140px', textTransform: 'uppercase' }}>{issue.field}</span>
                  <span>{issue.message}</span>
                </div>
              ))}
              {warnings.map((issue, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', fontSize: '12px', color: colors.secondary, marginBottom: '4px' }}>
                  <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, minWidth: '140px', textTransform: 'uppercase' }}>{issue.field}</span>
                  <span>{issue.message}</span>
                </div>
              ))}
            </div>
          )
        })}

        {clean.length > 0 && (
          <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: `1px solid ${colors.border}` }}>
            <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>Sin problemas</div>
            {clean.map(p => (
              <div key={p.id} style={{ padding: '8px 0', borderBottom: `1px solid ${colors.border}`, fontFamily: fonts.sans, fontSize: '13px', color: colors.primary }}>
                ✓ {p.name}
              </div>
            ))}
          </div>
        )}
      </div>
      <ProspectDrawer
        prospect={selected}
        onClose={() => setSearchParams({})}
        onOpenDetail={id => navigate(`/tabla/${id}`)}
      />
    </div>
  )
}
