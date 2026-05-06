import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchProspects, updateProspect } from '../lib/api'
import { computeScores, DEFAULT_WEIGHTS } from '../lib/scoring'
import type { Prospect, RawFields } from '../lib/types'
import { colors, fonts } from '../lib/theme'

interface FieldInput {
  key: keyof RawFields
  type: 'number' | 'date'
  step?: string
  placeholder?: string
}

interface FieldGroup {
  label: string
  severity: 'error' | 'warning'
  fields: FieldInput[]
}

const FIELD_INPUTS: Record<string, FieldGroup | null> = {
  latitude: {
    label: 'Ubicación',
    severity: 'error',
    fields: [
      { key: 'latitude',  type: 'number', step: 'any', placeholder: 'Latitud (ej. 25.6866)' },
      { key: 'longitude', type: 'number', step: 'any', placeholder: 'Longitud (ej. -100.3161)' },
    ],
  },
  longitude: null,  // rendered with latitude
  landPrice: {
    label: 'Precio terreno',
    severity: 'error',
    fields: [{ key: 'landPrice', type: 'number', placeholder: 'MXN' }],
  },
  sqmLand: {
    label: 'Superficie terreno',
    severity: 'error',
    fields: [{ key: 'sqmLand', type: 'number', placeholder: 'm²' }],
  },
  constructionOverhead: {
    label: 'Overhead construcción',
    severity: 'error',
    fields: [{ key: 'constructionOverhead', type: 'number', step: '0.01', placeholder: '≥ 1.0 (ej. 1.3)' }],
  },
  saleDate: {
    label: 'Fechas',
    severity: 'error',
    fields: [
      { key: 'investmentDate', type: 'date' },
      { key: 'saleDate', type: 'date' },
    ],
  },
  investmentDate: null,  // rendered with saleDate
  constructionCostPerSqm: {
    label: 'Costo construcción/m²',
    severity: 'warning',
    fields: [{ key: 'constructionCostPerSqm', type: 'number', placeholder: 'MXN/m²' }],
  },
  rentMonthly: {
    label: 'Renta mensual',
    severity: 'warning',
    fields: [{ key: 'rentMonthly', type: 'number', placeholder: 'MXN/mes' }],
  },
}

const inputStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  borderBottom: `1px solid ${colors.border}`,
  color: colors.neutral,
  fontFamily: fonts.sans,
  fontSize: '13px',
  padding: '6px 0',
  width: '100%',
  outline: 'none',
}

