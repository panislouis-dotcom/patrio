import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchProperties, updateProperty, generateProspectus } from '../lib/api'
import type { Property } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { fmtPct, fmtM } from '../lib/fmt'
import { SmartPropertyModal } from './SmartPropertyModal'
import { LIFECYCLE, PROPERTY_STATUS_COLOR, PROPERTY_STATUS_LABEL, isPrePurchase } from '../lib/status'
import type { PropertyStatus } from '../lib/status'

type Filter = 'todas' | PropertyStatus

interface Column {
  key: string
  label: string
  /** Lo que ordena la columna. null baja al final, siempre. */
  sort: (p: Property) => number | null
  render: (p: Property) => React.ReactNode
  align?: 'left' | 'right'
}

const num = (value: React.ReactNode, color: string): React.ReactNode => (
  <span style={{ color, fontFamily: fonts.label, fontSize: '11px' }}>{value}</span>
)

const gainColor = (n: number | null) => (n == null ? colors.secondary : n >= 0 ? colors.tertiary : '#E62300')
const months = (n: number | null) => (n ? `${n}m` : '—')

// ── Columnas ──────────────────────────────────────────────────────────────────
// Una propiedad temprana se juzga por lo que promete; una comprada, por lo que
// ya rindió. Por eso las columnas cambian con el filtro en vez de mostrar
// veinte celdas con guiones.

const SCORE: Column = {
  key: 'score', label: 'SCORE', align: 'right',
  sort: p => p.score,
  render: p => p.score == null
    ? num('—', colors.secondary)
    : (
      <span style={{ background: p.score >= 70 ? colors.tertiary : p.score >= 40 ? colors.accent1 : colors.secondary, color: colors.neutral, fontFamily: fonts.label, fontSize: '10px', padding: '2px 6px', borderRadius: '2px' }}>
        {p.score}
      </span>
    ),
}

const INVERSION: Column = {
  key: 'totalInvestment', label: 'INVERSIÓN', align: 'right',
  sort: p => p.totalInvestment,
  render: p => num(fmtM(p.totalInvestment), colors.secondary),
}

const ESTADO: Column = {
  key: 'status', label: 'ESTADO', align: 'right',
  sort: p => LIFECYCLE.indexOf(p.status),
  render: p => (
    <span style={{ background: PROPERTY_STATUS_COLOR[p.status], color: colors.neutral, fontFamily: fonts.label, fontSize: '9px', padding: '2px 6px', borderRadius: '2px', letterSpacing: '0.08em' }}>
      {PROPERTY_STATUS_LABEL[p.status]}
    </span>
  ),
}

/** Lo que se mira antes de comprar: la apuesta. */
const EARLY_COLUMNS: Column[] = [
  SCORE,
  { key: 'projectedRoi', label: 'ROI PROY.', align: 'right',
    sort: p => p.projectedRoi,
    render: p => num(fmtPct(p.projectedRoi), (p.projectedRoi ?? 0) < 0 ? '#E62300' : (p.projectedRoi ?? 0) > 0.15 ? colors.tertiary : colors.neutral) },
  { key: 'capRate', label: 'CAP RATE', align: 'right',
    sort: p => p.capRate, render: p => num(fmtPct(p.capRate), colors.primary) },
  INVERSION,
  { key: 'projectedSale', label: 'VENTA PROY.', align: 'right',
    sort: p => p.projectedSale, render: p => num(fmtM(p.projectedSale), colors.secondary) },
  { key: 'holdMonths', label: 'PLAZO', align: 'right',
    sort: p => p.holdMonths, render: p => num(months(p.holdMonths), colors.secondary) },
]

/** Lo que se mira después de comprar: el resultado, todavía en curso. */
const HELD_COLUMNS: Column[] = [
  INVERSION,
  { key: 'currentValuation', label: 'VALUACIÓN', align: 'right',
    sort: p => p.currentValuation, render: p => num(fmtM(p.currentValuation), colors.neutral) },
  { key: 'unrealizedGain', label: 'GANANCIA', align: 'right',
    sort: p => p.unrealizedGain, render: p => num(fmtM(p.unrealizedGain), gainColor(p.unrealizedGain)) },
  { key: 'roi', label: 'ROI ANUAL', align: 'right',
    sort: p => p.roi, render: p => num(fmtPct(p.roi), gainColor(p.roi)) },
  { key: 'holdMonthsActual', label: 'PLAZO REAL', align: 'right',
    sort: p => p.holdMonthsActual, render: p => num(months(p.holdMonthsActual), colors.secondary) },
]

