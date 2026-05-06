import { useState } from 'react'
import type { CSSProperties } from 'react'
import { updateProspect } from '../lib/api'
import type { Prospect, RawFields } from '../lib/types'
import { colors, fonts } from '../lib/theme'

interface Props {
  prospect: Prospect | null
  onClose: () => void
  onOpenDetail: (id: number) => void
  onUpdated: (updated: Prospect) => void
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
  latitude:  { label: 'Ubicación', severity: 'error', fields: [
    { key: 'latitude',  type: 'number', step: 'any', placeholder: 'Latitud (ej. 25.6866)' },
    { key: 'longitude', type: 'number', step: 'any', placeholder: 'Longitud (ej. -100.3161)' },
  ]},
  longitude: null,
  landPrice: { label: 'Precio terreno',    severity: 'error',   fields: [{ key: 'landPrice',             type: 'number', placeholder: 'MXN'      }] },
  sqmLand:   { label: 'Superficie terreno', severity: 'error',  fields: [{ key: 'sqmLand',               type: 'number', placeholder: 'm²'       }] },
  constructionOverhead: { label: 'Overhead construcción', severity: 'error', fields: [{ key: 'constructionOverhead', type: 'number', step: '0.01', placeholder: '≥ 1.0 (ej. 1.3)' }] },
  saleDate: { label: 'Fechas', severity: 'error', fields: [
    { key: 'investmentDate', type: 'date' },
    { key: 'saleDate',       type: 'date' },
  ]},
  investmentDate: null,
  constructionCostPerSqm: { label: 'Costo construcción/m²', severity: 'warning', fields: [{ key: 'constructionCostPerSqm', type: 'number', placeholder: 'MXN/m²'   }] },
  rentMonthly:            { label: 'Renta mensual',          severity: 'warning', fields: [{ key: 'rentMonthly',            type: 'number', placeholder: 'MXN/mes'  }] },
  acquisitionCostPct: {
    label: 'Costos adquisición (%)',
    severity: 'warning' as const,
    fields: [{ key: 'acquisitionCostPct' as keyof RawFields, type: 'number' as const, step: '0.001', placeholder: 'ej. 0.065 = 6.5%' }],
  },
  roi: null,
  profit: null,
}

// Fields that are computed — cannot be edited inline; rendered as read-only hints
const UNEDITABLE_FIELDS = new Set(['roi', 'profit'])