export function QualityTab() {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [loading, setLoading] = useState(true)
  const [edits, setEdits] = useState<Record<number, Partial<RawFields>>>({})
  const [saving, setSaving] = useState<Record<number, boolean>>({})
  const [saveErrors, setSaveErrors] = useState<Record<number, string | null>>({})
  const [fetchError, setFetchError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    fetchProspects()
      .then(data => setProspects(computeScores(data, DEFAULT_WEIGHTS)))
      .catch(e => setFetchError(e instanceof Error ? e.message : 'Error al cargar'))
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

  function handleEdit(
    prospectId: number,
    key: keyof RawFields,
    raw: string,
    inputType: 'number' | 'date'
  ) {
    const value = inputType === 'number'
      ? (raw === '' ? undefined : parseFloat(raw))
      : raw
    setEdits(prev => {
      const prospectEdits = { ...(prev[prospectId] ?? {}) }
      if (value === undefined) {
        delete (prospectEdits as Record<string, unknown>)[key as string]
      } else {
        (prospectEdits as Record<string, unknown>)[key as string] = value
      }
      return { ...prev, [prospectId]: prospectEdits }
    })
  }

  async function handleSave(prospectId: number) {
    const payload = edits[prospectId]
    if (!payload || Object.keys(payload).length === 0) return
    setSaving(prev => ({ ...prev, [prospectId]: true }))
    setSaveErrors(prev => ({ ...prev, [prospectId]: null }))
    try {
      const updated = await updateProspect(prospectId, payload)
      setProspects(prev => {
        const next = prev.map(p => p.id === prospectId ? updated : p)
        return computeScores(next, DEFAULT_WEIGHTS)
      })
      setEdits(prev => { const next = { ...prev }; delete next[prospectId]; return next })
    } catch (e: unknown) {
      setSaveErrors(prev => ({
        ...prev,
        [prospectId]: e instanceof Error ? e.message : 'Error al guardar'
      }))
    } finally {
      setSaving(prev => ({ ...prev, [prospectId]: false }))
    }
  }

  if (loading) return <div style={{ padding: '32px', color: colors.secondary }}>Cargando…</div>
  if (fetchError) return <div style={{ padding: '32px', color: 'tomato' }}>{fetchError}</div>

  return (
    <div style={{ overflowY: 'auto', padding: '24px', height: 'calc(100vh - 49px)' }}>
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
        const prospectEdits = edits[p.id] ?? {}
        const hasEdits = Object.keys(prospectEdits).length > 0

        const uniqueGroups = p.issues
          .map(i => FIELD_INPUTS[i.field])
          .filter((g): g is FieldGroup => g !== null && g !== undefined)
          .filter((g, i, arr) => arr.findIndex(x => x.label === g.label) === i)

        return (
          <div
            key={p.id}
            style={{
              background: colors.surfaceAlt,
              border: `1px solid ${colors.border}`,
              borderRadius: '2px',
              padding: '16px',
              marginBottom: '12px',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
              <span style={{ fontFamily: fonts.sans, fontSize: '14px', color: colors.neutral }}>{p.name}</span>
              <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary }}>
                {errors.length > 0 && <span style={{ color: 'tomato', marginRight: '8px' }}>🔴 {errors.length}</span>}
                {warnings.length > 0 && <span style={{ color: '#D4891A' }}>⚠️ {warnings.length}</span>}
              </span>
            </div>

            {/* Field groups */}
            {uniqueGroups.map(group => (
              <div key={group.label} style={{ marginBottom: '16px' }}>
                <div style={{
                  fontFamily: fonts.label,
                  fontSize: '10px',
                  color: group.severity === 'error' ? colors.neutral : colors.secondary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: '8px',
                }}>
                  {group.severity === 'error' ? '🔴' : '⚠️'} {group.label}
                </div>
                {group.fields.map(field => (
                  <div key={field.key as string} style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '6px' }}>
                    <span style={{
                      fontFamily: fonts.label,
                      fontSize: '10px',
                      color: colors.secondary,
                      minWidth: '100px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      flexShrink: 0,
                    }}>
                      {field.placeholder ?? String(field.key)}
                    </span>
                    <input
                      type={field.type}
                      step={field.step}
                      placeholder={field.placeholder}
                      value={prospectEdits[field.key] !== undefined ? String(prospectEdits[field.key]) : (p[field.key] != null ? String(p[field.key]) : '')}
                      onChange={e => handleEdit(p.id, field.key, e.target.value, field.type)}
                      style={inputStyle}
                    />
                  </div>
                ))}
              </div>
            ))}

            {/* Save error */}
            {saveErrors[p.id] && (
              <div style={{ fontFamily: fonts.label, fontSize: '11px', color: 'tomato', marginBottom: '8px' }}>
                {saveErrors[p.id]}
              </div>
            )}

            {/* Footer row: link + save button */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
              <button
                onClick={() => navigate(`/tabla/${p.id}`)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: colors.secondary,
                  fontFamily: fonts.label,
                  fontSize: '11px',
                  cursor: 'pointer',
                  padding: 0,
                  letterSpacing: '0.04em',
                }}
              >
                Ver detalle completo →
              </button>

              {hasEdits && (
                <button
                  onClick={() => handleSave(p.id)}
                  disabled={saving[p.id]}
                  style={{
                    background: colors.primary,
                    color: colors.neutral,
                    border: 'none',
                    borderRadius: '2px',
                    fontFamily: fonts.label,
                    fontSize: '11px',
                    letterSpacing: '0.08em',
                    padding: '6px 14px',
                    cursor: saving[p.id] ? 'default' : 'pointer',
                    opacity: saving[p.id] ? 0.5 : 1,
                    textTransform: 'uppercase',
                  }}
                >
                  {saving[p.id] ? 'Guardando…' : 'Guardar cambios ▸'}
                </button>
              )}
            </div>
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
  )
}