/** Lo que queda cuando ya se vendió: el hecho consumado. */
const SOLD_COLUMNS: Column[] = [
  INVERSION,
  { key: 'salePrice', label: 'VENTA', align: 'right',
    sort: p => p.salePrice, render: p => num(fmtM(p.salePrice), colors.neutral) },
  { key: 'realizedGain', label: 'GANANCIA', align: 'right',
    sort: p => p.realizedGain, render: p => num(fmtM(p.realizedGain), gainColor(p.realizedGain)) },
  { key: 'realizedRoi', label: 'ROI REAL', align: 'right',
    sort: p => p.realizedRoi, render: p => num(fmtPct(p.realizedRoi), gainColor(p.realizedRoi)) },
  { key: 'holdMonthsActual', label: 'PLAZO REAL', align: 'right',
    sort: p => p.holdMonthsActual, render: p => num(months(p.holdMonthsActual), colors.secondary) },
]

/** El inventario completo: lo poco que significa lo mismo en toda etapa. */
const ALL_COLUMNS: Column[] = [
  ESTADO,
  SCORE,
  INVERSION,
  { key: 'headline', label: 'ROI', align: 'right',
    sort: p => headlineRoi(p),
    render: p => num(fmtPct(headlineRoi(p)), gainColor(headlineRoi(p))) },
  { key: 'plazo', label: 'PLAZO', align: 'right',
    sort: p => p.holdMonthsActual ?? p.holdMonths,
    render: p => num(months(p.holdMonthsActual ?? p.holdMonths), colors.secondary) },
]

/** El ROI que esa propiedad tiene para dar: proyectado, vivo o realizado. */
function headlineRoi(p: Property): number | null {
  return p.realizedRoi ?? p.roi ?? p.projectedRoi
}

/**
 * Un grupo del resumen: su nombre con cuántas propiedades abarca, y sus cifras.
 * El nombre lleva el conteo pegado porque es lo que le pone alcance a los
 * números que siguen — sin él, dos grupos contiguos invitan a restarse.
 */
function summaryGroup(name: string, figures: Array<[string, string]>): React.ReactNode {
  return (
    <span key={name} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginRight: '14px' }}>
      <span style={{ color: colors.tertiary, letterSpacing: '0.08em' }}>{name}</span>
      {figures.map(([label, value]) => (
        <span key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ margin: '0 2px' }}>·</span>
          <span>{label}:</span>
          <span style={{ color: colors.neutral }}>{value}</span>
        </span>
      ))}
    </span>
  )
}

function columnsFor(filter: Filter): Column[] {
  if (filter === 'todas') return ALL_COLUMNS
  if (filter === 'vendida') return SOLD_COLUMNS
  if (isPrePurchase(filter)) return EARLY_COLUMNS
  if (filter === 'archivada') return ALL_COLUMNS
  return HELD_COLUMNS
}

