import { useCallback, useState } from 'react'
import type React from 'react'
import { colors, fonts } from '../lib/theme'
import FloorPlanEditor, { type PlanApi } from './FloorPlanEditor'
import { RendersPanel } from './detail/RendersPanel'
import { floorToPngBlob } from '../lib/floorplan/planImage'
import { clone, emptyFloorSet, type FloorPlanModel, type FloorSet, type VariantKey } from '../lib/floorplan/types'
import type { PropertyRender, RenderPrompt, RenderPromptKind } from '../lib/types'

const btnBase: React.CSSProperties = {
  cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px',
  letterSpacing: '0.1em', flexShrink: 0, padding: '5px 12px',
}
const outlined: React.CSSProperties = { ...btnBase, background: 'none', border: `1px solid ${colors.border}`, color: colors.secondary }
const outlinedPrimary: React.CSSProperties = { ...btnBase, background: 'none', border: `1px solid ${colors.primary}`, color: colors.primary }
const danger: React.CSSProperties = { ...btnBase, background: '#c0392b', border: 'none', color: '#fff', padding: '6px 16px' }
const label: React.CSSProperties = { fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em', color: colors.secondary }

interface Props {
  variant: VariantKey
  geometry: FloorPlanModel | null
  /** Guardar UNA variante; la ficha compone el envelope y preserva la otra. */
  onSave: (variant: VariantKey, fs: FloorSet) => void | Promise<void>
  onUploadImage: (file: File) => Promise<{ imageKey: string }>
  /** Con la variante: el GUARDAR de la página guarda por el editor vivo y
   * necesita saber a cuál de los dos levantamientos pertenece. */
  onReady?: (variant: VariantKey, api: PlanApi) => void
  onDirtyChange?: (dirty: boolean) => void
  /** Para resolver rutas de archivo (`${base}/files/...`) en RENDERS — igual que
   * en FotosPanel. */
  base: string
  prompts: RenderPrompt[]
  /** La lista COMPLETA, sin filtrar: `RendersPanel` la recorta a la variante de
   * ESTE panel por dentro (`sourceVariant === variant`), igual que FOTOS la
   * recorta a `sourceVariant == null`. Un solo filtro, un solo lugar. */
  renders: PropertyRender[]
  /** Generar desde el plano de ESTA variante. Este panel resuelve el piso activo →
   * PNG (`floorToPngBlob`) y manda la variante; quien llama (la ficha) conoce el
   * id de la propiedad y hace la llamada real a `generatePropertyRenderFromPlan` —
   * la misma separación de responsabilidades que ya tiene `onSave`. */
  onGenerateRender: (variant: VariantKey, req: { promptId: number | null; promptText: string; plan: Blob })
    => Promise<PropertyRender>
  onEdit?: (renderId: number, promptText: string) => Promise<PropertyRender>
  onSavePrompt: (p: { name: string; body: string; kind: RenderPromptKind }) => Promise<RenderPrompt>
  onDeleteRender: (renderId: number) => Promise<void>
}

type SubTab = 'plano' | 'renders'
const SUB_TABS: readonly [SubTab, string][] = [['plano', 'PLANO'], ['renders', 'RENDERS']]

/**
 * El contenedor de UN levantamiento. El ORIGINAL es solo el editor: es la medición
 * de cómo está la propiedad y no nace de nadie. El PLANEADO es una propuesta que
 * nace clonando el original (o en blanco) y de ahí diverge — por eso solo este
 * panel tiene acciones de clonación, y re-clonar pide confirmación de dos pasos
 * (el patrón del ELIMINAR en DetailHeader, nunca window.confirm): descarta un
 * planeado en el que alguien ya trabajó.
 *
 * Clonar PERSISTE de inmediato, a diferencia de dibujar (que pasa por Save/GUARDAR):
 * las dos acciones del empty state y el re-partir son operaciones sobre el envelope
 * —crear o reemplazar la variante— no ediciones dentro de ella, y dejarlas en
 * memoria haría que "descarta el planeado actual" fuera mentira hasta un guardado
 * que nada garantiza.
 */
/** CUÁL escritura del planeado corre: con un booleano compartido, el "CLONANDO…"
 * de una acción aterrizaba en el botón de la vecina. */
type PendingWrite = 'partir' | 'blanco' | 'repartir'

export function LevantamientoPanel({
  variant, geometry, onSave, onUploadImage, onReady, onDirtyChange,
  base, prompts, renders, onGenerateRender, onEdit, onSavePrompt, onDeleteRender,
}: Props) {
  const [confirmReclone, setConfirmReclone] = useState(false)
  const [pending, setPending] = useState<PendingWrite | null>(null)
  const [error, setError] = useState<string | null>(null)
  // El reducer del editor captura `initial` al montar y lo ignora después: cada
  // clonación bumpea esta generación para remontarlo con el planeado recién escrito.
  const [generation, setGeneration] = useState(0)
  const [tab, setTab] = useState<SubTab>('plano')

  const original = geometry?.variants.original ?? null
  const fs = variant === 'original' ? original : geometry?.variants.planned ?? null
  // Clonar un original sin pisos no produce nada editable: la acción ni se ofrece.
  const originalHasFloors = original != null && original.floors.length > 0
  // El piso activo de ESTE FloorSet: lo que RENDERS siembra y exporta a PNG. `fs`
  // es null en el empty-state del planeado (RENDERS ni se ofrece, ver abajo) y en
  // un original que nunca se guardó — en ese caso `activeFloor` sale null y
  // `RendersPanel` ya sabe decir "dibuja el plano primero" en vez de tronar.
  const activeFloor = fs?.floors[fs.activeFloor] ?? null

  const handleReady = useCallback((api: PlanApi) => onReady?.(variant, api), [onReady, variant])
  const handleSave = useCallback((set: FloorSet) => onSave(variant, set), [onSave, variant])
  // La exportación a PNG (`floorToPngBlob`, solo corre en el navegador) vive aquí
  // porque este panel es quien sabe cuál es el piso activo de SU variante; la
  // llamada real a `generatePropertyRenderFromPlan` vive en la ficha, que es
  // quien conoce el id de la propiedad — misma separación que ya tiene `onSave`.
  const handleGeneratePlan = useCallback(async (req: { promptId: number | null; promptText: string }) => {
    const blob = await floorToPngBlob(activeFloor!)
    return onGenerateRender(variant, { ...req, plan: blob })
  }, [activeFloor, variant, onGenerateRender])

  // Escribe el planeado ENTERO de un golpe: un clon del original o una planta en
  // blanco. Es la única escritura que no pasa por el editor.
  async function writePlanned(source: FloorSet, action: PendingWrite) {
    setPending(action)
    setError(null)
    try {
      // clone() copia `id` tal cual: un piso planeado que nace de PARTIR/RE-PARTIR
      // comparte el MISMO id de piso que su contraparte en el original. A propósito, no
      // un descuido — la unicidad de FloorGraph.id (Task 28) solo exige no repetirse
      // DENTRO de un FloorSet; original y planned son arreglos separados, así que no hay
      // colisión. Y es una propiedad útil: da linaje gratis ("este piso planeado viene de
      // este piso original exacto"), igual que parent_render_id/prompt_id ya rastrean
      // linaje en otras partes de este código. Quien filtre renders por piso más adelante
      // SIEMPRE debe combinar floor_id con source_variant — nunca floor_id solo — para no
      // mezclar el original y el planeado de un mismo piso. No "arreglar" esto dándole un
      // id nuevo al clon sin revisar antes ese filtro.
      await onSave('planned', clone(source))
      setGeneration(g => g + 1)
      setConfirmReclone(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo escribir el planeado')
    } finally {
      setPending(null)
    }
  }
  const busy = pending != null

  if (variant === 'planned' && fs == null) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: '12px', background: colors.dark, padding: '32px' }}>
        <div style={label}>SIN LEVANTAMIENTO PLANEADO</div>
        <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary, textAlign: 'center', maxWidth: '360px' }}>
          El planeado es cómo va a quedar la propiedad. Nace clonando el original
          y de ahí divergen, o se dibuja desde cero.
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {originalHasFloors && (
            <button onClick={() => writePlanned(original!, 'partir')} disabled={busy} style={{ ...outlinedPrimary, opacity: busy ? 0.6 : 1 }}>
              {pending === 'partir' ? 'CLONANDO…' : 'PARTIR DEL ORIGINAL'}
            </button>
          )}
          <button onClick={() => writePlanned(emptyFloorSet(), 'blanco')} disabled={busy} style={{ ...outlined, opacity: busy ? 0.6 : 1 }}>
            {pending === 'blanco' ? 'CREANDO…' : 'EMPEZAR EN BLANCO'}
          </button>
        </div>
        {error && <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.tertiary }}>{error}</div>}
      </div>
    )
  }

  const editor = (
    <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <FloorPlanEditor
        key={generation}
        initial={fs}
        onSave={handleSave}
        onUploadImage={onUploadImage}
        onReady={handleReady}
        onDirtyChange={onDirtyChange}
      />
    </div>
  )

  // PLANO: el contenido de siempre para esta variante — íntegro, sin cambios.
  // Para el planeado eso INCLUYE la barra de re-partir; para el original es
  // solo el editor, como ya era antes de esta sub-navegación.
  const planoContent = variant === 'original' ? editor : (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, display: 'flex', gap: '8px', alignItems: 'center',
        padding: '6px 16px', borderBottom: `1px solid ${colors.border}` }}>
        <span style={label}>PROPUESTA SOBRE EL ORIGINAL</span>
        <div style={{ flex: 1 }} />
        {error && <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.tertiary }}>{error}</span>}
        {originalHasFloors && (confirmReclone ? (
          <>
            <span style={label}>SE DESCARTA EL PLANEADO ACTUAL</span>
            {/* Desactivado en vuelo: la escritura ya se despachó y no se puede
                detener — un CANCELAR clicable escondería la confirmación
                mientras el planeado igual se reemplaza. */}
            <button onClick={() => setConfirmReclone(false)} disabled={busy}
              style={{ ...outlined, opacity: busy ? 0.6 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}>
              CANCELAR
            </button>
            <button onClick={() => writePlanned(original!, 'repartir')} disabled={busy}
              style={{ ...danger, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}>
              {pending === 'repartir' ? 'CLONANDO…' : '¿CONFIRMAR RE-PARTIR?'}
            </button>
          </>
        ) : (
          <button onClick={() => setConfirmReclone(true)} style={outlined}>RE-PARTIR DEL ORIGINAL</button>
        ))}
      </div>
      {editor}
    </div>
  )

  // RENDERS: propuestas nacidas del plano de ESTA variante, nunca del ajeno —
  // `RendersPanel` filtra por `variant` internamente (`sourceVariant === variant`).
  const rendersContent = (
    <RendersPanel source="plan" variant={variant} plan={activeFloor} base={base}
      prompts={prompts} renders={renders} onGeneratePlan={handleGeneratePlan}
      onEdit={onEdit} onSavePrompt={onSavePrompt} onDeleteRender={onDeleteRender} />
  )

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Mismo convenio visual que GALERÍA | RENDERS en FotosPanel (Tarea 16):
          misma tira de botones, mismo tono — es el mismo gesto, elegir qué ver
          DENTRO de esta sección, no saltar a otra pestaña de nivel superior. */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                    padding: '4px 8px', borderBottom: `1px solid ${colors.border}` }}>
        {SUB_TABS.map(([key, text], idx) => (
          <button key={key} onClick={() => setTab(key)} style={{
            fontFamily: fonts.label, fontSize: '7px', letterSpacing: '0.1em',
            padding: '3px 9px',
            border: `1px solid ${colors.border}`, marginLeft: idx === 0 ? 0 : '-1px',
            background: tab === key ? colors.surfaceAlt : 'transparent',
            color: tab === key ? colors.neutral : colors.secondary, cursor: 'pointer',
          }}>
            {text}
          </button>
        ))}
      </div>
      {tab === 'plano' ? planoContent : rendersContent}
    </div>
  )
}
