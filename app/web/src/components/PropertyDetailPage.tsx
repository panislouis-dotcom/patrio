import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  BASE, fetchProperty, updateProperty, deleteProperty, clearPropertyFields, transitionProperty,
  uploadPropertyImage, deletePropertyImage, updatePropertyImageType, reorderPropertyImages,
  fetchPropertyGeometry, savePropertyGeometry, uploadFloorplanImage, deletePropertyPlan,
  fetchPropertyInvestors, fetchInvestors, fetchPropertyProfit, fetchInstances, fetchTeam,
  listRenderPrompts, listPropertyRenders, generatePropertyRender, generatePropertyRenderFromPlan,
  uploadPropertyRender, uploadPropertyRenderFromPlan,
  editPropertyRender, createRenderPrompt, deletePropertyRender,
  choosePropertyRender, unchoosePropertyRender,
} from '../lib/api'
import type {
  AssumptionField,
  Property, RawPropertyFields, ClearableField, Transition, ImageType,
  PropertyInvestor, Investor, ProfitWaterfall, ProcessInstance, TeamMember,
  RenderPrompt, RenderPromptKind, PropertyRender,
} from '../lib/types'
import {
  ASSET_TYPES, ASSET_TYPE_LABEL, STRATEGY_TYPES, STRATEGY_TYPE_LABEL,
} from '../lib/types'
import {
  ALLOWED_TRANSITIONS, PROPERTY_STATUS_COLOR, PROPERTY_STATUS_LABEL,
  takesInvestors, takesTasks, hasProfitSplit,
} from '../lib/status'
import type { PropertyStatus } from '../lib/status'
import { colors, fonts } from '../lib/theme'
import { fieldInput, pageFill } from '../lib/styles'
import { fmtMXN, fmtPct, fmtPctSigned, fmtMonth, fmtRentas } from '../lib/fmt'
import { fieldLabel } from '../lib/fields'
import { useEdits } from '../lib/useEdits'
import { useNarrowViewport } from '../lib/useNarrowViewport'
import { InvestmentBreakdown } from './finance/InvestmentBreakdown'
import { LatLonPicker } from './LatLonPicker'
import { NumericInput } from './NumericInput'
import { StatRow } from './StatRow'
import { PropertyProfitSection } from './PropertyProfitSection'
import { type PlanApi } from './FloorPlanEditor'
import { LevantamientoPanel } from './LevantamientoPanel'
import { PlanesPanel } from './PlanesPanel'
import { getPlan, LEGACY_PLAN_NAME, migrateGeometry, removePlan, withOriginal, withPlan, type FloorPlanModel, type FloorSet, type ProjectPlan, type VariantKey } from '../lib/floorplan/types'
import { DetailHeader } from './detail/DetailHeader'
import { EditableRow } from './detail/EditableRow'
import { FeeTierEditor } from './detail/FeeTierEditor'
import { MapPanel } from './detail/MapPanel'
import { MediaTabs } from './detail/MediaTabs'
import { FotosPanel } from './detail/FotosPanel'
import { PresupuestosPanel } from './detail/PresupuestosPanel'
import { SectionDivider } from './detail/SectionDivider'
import { ErrorBanner } from './detail/ErrorBanner'
import { TransitionModal } from './detail/TransitionModal'
import { InvestorsPanel } from './detail/InvestorsPanel'
import { MilestoneTimeline } from './detail/MilestoneTimeline'
import { TasksPanel } from './detail/TasksPanel'

/**
 * Una sola ficha para todo el ciclo de vida. Las herramientas aparecen cuando su
 * etapa las abre, pero nada se esconde al avanzar: en pasos de después se ve
 * todo lo de antes, en lectura. Por eso PLAN ORIGINAL (dentro de RESULTADO)
 * sigue ahí en una propiedad rentada.
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
/**
 * Una ganancia, entera. Monto y porcentaje son la misma cifra en dos unidades y
 * viajan juntas: separarlas dejaba media pareja arriba y media abajo, las dos
 * llamadas con el mismo nombre. Por eso la etiqueta es la del monto, sin `%` —
 * el sufijo solo existe para cuando el porcentaje va solo y tiene que nombrarse
 * a sí mismo, y así impreso nunca va solo.
 */
const fmtGain = (amount: number | null | undefined, pct: number | null | undefined) =>
  `${fmtMXN(amount)} ${fmtPctSigned(pct)}`

/**
 * El hint de COMISIÓN VENTA ($) / COMISIÓN RENTA ($): describe la fórmula que
 * corrió —con la tasa que de verdad se aplicó, tramo o default— si el monto ya
 * existe, o nombra el insumo que falta si no.
 *
 * Los dos escenarios se calculan siempre, sin depender de una estrategia de
 * salida elegida (`compute_fees()` en fees.py ya no lee `exit_strategy` para
 * decidir cuál correr) — así que cada uno solo puede faltar por su propio
 * insumo: `missingInputsVenta` siempre trae exactamente `salePrice` cuando
 * falta, `missingInputsRenta` siempre `rentMonthly`. No hace falta
 * inspeccionar el arreglo: el modo ya dice cuál es.
 *
 * `rate` es `exitFeeVentaRate` (fracción de precio) del lado de venta o
 * `exitFeeRentaMonths` (número de rentas, ya no una fracción — el dueño del
 * producto marcó el % de una sola mensualidad como irreal frente a la
 * convención real de 2-4 rentas) del lado de renta: siempre viene junto con
 * `fee` cuando `fee` no es null.
 */
function exitFeeHint(fee: number | null, rate: number | null, mode: 'venta' | 'renta'): string {
  if (fee != null) {
    if (mode === 'venta') return `${fmtPct(rate)} SOBRE PRECIO DE VENTA`
    return `${fmtRentas(rate).toUpperCase()} SOBRE RENTA MENSUAL`
  }
  return mode === 'venta' ? 'FALTA PRECIO DE VENTA (REAL O PROYECTADO)' : 'FALTA RENTA MENSUAL (REAL O PROYECTADA)'
}

