import { useEffect, useMemo, useRef, useState } from 'react'
import { colors, fonts, radius, spacing } from '../../lib/theme'
import { fmtDia } from '../../lib/fmt'
import type { PropertyImage, PropertyRender, RenderPrompt, RenderPromptKind } from '../../lib/types'
import type { FloorGraph, VariantKey } from '../../lib/floorplan/types'
import { roomLabels } from '../../lib/floorplan/rooms'
import { planFacts } from '../../lib/floorplan/planFacts'

interface CommonProps {
  prompts: RenderPrompt[]
  renders: PropertyRender[]
  base: string
  /** Editar ENCIMA de un render: instrucción chica sobre su misma imagen. */
  onEdit?: (renderId: number, promptText: string) => Promise<PropertyRender>
  /** `kind` lo decide este panel, no quien llama: es SIEMPRE el mismo que su
   * propio `source` (Tarea 23) — un preset guardado desde un panel `plan` no
   * puede terminar en el catálogo de foto ni viceversa. */
  onSavePrompt: (p: { name: string; body: string; kind: RenderPromptKind }) => Promise<RenderPrompt>
  onDeleteRender: (renderId: number) => Promise<void>
  /** La estrella: marca este render como EL elegido de su grupo (piso+variante, o
   * foto). El servidor apaga cualquier otro del mismo grupo — este callback solo
   * dispara la llamada; RendersPanel actualiza el estado local (vía las props
   * `renders` que le llegan de arriba) cuando la promesa resuelve. */
  onChoose: (renderId: number) => Promise<void>
  onUnchoose: (renderId: number) => Promise<void>
}

/** FOTOS (Tarea 16): la fuente es una foto real de la propiedad — flujo actual. */
interface PhotosProps extends CommonProps {
  source: 'photos'
  images: PropertyImage[]
  onGenerate: (req: { sourceImageId: number; promptId: number | null; promptText: string })
    => Promise<PropertyRender>
  onUpload?: (req: { sourceImageId: number; file: File }) => Promise<PropertyRender>
  plan?: never
  variant?: never
  floorId?: never
  floorName?: never
  floorCount?: never
  onGeneratePlan?: never
  onUploadPlan?: never
}

/** Cada levantamiento (Tarea 17): la fuente es SU plano, nunca el ajeno. `variant`
 * y `plan` son OBLIGATORIOS aquí — antes los dos eran opcionales y un caller podía
 * mandar `source: 'plan'` sin `variant`; `scoped` (más abajo) filtraba entonces
 * contra `undefined`, la lista salía silenciosamente vacía y nada avisaba del
 * error. Ahora ese caso ni compila. */
interface PlanProps extends CommonProps {
  source: 'plan'
  variant: VariantKey
  /** El contenido del piso SELECCIONADO — el selector de piso vive en
   * `LevantamientoPanel` (dueño de `fs.floors`), no aquí: este panel solo ve UN
   * piso a la vez, porque generar siempre habla de una sola PNG/piso (Task 30). */
  plan: FloorGraph | null
  /** Identidad y nombre del piso de `plan` — null exactamente cuando `plan` es
   * null. Se mandan tal cual al generar (`onGeneratePlan`) y filtran la lista
   * (`scoped`) junto con `variant`, nunca solos (Task 28: floor identity + variant). */
  floorId: string | null
  floorName: string | null
  /** Cuántos pisos tiene ESTE levantamiento en total. Decide si un render con
   * `floorId` NULL (legado, anterior a la migración 042) se cuela bajo el único
   * piso sin ambigüedad (`floorCount` 1) o va a su propia sección "Sin piso
   * identificado" (`floorCount` 2+) — ver diseño en el plan de Task 30. */
  floorCount: number
  onGeneratePlan: (req: { promptId: number | null; promptText: string; floorId: string; floorName: string })
    => Promise<PropertyRender>
  onUploadPlan?: (req: { floorId: string; floorName: string; file: File }) => Promise<PropertyRender>
  images?: never
  onGenerate?: never
  onUpload?: never
}

/** De dónde nace todo render que este panel puede generar o listar. 'photos':
 * vive dentro de FOTOS, la fuente es una foto real (Tarea 16). 'plan': vive
 * dentro de un levantamiento, la fuente es SU plano (Tarea 17). Un mismo
 * componente, dos fuentes que nunca se mezclan — igual que en la base de datos,
 * `sourceVariant` NULL es foto y con valor es plano. */
type Props = PhotosProps | PlanProps

const label: React.CSSProperties = {
  fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em',
  color: colors.secondary, textTransform: 'uppercase',
}

/**
 * Compone el texto final de un prompt de PLANO: los datos duros del piso
 * (`planFacts`) SIEMPRE antes del texto de estilo, nunca al revés — así lo
 * documenta el propio `planFacts` ("listo para anteponerse al prompt de
 * estilo"). `choosePreset` y `selectPlan` (RendersPanel, más abajo) son las
 * dos únicas fuentes que tocan `text` en modo plano y ambas pasan por este
 * helper para que elegir un preset de estilo y elegir "El plano" compongan
 * sin pisarse, sin importar en qué orden el usuario dispare las dos acciones
 * (Task 33d) — antes cada una hacía su propio `setText` a secas y la segunda
 * en dispararse borraba lo que la primera hubiera puesto.
 *
 * `facts` null es modo fotos (no hay plano que anteponer) o modo plano antes
 * de elegir "El plano": el texto es solo el estilo, sin transformar — para no
 * alterar ni un espacio del cuerpo de un preset de FOTOS, que nunca compone
 * con nada.
 */