export function PropiedadesTable() {
  const [properties, setProperties] = useState<Property[]>([])
  const [filter, setFilter] = useState<Filter>('todas')
  const [showArchived, setShowArchived] = useState(false)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortAsc, setSortAsc] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCapture, setShowCapture] = useState(false)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const navigate = useNavigate()

  function load(includeArchived: boolean) {
    setLoading(true)
    fetchProperties({ includeArchived })
      .then(setProperties)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(showArchived) }, [showArchived])

  const columns = columnsFor(filter)
  const counts = useMemo(() => {
    const tally = {} as Record<string, number>
    for (const p of properties) tally[p.status] = (tally[p.status] ?? 0) + 1
    return tally
  }, [properties])

  const shown = filter === 'todas' ? properties : properties.filter(p => p.status === filter)

  const sortColumn = columns.find(c => c.key === sortKey)
  const sorted = sortColumn
    ? [...shown].sort((a, b) => {
        // Un valor ausente no es un cero: se va al fondo mande quien mande.
        const av = sortColumn.sort(a)
        const bv = sortColumn.sort(b)
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        return sortAsc ? av - bv : bv - av
      })
    : shown

  const totalErrors = shown.flatMap(p => p.issues).filter(i => i.severity === 'error').length
  const totalWarnings = shown.flatMap(p => p.issues).filter(i => i.severity === 'warning').length

  // ── Resumen del portafolio ──────────────────────────────────────────────────
  // Es la única cifra agregada del sistema y encabeza la pantalla principal, así
  // que ningún grupo puede mezclar dos clases de dinero. Se sigue la doctrina que
  // el prospecto ya documenta: sumar el precio de una venta con la valuación de
  // lo que sigue en pie obliga a llamar «valuación actual» a dinero que ya se
  // cobró, y contar $0 por lo que nadie ha avaluado hunde un promedio con un dato
  // que no existe. Tres grupos, cada uno cerrado sobre su propio conjunto:
  //
  //   · EN OPERACIÓN — el capital que hoy está adentro. Las vendidas no cuentan:
  //     ese dinero ya regresó.
  //   · AVALUADAS    — solo las que tienen avalúo, y su capital va con ellas, de
  //     modo que valuación − capital = plusvalía sin que sobre nadie.
  //   · VENDIDAS     — lo que se cobró y lo que dejó.
  //
  // Las archivadas quedan fuera de los tres: archivar es sacar del inventario.
  const operating = properties.filter(p => p.status === 'desarrollo' || p.status === 'en_renta')
  // La plusvalía la calcula el servidor por propiedad, así que el subconjunto
  // «con avalúo» es exactamente aquel en que existe — nunca hay que suponerlo.
  const appraised = operating.filter(p => p.unrealizedGain != null)
  const closed = properties.filter(p => p.status === 'vendida')
  const sum = (rows: Property[], pick: (p: Property) => number | null) =>
    rows.reduce((acc, p) => acc + (pick(p) ?? 0), 0)

  const appraisedCapital = sum(appraised, p => p.totalInvestment)
  const unrealized = sum(appraised, p => p.unrealizedGain)

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  async function downloadProspectus() {
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
  }

  const chip = (value: Filter, label: string, count: number) => (
    <button
      key={value}
      onClick={() => { setFilter(value); setSortKey(null) }}
      style={{
        fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em',
        padding: '4px 10px', cursor: 'pointer',
        border: `1px solid ${filter === value ? colors.tertiary : colors.border}`,
        background: filter === value ? colors.surfaceAlt : 'transparent',
        color: filter === value ? colors.neutral : colors.secondary,
      }}
    >
      {label}<span style={{ marginLeft: '5px', opacity: 0.55 }}>{count}</span>
    </button>
  )

  if (loading) return <div style={{ padding: '32px', color: colors.secondary }}>Cargando…</div>
  if (error) return <div style={{ padding: '32px', color: '#E62300' }}>Error: {error}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 49px)' }}>

      {/* Toolbar: chips de etapa + acciones */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '6px 12px', borderBottom: `1px solid ${colors.border}`, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
          {chip('todas', 'TODAS', properties.length)}
          {LIFECYCLE.map(s => chip(s, PROPERTY_STATUS_LABEL[s], counts[s] ?? 0))}
          {showArchived && chip('archivada', PROPERTY_STATUS_LABEL.archivada, counts.archivada ?? 0)}
          <button
            onClick={() => {
              setShowArchived(v => !v)
              if (showArchived && filter === 'archivada') setFilter('todas')
            }}
            style={{
              marginLeft: '8px', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em',
              padding: '4px 10px', cursor: 'pointer', background: 'transparent',
              border: `1px dashed ${showArchived ? colors.tertiary : colors.border}`,
              color: showArchived ? colors.neutral : colors.secondary,
            }}
          >
            {showArchived ? '✓ ARCHIVADAS' : 'VER ARCHIVADAS'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {(totalErrors > 0 || totalWarnings > 0) && (
            <div style={{ display: 'flex', gap: '8px', fontFamily: fonts.label, fontSize: '10px', letterSpacing: '0.08em' }}>
              {totalErrors > 0 && <span style={{ color: '#E62300' }}>🔴 {totalErrors}</span>}
              {totalWarnings > 0 && <span style={{ color: '#a46a14' }}>⚠️ {totalWarnings}</span>}
            </div>
          )}
          <button
            onClick={downloadProspectus}
            disabled={generatingPdf}
            style={{ background: 'transparent', border: `1px solid ${colors.primary}`, color: colors.tertiary, cursor: generatingPdf ? 'wait' : 'pointer', fontFamily: fonts.label, fontSize: '10px', letterSpacing: '0.1em', padding: '5px 12px', opacity: generatingPdf ? 0.7 : 1 }}
          >
            {generatingPdf ? '⏳ GENERANDO…' : '📄 PROSPECTO'}
          </button>
          <button
            onClick={() => setShowCapture(true)}
            style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '10px', letterSpacing: '0.1em', padding: '5px 12px' }}
          >
            + NUEVA
          </button>
        </div>
      </div>

      {/* Resumen del portafolio. Cada grupo desaparece cuando su conjunto está
          vacío, igual que los renglones del prospecto. */}
      {operating.length + closed.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', borderBottom: `1px solid ${colors.border}`, fontFamily: fonts.label, fontSize: '11px', color: colors.secondary, flexWrap: 'wrap' }}>
          {operating.length > 0 && summaryGroup(`EN OPERACIÓN ${operating.length}`, [
            ['Capital', fmtM(sum(operating, p => p.totalInvestment))],
          ])}
          {appraised.length > 0 && summaryGroup(`AVALUADAS ${appraised.length}`, [
            ['Valuación', fmtM(sum(appraised, p => p.currentValuation))],
            ['Plusvalía', `${fmtM(unrealized)} ${fmtPct(appraisedCapital > 0 ? unrealized / appraisedCapital : null)}`],
          ])}
          {closed.length > 0 && summaryGroup(`VENDIDAS ${closed.length}`, [
            ['Ventas', fmtM(sum(closed, p => p.salePrice))],
            ['Ganancia', fmtM(sum(closed, p => p.realizedGain))],
          ])}
        </div>
      )}

      {/* Tabla */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: colors.dark, zIndex: 10 }}>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              <th style={{ width: '28px', padding: '0 4px' }} />
              <th style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em', textAlign: 'left', whiteSpace: 'nowrap' }}>PROPIEDAD</th>
              {columns.map(c => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: sortKey === c.key ? colors.tertiary : colors.secondary, letterSpacing: '0.12em', cursor: 'pointer', textAlign: c.align ?? 'right', whiteSpace: 'nowrap', userSelect: 'none' }}
                >
                  {c.label}{sortKey === c.key ? (sortAsc ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
              <th style={{ padding: '6px 10px', width: '24px' }} />
            </tr>
          </thead>
          <tbody>
            {sorted.map(p => {
              const errors = p.issues.filter(i => i.severity === 'error').length
              const warnings = p.issues.filter(i => i.severity === 'warning').length

              return (
                <tr
                  key={p.id}
                  onClick={() => navigate(`/propiedades/${p.id}`)}
                  style={{ borderBottom: `1px solid ${colors.border}`, cursor: 'pointer', background: 'transparent' }}
                  onMouseEnter={e => (e.currentTarget.style.background = `${colors.border}55`)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td
                    style={{ padding: '0 4px', textAlign: 'center', cursor: 'pointer', width: '28px' }}
                    onClick={e => {
                      e.stopPropagation()
                      updateProperty(p.id, { isFavorite: !p.isFavorite })
                        .then(updated => setProperties(prev => prev.map(x => x.id === updated.id ? { ...x, isFavorite: updated.isFavorite } : x)))
                    }}
                  >
                    <span style={{ color: p.isFavorite ? colors.tertiary : colors.border, fontSize: '14px' }}>
                      {p.isFavorite ? '★' : '☆'}
                    </span>
                  </td>

                  <td style={{ padding: '5px 10px', maxWidth: '220px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <span
                        style={{ width: '6px', height: '6px', borderRadius: '50%', background: PROPERTY_STATUS_COLOR[p.status], flexShrink: 0 }}
                        title={PROPERTY_STATUS_LABEL[p.status]}
                      />
                      <div style={{ overflow: 'hidden' }}>
                        <div style={{ color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                        <div style={{ color: colors.secondary, fontFamily: fonts.label, fontSize: '10px', letterSpacing: '0.04em', marginTop: '1px' }}>{p.city}</div>
                      </div>
                    </div>
                  </td>

                  {columns.map(c => (
                    <td key={c.key} style={{ padding: '5px 10px', textAlign: c.align ?? 'right' }}>{c.render(p)}</td>
                  ))}

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
            {sorted.length === 0 && (
              <tr>
                <td colSpan={columns.length + 3} style={{ padding: '32px', textAlign: 'center', fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary }}>
                  Sin propiedades en esta etapa.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showCapture && (
        <SmartPropertyModal
          onClose={() => setShowCapture(false)}
          onCreated={() => { setShowCapture(false); load(showArchived) }}
        />
      )}
    </div>
  )
}