/** Agrupa filas DENTRO de RESULTADO (PLAN ORIGINAL, cada escenario, MARCA
 * ACTUAL) sin abrir un `SectionDivider` propio — mismo peso visual que ya usa
 * `FeeTierEditor` para su propia etiqueta dentro de COMISIONES DEL FONDO. */
const resultSubheading: React.CSSProperties = {
  fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em', color: colors.secondary,
  marginTop: '16px', marginBottom: '4px',
}

export function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const propertyId = Number(id)

  const [property, setProperty] = useState<Property | null>(null)
  const { edits, field, setField, hasEdits, clear } = useEdits<RawPropertyFields>(property)
  // No vive en `edits`: no es una columna, es el insumo de la misma
  // CALCULADORA que siembra el presupuesto al nacer — nunca hay un valor
  // guardado que prellenar aquí, solo uno que, al guardarse, la vuelve a correr.
  const [costPerSqm, setCostPerSqm] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [barsReady, setBarsReady] = useState(false)
  const [leftTab, setLeftTab] = useState<'general' | 'finanzas'>('general')
  const [transitionTo, setTransitionTo] = useState<Exclude<PropertyStatus, 'prospecto'> | null>(null)
  const [showAdvance, setShowAdvance] = useState(false)

  /** Debajo de 900px las dos columnas se apilan. Es el único breakpoint del repo. */
  const narrow = useNarrowViewport()

  // El envelope v3 ya migrado, o null si la propiedad no tiene geometría reconocible
  // (nunca dibujó, o el blob es del editor viejo). Null no significa «cargando»: mientras
  // la ficha carga, la página entera hace early-return antes de pintar las pestañas.
  const [geometry, setGeometry] = useState<FloorPlanModel | null>(null)
  // El candado optimista del blob (migración 052): la revisión de la que partió
  // lo que esta página tiene en memoria. Cada guardado la declara y el servidor
  // contesta 409 si otra sesión guardó en medio — el mensaje sale por los
  // caminos de error que ya existen (saveError / el error de cada panel). Ref y
  // no estado: nada se re-pinta por ella, solo viaja con el siguiente guardado.
  const geometryRevision = useRef(0)
  // El editor vivo Y de qué variante es, en UN solo ref: los dos levantamientos
  // comparten el GUARDAR del encabezado, y con el par amarrado estructuralmente
  // no existe el estado donde el api de un editor se guarda con la etiqueta del
  // otro. No se limpia al desmontar a propósito: conserva el rescate de guardar
  // lo dibujado aunque el usuario ya haya cambiado de pestaña.
  const planEditorRef = useRef<{ variant: VariantKey; api: PlanApi } | null>(null)
  const [planDirty, setPlanDirty] = useState(false)

  const [investors, setInvestors] = useState<PropertyInvestor[]>([])
  const [allInvestors, setAllInvestors] = useState<Investor[]>([])
  const [waterfall, setWaterfall] = useState<ProfitWaterfall | null>(null)
  const [instances, setInstances] = useState<ProcessInstance[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])

  const [renderPrompts, setRenderPrompts] = useState<RenderPrompt[]>([])
  const [renders, setRenders] = useState<PropertyRender[]>([])

  const status = property?.status

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchProperty(propertyId), fetchPropertyGeometry(propertyId)])
      .then(([p, geo]) => {
        setProperty(p)
        setGeometry(migrateGeometry(geo.geometry))
        geometryRevision.current = geo.revision
        setTimeout(() => setMounted(true), 40)
        setTimeout(() => setBarsReady(true), 420)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Error al cargar la propiedad'))
      .finally(() => setLoading(false))
  }, [propertyId])

  // La biblioteca y los renders van aparte de la ficha: si el proveedor de
  // imágenes está caído o la biblioteca falla, la propiedad se sigue leyendo.
  //
  // Un solo fetch, SIN filtrar por `kind` (Tarea 23): son 11 filas en total —
  // pedir 'photo' aparte de 'plan' sería un segundo viaje de red para ahorrar
  // filtrar un arreglo de una docena de elementos. Cada `RendersPanel` recorta
  // la lista a SU `kind` por dentro (foto↔`source:'photos'`, plano↔`source:'plan'`),
  // igual que ya recorta `renders` por `sourceVariant`.
  useEffect(() => {
    listRenderPrompts().then(setRenderPrompts).catch(() => {})
    listPropertyRenders(propertyId).then(setRenders).catch(() => {})
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

  const onPlanReady = useCallback((variant: VariantKey, api: PlanApi) => {
    planEditorRef.current = { variant, api }
  }, [])

  /**
   * Guardar UNA variante compone el envelope v4 completo con `withOriginal`/`withPlan`,
   * que preservan todo lo demás tal cual: un guardado de un plan jamás pisa el original
   * ni a los otros planes, y viceversa. Un blob v2/v3 viejo queda persistido en v4 en su
   * primer guardado. El `name` del plan se conserva del modelo (withPlan reemplaza el
   * objeto entero — sin esta lectura previa, guardar geometría regresaría el nombre al
   * default).
   */
  /** El ÚNICO camino que escribe el blob desde esta página: guarda declarando
   * la revisión vigente y adopta la nueva. Un 409 (otra sesión guardó en medio)
   * sale como excepción hacia el caller — nada local se toca, el usuario recarga. */
  async function persistGeometry(next: FloorPlanModel): Promise<void> {
    const saved = await savePropertyGeometry(propertyId, next, geometryRevision.current)
    geometryRevision.current = saved.revision
    setGeometry(saved.geometry)
  }

  async function saveFloorSet(variant: VariantKey, fs: FloorSet): Promise<void> {
    const next = variant === 'original'
      ? withOriginal(geometry, fs)
      : withPlan(geometry, {
          id: variant,
          name: getPlan(geometry, variant)?.name ?? LEGACY_PLAN_NAME,
          fs,
        })
    await persistGeometry(next)
  }

  // ─── Planes de proyecto: la colección (crear / renombrar / borrar) ─────────
  // Crear y renombrar persisten de inmediato — operaciones de envelope, no
  // ediciones dentro de un plan (mismo criterio que clonar en LevantamientoPanel).
  async function onCreatePlan(plan: ProjectPlan): Promise<void> {
    await persistGeometry(withPlan(geometry, plan))
  }
  async function onRenamePlan(planId: string, name: string): Promise<void> {
    const existing = getPlan(geometry, planId)
    if (!existing) return
    await persistGeometry(withPlan(geometry, { ...existing, name }))
  }
  async function onDeletePlan(planId: string): Promise<void> {
    // El servidor cascadea (plan del blob + renders + archivos) en una operación;
    // aquí solo se refleja: el plan fuera del envelope local y sus renders fuera
    // de la lista — mismo filtro (sourceVariant) que la cascada usó. Borrar
    // también sube la revisión del candado en el servidor: se adopta la nueva
    // para que el siguiente guardado de ESTA sesión no dé un 409 falso.
    const { revision } = await deletePropertyPlan(propertyId, planId)
    geometryRevision.current = revision
    setGeometry(prev => (prev ? removePlan(prev, planId) : prev))
    setRenders(prev => prev.filter(r => r.sourceVariant !== planId))
  }

  // ─── Renders: edición, biblioteca y borrado son iguales sin importar la fuente
  // (una foto en FOTOS, el plano de cada levantamiento) — una sola definición para
  // las tres monturas de RendersPanel (FotosPanel y los dos LevantamientoPanel), en
  // vez de copiar el mismo cierre tres veces.
  async function onEditRender(renderId: number, promptText: string): Promise<PropertyRender> {
    const created = await editPropertyRender(propertyId, renderId, { promptText })
    setRenders(prev => [created, ...prev])
    return created
  }
  async function onSaveRenderPrompt(
    { name, body, kind }: { name: string; body: string; kind: RenderPromptKind },
  ): Promise<RenderPrompt> {
    const created = await createRenderPrompt(name, body, kind)
    setRenderPrompts(prev => [...prev, created])
    return created
  }
  async function onDeleteRenderItem(renderId: number): Promise<void> {
    await deletePropertyRender(propertyId, renderId)
    setRenders(prev => prev.filter(r => r.id !== renderId))
  }
  async function onChooseRender(renderId: number): Promise<void> {
    const chosen = await choosePropertyRender(propertyId, renderId)
    // El servidor ya apagó los demás del grupo en la base de datos; esto solo
    // evita esperar el próximo fetch para verlo reflejado en pantalla.
    setRenders(prev => prev.map(r => {
      if (r.id === chosen.id) return chosen
      const sameFloorGroup = chosen.floorId != null
        && r.floorId === chosen.floorId && r.sourceVariant === chosen.sourceVariant
      const samePhotoGroup = chosen.sourceImageId != null && r.sourceImageId === chosen.sourceImageId
      return (sameFloorGroup || samePhotoGroup) ? { ...r, isChosen: false } : r
    }))
  }
  async function onUnchooseRender(renderId: number): Promise<void> {
    const updated = await unchoosePropertyRender(propertyId, renderId)
    setRenders(prev => prev.map(r => r.id === updated.id ? updated : r))
  }

  /**
   * Generar desde el plano de UN levantamiento. `LevantamientoPanel` ya resolvió
   * el piso SELECCIONADO en RENDERS → PNG (`floorToPngBlob`, solo corre en el
   * navegador) más su `floorId`/`floorName`; aquí se manda todo junto con la
   * variante que lo pidió — la pieza que le faltaba al endpoint desde la Tarea 14
   * (`variant` obligatorio) y la Tarea 29 (`floorId`/`floorName` obligatorios).
   */
  async function onGenerateRender(
    variant: VariantKey,
    req: { promptId: number | null; promptText: string; plan: Blob; floorId: string; floorName: string },
  ): Promise<PropertyRender> {
    const created = await generatePropertyRenderFromPlan(propertyId, { ...req, variant })
    setRenders(prev => [created, ...prev])
    return created
  }

  /** Análogo a `onGenerateRender`, pero para la subida directa: mismo spread
   * `{...req, variant}`, mismo seam. */
  async function onUploadRender(
    variant: VariantKey,
    req: { floorId: string; floorName: string; file: File },
  ): Promise<PropertyRender> {
    const created = await uploadPropertyRenderFromPlan(propertyId, { ...req, variant })
    setRenders(prev => [created, ...prev])
    return created
  }

  async function save() {
    if (!property || (!hasEdits && costPerSqm == null && !planEditorRef.current?.api.isDirty())) return
    setSaving(true)
    setSaveError(null)
    try {
      if (hasEdits || costPerSqm != null) {
        setProperty(await updateProperty(propertyId, {
          ...edits,
          ...(costPerSqm != null ? { constructionCostPerSqm: costPerSqm } : {}),
        }))
        clear()
        setCostPerSqm(undefined)
      }
      const planEditor = planEditorRef.current
      if (planEditor?.api.isDirty()) {
        await saveFloorSet(planEditor.variant, planEditor.api.getModel())
        planEditor.api.markSaved()
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', ...pageFill, color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>
        Cargando…
      </div>
    )
  }
  if (error || !property) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', ...pageFill, color: '#E62300', fontFamily: fonts.sans, fontSize: '13px' }}>
        {error ?? 'No encontrada'}
      </div>
    )
  }

  const p = property
  const stage = p.status
  const sold = stage === 'vendida'
  const errors = p.issues.filter(i => i.severity === 'error')
  const warnings = p.issues.filter(i => i.severity === 'warning')
  const url = field('url') ?? ''
  const acquisitionCostPct = field('acquisitionCostPct')
  const landCommissionPct = field('landCommissionPct')
  const constructionCommissionPct = field('constructionCommissionPct')

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
    opts: { step?: number; clearable?: ClearableField; readOnly?: boolean; hint?: string; stacked?: boolean } = {},
  ) => (
    <EditableRow
      label={label}
      editing={editing}
      value={format(field(key))}
      hint={opts.hint}
      stacked={opts.stacked}
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

  /**
   * Las fechas del ciclo de vida se capturan y se leen POR MES. Ninguna mueve un
   * cálculo al día —todas pasan por `months_between`— y ninguna se capturó nunca
   * al día, así que un `type="date"` solo podía producir precisión que el dominio
   * no tiene. El input manda `YYYY-MM`, que el API ya aceptaba de siempre.
   */
  const dateRow = (label: string, key: TextKey, clearable?: ClearableField) => (
    <EditableRow
      label={label}
      editing={editing}
      value={fmtMonth(field(key))}
      onClear={clearable && p[clearable] != null ? () => clearField(clearable) : undefined}
      input={
        <input
          type="month"
          value={(field(key) ?? '').slice(0, 7)}
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

  // El precio de compra es lo que cuesta adquirir el inmueble como está; la
  // obra es lo que se va a ejecutar encima. Nada de lo que ya está construido
  // y ya está dentro del precio aparece dos veces.
  //
  // Estas cinco partidas SON la inversión: el total sale de sumarlas, así que
  // las barras explican todo el capital por construcción. Hubo una sexta,
  // «Sin desglosar», para el hueco entre un total tecleado a mano y lo que el
  // desglose sabía explicar; sin ese segundo origen el hueco no existe, y una
  // fila que solo puede aparecer si el servidor se contradice es una que
  // taparía la contradicción en vez de dejarla salir.
  const investmentItems = [
    { label: 'Precio de compra', amount: p.purchasePrice ?? 0 },
    { label: 'Costos adq.', amount: p.acquisitionCosts ?? 0 },
    { label: 'Permisos', amount: p.permitsCost ?? 0 },
    { label: 'Subdivisión', amount: p.subdivisionCost ?? 0 },
    // La obra ya no es una fórmula: es la SUMA DEL PRESUPUESTO, capturada
    // renglón por renglón en la pestaña PRESUPUESTO. Antes era
    // `m² × $/m² × overhead`, y con eso vivían dos respuestas a «cuánto va a
    // costar la obra» en cuanto alguien empezara a detallarla. Ahora nunca hay
    // dos —y no porque una gane, sino porque nunca hubo dos.
    { label: 'Obra a ejecutar', amount: p.constructionBudgeted ?? 0 },
  ]

  /**
   * Una sección de cifras DERIVADAS se dibuja solo si alguna de sus filas tiene
   * valor — la política de vacío de InvestmentBreakdown, aplicada a las demás.
   * Una derivada sin valor no es un pendiente de captura sino una pregunta que
   * esta propiedad no puede contestar, y tres guiones seguidos bajo un título no
   * informan de nada. Las filas capturables (DATOS, FECHAS) no pasan por aquí:
   * ahí el guion sí es información, porque señala qué falta teclear.
   */
  const statSection = (
    title: string,
    rows: Array<[string, number | null | undefined, (n: number | null | undefined) => string]>,
    /** Filas capturables que van en la misma sección, antes de las derivadas —
     * misma pantalla, edición y lectura son la misma fila. No pasan por el
     * filtro de "solo si hay algo que decir": una capturable vacía en edición
     * SÍ es información, es lo que falta teclear. */
    captured?: React.ReactNode,
  ) => {
    const visible = rows.filter(([, value]) => value != null)
    if (visible.length === 0 && !captured) return null
    return (
      <>
        <SectionDivider label={title} />
        {captured}
        {visible.map(([label, value, format]) => (
          <StatRow key={label} label={label} value={format(value)} />
        ))}
      </>
    )
  }

  const tabs: Array<['general' | 'finanzas', string]> = [
    ['general', 'GENERAL'],
    ...(takesInvestors(stage) ? [['finanzas', 'FINANZAS'] as ['finanzas', string]] : []),
  ]

  return (
    /* En dos columnas la ficha ocupa exactamente la pantalla y cada columna
       scrollea por dentro. Apilada no puede: la altura la manda el contenido, y
       fijarla en 100vh dejaría la mitad de abajo recortada sin forma de llegar
       a ella. Por eso en angosto la página recupera su scroll vertical. */
    <div style={{
      // Angosta CRECE con su contenido —`1 0 auto`— para que la página pueda
      // scrollear en vertical; ancha se queda con el hueco exacto y deja que
      // scrolleen sus dos columnas por dentro. Ninguna de las dos sabe cuánto
      // mide la barra de navegación: ver `pageFill`.
      ...(narrow
        ? { flex: '1 0 auto' }
        : { ...pageFill, overflow: 'hidden' }),
      display: 'flex', flexDirection: 'column', background: colors.dark,
    }}>

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
        hasChanges={hasEdits || costPerSqm != null || planDirty}
        saving={saving}
        onSave={save}
        onCancel={() => { clear(); setCostPerSqm(undefined); setEditing(false) }}
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

      {/* La columna izquierda mide 360px FIJOS. Debajo de 900px eso no deja
          nada para la de medios —en un teléfono de 390 le quedaban 15— y la
          pestaña PRESUPUESTO tenía ancho visible cero, con la página entera
          scrolleando en horizontal en vez de la tabla. Apiladas, cada una toma
          el ancho completo. Ver `useNarrowViewport` para por qué es el único
          breakpoint del repo y por qué no es un `@media` de CSS. */}
      <div style={{
        flex: 1, display: 'grid',
        gridTemplateColumns: narrow ? '1fr' : '360px 1fr',
        overflow: narrow ? 'visible' : 'hidden',
      }}>

        {/* ── IZQUIERDA: GENERAL / FINANZAS ── */}
        {/* Apilada, el borde que separaba las columnas pasa a ser el que las
            separa de arriba abajo. */}
        <div style={{
          ...fade(80),
          [narrow ? 'borderBottom' : 'borderRight']: `1px solid ${colors.border}`,
          display: 'flex', flexDirection: 'column',
          overflow: narrow ? 'visible' : 'hidden',
        }}>
          {/* Con una sola pestaña no hay nada que elegir, y la tira de tabs
              solo restaba espacio a la columna: se pinta nada más cuando hay
              algo entre qué cambiar. */}
          {tabs.length > 1 && (
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
          )}

          {/* ── GENERAL ── */}
          {leftTab === 'general' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', scrollbarWidth: 'none' }}>

              <SectionDivider label="DATOS" />
              {numRow('VALUACIÓN', 'currentValuation', fmtMXN, { clearable: 'currentValuation' })}
              {/* La ESTIMADA se fue a SUPUESTOS: es una apuesta sobre el futuro,
                  no un hecho. La COBRADA se queda — es lo que de verdad entró,
                  un hecho tan real como la dirección o las unidades. */}
              {(editing || p.rentMonthlyActual != null) &&
                numRow('RENTA/MES COBRADA', 'rentMonthlyActual', fmtMXN, { clearable: 'rentMonthlyActual' })}
              {/* La renta anual cobrada vive aquí y no en RESULTADO, que
                  contesta por lo estimado (RENTA ANUAL ESTIMADA, en PLAN
                  ORIGINAL). Antes de partir la renta en dos, la anual de una
                  rentada salía —correctamente— de lo que cobraba; al
                  separarlas, esa cifra se quedó sin fila y desapareció de la
                  ficha. Esto la devuelve, del lado que le toca. */}
              {(p.capRateActual != null || p.rentMonthlyActual != null) && (
                <>
                  <EditableRow label="CAP RATE" editing={editing} value={fmtPct(p.capRateActual)} />
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

              {/* SUPUESTOS es todo número que alguien estima sobre el futuro,
                  no solo los dos que el modelo puede rellenar por default: la
                  renta esperada y la venta proyectada son apuestas igual de
                  reales, solo que sin un default que las sostenga si nadie las
                  captura. Se ven SIEMPRE, no solo en edición: esconderlos era
                  como el 6.5% y el 1.3 llegaron a costar sin que nadie los
                  eligiera. Van antes del desglose y de la proyección: son el
                  insumo que los dos usan para convertirse en dinero. */}
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
              {/* El overhead de obra ya no está, y no es un descuido: dejó de
                  multiplicar nada. Se aplica una sola vez, al calcular el primer
                  renglón del presupuesto al dar de alta la propiedad, y desde
                  ahí vive DENTRO del importe. Un supuesto que no mueve dinero no
                  es un supuesto — dejarlo aquí sería un número que se puede leer,
                  comparar y hasta editar sin que cambie un peso, que es el mismo
                  defecto «NO SE USA» que la inversión capturada ya tuvo. */}
              {numRow('PLAZO PROYECTADO (MESES)', 'holdMonths', fmtNum, {
                clearable: isCaptured('holdMonths') ? 'holdMonths' : undefined,
                hint: assumptionHint('holdMonths'),
              })}
              {/* Sin CAPTURADO/SUPUESTO POR OMISIÓN: a diferencia de los dos de
                  arriba, estos dos no tienen un default del modelo que los
                  sostenga — vacíos, simplemente no hay nada que multiplicar. */}
              {numRow('RENTA/MES ESTIMADA', 'rentMonthlyProjected', fmtMXN, { clearable: 'rentMonthlyProjected' })}
              {numRow('VENTA PROYECTADA', 'projectedSale', fmtMXN, { clearable: 'projectedSale' })}

              {/* El desglose se captura en cualquier etapa: es el modelo que se
                  compara contra la realidad, no un formulario de prospecto.

                  M² DE TERRENO, M² DE CONSTRUCCIÓN y COSTO OBRA/m² van FUERA del
                  `editing ? :` de abajo, a diferencia de PRECIO DE COMPRA /
                  PERMISOS / SUBDIVISIÓN: esos tres sí tienen una representación
                  de solo lectura genuina —las barras de InvestmentBreakdown— y
                  por eso alternan de forma correcta. Estos tres no tienen ninguna
                  otra forma en que mostrarse, así que van como cualquier otra fila
                  capturable de la ficha: una sola vez, con `numRow`/`EditableRow`
                  resolviendo edición/lectura por su cuenta. Vivir dentro del
                  `editing ? :` era exactamente el bug que a VENTA PROYECTADA ya se
                  le había corregido aquí mismo: una caja que solo existe editando
                  desaparece del todo al salir de edición. */}
              <SectionDivider label="DESGLOSE DE INVERSIÓN" />
              {editing && numRow('PRECIO DE COMPRA', 'purchasePrice', fmtMXN, { clearable: 'purchasePrice' })}
              {numRow('M² DE TERRENO', 'sqmLand', fmtNum, { clearable: 'sqmLand' })}
              {/* El metraje se queda: es FÍSICO, y lo leen el analizador de
                  mercado y el PDF, a los que no les importa lo que cueste la
                  obra. */}
              {numRow('M² DE CONSTRUCCIÓN', 'sqmConstruction', fmtNum, { clearable: 'sqmConstruction' })}
              {/* No es un insumo guardado —«OBRA/m²» en lectura sigue siendo
                  presupuesto ÷ metraje, nunca esta caja— es la CALCULADORA
                  que siembra el presupuesto al nacer, disponible de nuevo
                  aquí mientras nadie haya detallado una partida real: el
                  servidor rechaza el intento si ya hay más detallado que lo
                  que esta cuenta produciría.

                  SIN overhead, a propósito y a diferencia del alta: aquí
                  no se está proponiendo un estimado grueso para calificar
                  después, se está editando un presupuesto real, y un
                  multiplicador oculto dejaría el número tecleado sin
                  relación directa con el número que se enseña — que fue
                  justo la confusión que esto causó la primera vez.

                  Prellenada con el cociente derivado: sin overhead que se
                  aplique dos veces, guardar sin tocarla reproduce el mismo
                  total, así que no hay razón para abrirla vacía. */}
              <EditableRow
                label="COSTO OBRA/m²"
                editing={editing}
                value={fmtMXN(p.constructionCostPerSqm)}
                input={
                  <NumericInput
                    value={costPerSqm ?? p.constructionCostPerSqm ?? undefined}
                    onChange={setCostPerSqm}
                    ariaLabel="COSTO OBRA/m²"
                    style={fieldInput}
                  />
                }
              />
              {editing ? (
                <>
                  {numRow('PERMISOS', 'permitsCost', fmtMXN, { clearable: 'permitsCost' })}
                  {numRow('SUBDIVISIÓN', 'subdivisionCost', fmtMXN, { clearable: 'subdivisionCost' })}
                </>
              ) : (
                <>
                  <InvestmentBreakdown
                    items={investmentItems}
                    barsReady={barsReady}
                  />
                  {/* El avance de obra EN DINERO. Son cifras NUEVAS, no otra
                      versión de la inversión: lo que la obra va a costar y lo
                      que ya se pagó de ella son dos preguntas distintas, y solo
                      la primera es capital invertido. Lo presupuestado no está
                      aquí porque ya es la barra «Obra a ejecutar» de arriba —
                      cada cifra etiquetada vive en un solo lugar.
                      La sección entera desaparece mientras nadie firme ni pague:
                      cuatro guiones bajo un título no informan de nada. */}
                  {statSection('AVANCE DE OBRA', [
                    ['OBRA COMPROMETIDA', p.constructionCommitted, fmtMXN],
                    ['OBRA PAGADA', p.constructionPaid, fmtMXN],
                    ['COMPROMETIDO VS PRESUPUESTO', p.constructionCommittedVariance, fmtMXN],
                    ['PAGADO VS PRESUPUESTO', p.constructionPaidVariance, fmtMXN],
                  ])}
                </>
              )}

              <SectionDivider label="COMISIONES DEL FONDO" />
              {/* Las mismas 4 comisiones que antes vivían en SUPUESTOS, mudadas aquí:
                  son supuestos del fondo, no del inmueble, y perdidas entre COSTOS
                  ADQ. / PLAZO PROYECTADO / VENTA PROYECTADA nadie las encontraba.
                  TERRENO y OBRA siguen siendo un % plano (editable, mismo badge
                  CAPTURADO/SUPUESTO POR OMISIÓN de siempre) seguido de su monto en
                  pesos. VENTA y RENTA ya no son un % plano (migración 053, Tarea 6):
                  cada una es una escalera de tramos (`FeeTierEditor`) seguida del
                  mismo monto en pesos de siempre — que el backend ya calculaba y la
                  ficha nunca pintaba antes de esta sección.

                  Ya no hay un selector ESTRATEGIA DE SALIDA (feedback en vivo del
                  dueño del producto: obligar a elegir venta o renta para ver su
                  comisión pedía una decisión que nadie tiene tomada de antemano). La
                  escalera de VENTA y la de RENTA se ven siempre las dos, cada una con
                  su propio monto — compute_fees() (fees.py) calcula los dos
                  escenarios siempre que haya con qué, sin depender de una estrategia
                  elegida. `exitStrategy` sigue en la BD (migración 049) por si sirve
                  para otro uso, pero ya no tiene control aquí.

                  Esta sección es pura captura — % de terreno/obra y las escaleras
                  de venta/renta. El resultado que producen (inversión con
                  comisiones, ganancia bruta/neta, yield) vive todo junto en
                  RESULTADO, al final de la columna. */}
              {/* Cuatro filas (TERRENO, OBRA — %/$ cada una) en dos columnas cuando el
                  ancho lo permite, con el mismo `narrow` que ya parte la página entera
                  en dos (línea ~682) — no un breakpoint nuevo. En angosto siguen
                  apiladas. Cada fila usa `stacked` (feedback en vivo, segunda ronda):
                  etiqueta+hint arriba, valor/input abajo, alineados a la izquierda —
                  el renglón normal de `EditableRow` se amontona en media columna de
                  grid. Por default sigue apagada — ningún otro renglón de la ficha
                  cambió.

                  VENTA y RENTA (escalera + $) NO viven en este grid: son una lista de
                  alto variable, no una fila de altura fija, así que van en su propio
                  bloque de dos columnas justo abajo. */}
              <div style={narrow ? undefined : { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '24px' }}>
                <EditableRow
                  label="COMISIÓN COMPRA TERRENO (%)"
                  editing={editing}
                  value={fmtPct(landCommissionPct)}
                  hint={assumptionHint('landCommissionPct')}
                  stacked
                  onClear={isCaptured('landCommissionPct') ? () => clearField('landCommissionPct') : undefined}
                  input={
                    <NumericInput
                      value={landCommissionPct != null ? landCommissionPct * 100 : undefined}
                      onChange={n => setField('landCommissionPct', n != null ? n / 100 : undefined)}
                      step={0.1}
                      ariaLabel="COMISIÓN COMPRA TERRENO (%)"
                      style={fieldInput}
                    />
                  }
                />
                <EditableRow
                  label="COMISIÓN COMPRA TERRENO ($)"
                  editing={editing}
                  value={fmtMXN(p.landFee)}
                  hint="% SOBRE PRECIO DE COMPRA"
                  stacked
                />
                <EditableRow
                  label="COMISIÓN OBRA (%)"
                  editing={editing}
                  value={fmtPct(constructionCommissionPct)}
                  hint={assumptionHint('constructionCommissionPct')}
                  stacked
                  onClear={isCaptured('constructionCommissionPct') ? () => clearField('constructionCommissionPct') : undefined}
                  input={
                    <NumericInput
                      value={constructionCommissionPct != null ? constructionCommissionPct * 100 : undefined}
                      onChange={n => setField('constructionCommissionPct', n != null ? n / 100 : undefined)}
                      step={0.1}
                      ariaLabel="COMISIÓN OBRA (%)"
                      style={fieldInput}
                    />
                  }
                />
                <EditableRow
                  label="COMISIÓN OBRA ($)"
                  editing={editing}
                  value={fmtMXN(p.constructionFee)}
                  hint="% SOBRE OBRA A EJECUTAR"
                  stacked
                />
              </div>
              {/* COMISIÓN VENTA y COMISIÓN RENTA ya no caben en el grid de arriba
                  (feedback en vivo, Tarea 6 de metas-venta-renta): el % plano de
                  cada una se volvió una escalera de tramos —FeeTierEditor, su
                  propio sub-recurso fuera de useEdits/PATCH, siempre activo, sin
                  depender de `editing`— y una lista de renglones no cabe en una
                  fila de altura fija. Mismo patrón `narrow` de dos columnas que el
                  cierre de la sección, un poco más abajo: cada editor va
                  INMEDIATAMENTE seguido de su fila ($), que sigue sin cambios —
                  sigue mostrando el monto que ya calculaba el servidor, ahora
                  resuelto contra la escalera en vez del % plano. */}
              <div style={{ marginTop: '16px' }}>
                <div style={narrow ? undefined : { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '24px' }}>
                  <div>
                    <FeeTierEditor property={p} kind="venta" defaultRatePct={p.exitFeeVentaRate} onPropertyChange={setProperty} />
                    <EditableRow
                      label="COMISIÓN VENTA ($)"
                      editing={editing}
                      value={p.exitFeeVenta != null ? fmtMXN(p.exitFeeVenta) : '—'}
                      hint={exitFeeHint(p.exitFeeVenta, p.exitFeeVentaRate, 'venta')}
                      stacked
                    />
                  </div>
                  <div style={narrow ? { marginTop: '20px' } : undefined}>
                    <FeeTierEditor property={p} kind="renta" defaultRatePct={p.exitFeeRentaMonths} onPropertyChange={setProperty} />
                    <EditableRow
                      label="COMISIÓN RENTA ($)"
                      editing={editing}
                      value={p.exitFeeRenta != null ? fmtMXN(p.exitFeeRenta) : '—'}
                      hint={exitFeeHint(p.exitFeeRenta, p.exitFeeRentaMonths, 'renta')}
                      stacked
                    />
                  </div>
                </div>
              </div>
              {/* RESULTADO: la misma forma en las 5 etapas — lo que cambia es
                  qué filas tienen dato, no la estructura. INVERSIÓN SIN
                  COMISIONES/COMISIÓN TERRENO/COMISIÓN OBRA son el ancla —
                  retoman lo que DESGLOSE DE INVERSIÓN y COMISIONES DEL FONDO
                  ya explicaron arriba para armar lo que sigue. PLAN ORIGINAL
                  congela projectedProfit/projectedRoi contra VENTA
                  PROYECTADA aunque la propiedad ya haya vendido: es la
                  promesa original, no se mueve. Las dos columnas de escenario
                  corren siempre las dos, sin depender de una estrategia de
                  salida elegida — el badge REAL/PROYECTADO(A) depende del
                  DATO (salePrice/rentMonthlyActual), no de la etapa, así que
                  una `desarrollo` y una `vendida` corren exactamente el mismo
                  layout. Una vez vendida, ESCENARIO VENTA YA ES la cifra
                  realizada (precio real, comisión real, badge REAL) —
                  reemplaza la lectura aparte de GANANCIA REALIZADA que existía
                  antes de este cambio. MARCA ACTUAL es la única fila que NO se
                  funde con venta/renta: mide el avalúo de hoy, no una salida
                  modelada, y no neta ninguna comisión de salida. */}
              <SectionDivider label="RESULTADO" />
              <StatRow label="INVERSIÓN SIN COMISIONES" value={fmtMXN(p.totalInvestment)} />
              <StatRow label="COMISIÓN TERRENO" value={fmtMXN(p.landFee)} />
              <StatRow label="COMISIÓN OBRA" value={fmtMXN(p.constructionFee)} />

              {p.projectedRoiTotal != null && (
                <>
                  <div style={resultSubheading}>PLAN ORIGINAL</div>
                  <StatRow label="GANANCIA PROYECTADA" value={fmtGain(p.projectedProfit, p.projectedRoiTotal)} />
                  <StatRow label="ROI PROY. ANUAL" value={fmtPctSigned(p.projectedRoi)} />
                  <StatRow label="RENTA ANUAL ESTIMADA" value={fmtMXN(p.rentAnnual)} />
                  <StatRow label="CAP RATE PROY. S/ VENTA" value={fmtPct(p.capRate)} />
                </>
              )}

              <div style={narrow ? { marginTop: '16px' } : { marginTop: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '24px' }}>
                <div>
                  <div style={resultSubheading}>ESCENARIO VENTA · {p.salePrice != null ? 'REAL' : 'PROYECTADO'}</div>
                  <StatRow label="PRECIO DE VENTA" value={fmtMXN(p.salePrice ?? p.projectedSale)} />
                  <StatRow
                    label="COMISIÓN VENTA"
                    value={p.exitFeeVenta != null ? fmtMXN(p.exitFeeVenta) : exitFeeHint(p.exitFeeVenta, p.exitFeeVentaRate, 'venta')}
                  />
                  <StatRow label="INVERSIÓN CON COMISIONES" value={fmtMXN(p.totalInvestmentWithFeesVenta)} />
                  <StatRow label="GANANCIA BRUTA" value={fmtGain(p.grossGainVenta, p.grossGainVentaPct)} />
                  <StatRow label="GANANCIA NETA" value={fmtGain(p.netGainVenta, p.netGainVentaPct)} />
                  <StatRow label="ROI NETO ANUAL" value={fmtPctSigned(p.netRoiVenta)} />
                </div>
                <div style={narrow ? { marginTop: '20px' } : undefined}>
                  <div style={resultSubheading}>ESCENARIO RENTA · {p.rentMonthlyActual != null ? 'REAL' : 'PROYECTADA'}</div>
                  <StatRow label="RENTA/MES" value={fmtMXN(p.rentMonthlyActual ?? p.rentMonthlyProjected)} />
                  <StatRow
                    label="COMISIÓN RENTA"
                    value={p.exitFeeRenta != null ? fmtMXN(p.exitFeeRenta) : exitFeeHint(p.exitFeeRenta, p.exitFeeRentaMonths, 'renta')}
                  />
                  <StatRow label="INVERSIÓN CON COMISIONES" value={fmtMXN(p.totalInvestmentWithFeesRenta)} />
                  <StatRow label="YIELD BRUTO (s/comisión)" value={fmtPct(p.grossYieldRenta)} />
                  <StatRow label="YIELD NETO (c/comisión)" value={fmtPct(p.netYieldRenta)} />
                </div>
              </div>

              {p.unrealizedGainPct != null && (
                <>
                  <div style={resultSubheading}>MARCA ACTUAL</div>
                  <StatRow label="GANANCIA NO REALIZADA" value={fmtGain(p.unrealizedGain, p.unrealizedGainPct)} />
                  <StatRow label="ROI (MARCA) ANUAL" value={fmtPctSigned(p.roi)} />
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
                          <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em' }}>{fieldLabel(issue.field).toUpperCase()}</div>
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
        </div>

        {/* ── CENTRO: Mapa / Fotos / Plano / Presupuesto ──
            El presupuesto no lleva ventana de etapa, a diferencia de las
            herramientas de la columna izquierda: acompaña a la propiedad desde
            prospecto como el desglose de costos, porque hay que poder
            presupuestar antes de ofertar.

            RENDERS ya no es pestaña propia: vive DENTRO de FOTOS (sub-navegación
            GALERÍA | RENDERS, Tarea 16) para las propuestas nacidas de una foto, y
            DENTRO de cada levantamiento (sub-navegación PLANO | RENDERS, Tarea 17)
            para las nacidas de SU plano. La separación foto≠render no se relajó —
            sigue siendo dos tablas y un badge que RendersPanel nunca deja de pintar
            — solo cambió dónde vive cada una en la barra. */}
        <MediaTabs
          style={fade(160)}
          tabs={[
            {
              label: 'mapa',
              panel: <MapPanel lat={p.latitude} lon={p.longitude} markerColor={PROPERTY_STATUS_COLOR[stage]} />,
            },
            {
              label: 'fotos',
              panel: (
                <FotosPanel
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
                  onReorder={async (imageIds: number[]) => {
                    const images = await reorderPropertyImages(p.id, imageIds)
                    setProperty(prev => prev ? { ...prev, images } : prev)
                  }}
                  prompts={renderPrompts}
                  renders={renders}
                  onGenerate={async req => {
                    const created = await generatePropertyRender(p.id, req)
                    setRenders(prev => [created, ...prev])
                    return created
                  }}
                  onUploadRender={async req => {
                    const created = await uploadPropertyRender(p.id, req)
                    setRenders(prev => [created, ...prev])
                    return created
                  }}
                  onEdit={onEditRender}
                  onSavePrompt={onSaveRenderPrompt}
                  onDeleteRender={onDeleteRenderItem}
                  onChoose={onChooseRender}
                  onUnchoose={onUnchooseRender}
                />
              ),
            },
            {
              label: 'levantamiento original',
              // Los dos paneles son el MISMO componente en el mismo hueco de
              // MediaTabs: sin `key`, React reusaría el montaje al cambiar de
              // pestaña y el reducer del editor se quedaría con el plano de la
              // otra variante. El key fuerza el remontaje — con lo que un cambio
              // de pestaña pierde lo no guardado, igual que ya pasaba en PLANO.
              panel: (
                <LevantamientoPanel
                  key="levantamiento-original"
                  variant="original"
                  geometry={geometry}
                  onSave={saveFloorSet}
                  onUploadImage={file => uploadFloorplanImage(p.id, file)}
                  onReady={onPlanReady}
                  onDirtyChange={setPlanDirty}
                  base={BASE}
                  prompts={renderPrompts}
                  renders={renders}
                  onGenerateRender={onGenerateRender}
                  onUploadRender={onUploadRender}
                  onEdit={onEditRender}
                  onSavePrompt={onSaveRenderPrompt}
                  onDeleteRender={onDeleteRenderItem}
                  onChoose={onChooseRender}
                  onUnchoose={onUnchooseRender}
                />
              ),
            },
            {
              label: 'plano de proyecto',
              // PlanesPanel es dueño de CUÁL plan está activo (y remonta el
              // LevantamientoPanel por plan); esta página sigue siendo dueña de
              // persistir: guardar geometría, crear/renombrar (withPlan) y
              // borrar (cascada del servidor + poda local de renders).
              panel: (
                <PlanesPanel
                  key="planes-de-proyecto"
                  geometry={geometry}
                  onSave={saveFloorSet}
                  onCreatePlan={onCreatePlan}
                  onRenamePlan={onRenamePlan}
                  onDeletePlan={onDeletePlan}
                  onUploadImage={file => uploadFloorplanImage(p.id, file)}
                  onReady={onPlanReady}
                  onDirtyChange={setPlanDirty}
                  base={BASE}
                  prompts={renderPrompts}
                  renders={renders}
                  onGenerateRender={onGenerateRender}
                  onUploadRender={onUploadRender}
                  onEdit={onEditRender}
                  onSavePrompt={onSaveRenderPrompt}
                  onDeleteRender={onDeleteRenderItem}
                  onChoose={onChooseRender}
                  onUnchoose={onUnchooseRender}
                />
              ),
            },
            {
              // Cada escritura del presupuesto devuelve la propiedad
              // recalculada: la suma presupuestada ES el costo de obra, así que
              // tocar un renglón mueve la inversión y el ROI (el cap rate no —
              // ya no es función del costo, ver underwriting.py). Un solo
              // setProperty y la ficha entera queda al día.
              label: 'presupuesto',
              panel: <PresupuestosPanel property={p} geometry={geometry} onPropertyChange={setProperty} />,
            },
          ]}
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