function composeWithFacts(style: string, facts: string | null): string {
  if (!facts) return style
  const s = style.trim()
  return s ? `${facts}\n\n${s}` : facts
}

/**
 * Reemplaza SOLO la porción de hechos duros de un `text` ya compuesto
 * (`composeWithFacts`) por hechos NUEVOS, conservando intacta la porción de
 * estilo — mismo principio que `choosePreset` ya usa para su propia mitad, ahora
 * del otro lado del prefijo. La usa el efecto de sincronización de piso, más
 * abajo (Task 33e / addendum de fidelidad geométrica).
 *
 * `oldFacts` es lo que se ESPERA encontrar al frente de `text` — los hechos con
 * los que se compuso la última vez. Si `text` ya no empieza exactamente con eso
 * es porque el usuario lo editó a mano después de componer (rompiendo el
 * prefijo): en ese caso se regresa `text` intacto, sin tocar nada. Forzar la
 * sustitución ahí arriesgaría pisar una edición manual sin avisar — peor que
 * dejarlo con datos potencialmente obsoletos, que al menos el usuario reconoce
 * como propios (ver el efecto de sincronización para la decisión completa).
 */
function replaceFacts(text: string, oldFacts: string, newFacts: string): string {
  if (!text.startsWith(oldFacts)) return text
  return composeWithFacts(text.slice(oldFacts.length), newFacts)
}

/**
 * RENDERS: eliges una fuente, eliges (o escribes) un prompt, y sale una
 * propuesta. La fuente depende de `source` — una foto (dentro de FOTOS) o el
 * plano de un levantamiento (dentro de ESE levantamiento) — y nunca las dos:
 * mezclarlas en una sola lista es cómo una propuesta de plano termina listada
 * como si fuera evidencia fotográfica, o viceversa.
 *
 * Todo render que se muestre lleva encima la palabra PROPUESTA y el prompt con
 * el que se hizo. No es decoración: el modelo de datos separa foto de render
 * para que nadie confunda evidencia con proyecto, y esta pantalla es donde esa
 * garantía se vuelve visible para quien la está mirando.
 */
