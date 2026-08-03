import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  BASE, fetchProperty, updateProperty, deleteProperty, clearPropertyFields, transitionProperty,
  uploadPropertyImage, deletePropertyImage, updatePropertyImageType,
  fetchPropertyGeometry, savePropertyGeometry, uploadFloorplanImage,
  fetchPropertyInvestors, fetchInvestors, fetchPropertyProfit, fetchInstances, fetchTeam,
} from '../lib/api'
import type {
  AssumptionField,
  Property, RawPropertyFields, ClearableField, Transition, ImageType,
  PropertyInvestor, Investor, ProfitWaterfall, ProcessInstance, TeamMember,
} from '../lib/types'
import { ASSET_TYPES, ASSET_TYPE_LABEL, STRATEGY_TYPES, STRATEGY_TYPE_LABEL } from '../lib/types'
import {
  ALLOWED_TRANSITIONS, PROPERTY_STATUS_COLOR, PROPERTY_STATUS_LABEL,
  hasScore, isPrePurchase, runsAnalysis, takesInvestors, takesTasks, hasProfitSplit,
} from '../lib/status'
import type { PropertyStatus } from '../lib/status'
import { colors, fonts } from '../lib/theme'
import { fieldInput } from '../lib/styles'
import { fmtMXN, fmtPct } from '../lib/fmt'
import { useEdits } from '../lib/useEdits'
import { MetricHero } from './finance/MetricHero'
import { InvestmentBreakdown } from './finance/InvestmentBreakdown'
import { LatLonPicker } from './LatLonPicker'
import { NumericInput } from './NumericInput'
import { StatRow } from './StatRow'
import { PhotoGallery } from './PhotoGallery'
import { PropertyAnalysisSection } from './PropertyAnalysisSection'
import { PropertyProfitSection } from './PropertyProfitSection'
import FloorPlanEditor, { type PlanApi } from './FloorPlanEditor'
import type { FloorPlanModel } from '../lib/floorplan/types'
import { DetailHeader } from './detail/DetailHeader'
import { EditableRow } from './detail/EditableRow'
import { MapPanel } from './detail/MapPanel'
import { MediaTabs } from './detail/MediaTabs'
import { SectionDivider } from './detail/SectionDivider'
import { ErrorBanner } from './detail/ErrorBanner'
import { TransitionModal } from './detail/TransitionModal'
import { InvestorsPanel } from './detail/InvestorsPanel'
import { MilestoneTimeline } from './detail/MilestoneTimeline'
import { TasksPanel } from './detail/TasksPanel'

/**
 * Una sola ficha para todo el ciclo de vida. Las herramientas aparecen cuando su
 * etapa las abre, pero nada se esconde al avanzar: en pasos de después se ve
 * todo lo de antes, en lectura. Por eso PROYECCIÓN sigue ahí en una propiedad
 * rentada y el análisis pre-compra sigue consultable en una vendida.
 *
 * Escribir tiene tres puertas y solo tres, cada una con su significado:
 *   · PATCH sube o cambia un valor — una caja vacía significa "no lo toques".
 *   · clear-fields lo vacía, con un botón que lo dice.
 *   · transition mueve la etapa, pidiendo lo que esa etapa exige.
 */

type TextKey = { [K in keyof RawPropertyFields]-?: NonNullable<RawPropertyFields[K]> extends string ? K : never }[keyof RawPropertyFields]
type NumKey = { [K in keyof RawPropertyFields]-?: NonNullable<RawPropertyFields[K]> extends number ? K : never }[keyof RawPropertyFields]

const fmtNum = (n: number | null | undefined) => (n != null ? String(n) : '—')
const fmtMonths = (n: number | null | undefined) => (n != null ? `${n} meses` : '—')
const roiColorOf = (roi: number | null) =>
  roi == null ? colors.secondary : roi > 0.5 ? colors.primary : roi > 0.25 ? colors.tertiary : '#c0392b'

