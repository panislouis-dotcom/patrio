import { useMemo, useState } from 'react'
import { colors, fonts, radius, spacing } from '../../lib/theme'
import { fmtDia } from '../../lib/fmt'
import type { PropertyImage, PropertyRender, RenderPrompt } from '../../lib/types'

interface Props {
  images: PropertyImage[]
  prompts: RenderPrompt[]
  renders: PropertyRender[]
  base: string
  onGenerate: (req: { sourceImageId: number; promptId: number | null; promptText: string })
    => Promise<PropertyRender>
  onSavePrompt: (p: { name: string; body: string }) => Promise<RenderPrompt>
  onDeleteRender: (renderId: number) => Promise<void>
}

const label: React.CSSProperties = {
  fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em',
  color: colors.secondary, textTransform: 'uppercase',
}

/**
 * La pestaña RENDERS: eliges una foto, eliges (o escribes) un prompt, y sale
 * una propuesta.
 *
 * Todo render que se muestre lleva encima la palabra PROPUESTA y el prompt con
 * el que se hizo. No es decoración: el modelo de datos separa foto de render
 * para que nadie confunda evidencia con proyecto, y esta pantalla es donde esa
 * garantía se vuelve visible para quien la está mirando.
 */
export function RendersPanel({
  images, prompts, renders, base, onGenerate, onSavePrompt, onDeleteRender,
}: Props) {
  const [sourceId, setSourceId] = useState<number | null>(null)
  const [promptId, setPromptId] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [naming, setNaming] = useState(false)
  const [newName, setNewName] = useState('')

  // Índice para colgarle a cada render su foto base sin recorrer la lista por render.
  const byId = useMemo(() => new Map(images.map(i => [i.id, i])), [images])

  const selectedPrompt = prompts.find(p => p.id === promptId) ?? null
  // Si el texto ya no es el del preset, el render no salió de ese preset.
  // Mandar el id de todos modos haría que el render mintiera sobre su origen.
  const effectivePromptId =
    selectedPrompt && selectedPrompt.body.trim() === text.trim() ? selectedPrompt.id : null

  function choosePreset(value: string) {
    const p = prompts.find(x => String(x.id) === value) ?? null
    setPromptId(p?.id ?? null)
    setText(p?.body ?? '')
  }

  async function generate() {
    if (sourceId == null || !text.trim()) return
    setBusy(true); setError(null)
    try {
      await onGenerate({ sourceImageId: sourceId, promptId: effectivePromptId, promptText: text.trim() })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar el render')
    } finally { setBusy(false) }
  }

  async function savePrompt() {
    if (!newName.trim() || !text.trim()) return
    setBusy(true); setError(null)
    try {
      await onSavePrompt({ name: newName.trim(), body: text.trim() })
      setNaming(false); setNewName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el prompt')
    } finally { setBusy(false) }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: spacing.md,
                  display: 'flex', flexDirection: 'column', gap: spacing.md }}>

      {/* ── Foto fuente ── */}
      <div>
        <div style={label}>Foto base</div>
        {images.length === 0 ? (
          <p style={{ color: colors.secondary, fontSize: '13px', marginTop: spacing.sm }}>
            Sube una foto en la pestaña FOTOS para poder generar un render.
          </p>
        ) : (
          <div style={{ display: 'flex', gap: spacing.sm, overflowX: 'auto', marginTop: spacing.sm }}>
            {images.map(img => (
              <button key={img.id} onClick={() => setSourceId(img.id)} title={img.fileName}
                style={{
                  padding: 0, background: 'none', cursor: 'pointer', flexShrink: 0,
                  border: `2px solid ${sourceId === img.id ? colors.primary : colors.border}`,
                  borderRadius: radius.sm, lineHeight: 0,
                }}>
                <img src={`${base}/files/${img.filePath}`} alt={img.fileName}
                     style={{ width: 84, height: 64, objectFit: 'cover', borderRadius: radius.sm }} />
              </button>
            ))}
          </div>
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
          {prompts.map(p => (
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
          <button onClick={generate} disabled={busy || sourceId == null || !text.trim()} style={btn(true)}>
            {busy ? 'GENERANDO…' : 'GENERAR RENDER'}
          </button>
        </div>
      )}

      {/* ── Renders generados ── */}
      <div>
        <div style={label}>Renders ({renders.length})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, marginTop: spacing.sm }}>
          {renders.map(r => (
            <RenderCard key={r.id} render={r} source={byId.get(r.sourceImageId ?? -1) ?? null}
                        base={base} onDelete={() => onDeleteRender(r.id)}
                        onReuse={() => { setPromptId(r.promptId); setText(r.promptText) }} />
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
function RenderCard({ render, source, base, onDelete, onReuse }: {
  render: PropertyRender
  source: PropertyImage | null
  base: string
  onDelete: () => void
  onReuse: () => void
}) {
  const huerfano = render.sourceImageId == null

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
            <button onClick={onReuse} style={linkBtn}>Reusar prompt</button>
            <button onClick={onDelete} style={linkBtn}>Borrar</button>
          </span>
        </div>
        {/* El prompt, arriba y completo: es la receta del render. */}
        <p style={{ fontSize: '12px', color: colors.secondary, lineHeight: 1.5 }}>
          {render.promptText}
        </p>
      </figcaption>

      <div style={{ display: 'grid', gridTemplateColumns: huerfano ? '1fr' : '1fr 1fr' }}>
        {huerfano ? null : (
          <div style={{ position: 'relative', borderRight: `1px solid ${colors.border}` }}>
            <span style={{ ...label, position: 'absolute', top: spacing.sm, left: spacing.sm,
                           color: colors.dark, background: colors.secondary,
                           padding: '3px 6px', borderRadius: radius.sm }}>
              Foto base
            </span>
            <img src={`${base}/files/${source!.filePath}`}
                 alt={`Foto base del render ${render.id}`}
                 style={{ width: '100%', maxHeight: 420, objectFit: 'contain', display: 'block' }} />
          </div>
        )}
        {/* `contain`, no `cover`: recortar un render para que quepa esconde justo
            lo que se está revisando. */}
        <img src={`${base}/files/${render.filePath}`} alt={`Render ${render.id}`}
             style={{ width: '100%', maxHeight: 420, objectFit: 'contain', display: 'block' }} />
      </div>

      {huerfano && (
        // El caso ON DELETE SET NULL, dicho en voz alta. Callarlo haría parecer
        // que el render nació sin origen, que es distinto a haberlo perdido.
        <p style={{ ...label, letterSpacing: 0, textTransform: 'none', padding: spacing.sm,
                    borderTop: `1px solid ${colors.border}` }}>
          Foto base borrada — el render se conserva, la liga no.
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
