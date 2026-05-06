import { useState } from 'react'
import { updateProspect } from '../lib/api'
import type { Prospect, RawFields } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { EditableRow, ReadOnlyRow, rowStyle, inlineInputStyle } from './EditableRow'

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

function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return (yb - ya) * 12 + (mb - ma)
}


export function ProspectDrawer({ prospect, onClose, onOpenDetail, onUpdated }: Props) {
  const [activeField, setActiveField] = useState<string | null>(null)
  const [edits, setEdits] = useState<Partial<RawFields>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Reset when prospect changes
  const [lastId, setLastId] = useState<number | null>(null)
  if (prospect && prospect.id !== lastId) {
    setEdits({})
    setSaving(false)
    setSaveError(null)
    setActiveField(null)
    setLastId(prospect.id)
  }

  if (!prospect) return null

  const issueMap = Object.fromEntries(prospect.issues.map(i => [i.field, i]))

  function badge(field: string): string {
    const issue = issueMap[field]
    if (!issue) return ''
    return issue.severity === 'error' ? ' 🔴' : ' ⚠️'
  }

  function handleEdit(key: keyof RawFields, raw: string, inputType: 'number' | 'date' | 'text', isAcqPct = false) {
    let value: string | number | undefined
    if (inputType === 'number') {
      if (raw === '') {
        value = undefined
      } else {
        const parsed = parseFloat(raw)
        value = isAcqPct ? parsed / 100 : parsed
      }
    } else {
      value = raw
    }
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

  function currentEditValue(key: keyof RawFields, isAcqPct = false): string {
    if (edits[key] !== undefined) {
      const v = edits[key] as number | string
      if (isAcqPct && typeof v === 'number') return (v * 100).toFixed(1)
      return String(v)
    }
    const raw = prospect![key]
    if (isAcqPct && typeof raw === 'number') return (raw * 100).toFixed(1)
    return raw != null ? String(raw) : ''
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

  const hasPendingEdits = Object.keys(edits).length > 0

  // Determine select display value
  const statusValue = edits.status !== undefined ? (edits.status as string) : prospect.status

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
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontFamily: fonts.serif, fontSize: '18px', color: colors.neutral, lineHeight: 1.2 }}>{prospect.name}</div>
            <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary, marginTop: '4px' }}>{prospect.address}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: colors.secondary, cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>✕</button>
        </div>

        {/* Score */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <span style={{ background: colors.tertiary, color: colors.neutral, fontFamily: fonts.label, fontSize: '12px', padding: '3px 8px', borderRadius: '2px' }}>Score {prospect.score}</span>
        </div>

        {/* Metric blocks */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <MetricBlock label="ROI" value={fmt(prospect.roi, 'pct')} accent />
          <MetricBlock label="Cap Rate" value={fmt(prospect.capRate, 'pct')} />
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <MetricBlock label="Profit" value={fmt(prospect.profit, 'mxn')} accent />
          <MetricBlock label="Inversión" value={fmt(prospect.totalInvestment, 'mxn')} />
        </div>

        {/* Unified editable data section */}
        <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: '12px' }}>

          {/* Ciudad */}
          <EditableRow
            fieldKey="city"
            label="Ciudad"
            displayValue={prospect.city || '—'}
            isActive={activeField === 'city'}
            inputType="text"
            inputValue={currentEditValue('city')}
            issueBadge={badge('city')}
            onActivate={() => setActiveField('city')}
            onDeactivate={() => setActiveField(null)}
            onChange={raw => handleEdit('city', raw, 'text')}
          />

          {/* Estado (select) */}
          <div style={rowStyle}>
            <span style={{ color: colors.secondary }}>Estado{badge('status')}</span>
            {activeField === 'status' ? (
              <select
                value={statusValue}
                autoFocus
                onChange={e => {
                  setEdits(prev => ({ ...prev, status: e.target.value }))
                }}
                onBlur={() => setActiveField(null)}
                onKeyDown={e => { if (e.key === 'Escape') setActiveField(null) }}
                style={{ ...inlineInputStyle, cursor: 'pointer' }}
              >
                <option value="evaluating">evaluating</option>
                <option value="passed">passed</option>
                <option value="converted">converted</option>
              </select>
            ) : (
              <span
                style={{ color: colors.neutral, cursor: 'text' }}
                onClick={() => setActiveField('status')}
              >
                {statusValue || '—'}
              </span>
            )}
          </div>

          {/* m² Terreno — hide if 0 and no issue */}
          {(prospect.sqmLand > 0 || issueMap['sqmLand']) && (
            <EditableRow
              fieldKey="sqmLand"
              label="m² Terreno"
              displayValue={prospect.sqmLand > 0 ? prospect.sqmLand.toLocaleString('es-MX') : '—'}
              isActive={activeField === 'sqmLand'}
              inputType="number"
              inputValue={currentEditValue('sqmLand')}
              issueBadge={badge('sqmLand')}
              onActivate={() => setActiveField('sqmLand')}
              onDeactivate={() => setActiveField(null)}
              onChange={raw => handleEdit('sqmLand', raw, 'number')}
            />
          )}

          {/* m² Construcción — hide if 0 and no issue */}
          {(prospect.sqmConstruction > 0 || issueMap['sqmConstruction']) && (
            <EditableRow
              fieldKey="sqmConstruction"
              label="m² Construcción"
              displayValue={prospect.sqmConstruction > 0 ? prospect.sqmConstruction.toLocaleString('es-MX') : '—'}
              isActive={activeField === 'sqmConstruction'}
              inputType="number"
              inputValue={currentEditValue('sqmConstruction')}
              issueBadge={badge('sqmConstruction')}
              onActivate={() => setActiveField('sqmConstruction')}
              onDeactivate={() => setActiveField(null)}
              onChange={raw => handleEdit('sqmConstruction', raw, 'number')}
            />
          )}

          {/* Precio terreno — hide if 0 and no issue */}
          {(prospect.landPrice > 0 || issueMap['landPrice']) && (
            <EditableRow
              fieldKey="landPrice"
              label="Precio terreno"
              displayValue={prospect.landPrice > 0 ? `$${(prospect.landPrice / 1_000_000).toFixed(1)}M` : '—'}
              isActive={activeField === 'landPrice'}
              inputType="number"
              inputValue={currentEditValue('landPrice')}
              issueBadge={badge('landPrice')}
              onActivate={() => setActiveField('landPrice')}
              onDeactivate={() => setActiveField(null)}
              onChange={raw => handleEdit('landPrice', raw, 'number')}
            />
          )}

          {/* Venta proyectada — hide if 0 and no issue */}
          {(prospect.projectedSale > 0 || issueMap['projectedSale']) && (
            <EditableRow
              fieldKey="projectedSale"
              label="Venta proyectada"
              displayValue={prospect.projectedSale > 0 ? `$${(prospect.projectedSale / 1_000_000).toFixed(1)}M` : '—'}
              isActive={activeField === 'projectedSale'}
              inputType="number"
              inputValue={currentEditValue('projectedSale')}
              issueBadge={badge('projectedSale')}
              onActivate={() => setActiveField('projectedSale')}
              onDeactivate={() => setActiveField(null)}
              onChange={raw => handleEdit('projectedSale', raw, 'number')}
            />
          )}

          {/* Costo adquisición % — always show */}
          <EditableRow
            fieldKey="acquisitionCostPct"
            label="Costo adquisición"
            displayValue={prospect.acquisitionCostPct > 0 ? `${(prospect.acquisitionCostPct * 100).toFixed(1)}%` : '—'}
            isActive={activeField === 'acquisitionCostPct'}
            inputType="number"
            inputStep="0.001"
            inputValue={currentEditValue('acquisitionCostPct', true)}
            issueBadge={badge('acquisitionCostPct')}
            onActivate={() => setActiveField('acquisitionCostPct')}
            onDeactivate={() => setActiveField(null)}
            onChange={raw => handleEdit('acquisitionCostPct', raw, 'number', true)}
          />

          {/* Construcción/m² — hide if 0 and no issue */}
          {(prospect.constructionCostPerSqm > 0 || issueMap['constructionCostPerSqm']) && (
            <EditableRow
              fieldKey="constructionCostPerSqm"
              label="Construcción/m²"
              displayValue={prospect.constructionCostPerSqm > 0 ? `$${prospect.constructionCostPerSqm.toLocaleString('es-MX')}` : '—'}
              isActive={activeField === 'constructionCostPerSqm'}
              inputType="number"
              inputValue={currentEditValue('constructionCostPerSqm')}
              issueBadge={badge('constructionCostPerSqm')}
              onActivate={() => setActiveField('constructionCostPerSqm')}
              onDeactivate={() => setActiveField(null)}
              onChange={raw => handleEdit('constructionCostPerSqm', raw, 'number')}
            />
          )}

          {/* Overhead — always show */}
          <EditableRow
            fieldKey="constructionOverhead"
            label="Overhead"
            displayValue={prospect.constructionOverhead > 0 ? String(prospect.constructionOverhead) : '—'}
            isActive={activeField === 'constructionOverhead'}
            inputType="number"
            inputStep="0.01"
            inputValue={currentEditValue('constructionOverhead')}
            issueBadge={badge('constructionOverhead')}
            onActivate={() => setActiveField('constructionOverhead')}
            onDeactivate={() => setActiveField(null)}
            onChange={raw => handleEdit('constructionOverhead', raw, 'number')}
          />

          {/* Renta mensual — hide if 0 and no issue */}
          {(prospect.rentMonthly > 0 || issueMap['rentMonthly']) && (
            <EditableRow
              fieldKey="rentMonthly"
              label="Renta mensual"
              displayValue={prospect.rentMonthly > 0 ? `$${prospect.rentMonthly.toLocaleString('es-MX')}` : '—'}
              isActive={activeField === 'rentMonthly'}
              inputType="number"
              inputValue={currentEditValue('rentMonthly')}
              issueBadge={badge('rentMonthly')}
              onActivate={() => setActiveField('rentMonthly')}
              onDeactivate={() => setActiveField(null)}
              onChange={raw => handleEdit('rentMonthly', raw, 'number')}
            />
          )}

          {/* Latitud — hide if 0 and no issue */}
          {(prospect.latitude !== 0 || issueMap['latitude']) && (
            <EditableRow
              fieldKey="latitude"
              label="Latitud"
              displayValue={prospect.latitude !== 0 ? String(prospect.latitude) : '—'}
              isActive={activeField === 'latitude'}
              inputType="number"
              inputStep="any"
              inputValue={currentEditValue('latitude')}
              issueBadge={badge('latitude')}
              onActivate={() => setActiveField('latitude')}
              onDeactivate={() => setActiveField(null)}
              onChange={raw => handleEdit('latitude', raw, 'number')}
            />
          )}

          {/* Longitud — hide if 0 and no issue */}
          {(prospect.longitude !== 0 || issueMap['longitude']) && (
            <EditableRow
              fieldKey="longitude"
              label="Longitud"
              displayValue={prospect.longitude !== 0 ? String(prospect.longitude) : '—'}
              isActive={activeField === 'longitude'}
              inputType="number"
              inputStep="any"
              inputValue={currentEditValue('longitude')}
              issueBadge={badge('longitude')}
              onActivate={() => setActiveField('longitude')}
              onDeactivate={() => setActiveField(null)}
              onChange={raw => handleEdit('longitude', raw, 'number')}
            />
          )}

          {/* Fecha inversión */}
          <EditableRow
            fieldKey="investmentDate"
            label="Fecha inversión"
            displayValue={prospect.investmentDate || '—'}
            isActive={activeField === 'investmentDate'}
            inputType="date"
            inputValue={currentEditValue('investmentDate')}
            issueBadge={badge('investmentDate')}
            onActivate={() => setActiveField('investmentDate')}
            onDeactivate={() => setActiveField(null)}
            onChange={raw => handleEdit('investmentDate', raw, 'date')}
          />

          {/* Fecha venta */}
          <EditableRow
            fieldKey="saleDate"
            label="Fecha venta"
            displayValue={prospect.saleDate || '—'}
            isActive={activeField === 'saleDate'}
            inputType="date"
            inputValue={currentEditValue('saleDate')}
            issueBadge={badge('saleDate')}
            onActivate={() => setActiveField('saleDate')}
            onDeactivate={() => setActiveField(null)}
            onChange={raw => handleEdit('saleDate', raw, 'date')}
          />

          {/* Notas — hide if empty or "-" */}
          {prospect.notes && prospect.notes !== '-' && prospect.notes.trim() !== '' && (
            <EditableRow
              fieldKey="notes"
              label="Notas"
              displayValue={prospect.notes.length > 60 ? prospect.notes.slice(0, 60) + '…' : prospect.notes}
              isActive={activeField === 'notes'}
              inputType="text"
              inputValue={currentEditValue('notes')}
              issueBadge={badge('notes')}
              onActivate={() => setActiveField('notes')}
              onDeactivate={() => setActiveField(null)}
              onChange={raw => handleEdit('notes', raw, 'text')}
            />
          )}

          {/* Read-only computed rows */}
          {prospect.totalInvestment > 0 && (
            <ReadOnlyRow label="Inversión total" value={`$${(prospect.totalInvestment / 1_000_000).toFixed(1)}M`} />
          )}
          {prospect.investmentPerSqm > 0 && (
            <ReadOnlyRow label="Inversión/m²" value={`$${prospect.investmentPerSqm.toLocaleString('es-MX')}`} />
          )}
          {prospect.salePerSqm > 0 && (
            <ReadOnlyRow label="Venta/m²" value={`$${prospect.salePerSqm.toLocaleString('es-MX')}`} />
          )}
          {prospect.roi > 0 && (
            <ReadOnlyRow label="ROI" value={`${(prospect.roi * 100).toFixed(1)}%`} />
          )}
          {prospect.capRate > 0 && (
            <ReadOnlyRow label="Cap Rate" value={`${(prospect.capRate * 100).toFixed(1)}%`} />
          )}

          {/* Timeline row — only when both dates set */}
          {prospect.investmentDate && prospect.saleDate && prospect.investmentDate !== '' && prospect.saleDate !== '' && (
            <ReadOnlyRow
              label="Timeline"
              value={`${prospect.investmentDate} → ${prospect.saleDate} (${monthsBetween(prospect.investmentDate, prospect.saleDate)} meses)`}
            />
          )}
        </div>

        {/* Save error */}
        {saveError && (
          <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: 'tomato' }}>{saveError}</div>
        )}

        {/* Save button */}
        {hasPendingEdits && (
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
            }}
          >
            {saving ? 'Guardando…' : 'GUARDAR CAMBIOS ▸'}
          </button>
        )}

        {/* Computed-field warnings (roi, profit) */}
        {(['roi', 'profit'] as const).flatMap(f => issueMap[f] ? [issueMap[f]] : []).map((issue, i) => (
          <div key={i} style={{ display: 'flex', gap: '8px', padding: '5px 0', fontSize: '12px', opacity: 0.7 }}>
            <span>{issue.severity === 'error' ? '🔴' : '⚠️'}</span>
            <div>
              <div style={{ color: colors.neutral }}>{issue.message}</div>
              <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, marginTop: '2px' }}>Campo calculado — ajusta en ABRIR DETALLE</div>
            </div>
          </div>
        ))}

        {/* Open detail */}
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