function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return (yb - ya) * 12 + (mb - ma)
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${colors.border}`, fontFamily: fonts.sans, fontSize: '12px' }}>
      <span style={{ color: colors.secondary }}>{label}</span>
      <span style={{ color: colors.neutral }}>{value}</span>
    </div>
  )
}

const inputStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  borderBottom: `1px solid ${colors.border}`,
  color: colors.neutral,
  fontFamily: fonts.sans,
  fontSize: '12px',
  padding: '4px 0',
  width: '100%',
  outline: 'none',
}

export function ProspectDrawer({ prospect, onClose, onOpenDetail, onUpdated }: Props) {
  const [edits, setEdits] = useState<Partial<RawFields>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Reset edits when a different prospect is opened
  const [lastId, setLastId] = useState<number | null>(null)
  if (prospect && prospect.id !== lastId) {
    setEdits({})
    setSaving(false)
    setSaveError(null)
    setLastId(prospect.id)
  }

  if (!prospect) return null

  const errors = prospect.issues.filter(i => i.severity === 'error')
  const warnings = prospect.issues.filter(i => i.severity === 'warning')

  function handleEdit(key: keyof RawFields, raw: string, inputType: 'number' | 'date') {
    const value = inputType === 'number'
      ? (raw === '' ? undefined : parseFloat(raw))
      : raw
    setEdits(prev => {
      const next = { ...prev }
      if (value === undefined) {
        delete (next as Record<string, unknown>)[key as string]
      } else {
        (next as Record<string, unknown>)[key as string] = value
      }
      return next
    })
  }

  async function handleSave() {
    if (Object.keys(edits).length === 0 || !prospect) return
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await updateProspect(prospect.id, edits)
      onUpdated(updated)
      setEdits({})
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

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

        {/* ── Datos ──────────────────────────────────────────── */}
        <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: '12px' }}>
          <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>
            Datos
          </div>
          <Row label="Ciudad" value={prospect.city} />
          <Row label="Estado" value={prospect.status} />
          {prospect.sqmLand > 0 && <Row label="m² Terreno" value={prospect.sqmLand.toLocaleString('es-MX')} />}
          {prospect.sqmConstruction > 0 && <Row label="m² Construcción" value={prospect.sqmConstruction.toLocaleString('es-MX')} />}
          {prospect.landPrice > 0 && <Row label="Precio terreno" value={`$${(prospect.landPrice / 1_000_000).toFixed(1)}M`} />}
          {prospect.projectedSale > 0 && <Row label="Venta proyectada" value={`$${(prospect.projectedSale / 1_000_000).toFixed(1)}M`} />}
          {prospect.investmentPerSqm > 0 && <Row label="Inversión/m²" value={`$${prospect.investmentPerSqm.toLocaleString('es-MX')}`} />}
          {prospect.salePerSqm > 0 && <Row label="Venta/m²" value={`$${prospect.salePerSqm.toLocaleString('es-MX')}`} />}
          {prospect.investmentDate && prospect.saleDate && prospect.investmentDate !== '' && prospect.saleDate !== '' && (() => {
            const months = monthsBetween(prospect.investmentDate, prospect.saleDate)
            return (
              <Row
                label="Timeline"
                value={`${prospect.investmentDate} → ${prospect.saleDate} (${months} meses)`}
              />
            )
          })()}
          {prospect.notes && prospect.notes !== '-' && prospect.notes.trim() !== '' && (
            <div style={{ padding: '5px 0', fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary }}>
              <span style={{ color: colors.secondary }}>Notas · </span>
              <span style={{ color: colors.neutral }}>
                {prospect.notes.length > 80 ? prospect.notes.slice(0, 80) + '…' : prospect.notes}
              </span>
            </div>
          )}
        </div>

        {(errors.length > 0 || warnings.length > 0) && (() => {
          const uniqueGroups = prospect.issues
            .map(i => FIELD_INPUTS[i.field])
            .filter((g): g is FieldGroup => g !== null && g !== undefined)
            .filter((g, idx, arr) => arr.findIndex(x => x.label === g.label) === idx)

          return (
            <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: '12px' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px' }}>
                Calidad de datos
              </div>

              {uniqueGroups.map(group => (
                <div key={group.label} style={{ marginBottom: '14px' }}>
                  <div style={{ fontFamily: fonts.label, fontSize: '10px', color: group.severity === 'error' ? colors.neutral : colors.secondary, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
                    {group.severity === 'error' ? '🔴' : '⚠️'} {group.label}
                  </div>
                  {group.fields.map(field => (
                    <div key={field.key as string} style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, minWidth: '80px', textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>
                        {field.placeholder ?? String(field.key)}
                      </span>
                      <input
                        type={field.type}
                        step={field.step}
                        placeholder={field.placeholder}
                        value={edits[field.key] !== undefined ? String(edits[field.key]) : (prospect[field.key] != null ? String(prospect[field.key]) : '')}
                        onChange={e => handleEdit(field.key, e.target.value, field.type)}
                        style={inputStyle}
                      />
                    </div>
                  ))}
                </div>
              ))}

              {saveError && (
                <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: 'tomato', marginBottom: '8px' }}>{saveError}</div>
              )}

              {Object.keys(edits).length > 0 && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: saving ? colors.border : colors.primary,
                    color: colors.neutral,
                    border: 'none',
                    borderRadius: '2px',
                    cursor: saving ? 'default' : 'pointer',
                    fontFamily: fonts.label,
                    fontSize: '11px',
                    letterSpacing: '0.08em',
                    opacity: saving ? 0.6 : 1,
                    marginBottom: '8px',
                  }}
                >
                  {saving ? 'Guardando…' : 'GUARDAR CAMBIOS ▸'}
                </button>
              )}

              {/* Read-only hints for computed-field warnings */}
              {prospect.issues
                .filter(i => UNEDITABLE_FIELDS.has(i.field))
                .map((issue, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '6px', fontSize: '12px', opacity: 0.75 }}>
                    <span>{issue.severity === 'error' ? '🔴' : '⚠️'}</span>
                    <div>
                      <div style={{ color: colors.neutral }}>{issue.message}</div>
                      <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, marginTop: '2px', letterSpacing: '0.04em' }}>
                        Campo calculado — ajusta en ABRIR DETALLE
                      </div>
                    </div>
                  </div>
                ))
              }
            </div>
          )
        })()}

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