export function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const propertyId = Number(id)

  const [property, setProperty] = useState<Property | null>(null)
  const { edits, field, setField, hasEdits, clear } = useEdits<RawPropertyFields>(property)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [barsReady, setBarsReady] = useState(false)
  const [leftTab, setLeftTab] = useState<'general' | 'finanzas' | 'analisis'>('general')
  const [transitionTo, setTransitionTo] = useState<Exclude<PropertyStatus, 'prospecto'> | null>(null)
  const [showAdvance, setShowAdvance] = useState(false)

  const [geometry, setGeometry] = useState<FloorPlanModel | Record<string, never> | null>(null)
  const planApiRef = useRef<PlanApi | null>(null)
  const [planDirty, setPlanDirty] = useState(false)

  const [investors, setInvestors] = useState<PropertyInvestor[]>([])
  const [allInvestors, setAllInvestors] = useState<Investor[]>([])
  const [waterfall, setWaterfall] = useState<ProfitWaterfall | null>(null)
  const [instances, setInstances] = useState<ProcessInstance[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])

  const status = property?.status

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchProperty(propertyId), fetchPropertyGeometry(propertyId)])
      .then(([p, geo]) => {
        setProperty(p)
        setGeometry(geo)
        setTimeout(() => setMounted(true), 40)
        setTimeout(() => setBarsReady(true), 420)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Error al cargar la propiedad'))
      .finally(() => setLoading(false))
  }, [propertyId])

  // Lo que cada etapa trae consigo. Depende del status y no solo del id: al
  // avanzar de oferta a desarrollo aparece el reparto, sin recargar la página.
  useEffect(() => {
    if (!status) return
    if (takesInvestors(status)) {
      Promise.all([fetchPropertyInvestors(propertyId), fetchInvestors()])
        .then(([pis, all]) => { setInvestors(pis); setAllInvestors(all) })
        .catch(() => { /* el panel se muestra vacío; no tumba la ficha */ })
    }
    if (hasProfitSplit(status)) {
      fetchPropertyProfit(propertyId).then(({ waterfall: wf }) => setWaterfall(wf)).catch(() => {})
      fetchTeam().then(setTeam).catch(() => {})
    }
    if (takesTasks(status)) {
      fetchInstances(propertyId).then(setInstances).catch(() => {})
    }
  }, [propertyId, status])

  const onPlanReady = useCallback((api: PlanApi) => { planApiRef.current = api }, [])

  async function save() {
    if (!property || (!hasEdits && !planApiRef.current?.isDirty())) return
    setSaving(true)
    setSaveError(null)
    try {
      if (hasEdits) {
        setProperty(await updateProperty(propertyId, edits))
        clear()
      }
      if (planApiRef.current?.isDirty()) {
        setGeometry(await savePropertyGeometry(propertyId, planApiRef.current.getModel()))
        planApiRef.current.markSaved()
        setPlanDirty(false)
      }
      setEditing(false)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  /** Vaciar es su propia operación: se aplica al momento y borra la edición pendiente. */
  async function clearField(key: ClearableField) {
    setSaving(true)
    setSaveError(null)
    try {
      setProperty(await clearPropertyFields(propertyId, [key]))
      setField(key as keyof RawPropertyFields, undefined)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'No se pudo vaciar el campo')
    } finally {
      setSaving(false)
    }
  }

  async function advance(body: Transition) {
    const updated = await transitionProperty(propertyId, body)
    setProperty(updated)
    setTransitionTo(null)
    clear()
    setEditing(false)
  }

  /** Deja que el error suba: el encabezado lo reporta y la página lo enseña. */
  async function handleDelete() {
    setSaveError(null)
    await deleteProperty(propertyId)
    navigate('/propiedades')
  }

  const fade = (delay = 0): React.CSSProperties => ({
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'translateY(0)' : 'translateY(12px)',
    transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ease ${delay}ms`,
  })

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 49px)', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>
        Cargando…
      </div>
    )
  }
  if (error || !property) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 49px)', color: '#E62300', fontFamily: fonts.sans, fontSize: '13px' }}>
        {error ?? 'No encontrada'}
      </div>
    )
  }

  const p = property
  const stage = p.status
  const early = isPrePurchase(stage) || stage === 'archivada'
  const sold = stage === 'vendida'
  const errors = p.issues.filter(i => i.severity === 'error')
  const warnings = p.issues.filter(i => i.severity === 'warning')
  const url = field('url') ?? ''
  const acquisitionCostPct = field('acquisitionCostPct')
  const derivedInvestment = p.investmentBasis === 'underwriting'

  // Un supuesto siempre tiene un valor en uso; lo que cambia es quién lo puso.
  // Vaciarlo solo es una operación cuando hay una captura que quitar — de otro
  // modo el botón ✕ ofrecería borrar algo que nunca se guardó.
  const isCaptured = (key: AssumptionField) => p.assumptions[key].source === 'captured'
  const assumptionHint = (key: AssumptionField) =>
    isCaptured(key) ? 'CAPTURADO' : 'SUPUESTO POR OMISIÓN'
  // Los destinos reales de esta etapa. Archivar se ofrece aparte: no es avanzar.
  const forward = ALLOWED_TRANSITIONS[stage].filter(s => s !== 'archivada')
  const canArchive = ALLOWED_TRANSITIONS[stage].includes('archivada')

  // ── Constructores de fila ───────────────────────────────────────────────────

  const textRow = (label: string, key: TextKey, placeholder?: string) => (
    <EditableRow
      label={label}
      editing={editing}
      value={field(key) || '—'}
      input={
        <input
          value={field(key) ?? ''}
          onChange={e => setField(key, e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          style={fieldInput}
        />
      }
    />
  )

  /**
   * La única semántica numérica de la ficha: una caja vacía revierte al valor
   * guardado (no manda nada), y quien quiera dejar el campo vacío de verdad usa
   * el botón ✕, que llama a clear-fields.
   */
  const numRow = (
    label: string, key: NumKey, format: (n: number | null | undefined) => string,
    opts: { step?: number; clearable?: ClearableField; readOnly?: boolean; hint?: string } = {},
  ) => (
    <EditableRow
      label={label}
      editing={editing}
      value={format(field(key))}
      hint={opts.hint}
      onClear={opts.clearable && p[opts.clearable] != null ? () => clearField(opts.clearable!) : undefined}
      input={opts.readOnly ? undefined : (
        <NumericInput
          value={field(key) ?? undefined}
          onChange={n => setField(key, n)}
          step={opts.step}
          ariaLabel={label}
          style={fieldInput}
        />
      )}
    />
  )

  const dateRow = (label: string, key: TextKey, clearable?: ClearableField) => (
    <EditableRow
      label={label}
      editing={editing}
      value={field(key) || '—'}
      onClear={clearable && p[clearable] != null ? () => clearField(clearable) : undefined}
      input={
        <input
          type="date"
          value={field(key) ?? ''}
          onChange={e => setField(key, e.target.value)}
          aria-label={label}
          style={fieldInput}
        />
      }
    />
  )

  const selectRow = (
    label: string, key: 'assetType' | 'strategyType',
    options: readonly string[], labels: Record<string, string>,
  ) => (
    <EditableRow
      label={label}
      editing={editing}
      value={labels[field(key) ?? ''] ?? '—'}
      onClear={p[key] != null ? () => clearField(key) : undefined}
      input={
        <select
          value={field(key) ?? ''}
          onChange={e => setField(key, e.target.value)}
          aria-label={label}
          style={{ ...fieldInput, cursor: 'pointer' }}
        >
          <option value="">— sin definir —</option>
          {options.map(t => <option key={t} value={t}>{labels[t]}</option>)}
        </select>
      }
    />
  )

  // ── Héroes por etapa ────────────────────────────────────────────────────────
  // Lo que importa de una propiedad cambia con su etapa: antes de comprar, lo
  // que promete; después, lo que va rindiendo; al vender, lo que dejó.
  //
  // Los dos números de una vendida son ANUALIZADO y TOTAL, y la etiqueta tiene
  // que decir cuál es cuál: una venta a seis meses hacía que el héroe grande
  // dijera +112% cuando lo ganado fue +45.6%. Se nombran como ya se nombra la
  // etapa temprana (ROI PROY. ANUAL / ROI PROY. TOTAL) — misma pareja, mismo
  // orden, mismas palabras — para que los dos pares se lean igual.
  const heroes = sold
    ? { label: 'ROI REAL ANUAL', value: p.realizedRoi, second: 'ROI REAL TOTAL', secondValue: p.realizedGainPct, caption: fmtMXN(p.realizedGain) }
    : early
      ? { label: 'ROI PROY. ANUAL', value: p.projectedRoi, second: 'ROI PROY. TOTAL', secondValue: p.projectedRoiTotal, caption: hasScore(stage) ? `Score ${p.score ?? '—'}` : undefined }
      : { label: 'ROI ANUAL', value: p.roi, second: 'GANANCIA NO REALIZADA', secondValue: p.unrealizedGainPct, caption: fmtMXN(p.unrealizedGain) }

  // El precio de compra es lo que cuesta adquirir el inmueble como está; la
  // obra es lo que se va a ejecutar encima. Nada de lo que ya está construido
  // y ya está dentro del precio aparece dos veces.
  const investmentItems = [
    { label: 'Precio de compra', amount: p.purchasePrice ?? 0 },
    { label: 'Costos adq.', amount: p.acquisitionCosts ?? 0 },
    { label: 'Permisos', amount: p.permitsCost ?? 0 },
    { label: 'Subdivisión', amount: p.subdivisionCost ?? 0 },
    { label: 'Obra a ejecutar', amount: p.constructionTotal ?? 0 },
  ]

  const tabs: Array<['general' | 'finanzas' | 'analisis', string]> = [
    ['general', 'GENERAL'],
    ...(takesInvestors(stage) ? [['finanzas', 'FINANZAS'] as ['finanzas', string]] : []),
    ['analisis', 'ANÁLISIS'],
  ]

  return (
    <div style={{ height: 'calc(100vh - 49px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: colors.dark }}>

      {/* El menú de AVANZAR A vive dentro del encabezado, y `fade` le crea un
          contexto de apilamiento propio con su transform: sin un z-index aquí,
          el desplegable no puede subir por encima de la columna de medios por
          más z-index que tenga adentro. */}
      <DetailHeader
        style={{ ...fade(0), position: 'relative', zIndex: 60 }}
        backLabel="PROPIEDADES"
        onBack={() => navigate('/propiedades')}
        title={field('name') ?? ''}
        editingTitle={{ value: field('name') ?? '', onChange: v => setField('name', v) }}
        statusLabel={PROPERTY_STATUS_LABEL[stage]}
        statusColor={PROPERTY_STATUS_COLOR[stage]}
        editing={editing}
        onToggleEdit={() => setEditing(v => !v)}
        hasChanges={hasEdits || planDirty}
        saving={saving}
        onSave={save}
        onCancel={() => { clear(); setEditing(false) }}
        onDelete={handleDelete}
        onDeleteError={setSaveError}
        actions={
          <>
            {forward.length > 0 && (
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <button
                  onClick={() => setShowAdvance(v => !v)}
                  style={{ background: 'none', border: `1px solid ${colors.primary}`, color: colors.primary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: '5px 12px' }}
                >
                  AVANZAR A ▸
                </button>
                {showAdvance && (
                  <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', background: colors.dark, border: `1px solid ${colors.border}`, zIndex: 50, minWidth: '140px' }}>
                    {forward.map(target => (
                      <button
                        key={target}
                        onClick={() => { setShowAdvance(false); setTransitionTo(target as Exclude<PropertyStatus, 'prospecto'>) }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: `1px solid ${colors.border}`, color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: '8px 12px' }}
                      >
                        {PROPERTY_STATUS_LABEL[target]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {canArchive && (
              <button
                onClick={() => setTransitionTo('archivada')}
                style={{ background: 'none', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: '5px 4px', flexShrink: 0 }}
              >
                ARCHIVAR
              </button>
            )}
          </>
        }
      />

      <ErrorBanner message={saveError} />

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '360px 1fr', overflow: 'hidden' }}>

        {/* ── IZQUIERDA: GENERAL / FINANZAS / ANÁLISIS ── */}
        <div style={{ ...fade(80), borderRight: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
            {tabs.map(([tab, label]) => (
              <button key={tab} onClick={() => setLeftTab(tab)} style={{
                background: 'transparent', border: 'none',
                borderBottom: leftTab === tab ? `2px solid ${colors.primary}` : '2px solid transparent',
                color: leftTab === tab ? colors.neutral : colors.secondary,
                cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px',
                letterSpacing: '0.12em', padding: '10px 16px 8px',
              }}>
                {label}
              </button>
            ))}
          </div>

          {/* ── GENERAL ── */}
          {leftTab === 'general' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', scrollbarWidth: 'none' }}>

              <MetricHero
                label={heroes.label}
                value={heroes.value != null ? `${heroes.value > 0 ? '+' : ''}${(heroes.value * 100).toFixed(1)}%` : '—'}
                color={roiColorOf(heroes.value)}
                barPct={heroes.value != null ? heroes.value * 100 : 0}
                barsReady={barsReady}
                caption={heroes.caption}
              />
              <MetricHero
                label={heroes.second}
                value={heroes.secondValue != null ? `${heroes.secondValue > 0 ? '+' : ''}${(heroes.secondValue * 100).toFixed(1)}%` : '—'}
                color={roiColorOf(heroes.secondValue)}
                size={24}
              />

              <SectionDivider label="DATOS" />
              {/* La inversión son dos hechos, no uno: la base con la que se
                  divide todo, y el número que alguien tecleó. Antes el segundo
                  desaparecía de la ficha en cuanto el desglose se completaba —
                  quedaba guardado, invisible e inborrable. */}
              <EditableRow
                label="INVERSIÓN"
                editing={editing}
                value={fmtMXN(p.totalInvestment)}
                hint={derivedInvestment ? 'SUMA DEL DESGLOSE' : 'CAPTURA MANUAL'}
              />
              {(editing || p.totalInvestmentCaptured != null) &&
                numRow('INVERSIÓN CAPTURADA', 'totalInvestmentCaptured', fmtMXN, {
                  clearable: 'totalInvestmentCaptured',
                  hint: derivedInvestment ? 'NO SE USA: MANDA EL DESGLOSE' : undefined,
                })}
              {numRow('VALUACIÓN', 'currentValuation', fmtMXN, { clearable: 'currentValuation' })}
              {/* Lo que se proyectó cobrar y lo que se cobra son dos columnas y
                  dos filas: confirmar una nunca vuelve a borrar la otra. */}
              {numRow('RENTA/MES ESTIMADA', 'rentMonthlyProjected', fmtMXN, { clearable: 'rentMonthlyProjected' })}
              {(editing || p.rentMonthlyActual != null) &&
                numRow('RENTA/MES COBRADA', 'rentMonthlyActual', fmtMXN, { clearable: 'rentMonthlyActual' })}
              <EditableRow label="CAP RATE PROY." editing={editing} value={fmtPct(p.capRate)} />
              {/* La renta anual cobrada vive aquí y no en PROYECCIÓN, que
                  contesta por lo estimado. Antes de partir la renta en dos, la
                  anual de una rentada salía —correctamente— de lo que cobraba;
                  al separarlas, esa cifra se quedó sin fila y desapareció de la
                  ficha. Esto la devuelve, del lado que le toca. */}
              {(p.capRateActual != null || p.rentMonthlyActual != null) && (
                <>
                  <EditableRow label="CAP RATE REAL" editing={editing} value={fmtPct(p.capRateActual)} />
                  <EditableRow label="RENTA ANUAL COBRADA" editing={editing} value={fmtMXN(p.rentAnnualActual)} />
                </>
              )}
              <EditableRow
                label="PLAZO REAL"
                editing={editing}
                value={fmtMonths(p.holdMonthsActual)}
                hint={editing ? 'DERIVADO DE FECHAS' : undefined}
              />
              {numRow('UNIDADES', 'totalUnits', fmtNum, { clearable: 'totalUnits' })}
              {selectRow('TIPO DE ACTIVO', 'assetType', ASSET_TYPES, ASSET_TYPE_LABEL)}
              {selectRow('ESTRATEGIA', 'strategyType', STRATEGY_TYPES, STRATEGY_TYPE_LABEL)}
              {/* La etapa no se edita: se avanza. */}
              <EditableRow
                label="ETAPA"
                editing={editing}
                value={
                  <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.12em', padding: '3px 8px', background: PROPERTY_STATUS_COLOR[stage], color: colors.neutral }}>
                    {PROPERTY_STATUS_LABEL[stage]}
                  </span>
                }
                hint={editing ? 'SE MUEVE CON AVANZAR A' : undefined}
              />

              <SectionDivider label="FECHAS" />
              {dateRow('ADQUISICIÓN', 'acquisitionDate', 'acquisitionDate')}
              {dateRow('PRIMERA RENTA', 'firstRentDate', 'firstRentDate')}
              {/* "VALUACIÓN" a secas ya nombra el monto en DATOS; aquí es su fecha de corte. */}
              {dateRow('FECHA DE VALUACIÓN', 'valuationDate', 'valuationDate')}
              {(sold || p.saleDate != null) && (
                <>
                  {dateRow('VENTA', 'saleDate', 'saleDate')}
                  {numRow('PRECIO DE VENTA', 'salePrice', fmtMXN, { clearable: 'salePrice' })}
                </>
              )}

              <SectionDivider label="UBICACIÓN" />
              {textRow('DIRECCIÓN', 'address')}
              {textRow('CIUDAD', 'city')}
              <EditableRow
                label="URL"
                editing={editing}
                value={url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: colors.secondary, textDecoration: 'none' }}>VER FUENTE ↗</a>
                ) : '—'}
                input={
                  <input value={url} onChange={e => setField('url', e.target.value)} aria-label="URL" style={fieldInput} />
                }
              />
              {editing && (
                <div style={{ marginTop: '12px' }}>
                  <LatLonPicker
                    lat={field('latitude') ?? 0}
                    lon={field('longitude') ?? 0}
                    onChange={(newLat, newLon) => { setField('latitude', newLat); setField('longitude', newLon) }}
                  />
                </div>
              )}

              {/* El desglose se captura en cualquier etapa: es el modelo que se
                  compara contra la realidad, no un formulario de prospecto. */}
              {editing ? (
                <>
                  <SectionDivider label="DESGLOSE DE INVERSIÓN" />
                  {numRow('PRECIO DE COMPRA', 'purchasePrice', fmtMXN, { clearable: 'purchasePrice' })}
                  {numRow('TERRENO (m²)', 'sqmLand', fmtNum, { clearable: 'sqmLand' })}
                  {numRow('OBRA A EJECUTAR (m²)', 'sqmConstruction', fmtNum, { clearable: 'sqmConstruction' })}
                  {numRow('COSTO OBRA/m²', 'constructionCostPerSqm', fmtMXN, { clearable: 'constructionCostPerSqm' })}
                  {numRow('PERMISOS', 'permitsCost', fmtMXN, { clearable: 'permitsCost' })}
                  {numRow('SUBDIVISIÓN', 'subdivisionCost', fmtMXN, { clearable: 'subdivisionCost' })}
                  {numRow('VENTA PROYECTADA', 'projectedSale', fmtMXN, { clearable: 'projectedSale' })}
                </>
              ) : (
                <>
                  <InvestmentBreakdown
                    label="DESGLOSE DE INVERSIÓN"
                    total={p.totalInvestment ?? 0}
                    items={investmentItems}
                    barsReady={barsReady}
                  />
                  <SectionDivider label="MÉTRICAS" />
                  <StatRow label="INVERSIÓN/m²" value={fmtMXN(p.investmentPerSqm)} />
                  <StatRow label="VENTA/m²" value={fmtMXN(p.salePerSqm)} />
                  <StatRow label="COMPRA/m² TERRENO" value={fmtMXN(p.purchasePricePerSqm)} />
                </>
              )}

              {/* Los supuestos se ven SIEMPRE, no solo en edición: cada uno de
                  los tres mueve dinero o mueve el reloj, y esconderlos era como
                  el 6.5% y el 1.3 llegaron a costar sin que nadie los eligiera.
                  Cada fila dice además si alguien los eligió o los puso el
                  modelo — que es la diferencia entre una decisión y un supuesto. */}
              <SectionDivider label="SUPUESTOS" />
              <EditableRow
                label="COSTOS ADQ. (%)"
                editing={editing}
                value={fmtPct(acquisitionCostPct)}
                hint={assumptionHint('acquisitionCostPct')}
                onClear={isCaptured('acquisitionCostPct') ? () => clearField('acquisitionCostPct') : undefined}
                input={
                  <NumericInput
                    value={acquisitionCostPct != null ? acquisitionCostPct * 100 : undefined}
                    onChange={n => setField('acquisitionCostPct', n != null ? n / 100 : undefined)}
                    step={0.1}
                    ariaLabel="COSTOS ADQ. (%)"
                    style={fieldInput}
                  />
                }
              />
              {numRow('OVERHEAD DE OBRA', 'constructionOverhead', fmtNum, {
                step: 0.01,
                clearable: isCaptured('constructionOverhead') ? 'constructionOverhead' : undefined,
                hint: assumptionHint('constructionOverhead'),
              })}
              {numRow('PLAZO PROYECTADO (MESES)', 'holdMonths', fmtNum, {
                clearable: isCaptured('holdMonths') ? 'holdMonths' : undefined,
                hint: assumptionHint('holdMonths'),
              })}

              {/* La proyección sobrevive a la compra: es contra ella que se mide
                  la realidad. Solo al vender el servidor la apaga. */}
              <SectionDivider label="PROYECCIÓN" />
              <StatRow label="VENTA PROYECTADA" value={fmtMXN(p.projectedSale)} />
              <StatRow label="GANANCIA PROYECTADA" value={fmtMXN(p.projectedProfit)} />
              <StatRow label="ROI PROY. ANUAL" value={fmtPct(p.projectedRoi)} />
              <StatRow label="ROI PROY. TOTAL" value={fmtPct(p.projectedRoiTotal)} />
              <StatRow label="RENTA ANUAL EST." value={fmtMXN(p.rentAnnual)} />
              <StatRow label="PLAZO PROYECTADO" value={fmtMonths(p.holdMonths)} />

              {sold && (
                <>
                  <SectionDivider label="RESULTADO" />
                  <StatRow label="PRECIO DE VENTA" value={fmtMXN(p.salePrice)} />
                  {/* GANANCIA REALIZADA se queda porque son pesos y no se
                      confunde con nada. El porcentaje total NO se repite aquí:
                      lo dice el héroe como ROI REAL TOTAL, y tenerlo dos veces
                      con dos nombres distintos era parte de lo que hacía leer
                      mal el par anualizado/total. */}
                  <StatRow label="GANANCIA REALIZADA" value={fmtMXN(p.realizedGain)} />
                  <StatRow label="ROI REAL ANUAL" value={fmtPct(p.realizedRoi)} />
                  <StatRow label="PLAZO REAL" value={fmtMonths(p.holdMonthsActual)} />
                </>
              )}

              {p.issues.length > 0 && (
                <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: `1px solid ${colors.border}` }}>
                  <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '12px' }}>CALIDAD DE DATOS</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {[...errors, ...warnings].map((issue, i) => (
                      <div key={i} style={{ display: 'flex', gap: '8px', padding: '8px', background: colors.surfaceAlt, border: `1px solid ${issue.severity === 'error' ? '#c0392b44' : colors.border}` }}>
                        <span style={{ fontSize: '11px', flexShrink: 0 }}>{issue.severity === 'error' ? '🔴' : '⚠️'}</span>
                        <div>
                          <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em' }}>{issue.field.toUpperCase()}</div>
                          <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: issue.severity === 'error' ? colors.neutral : colors.secondary, marginTop: '2px' }}>{issue.message}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <MilestoneTimeline milestones={p.milestones ?? {}} />

              <SectionDivider label="NOTAS" />
              {editing ? (
                <textarea
                  value={field('notes') ?? ''}
                  onChange={e => setField('notes', e.target.value)}
                  rows={3}
                  aria-label="NOTAS"
                  style={{ ...fieldInput, resize: 'vertical' }}
                />
              ) : (
                <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, lineHeight: '1.7', whiteSpace: 'pre-wrap' }}>
                  {field('notes') && field('notes') !== '-' ? field('notes') : '—'}
                </div>
              )}

              {takesTasks(stage) && (
                <TasksPanel propertyId={propertyId} instances={instances} onChange={setInstances} />
              )}
            </div>
          )}

          {/* ── FINANZAS ── */}
          {leftTab === 'finanzas' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', scrollbarWidth: 'none' }}>
              <InvestorsPanel
                propertyId={propertyId}
                investors={investors}
                allInvestors={allInvestors}
                waterfall={waterfall}
                onChange={setInvestors}
              />
              {hasProfitSplit(stage) && (
                <PropertyProfitSection
                  propertyId={propertyId}
                  team={team}
                  showWaterfall={false}
                  showInvestorBreakdown={false}
                  onWaterfallChange={setWaterfall}
                />
              )}
            </div>
          )}

          {/* ── ANÁLISIS ── */}
          {leftTab === 'analisis' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', scrollbarWidth: 'none' }}>
              {/* El historial se consulta siempre; correr uno nuevo solo mientras
                  el analizador tenga sentido (hasta desarrollo). */}
              {/* assetType y sqmConstruction dejan que el formulario PROPONGA obra
                  nueva en un lote sin obra capturada — visible y cambiable, en vez
                  de que el análisis lo infiera en silencio y cobre por ello. */}
              <PropertyAnalysisSection
                propertyId={propertyId}
                canRun={runsAnalysis(stage)}
                holdMonths={p.assumptions?.holdMonths}
                assetType={p.assetType}
                sqmConstruction={p.sqmConstruction}
              />
            </div>
          )}
        </div>

        {/* ── CENTRO: Mapa / Fotos / Plano ── */}
        <MediaTabs
          style={fade(160)}
          mapa={<MapPanel lat={p.latitude} lon={p.longitude} markerColor={PROPERTY_STATUS_COLOR[stage]} />}
          fotos={
            <PhotoGallery
              images={p.images}
              base={BASE}
              onUpload={async (file, imageType) => {
                const img = await uploadPropertyImage(p.id, file, imageType)
                setProperty(prev => prev ? { ...prev, images: [...prev.images, img] } : prev)
              }}
              onDelete={async imageId => {
                await deletePropertyImage(p.id, imageId)
                setProperty(prev => prev ? { ...prev, images: prev.images.filter(i => i.id !== imageId) } : prev)
              }}
              onChangeType={async (imageId: number, next: ImageType) => {
                const updated = await updatePropertyImageType(p.id, imageId, next)
                setProperty(prev => prev ? { ...prev, images: prev.images.map(i => i.id === imageId ? updated : i) } : prev)
              }}
            />
          }
          plano={geometry !== null && (
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <FloorPlanEditor
                initial={geometry}
                onSave={async m => setGeometry(await savePropertyGeometry(p.id, m))}
                onUploadImage={file => uploadFloorplanImage(p.id, file)}
                onReady={onPlanReady}
                onDirtyChange={setPlanDirty}
              />
            </div>
          )}
        />
      </div>

      {transitionTo && (
        <TransitionModal
          property={p}
          to={transitionTo}
          onCancel={() => setTransitionTo(null)}
          onConfirm={advance}
        />
      )}
    </div>
  )
}
