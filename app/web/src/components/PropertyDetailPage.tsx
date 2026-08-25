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
  hasScore, takesInvestors, takesTasks, hasProfitSplit,
} from '../lib/status'
import type { PropertyStatus } from '../lib/status'
import { colors, fonts } from '../lib/theme'
import { fieldInput, pageFill } from '../lib/styles'
import { fmtMXN, fmtPct, fmtPctSigned, fmtMonth } from '../lib/fmt'
import { fieldLabel } from '../lib/fields'
import { useEdits } from '../lib/useEdits'
import { useNarrowViewport } from '../lib/useNarrowViewport'
import { MetricHero } from './finance/MetricHero'
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
 * todo lo de antes, en lectura. Por eso PROYECCIÓN sigue ahí en una propiedad
 * rentada.
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
const roiColorOf = (roi: number | null | undefined) =>
  roi == null ? colors.secondary : roi > 0.5 ? colors.primary : roi > 0.25 ? colors.tertiary : '#c0392b'
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
 * corrió si el monto ya existe, o nombra el insumo que falta si no.
 *
 * Los dos escenarios se calculan siempre, sin depender de una estrategia de
 * salida elegida (`compute_fees()` en fees.py ya no lee `exit_strategy` para
 * decidir cuál correr) — así que cada uno solo puede faltar por su propio
 * insumo: `missingInputsVenta` siempre trae exactamente `salePrice` cuando
 * falta, `missingInputsRenta` siempre `rentMonthly`. No hace falta
 * inspeccionar el arreglo: el modo ya dice cuál es.
 */
function exitFeeHint(fee: number | null, mode: 'venta' | 'renta'): string {
  if (fee != null) return mode === 'venta' ? '% SOBRE PRECIO/PROYECCIÓN DE VENTA' : 'MESES × RENTA COBRADA/ESTIMADA'
  return mode === 'venta' ? 'FALTA PRECIO DE VENTA (REAL O PROYECTADO)' : 'FALTA RENTA MENSUAL (REAL O PROYECTADA)'
}

/** Las dos cifras grandes de la ficha, ya formateadas. */
interface Heroes {
  label: string; value: string; color: string; barPct?: number; caption?: string
  second?: string; secondValue?: string; secondColor?: string
}

/**
 * Qué contesta la ficha con su elemento más grande.
 *
 * No lo elige la etapa: lo elige QUÉ TANTA REALIDAD respalda cada respuesta. Una
 * propiedad contesta con lo realizado si vendió, con su marca si es suya y
 * alguien la valuó, y con su proyección si todavía es un plan. Amarrado a la
 * etapa, el héroe prometía una cifra que el dato no tenía: una en desarrollo sin
 * avalúo enseñaba «— / —» arriba mientras su proyección viva estaba treinta
 * filas más abajo, y una archivada enseñaba dos guiones el 100% de las veces.
 *
 * Es la misma precedencia que el servidor usa en headline_roi() y la tabla en
 * headlineRoi(): una sola idea de «el ROI que esta propiedad tiene para dar».
 *
 * Cada familia decide con su GANANCIA % y no con su ROI, porque la ganancia sobre
 * el plazo completo es la que menos condiciones necesita (no depende de que
 * exista un periodo). Así el ROI puede faltar sin arrastrarse a la familia entera.
 *
 * Las tres parejas son un ROI y una ganancia %, y los nombres son los de
 * docs/glosario.md: **ROI significa siempre anualizado**, y la cifra sobre el
 * plazo completo se llama Ganancia. Cuando ambas se llamaban ROI, el héroe grande
 * decía +112% donde lo ganado fue +45.6%, y el usuario reportó lo contrario desde
 * el otro lado — «Roi esta mal porque no se mueve cuando muevo el plazo», mirando
 * la total, que por definición no depende del plazo.
 */
