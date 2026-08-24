import { useCallback, useEffect, useState } from 'react'
import type React from 'react'
import { colors, fonts } from '../lib/theme'
import FloorPlanEditor, { type PlanApi } from './FloorPlanEditor'
import { btn as floorBtn } from './floorplanStyles'
import { RendersPanel } from './detail/RendersPanel'
import { floorToPngBlob } from '../lib/floorplan/planImage'
import { planFacts } from '../lib/floorplan/planFacts'
import { generateAllFloors, formatBatchSummary, type FloorBatchSummary } from '../lib/floorplan/generateAllFloors'
import { clone, emptyFloorSet, getPlan, type FloorGraph, type FloorPlanModel, type FloorSet, type VariantKey } from '../lib/floorplan/types'
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
  /** Generar desde el plano de ESTA variante, con el PISO que RENDERS tiene
   * seleccionado — no necesariamente el piso activo de PLANO (Task 30: RENDERS
   * tiene su propio selector, independiente de la navegación del editor). Este
   * panel resuelve ese piso → PNG (`floorToPngBlob`) y manda la variante; quien
   * llama (la ficha) conoce el id de la propiedad y hace la llamada real a
   * `generatePropertyRenderFromPlan` — la misma separación de responsabilidades
   * que ya tiene `onSave`. */
  onGenerateRender: (variant: VariantKey, req: {
    promptId: number | null; promptText: string; plan: Blob; floorId: string; floorName: string
  }) => Promise<PropertyRender>
  onUploadRender?: (variant: VariantKey, req: { floorId: string; floorName: string; file: File })
    => Promise<PropertyRender>
  onEdit?: (renderId: number, promptText: string) => Promise<PropertyRender>
  onSavePrompt: (p: { name: string; body: string; kind: RenderPromptKind }) => Promise<RenderPrompt>
  onDeleteRender: (renderId: number) => Promise<void>
  onChoose: (renderId: number) => Promise<void>
  onUnchoose: (renderId: number) => Promise<void>
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
  base, prompts, renders, onGenerateRender, onUploadRender, onEdit, onSavePrompt, onDeleteRender,
  onChoose, onUnchoose,
}: Props) {
  const [confirmReclone, setConfirmReclone] = useState(false)
  const [pending, setPending] = useState<PendingWrite | null>(null)
  const [error, setError] = useState<string | null>(null)
  // El reducer del editor captura `initial` al montar y lo ignora después: cada
  // clonación bumpea esta generación para remontarlo con el planeado recién escrito.
  const [generation, setGeneration] = useState(0)
  const [tab, setTab] = useState<SubTab>('plano')
  // El piso que RENDERS tiene elegido — estado PROPIO, independiente del piso
  // activo del editor de PLANO (`FloorPlanEditor`'s `SWITCH_FLOOR`/`activeFloor`):
  // cambiar de piso aquí nunca reordena ni reactiva nada en el editor, y
  // viceversa. Por id, no por índice: sobrevive a que los pisos se reordenen.
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null)
  // GENERAR TODOS LOS PISOS (Task 31): confirmación de dos pasos, igual patrón que
  // RE-PARTIR DEL ORIGINAL arriba — `batchConfirm` arma la advertencia sin disparar
  // nada, un segundo click sí dispara. `batchProgress`/`batchTally` son el estado
  // EN VUELO (qué piso corre ahora, cuántos van bien/mal hasta este momento);
  // `batchSummary` es el resultado congelado al terminar, para el resumen final.
  const [batchConfirm, setBatchConfirm] = useState(false)
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{ floorName: string; index: number; total: number } | null>(null)
  const [batchTally, setBatchTally] = useState({ succeeded: 0, failed: 0 })
  const [batchSummary, setBatchSummary] = useState<FloorBatchSummary | null>(null)

  const original = geometry?.variants.original ?? null
  // `variant` distinto de 'original' es un id de plan (el legado migrado usa el id
  // literal 'planned', así que este montaje fijo sigue direccionando el mismo plan).
  const fs = variant === 'original' ? original : getPlan(geometry ?? null, variant)?.fs ?? null
  // Clonar un original sin pisos no produce nada editable: la acción ni se ofrece.
  const originalHasFloors = original != null && original.floors.length > 0
  // El piso SELECCIONADO en RENDERS: lo que RENDERS siembra y exporta a PNG. Cae
  // al primer piso cuando no hay selección propia todavía o cuando la selección
  // ya no existe (p. ej. un piso borrado) — nunca al piso activo de PLANO, que es
  // un estado distinto (ver arriba). `fs` es null en el empty-state del planeado
  // (RENDERS ni se ofrece, ver abajo) y en un original que nunca se guardó — en
  // ese caso `selectedFloor` sale null y `RendersPanel` ya sabe decir "dibuja el
  // plano primero" en vez de tronar.
  const selectedFloor = fs?.floors.find(f => f.id === selectedFloorId) ?? fs?.floors[0] ?? null

  // La IDENTIDAD real de qué pisos hay ahora mismo. `generation` (abajo) solo sube
  // cuando `writePlanned` reescribe el planeado de un golpe (PARTIR/BLANCO/RE-PARTIR)
  // — pero el editor de PLANO también puede cambiar `fs.floors` por su cuenta (hoy,
  // "+ Floor" ya está conectado a un botón; DEL_FLOOR vive en el reducer con tests
  // pero sin botón todavía) y ese camino pasa por el mismo `onSave` de siempre, sin
  // tocar `generation`. Un join de ids es la señal que cubre los dos caminos con una
  // sola dependencia: cambia si y solo si el CONJUNTO de pisos cambió, sin importar
  // por cuál puerta entró el cambio.
  const floorIdentity = fs?.floors.map(f => f.id).join(',') ?? ''

  // El lote (GENERAR TODOS LOS PISOS, Task 31) describe un conjunto de pisos
  // congelado en el momento en que corrió. Si ese conjunto cambia — por cualquier
  // camino, ver `floorIdentity` arriba — el resumen/progreso viejo se queda
  // describiendo pisos que ya no existen. Las 5 piezas se resetean juntas: no tiene
  // sentido dejar la confirmación armada o el tally a medias de un lote que ya no
  // corresponde al plano actual.
  useEffect(() => {
    setBatchConfirm(false)
    setBatchRunning(false)
    setBatchProgress(null)
    setBatchTally({ succeeded: 0, failed: 0 })
    setBatchSummary(null)
  }, [floorIdentity])

  const handleReady = useCallback((api: PlanApi) => onReady?.(variant, api), [onReady, variant])
  const handleSave = useCallback((set: FloorSet) => onSave(variant, set), [onSave, variant])
  // La exportación a PNG (`floorToPngBlob`, solo corre en el navegador) vive aquí
  // porque este panel es quien sabe cuál es el piso SELECCIONADO en RENDERS; la
  // llamada real a `generatePropertyRenderFromPlan` vive en la ficha, que es
  // quien conoce el id de la propiedad — misma separación que ya tiene `onSave`.
  // `floorId`/`floorName` llegan ya resueltos desde `RendersPanel` (que los recibe
  // como prop, ver abajo): se limita a pasarlos, no inventa un segundo origen.
  const handleGeneratePlan = useCallback(async (req: {
    promptId: number | null; promptText: string; floorId: string; floorName: string
  }) => {
    // Task 34: la referencia que ve la IA nunca lleva cotas — `_PLAN_CLAUSE`
    // (app/api/renders.py) le pide "sin texto ni marcas de agua" en SU salida.
    // roomTypeFill:true (Fase 2 del diagnóstico de Locales Salón Escobedo, validado con
    // un experimento real): relleno de color por tipo de cuarto — no es texto, así que
    // no choca con `_PLAN_CLAUSE`. RendersPanel.tsx pasa el `includeColorLegend` gemelo a
    // `planFacts` para el mismo piso — texto e imagen nunca deben describir tipos
    // distintos, ver el comentario de `resolveRoomType` en planFacts.ts.
    //
    // nameLabels se probó en producción y se REVIRTIÓ (2026-08-16, auditoría de 4 agentes).
    // El texto de nombre de cuarto sobresale del muro exterior, y `_content_bbox`
    // (app/api/renders.py) lo cuenta como edificio para calibrar el compositing: la
    // referencia mide 4.59% más ancha de lo que es y ese ancho inflado entra directo a
    // `scale_x`. A/B natural con `prompt_text` IDÉNTICO byte a byte (renders 38 vs 41 de la
    // propiedad 5): sin etiquetas scale_x=1.5621 y 6 columnas negras; con etiquetas
    // scale_x=1.4360, 118 columnas negras y muros hasta 45px fuera contra un trazo de 15px.
    const blob = await floorToPngBlob(selectedFloor!, { annotations: false, roomTypeFill: true })
    return onGenerateRender(variant, { ...req, plan: blob })
  }, [selectedFloor, variant, onGenerateRender])

  const handleUploadPlan = useCallback(async (req: { floorId: string; floorName: string; file: File }) => {
    return onUploadRender!(variant, req)
  }, [variant, onUploadRender])

  // GENERAR TODOS LOS PISOS (Task 31): un render por CADA piso de `fs.floors`, sin
  // importar cuál esté seleccionado arriba en RENDERS — el selector de un piso es
  // independiente de este botón de lote (decisión de Eduardo). Cada llamada usa
  // SU PROPIO piso para el blob (`floorToPngBlob`) y el prompt (`planFacts`, los
  // mismos hechos duros que siembra "El plano" en `RendersPanel` cuando no hay
  // preset elegido) — nunca reusa el blob/piso seleccionado en el selector de
  // RENDERS. Sin `promptId`: el lote no nace de un preset guardado, nace de los
  // hechos de cada piso.
  const generateOneFloor = useCallback(async (floor: FloorGraph) => {
    // Mismos flags que handleGeneratePlan arriba, para ESTE piso — nunca unos sin otros.
    const blob = await floorToPngBlob(floor, { annotations: false, roomTypeFill: true })
    return onGenerateRender(variant, {
      promptId: null, promptText: planFacts(floor, { includeColorLegend: true }), plan: blob, floorId: floor.id, floorName: floor.name,
    })
  }, [variant, onGenerateRender])

  // La orquestación secuencial y la tolerancia a fallo parcial viven en
  // `generateAllFloors` (probado aparte, sin UI ni red) — esta función solo
  // conecta ese resultado con el estado visible: qué piso corre ahora
  // (`batchProgress`), el tally en vivo (`batchTally`, actualizado por piso según
  // resuelve o truena, sin alterar si `generateAllFloors` lo cuenta como éxito o
  // fallo — solo lo observa) y el resumen final (`batchSummary`).
  async function runGenerateAllFloors() {
    if (fs == null || fs.floors.length === 0) return
    setBatchRunning(true)
    setBatchSummary(null)
    setBatchTally({ succeeded: 0, failed: 0 })
    // `generateAllFloors` ya atrapa el fallo de CADA piso por dentro y nunca relanza
    // (Task 31: tolerancia a fallo parcial) — pero si algo se le escapara igual (un
    // bug ahí, o que `onProgress` truene), el `finally` es lo que evita que el botón
    // se quede en "GENERANDO…" para siempre: correr/progreso/confirmación se limpian
    // pase lo que pase, y el resumen solo se pone si de verdad hay uno que mostrar.
    try {
      const summary = await generateAllFloors(
        fs.floors,
        async floor => {
          try {
            const result = await generateOneFloor(floor)
            setBatchTally(t => ({ ...t, succeeded: t.succeeded + 1 }))
            return result
          } catch (e) {
            setBatchTally(t => ({ ...t, failed: t.failed + 1 }))
            throw e
          }
        },
        current => setBatchProgress(current),
      )
      setBatchSummary(summary)
    } finally {
      setBatchProgress(null)
      setBatchRunning(false)
      setBatchConfirm(false)
    }
  }

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
      setError(e instanceof Error ? e.message : 'No se pudo escribir el plano de proyecto')
    } finally {
      setPending(null)
    }
  }
  const busy = pending != null

  if (variant === 'planned' && fs == null) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: '12px', background: colors.dark, padding: '32px' }}>
        <div style={label}>SIN PLANO DE PROYECTO</div>
        <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary, textAlign: 'center', maxWidth: '360px' }}>
          El plano de proyecto es cómo va a quedar la propiedad. Nace clonando el original
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
            <span style={label}>SE DESCARTA EL PLANO DE PROYECTO ACTUAL</span>
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
  // `RendersPanel` filtra por `variant` internamente (`sourceVariant === variant`),
  // y por el PISO seleccionado aquí (Task 30). El selector mira el mismo patrón
  // visual que la tira de pisos de PLANO (`FloorPlanEditor.tsx`, `SWITCH_FLOOR`),
  // pero es SU PROPIO estado (`selectedFloorId` arriba) — nunca dispatcha al
  // reducer del editor. Se enseña siempre que haya al menos un piso, incluso con
  // uno solo, igual que la tira de PLANO nunca se esconde por tener un piso único.
  const floorCount = fs?.floors.length ?? 0
  const rendersContent = (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {fs != null && floorCount > 0 && (
        <div style={{ flexShrink: 0, display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap',
                      padding: '6px 16px', borderBottom: `1px solid ${colors.border}` }}>
          <span style={label}>PISO</span>
          {fs.floors.map(f => (
            <button key={f.id} onClick={() => setSelectedFloorId(f.id)}
              style={{ ...floorBtn(f.id === selectedFloor?.id), textTransform: 'none', letterSpacing: '0.04em',
                       fontFamily: fonts.sans, fontSize: '11px' }}>
              {f.name}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {/* GENERAR TODOS LOS PISOS (Task 31): botón secundario, nunca sustituye al
              GENERAR RENDER de un piso. Solo se ofrece con 2+ pisos — con uno solo
              sería idéntico al individual, ruido sin acción nueva. Mismo patrón de
              confirmación de dos pasos que RE-PARTIR DEL ORIGINAL (arriba en PLANO):
              un botón inicial, y un segundo paso que advierte costo/tiempo antes de
              disparar — pero sin el rojo de `danger`, porque aquí no se descarta
              nada, se paga por N renders nuevos. */}
          {floorCount > 1 && (batchConfirm ? (
            <>
              <span style={label}>
                {floorCount} PISOS · ~{floorCount}×60-90S · {floorCount} CARGOS REALES
              </span>
              {/* Desactivado en vuelo, mismo motivo que el CANCELAR de RE-PARTIR DEL
                  ORIGINAL (arriba en PLANO): el lote ya se despachó — es secuencial,
                  sin punto de corte entre pisos — y un CANCELAR clicable escondería
                  la confirmación mientras los renders restantes igual se generan. */}
              <button onClick={() => setBatchConfirm(false)} disabled={batchRunning}
                style={{ ...outlined, opacity: batchRunning ? 0.6 : 1, cursor: batchRunning ? 'not-allowed' : 'pointer' }}>
                CANCELAR
              </button>
              <button onClick={runGenerateAllFloors} disabled={batchRunning}
                style={{ ...outlinedPrimary, cursor: batchRunning ? 'not-allowed' : 'pointer', opacity: batchRunning ? 0.7 : 1 }}>
                {batchRunning ? 'GENERANDO…' : `¿CONFIRMAR GENERAR ${floorCount} PISOS?`}
              </button>
            </>
          ) : (
            <button onClick={() => setBatchConfirm(true)} style={outlined}>GENERAR TODOS LOS PISOS</button>
          ))}
        </div>
      )}
      {/* Progreso del lote: qué piso corre ahora y el tally en vivo mientras dura;
          el resumen final congelado ("N de M generados. Falló: …") en cuanto
          termina — nunca los dos a la vez. */}
      {batchProgress && (
        <div style={{ flexShrink: 0, padding: '6px 16px', borderBottom: `1px solid ${colors.border}` }}>
          <span style={{ ...label, letterSpacing: 0, textTransform: 'none' }}>
            Generando piso {batchProgress.index + 1} de {batchProgress.total}: {batchProgress.floorName}…
            {' '}({batchTally.succeeded} completados, {batchTally.failed} fallidos)
          </span>
        </div>
      )}
      {!batchProgress && batchSummary && (
        <div style={{ flexShrink: 0, padding: '6px 16px', borderBottom: `1px solid ${colors.border}` }}>
          <span style={{ ...label, letterSpacing: 0, textTransform: 'none',
                         color: batchSummary.failed > 0 ? colors.tertiary : colors.secondary }}>
            {formatBatchSummary(batchSummary)}
          </span>
        </div>
      )}
      <RendersPanel source="plan" variant={variant} plan={selectedFloor}
        floorId={selectedFloor?.id ?? null} floorName={selectedFloor?.name ?? null}
        floorCount={floorCount} base={base}
        prompts={prompts} renders={renders} onGeneratePlan={handleGeneratePlan}
        onUploadPlan={onUploadRender ? handleUploadPlan : undefined}
        onEdit={onEdit} onSavePrompt={onSavePrompt} onDeleteRender={onDeleteRender}
        onChoose={onChoose} onUnchoose={onUnchoose} />
    </div>
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