export function RendersPanel(props: Props) {
  const { source, prompts, renders, base, onEdit, onSavePrompt, onDeleteRender, onChoose, onUnchoose } = props
  // Narrowed a mano y no por destructuring directo: una vez que `plan`/`variant`/
  // `onGenerate*` salen del objeto `props` pierden la liga con `source` — el
  // discriminante — y TS ya no puede probar que están presentes en su rama. Leerlos
  // vía `props.source === …` conserva esa liga; el resto de la función no cambia.
  const images = props.source === 'photos' ? props.images : []
  const plan = props.source === 'plan' ? props.plan : null
  const variant = props.source === 'plan' ? props.variant : undefined
  const onGenerate = props.source === 'photos' ? props.onGenerate : undefined
  const onGeneratePlan = props.source === 'plan' ? props.onGeneratePlan : undefined
  const onUpload = props.source === 'photos' ? props.onUpload : undefined
  const onUploadPlan = props.source === 'plan' ? props.onUploadPlan : undefined
  // Identidad del piso SELECCIONADO (Task 30) — null exactamente cuando `plan` es
  // null. `floorCount` decide, más abajo, cómo agrupar los renders con `floorId`
  // NULL (legado): bajo el único piso si es 1, aparte si son 2+.
  const selectedFloorId = props.source === 'plan' ? props.floorId : null
  const selectedFloorName = props.source === 'plan' ? props.floorName : null
  const floorCount = props.source === 'plan' ? props.floorCount : 0

  // El catálogo que le toca a ESTE panel, nunca el del otro (Tarea 23): un preset
  // de plano ("Minimalista nórdico") no tiene sentido ofrecido sobre una foto de
  // fachada, y uno de foto ("Jardín regional") tampoco sobre un plano. `source`
  // ya es el discriminante — 'photos'↔'photo', 'plan'↔'plan' — así que no hace
  // falta un prop nuevo para decidirlo.
  const kind: RenderPromptKind = source === 'photos' ? 'photo' : 'plan'
  const visiblePrompts = useMemo(() => prompts.filter(p => p.kind === kind), [prompts, kind])

  const [sourceId, setSourceId] = useState<number | null>(null)
  const [usePlan, setUsePlan] = useState(false)
  const [promptId, setPromptId] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [naming, setNaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [uploading, setUploading] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  // Índice para colgarle a cada render su foto base sin recorrer la lista por render.
  const photosById = useMemo(() => new Map(images.map(i => [i.id, i])), [images])

  // Nombres de cuarto del plano, solo para el badge "N espacios" del botón de fuente.
  const planRoomNames = useMemo(
    () => (plan ? roomLabels(plan).map(r => r.name).filter(Boolean) : []),
    [plan],
  )

  // El equivalente en el frontend de `chain_is_plan` (backend): una edición hereda
  // `sourceVariant` de su padre inmediato, así que TODO nodo de una cadena (raíz y
  // ediciones) trae la misma marca — filtrar por nodo basta, no hace falta caminar
  // la cadena hasta la raíz. Fotos: NULL. Plano: la variante que lo generó.
  //
  // Modo plano AGREGA un segundo filtro (Task 30): el piso SELECCIONADO — nunca
  // solo, siempre junto con `variant` (Task 28: floor identity + variant, jamás
  // floor identity sola, para no mezclar el original y el planeado de un mismo
  // piso). `floorId` NULL es legado (anterior a la migración 042): con un solo
  // piso no hay ambigüedad y se cuela aquí; con 2+ pisos es ambiguo y se cuenta
  // aparte en `unassigned`, nunca en la lista de un piso concreto.
  //
  // Modo fotos NO filtra por foto (revertido — la estrella marca un elegido POR
  // FOTO igual, pero cada tarjeta ya enseña su propia "Foto base" en línea, así
  // que aislar una foto a la vez antes de poder elegir era una fila de más sin
  // trabajo que hacer: la exclusividad la garantiza el servidor por grupo
  // (`sourceImageId`), no una vista aislada).
  const scoped = useMemo(() => {
    const byVariant = renders.filter(r => (source === 'photos' ? r.sourceVariant == null : r.sourceVariant === variant))
    if (source === 'photos') return byVariant
    return byVariant.filter(r => r.floorId === selectedFloorId || (r.floorId === null && floorCount <= 1))
  }, [renders, source, variant, selectedFloorId, floorCount])

  // Renders de plano con `floorId` NULL cuando el levantamiento tiene 2+ pisos:
  // ambiguos — a cuál piso pertenecen no se puede reconstruir — así que se
  // enseñan en su propia sección, siempre visibles, nunca escondidos ni
  // mezclados en la lista de un piso concreto (ver diseño, Task 30).
  const unassigned = useMemo(() => {
    if (source !== 'plan' || floorCount < 2) return []
    return renders.filter(r => r.sourceVariant === variant && r.floorId === null)
  }, [renders, source, variant, floorCount])

  // Cadenas de edición: la lista muestra solo las CABEZAS (los renders que nadie
  // editó encima); el historial de cada una se camina hacia atrás por
  // parentRenderId. Una edición hereda el piso de su padre igual que la variante
  // (Task 29), así que una cadena nunca cruza de una sección a la otra.
  const { byId: renderById, heads } = useMemo(() => computeHeads(scoped), [scoped])
  const { byId: unassignedById, heads: unassignedHeads } = useMemo(() => computeHeads(unassigned), [unassigned])

  const selectedPrompt = visiblePrompts.find(p => p.id === promptId) ?? null
  // Los datos duros del piso (Tasks 33a-c) que le tocan al texto ACTUAL, si "El
  // plano" está elegido — null en modo fotos (`usePlan` nunca es true ahí) y
  // también null en modo plano hasta que se elige la fuente.
  // includeColorLegend:true (Fase 2 del diagnóstico de Locales Salón Escobedo): mismo
  // par gemelo que `roomTypeFill` en `LevantamientoPanel.tsx::handleGeneratePlan` — el
  // PNG que se manda ya lleva el relleno de color, así que el texto debe describir esos
  // mismos colores. Debe coincidir EXACTO con `selectPlan` (abajo): ambos alimentan la
  // comparación `text.startsWith(facts)` que decide si re-componer o no — una opción
  // distinta entre los dos rompería esa comparación (Task 33d/33e).
  const currentFacts = usePlan && plan ? planFacts(plan, { includeColorLegend: true }) : null
  // Si el texto ya no es lo que el preset compone (su cuerpo solo en modo
  // fotos; datos duros + su cuerpo en modo plano — ver `composeWithFacts`), el
  // render no salió de ese preset. Mandar el id de todos modos haría que el
  // render mintiera sobre su origen — mismo criterio de siempre, ahora
  // consciente de la composición de Task 33d.
  const effectivePromptId =
    selectedPrompt && composeWithFacts(selectedPrompt.body, currentFacts).trim() === text.trim()
      ? selectedPrompt.id : null

  // El sync de piso (más abajo) deliberadamente NO toca `text` cuando la edición
  // manual del usuario rompió el prefijo de hechos — correcto, para no pisarla
  // sin avisar. Pero eso deja el texto describiendo el piso VIEJO sin ninguna
  // señal de que ya no coincide con el piso/PNG que se va a mandar al generar:
  // exactamente el tipo de brecha silenciosa que el addendum de fidelidad
  // geométrica busca eliminar, ahora en el subcaso de edición manual. Mismo
  // predicado que ya usa `replaceFacts` (`text.startsWith(oldFacts)`), aquí
  // contra los hechos ACTUALES en vez de los viejos.
  const textStale = usePlan && currentFacts != null && !text.startsWith(currentFacts)

  // Identidad del piso que le toca a `plan` — su `id`, no la referencia del
  // objeto: `LevantamientoPanel` reconstruye `selectedFloor` en cada render (un
  // `.find` sobre `fs.floors`), así que la referencia puede cambiar sin que el
  // piso lo haya hecho; `id` es estable ante eso y ante reordenar/renombrar
  // (mismo campo que documenta `FloorGraph.id`), la señal correcta para
  // detectar "cambié de piso" en vez de "el mismo piso mutó de referencia".
  const planId = plan?.id ?? null
  const prevPlanIdRef = useRef(planId)
  const prevFactsRef = useRef(currentFacts)

  // `LevantamientoPanel` NUNCA remonta este panel al cambiar de piso — no hay
  // `key` por piso, solo cambia la prop `plan` (junto con `floorId`/`floorName`)
  // — así que sin este efecto `text`/`usePlan`, que viven DENTRO de este
  // componente, no se enteran del cambio. Dos síntomas reales, los dos de este
  // mismo hueco (ver docs/plans/2026-08-13-fidelidad-geometrica-renders-plano.md):
  //
  // 1. Duplicación: un re-clic en "El plano" comparaba el guard de idempotencia
  //    de `selectPlan` (`text.startsWith(facts)`) contra los hechos del piso
  //    NUEVO, que nunca calzan con el prefijo viejo — así que antepone sin
  //    quitar, y el texto termina describiendo los cuartos de los DOS pisos.
  // 2. Datos obsoletos: generar sin volver a hacer clic en "El plano" manda el
  //    PNG del piso nuevo (correcto, vía `plan`) con una descripción de texto
  //    del piso VIEJO — la imagen y el prompt describiendo dos pisos distintos,
  //    exactamente el tipo de "render sin fidelidad geométrica" que este
  //    addendum busca eliminar.
  //
  // El reemplazo es QUIRÚRGICO (`replaceFacts`, arriba): solo la porción de
  // hechos duros, la de estilo queda intacta — mismo principio que
  // `choosePreset` ya usa para su propia mitad. Y solo ocurre si `text` sigue
  // empezando exactamente con los hechos viejos (`prevFactsRef`); si ya no
  // calza es porque el usuario editó el texto a mano después de componer, y ahí
  // se deja intacto — sincronizar de todos modos arriesgaría pisar esa edición
  // sin avisar, y se prefiere un texto con datos potencialmente obsoletos pero
  // reconocible como propio a uno que el usuario nunca escribió.
  useEffect(() => {
    const prevPlanId = prevPlanIdRef.current
    const prevFacts = prevFactsRef.current
    prevPlanIdRef.current = planId
    prevFactsRef.current = currentFacts
    if (!usePlan || prevPlanId === planId || prevFacts == null || currentFacts == null) return
    setText(t => replaceFacts(t, prevFacts, currentFacts))
  }, [planId, currentFacts, usePlan])

  // Elegir un preset de estilo y elegir "El plano" son dos fuentes de texto
  // independientes que deben COMPONER, nunca pisarse (Task 33d) — antes cada
  // una hacía un `setText` que borraba lo que la otra hubiera puesto: elegir
  // el plano y LUEGO un preset perdía los datos duros del piso, y elegir un
  // preset y LUEGO el plano nunca los agregaba, dependiendo nada más del
  // orden de clics del usuario. `choosePreset` reemplaza SOLO la mitad de
  // estilo (es justo lo que "elegir OTRO preset" significa: descarta lo que
  // hubiera antes en esa mitad, igual que siempre) y conserva los datos duros
  // intactos si "El plano" ya estaba elegido.
  function choosePreset(value: string) {
    const p = visiblePrompts.find(x => String(x.id) === value) ?? null
    setPromptId(p?.id ?? null)
    setText(composeWithFacts(p?.body ?? '', currentFacts))
  }

  function selectPhoto(id: number) { setSourceId(id); setUsePlan(false) }
  function selectPlan() {
    setUsePlan(true); setSourceId(null)
    if (!plan) return
    const facts = planFacts(plan, { includeColorLegend: true }) // debe coincidir con currentFacts, arriba
    // Ya compuesto con estos mismos hechos (p.ej. un re-clic sobre "El plano"
    // ya seleccionado): no dupliques. `startsWith` basta porque
    // `composeWithFacts` siempre pone los hechos al frente.
    if (!text.startsWith(facts)) setText(composeWithFacts(text, facts))
  }

  async function generate() {
    const viaPlan = usePlan && !!onGeneratePlan
    if ((!viaPlan && sourceId == null) || !text.trim()) return
    setBusy(true); setError(null)
    try {
      if (viaPlan) {
        // `selectedFloorId`/`selectedFloorName` viajan siempre que `plan` existe —
        // los dos nacen del mismo piso elegido en `LevantamientoPanel` (ver PlanProps).
        await onGeneratePlan!({
          promptId: effectivePromptId, promptText: text.trim(),
          floorId: selectedFloorId!, floorName: selectedFloorName!,
        })
      } else {
        await onGenerate!({ sourceImageId: sourceId!, promptId: effectivePromptId, promptText: text.trim() })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar el render')
    } finally { setBusy(false) }
  }

  async function handleUploadFile(f: File) {
    setUploading(true); setError(null)
    try {
      if (usePlan && onUploadPlan) {
        await onUploadPlan({ floorId: selectedFloorId!, floorName: selectedFloorName!, file: f })
      } else if (onUpload && sourceId != null) {
        await onUpload({ sourceImageId: sourceId, file: f })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo subir el render')
    } finally { setUploading(false) }
  }

  function onUploadInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) void handleUploadFile(f)
  }

  async function savePrompt() {
    if (!newName.trim() || !text.trim()) return
    setBusy(true); setError(null)
    try {
      await onSavePrompt({ name: newName.trim(), body: text.trim(), kind })
      setNaming(false); setNewName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el prompt')
    } finally { setBusy(false) }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: spacing.md,
                  display: 'flex', flexDirection: 'column', gap: spacing.md }}>

      {/* ── Fuente: una foto (modo fotos) o el plano de esta variante (modo plano) ──
          Nunca las dos a la vez: en 'photos' no existe el botón "El plano" —esa
          fuente se mudó al RendersPanel de cada levantamiento (Tarea 17)— y en
          'plan' no hay tira de fotos, porque un levantamiento no es dueño de
          ninguna. */}
      <div>
        <div style={label}>Fuente</div>
        <div style={{ display: 'flex', gap: spacing.sm, overflowX: 'auto', marginTop: spacing.sm }}>
          {source === 'photos' && images.map(img => (
            <button key={img.id} onClick={() => selectPhoto(img.id)} title={img.fileName}
              style={{
                padding: 0, background: 'none', cursor: 'pointer', flexShrink: 0,
                border: `2px solid ${!usePlan && sourceId === img.id ? colors.primary : colors.border}`,
                borderRadius: radius.sm, lineHeight: 0,
              }}>
              <img src={`${base}/files/${img.filePath}`} alt={img.fileName}
                   style={{ width: 84, height: 64, objectFit: 'cover', borderRadius: radius.sm }} />
            </button>
          ))}
          {source === 'plan' && plan && (
            <button onClick={selectPlan} title="Usar el plano de este levantamiento"
              style={{
                flexShrink: 0, width: 84, height: 64, cursor: 'pointer',
                border: `2px solid ${usePlan ? colors.primary : colors.border}`,
                borderRadius: radius.sm, background: colors.dark, color: colors.neutral,
                fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px', padding: '4px',
              }}>
              <span>El plano</span>
              {planRoomNames.length > 0 && (
                <span style={{ color: colors.secondary, letterSpacing: 0 }}>{planRoomNames.length} espacios</span>
              )}
            </button>
          )}
        </div>
        {source === 'photos' && images.length === 0 && (
          <p style={{ color: colors.secondary, fontSize: '13px', marginTop: spacing.sm }}>
            Sube una foto en GALERÍA para generar un render.
          </p>
        )}
        {source === 'plan' && !plan && (
          <p style={{ color: colors.secondary, fontSize: '13px', marginTop: spacing.sm }}>
            Dibuja el plano en PLANO para generar un render.
          </p>
        )}
      </div>

      {/* ── Biblioteca de prompts ── */}
      <div>
        <label htmlFor="render-preset" style={label}>Preset</label>
        <select id="render-preset" value={promptId ?? ''} onChange={e => choosePreset(e.target.value)}
          style={{
            display: 'block', width: '100%', marginTop: spacing.sm, padding: '8px',
            fontFamily: fonts.sans, fontSize: '13px', color: colors.neutral,
            background: colors.dark, border: `1px solid ${colors.border}`, borderRadius: radius.sm,
          }}>
          <option value="">— Escribir desde cero —</option>
          {visiblePrompts.map(p => (
            <option key={p.id} value={p.id}>{p.name}{p.isDefault ? '' : ' ·'}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="render-text" style={label}>Texto del prompt</label>
        <textarea id="render-text" value={text} onChange={e => setText(e.target.value)} rows={5}
          placeholder="Describe qué debe cambiar. La fidelidad estructural se agrega sola."
          style={{
            display: 'block', width: '100%', marginTop: spacing.sm, padding: '8px', resize: 'vertical',
            fontFamily: fonts.sans, fontSize: '13px', color: colors.neutral, lineHeight: 1.5,
            background: colors.dark, border: `1px solid ${colors.border}`, borderRadius: radius.sm,
          }} />
        <p style={{ ...label, marginTop: '6px', textTransform: 'none', letterSpacing: 0 }}>
          A todo prompt se le añade la instrucción de conservar la geometría del inmueble.
        </p>
        {/* El texto quedó describiendo el piso VIEJO porque el sync no pisa una
            edición manual (ver `replaceFacts`) — se avisa aquí, antes de generar,
            en vez de dejar que el usuario mande una imagen y un texto de dos
            pisos distintos sin saberlo. */}
        {textStale && (
          <p style={{ ...label, marginTop: '6px', letterSpacing: 0, textTransform: 'none', color: colors.tertiary }}>
            El texto no refleja el piso actual — revísalo antes de generar.
          </p>
        )}
      </div>

      {error && (
        <p style={{ color: colors.tertiary, fontSize: '12px' }}>{error}</p>
      )}

      {/* Un botón muerto sin explicación se lee como «no pasó nada». Elegir el
          preset es la acción obvia —es el control grande— pero la que habilita
          es elegir foto, y la tira de miniaturas no parece un paso obligatorio.
          Así que el botón dice qué le falta en vez de quedarse callado. */}
      {!usePlan && sourceId == null && (images.length > 0 || plan) && (
        <p style={{ ...label, letterSpacing: 0, textTransform: 'none', color: colors.tertiary }}>
          Elige una fuente arriba para generar.
        </p>
      )}

      {/* ── Acciones ── */}
      {naming ? (
        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="render-prompt-name" style={label}>Nombre del prompt</label>
            <input id="render-prompt-name" value={newName} onChange={e => setNewName(e.target.value)}
              style={{
                display: 'block', width: '100%', marginTop: spacing.sm, padding: '8px',
                fontFamily: fonts.sans, fontSize: '13px', color: colors.neutral,
                background: colors.dark, border: `1px solid ${colors.border}`, borderRadius: radius.sm,
              }} />
          </div>
          <button onClick={savePrompt} disabled={busy || !newName.trim()} style={btn(true)}>Guardar</button>
          <button onClick={() => setNaming(false)} style={btn(false)}>Cancelar</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <button onClick={() => setNaming(true)} disabled={!text.trim()} style={btn(false)}>
            Guardar como nuevo
          </button>
          <button onClick={generate} disabled={busy || uploading || (!usePlan && sourceId == null) || !text.trim()} style={btn(true)}>
            {busy ? 'GENERANDO…' : 'GENERAR RENDER'}
          </button>
          {(onUpload || onUploadPlan) && (
            <>
              <input ref={uploadInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                     onChange={onUploadInputChange} />
              <button onClick={() => uploadInputRef.current?.click()}
                      disabled={busy || uploading || (!usePlan && sourceId == null)} style={btn(false)}>
                {uploading ? 'SUBIENDO…' : 'SUBIR RENDER'}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Renders generados ── */}
      <div>
        <div style={label}>Renders ({heads.length})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, marginTop: spacing.sm }}>
          {/* La señal va DONDE el usuario está mirando. Antes lo único que
              cambiaba era la etiqueta del botón, y la lista se quedaba idéntica
              65 segundos: indistinguible de que el click no hubiera servido. */}
          {busy && (
            <div style={{ border: `1px dashed ${colors.border}`, borderRadius: radius.sm,
                          padding: spacing.lg, textAlign: 'center', background: colors.surface }}>
              <p style={{ ...label, color: colors.primary }}>Generando render…</p>
              <p style={{ ...label, letterSpacing: 0, textTransform: 'none', marginTop: '6px' }}>
                Puede tardar cerca de un minuto. No cierres la pestaña.
              </p>
            </div>
          )}
          {uploading && (
            <div style={{ border: `1px dashed ${colors.border}`, borderRadius: radius.sm,
                          padding: spacing.lg, textAlign: 'center', background: colors.surface }}>
              <p style={{ ...label, color: colors.primary }}>Subiendo render…</p>
            </div>
          )}
          <RenderCards heads={heads} renderById={renderById} photosById={photosById} base={base}
            onDeleteRender={onDeleteRender} onEdit={onEdit}
            onChoose={onChoose} onUnchoose={onUnchoose}
            onReuse={h => { setPromptId(h.promptId); setText(h.promptText) }} />
        </div>
      </div>

      {/* Renders de plano SIN piso identificado (Task 30): con 2+ pisos son
          ambiguos — a cuál piso pertenecen no se puede reconstruir — así que se
          enseñan SIEMPRE, en su propia sección, nunca escondidos ni mezclados en
          la lista de ningún piso concreto. Con 1 solo piso no hace falta esta
          sección: `scoped` ya los incluyó arriba porque ahí no hay ambigüedad. */}
      {source === 'plan' && floorCount >= 2 && (
        <div>
          <div style={label}>Sin piso identificado ({unassignedHeads.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, marginTop: spacing.sm }}>
            <RenderCards heads={unassignedHeads} renderById={unassignedById} photosById={photosById} base={base}
              onDeleteRender={onDeleteRender} onEdit={onEdit}
              onChoose={onChoose} onUnchoose={onUnchoose}
              onReuse={h => { setPromptId(h.promptId); setText(h.promptText) }} />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * De una lista de renders, separa las CABEZAS (los que nadie editó encima) de un
 * índice por id — el mismo cálculo hacía falta dos veces desde Task 30 (la
 * sección por piso y "Sin piso identificado"), así que se saca de la función del
 * componente en vez de repetirlo. Pura: sin hooks, para poder envolverla en
 * `useMemo` en cada sitio que la usa.
 */
function computeHeads(list: PropertyRender[]): { byId: Map<number, PropertyRender>; heads: PropertyRender[] } {
  const byId = new Map(list.map(r => [r.id, r]))
  const parents = new Set(list.map(r => r.parentRenderId).filter((x): x is number => x != null))
  return { byId, heads: list.filter(r => !parents.has(r.id)) }
}

/** El historial de UN render, caminando `parentRenderId` hacia atrás dentro del
 * índice `byId` que le corresponda — nunca cruza de la sección de un piso a la
 * de otro, porque una edición hereda el piso de su padre (Task 29). */
function ancestryIn(byId: Map<number, PropertyRender>) {
  return (r: PropertyRender): PropertyRender[] => {
    const chain: PropertyRender[] = []
    let cur = r.parentRenderId != null ? byId.get(r.parentRenderId) : undefined
    while (cur) { chain.push(cur); cur = cur.parentRenderId != null ? byId.get(cur.parentRenderId) : undefined }
    return chain  // el paso inmediato anterior primero
  }
}

/** Las tarjetas de una sección de renders (un piso, o "Sin piso identificado") —
 * misma pinta en las dos, así que es un componente y no dos copias del `.map`. */
function RenderCards({ heads, renderById, photosById, base, onDeleteRender, onReuse, onEdit, onChoose, onUnchoose }: {
  heads: PropertyRender[]
  renderById: Map<number, PropertyRender>
  photosById: Map<number, PropertyImage>
  base: string
  onDeleteRender: (renderId: number) => Promise<void>
  onReuse: (r: PropertyRender) => void
  onEdit?: (renderId: number, promptText: string) => Promise<PropertyRender>
  onChoose: (renderId: number) => Promise<void>
  onUnchoose: (renderId: number) => Promise<void>
}) {
  const ancestry = ancestryIn(renderById)
  return (
    <>
      {heads.map(h => (
        <RenderCard key={h.id} render={h}
                    parent={h.parentRenderId != null ? renderById.get(h.parentRenderId) ?? null : null}
                    source={photosById.get(h.sourceImageId ?? -1) ?? null}
                    history={ancestry(h)}
                    base={base} onDelete={() => onDeleteRender(h.id)}
                    onReuse={() => onReuse(h)}
                    onChoose={() => onChoose(h.id)}
                    onUnchoose={() => onUnchoose(h.id)}
                    onEdit={onEdit ? (promptText: string) => onEdit(h.id, promptText).then(() => {}) : undefined} />
      ))}
    </>
  )
}

/**
 * Un render con todo lo que hace falta para juzgarlo, en este orden: qué prompt
 * lo produjo, cuándo, y contra qué foto.
 *
 * El orden no es estético. La versión anterior ponía el prompt DEBAJO de una
 * imagen de 520 px —es decir, fuera de pantalla— y el render quedaba huérfano de
 * lo único que explica de dónde salió. Y el par foto→propuesta es el argumento
 * mismo: una propuesta sin su antes no dice nada.
 */
function RenderCard({ render, source, parent, history, base, onDelete, onReuse, onEdit, onChoose, onUnchoose }: {
  render: PropertyRender
  source: PropertyImage | null
  parent: PropertyRender | null
  history: PropertyRender[]
  base: string
  onDelete: () => void
  onReuse: () => void
  onEdit?: (promptText: string) => Promise<void>
  onChoose: () => Promise<void>
  onUnchoose: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const edited = render.parentRenderId != null
  const plano = render.sourcePlanPath != null
  // La "base" que se muestra al lado: el paso anterior si es una edición; si no,
  // el plano o la foto de la que nació.
  const baseUrl = edited && parent ? `${base}/files/${parent.filePath}`
    : plano ? `${base}/files/${render.sourcePlanPath}`
    : source ? `${base}/files/${source.filePath}`
    : null
  const baseLabel = edited ? 'Paso anterior' : plano ? 'Plano base' : 'Foto base'
  const showBase = baseUrl != null

  async function runEdit() {
    if (!onEdit || !editText.trim()) return
    setEditBusy(true); setEditError(null)
    try {
      await onEdit(editText.trim())
      setEditing(false); setEditText('')
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'No se pudo generar el cambio')
    } finally { setEditBusy(false) }
  }

  return (
    <figure style={{ border: `1px solid ${colors.border}`, borderRadius: radius.sm,
                     overflow: 'hidden', background: colors.surface }}>
      <figcaption style={{ padding: spacing.sm, display: 'flex', flexDirection: 'column',
                           gap: '6px', borderBottom: `1px solid ${colors.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
          <span style={{ ...label, color: colors.dark, background: colors.accent1,
                         padding: '4px 8px', borderRadius: radius.sm }}>
            Propuesta · no es una foto
          </span>
          <span style={{ ...label, letterSpacing: 0, textTransform: 'none' }}>
            {fmtDia(render.createdAt)} · {render.model}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: spacing.sm }}>
            {/* Sin piso ni foto no hay grupo al cual pertenecer: el servidor no
                sabría a quién apagar, así que no se ofrece la estrella. */}
            {(render.floorId != null || render.sourceImageId != null) && (
              <button
                onClick={() => (render.isChosen ? onUnchoose() : onChoose())}
                style={linkBtn}
                aria-label={render.isChosen ? 'Quitar como elegido' : 'Elegir este render'}
              >
                {render.isChosen ? '★' : '☆'}
              </button>
            )}
            {onEdit && (
              <button onClick={() => setEditing(v => !v)} style={linkBtn}>Trabajar sobre este</button>
            )}
            <button onClick={onReuse} style={linkBtn}>Reusar prompt</button>
            <button onClick={onDelete} style={linkBtn}>Borrar</button>
          </span>
        </div>
        {/* El prompt, arriba y completo: es la receta del render. */}
        <p style={{ fontSize: '12px', color: colors.secondary, lineHeight: 1.5 }}>
          {render.promptText}
        </p>
      </figcaption>

      <div style={{ display: 'grid', gridTemplateColumns: showBase ? '1fr 1fr' : '1fr' }}>
        {showBase && (
          <div style={{ position: 'relative', borderRight: `1px solid ${colors.border}` }}>
            <span style={{ ...label, position: 'absolute', top: spacing.sm, left: spacing.sm,
                           color: colors.dark, background: colors.secondary,
                           padding: '3px 6px', borderRadius: radius.sm }}>
              {baseLabel}
            </span>
            <img src={baseUrl!} alt={`${baseLabel} del render ${render.id}`}
                 style={{ width: '100%', maxHeight: 420, objectFit: 'contain', display: 'block' }} />
          </div>
        )}
        {/* `contain`, no `cover`: recortar un render para que quepa esconde justo
            lo que se está revisando. */}
        <img src={`${base}/files/${render.filePath}`} alt={`Render ${render.id}`}
             style={{ width: '100%', maxHeight: 420, objectFit: 'contain', display: 'block' }} />
      </div>

      {/* Trabajar sobre este: instrucción chica, sobre esta misma imagen. */}
      {editing && onEdit && (
        <div style={{ padding: spacing.sm, borderTop: `1px solid ${colors.border}`,
                      display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={2}
            placeholder="Solo el cambio: «el baño no tiene puerta, agrégale una»."
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px', resize: 'vertical',
                     fontFamily: fonts.sans, fontSize: '13px', color: colors.neutral, lineHeight: 1.5,
                     background: colors.dark, border: `1px solid ${colors.border}`, borderRadius: radius.sm }} />
          {editError && <p style={{ color: colors.tertiary, fontSize: '12px' }}>{editError}</p>}
          <div style={{ display: 'flex', gap: spacing.sm }}>
            <button onClick={runEdit} disabled={editBusy || !editText.trim()} style={btn(true)}>
              {editBusy ? 'GENERANDO…' : 'GENERAR CAMBIO'}
            </button>
            <button onClick={() => { setEditing(false); setEditText('') }} style={btn(false)}>Cancelar</button>
          </div>
          {editBusy && (
            <p style={{ ...label, letterSpacing: 0, textTransform: 'none' }}>
              Genera sobre esta imagen. Puede tardar cerca de un minuto.
            </p>
          )}
        </div>
      )}

      {/* Historial: los pasos previos de esta misma imagen, colapsados. */}
      {history.length > 0 && (
        <div style={{ borderTop: `1px solid ${colors.border}` }}>
          <button onClick={() => setShowHistory(v => !v)} style={{ ...linkBtn, padding: spacing.sm }}>
            {showHistory ? '▾' : '▸'} Historial ({history.length} {history.length === 1 ? 'paso' : 'pasos'})
          </button>
          {showHistory && (
            <div style={{ padding: spacing.sm, paddingTop: 0, display: 'flex',
                          flexDirection: 'column', gap: spacing.sm }}>
              {history.map(h => (
                <div key={h.id} style={{ display: 'flex', gap: spacing.sm, alignItems: 'center' }}>
                  <img src={`${base}/files/${h.filePath}`} alt={`Paso ${h.id}`}
                       style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: radius.sm, flexShrink: 0 }} />
                  <p style={{ fontSize: '11px', color: colors.secondary, lineHeight: 1.4 }}>{h.promptText}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!showBase && (
        // Nació de una foto que se borró: se dice en voz alta. Callarlo haría
        // parecer que el render nació sin origen, que es distinto a haberlo perdido.
        <p style={{ ...label, letterSpacing: 0, textTransform: 'none', padding: spacing.sm,
                    borderTop: `1px solid ${colors.border}` }}>
          Fuente base borrada — el render se conserva, la liga no.
        </p>
      )}
    </figure>
  )
}

const linkBtn: React.CSSProperties = {
  fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase',
  background: 'none', border: 'none', cursor: 'pointer', color: colors.secondary, padding: 0,
}

function btn(primary: boolean): React.CSSProperties {
  return {
    fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase',
    padding: '10px 16px', cursor: 'pointer', borderRadius: radius.sm,
    border: `1px solid ${primary ? colors.primary : colors.border}`,
    background: primary ? colors.primary : 'transparent',
    color: primary ? colors.dark : colors.secondary,
  }
}