function heroesFor(p: Property): Heroes {
  if (p.realizedGainPct != null) {
    return {
      label: 'ROI REAL ANUAL', value: fmtPctSigned(p.realizedRoi), color: roiColorOf(p.realizedRoi),
      barPct: (p.realizedRoi ?? 0) * 100,
      // Cada ROI cierra su reloj el día de su propio numerador, y el caption dice
      // cuál es ese día. Antes cargaba la ganancia en pesos, que ya la dice el
      // segundo héroe con su etiqueta — un número sin etiqueta se escapaba de la
      // regla de «cada cifra una vez» justamente por no tener etiqueta.
      caption: p.saleDate ? `AL ${fmtMonth(p.saleDate).toUpperCase()}` : undefined,
      second: 'GANANCIA REALIZADA', secondValue: fmtGain(p.realizedGain, p.realizedGainPct),
      secondColor: roiColorOf(p.realizedGainPct),
    }
  }
  if (p.unrealizedGainPct != null) {
    return {
      label: 'ROI ANUAL', value: fmtPctSigned(p.roi), color: roiColorOf(p.roi),
      barPct: (p.roi ?? 0) * 100,
      // El ROI de la marca se anualiza de la compra a la fecha de la valuación,
      // así que el héroe dice hasta cuándo cuenta. Sin fecha de corte el reloj sí
      // corre a hoy, y entonces lo dice con esas palabras en vez de dejar que la
      // cifra se lea como si fuera de cualquier día.
      caption: `AL ${p.valuationDate ? fmtMonth(p.valuationDate).toUpperCase() : 'DÍA DE HOY'}`,
      second: 'GANANCIA NO REALIZADA', secondValue: fmtGain(p.unrealizedGain, p.unrealizedGainPct),
      secondColor: roiColorOf(p.unrealizedGainPct),
    }
  }
  if (p.projectedRoiTotal != null) {
    return {
      label: 'ROI PROY. ANUAL', value: fmtPctSigned(p.projectedRoi), color: roiColorOf(p.projectedRoi),
      barPct: (p.projectedRoi ?? 0) * 100,
      // El reloj de este ROI no es una fecha sino el plazo que supone el modelo,
      // y SUPUESTOS lo publica con su origen. Aquí el caption lleva el score,
      // que es lo que califica a un candidato mientras sigue compitiendo.
      caption: hasScore(p.status) ? `Score ${p.score ?? '—'}` : undefined,
      second: 'GANANCIA PROYECTADA', secondValue: fmtGain(p.projectedProfit, p.projectedRoiTotal),
      secondColor: roiColorOf(p.projectedRoiTotal),
    }
  }
  // Sin venta, sin marca y sin proyección no hay ningún rendimiento que anunciar,
  // y dos guiones enormes no son una respuesta. Lo que sí se sabe de una
  // propiedad así es cuánto capital pide, así que eso dice. Un solo héroe: no hay
  // segundo número que no sea inventarlo.
  return { label: 'INVERSIÓN', value: fmtMXN(p.totalInvestment), color: colors.neutral }
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
        setGeometry(migrateGeometry(geo))
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
  async function saveFloorSet(variant: VariantKey, fs: FloorSet): Promise<void> {
    const next = variant === 'original'
      ? withOriginal(geometry, fs)
      : withPlan(geometry, {
          id: variant,
          name: getPlan(geometry, variant)?.name ?? LEGACY_PLAN_NAME,
          fs,
        })
    setGeometry(await savePropertyGeometry(propertyId, next))
  }

  // ─── Planes de proyecto: la colección (crear / renombrar / borrar) ─────────
  // Crear y renombrar persisten de inmediato — operaciones de envelope, no
  // ediciones dentro de un plan (mismo criterio que clonar en LevantamientoPanel).
  async function onCreatePlan(plan: ProjectPlan): Promise<void> {
    setGeometry(await savePropertyGeometry(propertyId, withPlan(geometry, plan)))
  }
  async function onRenamePlan(planId: string, name: string): Promise<void> {
    const existing = getPlan(geometry, planId)
    if (!existing) return
    setGeometry(await savePropertyGeometry(propertyId, withPlan(geometry, { ...existing, name })))
  }
  async function onDeletePlan(planId: string): Promise<void> {
    // El servidor cascadea (plan del blob + renders + archivos) en una operación;
    // aquí solo se refleja: el plan fuera del envelope local y sus renders fuera
    // de la lista — mismo filtro (sourceVariant) que la cascada usó.
    await deletePropertyPlan(propertyId, planId)
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
  const exitSaleCommissionPct = field('exitSaleCommissionPct')

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

  // ── Héroes ──────────────────────────────────────────────────────────────────
  const heroes = heroesFor(p)

  // Un héroe es una PROMOCIÓN, no una copia: la cifra que sube deja su fila. Una
  // misma cifra dos veces en la misma pantalla se lee como dos cifras, que es
  // exactamente lo que hacía confundir el par anualizado/total. Regla única para
  // las cinco etapas — antes PROYECCIÓN repetía sus dos héroes y RESULTADO no.
  //
  // Se compara por etiqueta a propósito: que el héroe y la fila que sustituye se
  // llamen con las mismas palabras es la condición para que sustituirla no
  // esconda nada, y hacerlo así deja esa condición verificada en vez de supuesta.
  const promoted = new Set([heroes.label, heroes.second])

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
    const visible = rows.filter(([label, value]) => value != null && !promoted.has(label))
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

              <MetricHero
                label={heroes.label}
                value={heroes.value}
                color={heroes.color}
                barPct={heroes.barPct}
                barsReady={barsReady}
                caption={heroes.caption}
              />
              {heroes.second && (
                <MetricHero
                  label={heroes.second}
                  value={heroes.secondValue!}
                  color={heroes.secondColor!}
                  size={24}
                />
              )}

              <SectionDivider label="DATOS" />
              {/* La inversión no se teclea: es la suma del desglose, en toda
                  etapa y sin ramas. Había además una fila para capturarla a
                  mano, y con el desglose completo se anunciaba a sí misma como
                  «NO SE USA» — un campo que existía para decir que no servía.
                  Un total all-in se dice donde siempre estuvo su lugar: precio
                  de compra, con los costos de adquisición en 0. */}
              <EditableRow
                label="INVERSIÓN SIN COMISIONES"
                editing={editing}
                value={fmtMXN(p.totalInvestment)}
                hint="SUMA DEL DESGLOSE"
              />
              {/* La fila CON COMISIONES ya no vive aquí: sin una estrategia de
                  salida elegida —el pedido explícito es no obligar a elegir una—
                  no hay UNA cifra que este resumen terso pueda promover sin
                  fingir que un escenario le gana al otro. Los dos, venta y
                  renta, se comparan en COMISIONES DEL FONDO, donde hay espacio
                  para las dos lado a lado. */}
              {numRow('VALUACIÓN', 'currentValuation', fmtMXN, { clearable: 'currentValuation' })}
              {/* La ESTIMADA se fue a SUPUESTOS: es una apuesta sobre el futuro,
                  no un hecho. La COBRADA se queda — es lo que de verdad entró,
                  un hecho tan real como la dirección o las unidades. */}
              {(editing || p.rentMonthlyActual != null) &&
                numRow('RENTA/MES COBRADA', 'rentMonthlyActual', fmtMXN, { clearable: 'rentMonthlyActual' })}
              {/* La renta anual cobrada vive aquí y no en PROYECCIÓN, que
                  contesta por lo estimado. Antes de partir la renta en dos, la
                  anual de una rentada salía —correctamente— de lo que cobraba;
                  al separarlas, esa cifra se quedó sin fila y desapareció de la
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

              {/* La proyección va junto a sus supuestos, no junto al desglose:
                  es lo que esos supuestos producen, y nada de esto se teclea —
                  todo es resultado. Sobrevive a la compra Y a la venta —es
                  contra ella que se mide la realidad, y apagarla al vender la
                  apagaba justo cuando se volvía comprobable—. Los dos ROI solo
                  aparecen aquí cuando el héroe no los subió, en una propiedad
                  que ya tiene una respuesta con más realidad detrás.
                  CAP RATE PROY. entra por `captured` y no por las filas: esas
                  se ocultan solas si valen null, y este cap rate siempre se
                  enseña, aunque sea en «—» — igual que su par REAL en DATOS. */}
              {statSection('PROYECCIÓN', [
                ['GANANCIA PROYECTADA', p.projectedProfit, v => fmtGain(v, p.projectedRoiTotal)],
                ['ROI PROY. ANUAL', p.projectedRoi, fmtPctSigned],
                ['RENTA ANUAL ESTIMADA', p.rentAnnual, fmtMXN],
              ], <EditableRow label="CAP RATE PROY. S/ VENTA" editing={editing} value={fmtPct(p.capRate)} />)}

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

              {/* La marca y el resultado NO tienen sección propia, y es la misma
                  regla que gobierna todo lo de arriba: cada cifra etiquetada vive
                  en un solo lugar. Sus dos cifras derivadas son precisamente las
                  que el héroe promueve, y las capturadas ya viven donde se
                  capturan — VALUACIÓN en DATOS, PRECIO DE VENTA en FECHAS, PLAZO
                  REAL en DATOS. Una sección que solo puede repetir lo que ya está
                  en pantalla no organiza nada: solo hace dudar de si son la misma
                  cifra o dos parecidas. */}

              <SectionDivider label="COMISIONES DEL FONDO" />
              {/* Las mismas 4 filas que antes vivían en SUPUESTOS, mudadas aquí: son
                  supuestos del fondo, no del inmueble, y perdidas entre COSTOS ADQ. /
                  PLAZO PROYECTADO / VENTA PROYECTADA nadie las encontraba. Cada
                  comisión enseña su % (editable, mismo badge CAPTURADO/SUPUESTO POR
                  OMISIÓN de siempre) seguido de su monto en pesos — que el backend ya
                  calculaba y la ficha nunca pintaba.

                  Ya no hay un selector ESTRATEGIA DE SALIDA (feedback en vivo del
                  dueño del producto: obligar a elegir venta o renta para ver su
                  comisión pedía una decisión que nadie tiene tomada de antemano).
                  COMISIÓN VENTA (%) y MESES DE RENTA se ven siempre las dos, cada
                  una con su propio monto — compute_fees() (fees.py) calcula los dos
                  escenarios siempre que haya con qué, sin depender de una estrategia
                  elegida. `exitStrategy` sigue en la BD (migración 049) por si sirve
                  para otro uso, pero ya no tiene control aquí.

                  Esta sección repite a propósito INVERSIÓN SIN COMISIONES, que ya
                  vive en DATOS — la única excepción a «cada cifra vive en un solo
                  lugar» de la nota de arriba. Ahí es una regla real: DATOS es un
                  resumen terso. Aquí el cierre de la sección compara los dos
                  escenarios lado a lado — ver más abajo. */}
              {/* Ocho filas en dos columnas cuando el ancho lo permite, con el mismo
                  `narrow` que ya parte la página entera en dos (línea ~682) — no un
                  breakpoint nuevo. En angosto siguen apiladas. Cada fila usa
                  `stacked` (feedback en vivo, segunda ronda): etiqueta+hint arriba,
                  valor/input abajo, alineados a la izquierda — el renglón normal de
                  `EditableRow` se amontona en media columna de grid. Por default
                  sigue apagada — ningún otro renglón de la ficha cambió.

                  El orden empareja %/$ de cada comisión, una comisión por renglón
                  del grid: terreno, obra, venta, renta — simétrico, sin huecos ni
                  filas que compartan renglón por necesidad. */}
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
                <EditableRow
                  label="COMISIÓN VENTA (%)"
                  editing={editing}
                  value={fmtPct(exitSaleCommissionPct)}
                  hint={assumptionHint('exitSaleCommissionPct')}
                  stacked
                  onClear={isCaptured('exitSaleCommissionPct') ? () => clearField('exitSaleCommissionPct') : undefined}
                  input={
                    <NumericInput
                      value={exitSaleCommissionPct != null ? exitSaleCommissionPct * 100 : undefined}
                      onChange={n => setField('exitSaleCommissionPct', n != null ? n / 100 : undefined)}
                      step={0.1}
                      ariaLabel="COMISIÓN VENTA (%)"
                      style={fieldInput}
                    />
                  }
                />
                <EditableRow
                  label="COMISIÓN VENTA ($)"
                  editing={editing}
                  value={p.exitFeeVenta != null ? fmtMXN(p.exitFeeVenta) : '—'}
                  hint={exitFeeHint(p.exitFeeVenta, 'venta')}
                  stacked
                />
                {numRow('MESES DE RENTA (COMISIÓN SALIDA)', 'exitRentMonths', fmtNum, {
                  clearable: isCaptured('exitRentMonths') ? 'exitRentMonths' : undefined,
                  hint: assumptionHint('exitRentMonths'),
                  stacked: true,
                })}
                <EditableRow
                  label="COMISIÓN RENTA ($)"
                  editing={editing}
                  value={p.exitFeeRenta != null ? fmtMXN(p.exitFeeRenta) : '—'}
                  hint={exitFeeHint(p.exitFeeRenta, 'renta')}
                  stacked
                />
              </div>
              {/* El cierre de la sección, no una celda más del grid (feedback en
                  vivo del dueño del producto, dos rondas: primero que la cifra final
                  se perdía entre once renglones chicos, luego que quería ver los dos
                  escenarios —venta y renta— lado a lado, no uno elegido). SIN
                  COMISIONES es una sola cifra —no depende de la salida— y va chica y
                  centrada arriba; las dos CON COMISIONES son las cifras grandes,
                  una por columna, sin nada más compitiendo por la vista. */}
              <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: `1px solid ${colors.border}`, textAlign: 'center' }}>
                {/* `label` es un <span>, no un <div>: las pruebas ubican cada
                    cifra con `getByText(label).closest('div')`, que en un
                    <span> sube hasta ESTE contenedor —el mismo truco que ya usa
                    `EditableRow` en su modo normal. */}
                <div style={{ marginBottom: '20px' }}>
                  <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary }}>INVERSIÓN SIN COMISIONES</span>
                  <div style={{ fontFamily: fonts.serif, fontSize: '22px', color: colors.secondary, marginTop: '8px' }}>{fmtMXN(p.totalInvestment)}</div>
                </div>
                <div style={narrow ? undefined : { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '24px' }}>
                  <div>
                    <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary }}>INVERSIÓN CON COMISIONES (VENTA)</span>
                    <div style={{ fontFamily: fonts.serif, fontSize: '30px', color: colors.neutral, lineHeight: 1, marginTop: '8px' }}>
                      {p.totalInvestmentWithFeesVenta != null ? fmtMXN(p.totalInvestmentWithFeesVenta) : '—'}
                    </div>
                    <span style={{ display: 'block', fontFamily: fonts.label, fontSize: '7px', letterSpacing: '0.08em', color: colors.secondary, marginTop: '8px' }}>
                      {p.totalInvestmentWithFeesVenta != null ? 'SIN COMISIONES + COMISIONES (VENTA)' : 'FALTA PRECIO DE VENTA (VER ARRIBA)'}
                    </span>
                  </div>
                  <div style={narrow ? { marginTop: '20px' } : undefined}>
                    <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary }}>INVERSIÓN CON COMISIONES (RENTA)</span>
                    <div style={{ fontFamily: fonts.serif, fontSize: '30px', color: colors.neutral, lineHeight: 1, marginTop: '8px' }}>
                      {p.totalInvestmentWithFeesRenta != null ? fmtMXN(p.totalInvestmentWithFeesRenta) : '—'}
                    </div>
                    <span style={{ display: 'block', fontFamily: fonts.label, fontSize: '7px', letterSpacing: '0.08em', color: colors.secondary, marginTop: '8px' }}>
                      {p.totalInvestmentWithFeesRenta != null ? 'SIN COMISIONES + COMISIONES (RENTA)' : 'FALTA RENTA MENSUAL (VER ARRIBA)'}
                    </span>
                  </div>
                </div>
              </div>

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
