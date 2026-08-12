import { useMemo, useState } from 'react'
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
}

/** FOTOS (Tarea 16): la fuente es una foto real de la propiedad — flujo actual. */
interface PhotosProps extends CommonProps {
  source: 'photos'
  images: PropertyImage[]
  onGenerate: (req: { sourceImageId: number; promptId: number | null; promptText: string })
    => Promise<PropertyRender>
  plan?: never
  variant?: never
  onGeneratePlan?: never
}

/** Cada levantamiento (Tarea 17): la fuente es SU plano, nunca el ajeno. `variant`
 * y `plan` son OBLIGATORIOS aquí — antes los dos eran opcionales y un caller podía
 * mandar `source: 'plan'` sin `variant`; `scoped` (más abajo) filtraba entonces
 * contra `undefined`, la lista salía silenciosamente vacía y nada avisaba del
 * error. Ahora ese caso ni compila. */
interface PlanProps extends CommonProps {
  source: 'plan'
  variant: VariantKey
  plan: FloorGraph | null
  onGeneratePlan: (req: { promptId: number | null; promptText: string }) => Promise<PropertyRender>
  images?: never
  onGenerate?: never
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
  const { source, prompts, renders, base, onEdit, onSavePrompt, onDeleteRender } = props
  // Narrowed a mano y no por destructuring directo: una vez que `plan`/`variant`/
  // `onGenerate*` salen del objeto `props` pierden la liga con `source` — el
  // discriminante — y TS ya no puede probar que están presentes en su rama. Leerlos
  // vía `props.source === …` conserva esa liga; el resto de la función no cambia.
  const images = props.source === 'photos' ? props.images : []
  const plan = props.source === 'plan' ? props.plan : null
  const variant = props.source === 'plan' ? props.variant : undefined
  const onGenerate = props.source === 'photos' ? props.onGenerate : undefined
  const onGeneratePlan = props.source === 'plan' ? props.onGeneratePlan : undefined

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

  // Índice para colgarle a cada render su foto base sin recorrer la lista por render.
  const byId = useMemo(() => new Map(images.map(i => [i.id, i])), [images])

  // Nombres de cuarto del plano, solo para el badge "N espacios" del botón de fuente.
  const planRoomNames = useMemo(
    () => (plan ? roomLabels(plan).map(r => r.name).filter(Boolean) : []),
    [plan],
  )

  // El equivalente en el frontend de `chain_is_plan` (backend): una edición hereda
  // `sourceVariant` de su padre inmediato, así que TODO nodo de una cadena (raíz y
  // ediciones) trae la misma marca — filtrar por nodo basta, no hace falta caminar
  // la cadena hasta la raíz. Fotos: NULL. Plano: la variante que lo generó.
  const scoped = useMemo(
    () => renders.filter(r => (source === 'photos' ? r.sourceVariant == null : r.sourceVariant === variant)),
    [renders, source, variant],
  )

  // Cadenas de edición: la lista muestra solo las CABEZAS (los renders que nadie
  // editó encima); el historial de cada una se camina hacia atrás por parentRenderId.
  const renderById = useMemo(() => new Map(scoped.map(r => [r.id, r])), [scoped])
  const heads = useMemo(() => {
    const parents = new Set(scoped.map(r => r.parentRenderId).filter((x): x is number => x != null))
    return scoped.filter(r => !parents.has(r.id))
  }, [scoped])
  const ancestry = (r: PropertyRender): PropertyRender[] => {
    const chain: PropertyRender[] = []
    let cur = r.parentRenderId != null ? renderById.get(r.parentRenderId) : undefined
    while (cur) { chain.push(cur); cur = cur.parentRenderId != null ? renderById.get(cur.parentRenderId) : undefined }
    return chain  // el paso inmediato anterior primero
  }

  const selectedPrompt = visiblePrompts.find(p => p.id === promptId) ?? null
  // Si el texto ya no es el del preset, el render no salió de ese preset.
  // Mandar el id de todos modos haría que el render mintiera sobre su origen.
  const effectivePromptId =
    selectedPrompt && selectedPrompt.body.trim() === text.trim() ? selectedPrompt.id : null

  function choosePreset(value: string) {
    const p = visiblePrompts.find(x => String(x.id) === value) ?? null
    setPromptId(p?.id ?? null)
    setText(p?.body ?? '')
  }

  function selectPhoto(id: number) { setSourceId(id); setUsePlan(false) }
  function selectPlan() {
    setUsePlan(true); setSourceId(null)
    if (!text.trim() && plan) setText(planFacts(plan))
  }

  async function generate() {
    const viaPlan = usePlan && !!onGeneratePlan
    if ((!viaPlan && sourceId == null) || !text.trim()) return
    setBusy(true); setError(null)
    try {
      if (viaPlan) await onGeneratePlan!({ promptId: effectivePromptId, promptText: text.trim() })
      else await onGenerate!({ sourceImageId: sourceId!, promptId: effectivePromptId, promptText: text.trim() })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar el render')
    } finally { setBusy(false) }
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
          <button onClick={generate} disabled={busy || (!usePlan && sourceId == null) || !text.trim()} style={btn(true)}>
            {busy ? 'GENERANDO…' : 'GENERAR RENDER'}
          </button>
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
          {heads.map(h => (
            <RenderCard key={h.id} render={h}
                        parent={h.parentRenderId != null ? renderById.get(h.parentRenderId) ?? null : null}
                        source={byId.get(h.sourceImageId ?? -1) ?? null}
                        history={ancestry(h)}
                        base={base} onDelete={() => onDeleteRender(h.id)}
                        onReuse={() => { setPromptId(h.promptId); setText(h.promptText) }}
                        onEdit={onEdit ? (promptText: string) => onEdit(h.id, promptText).then(() => {}) : undefined} />
          ))}
        </div>
      </div>
    </div>
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
function RenderCard({ render, source, parent, history, base, onDelete, onReuse, onEdit }: {
  render: PropertyRender
  source: PropertyImage | null
  parent: PropertyRender | null
  history: PropertyRender[]
  base: string
  onDelete: () => void
  onReuse: () => void
  onEdit?: (promptText: string) => Promise<void>
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
