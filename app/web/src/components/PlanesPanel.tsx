import { useState } from 'react'
import type React from 'react'
import { colors, fonts } from '../lib/theme'
import { LevantamientoPanel } from './LevantamientoPanel'
import type { PlanApi } from './FloorPlanEditor'
import {
  clone, emptyFloorSet, genId, LEGACY_PLAN_ID,
  type FloorPlanModel, type FloorSet, type PlanKey, type ProjectPlan,
} from '../lib/floorplan/types'
import type { PropertyRender, RenderPrompt, RenderPromptKind } from '../lib/types'

const btnBase: React.CSSProperties = {
  cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px',
  letterSpacing: '0.1em', flexShrink: 0, padding: '5px 12px',
}
const outlined: React.CSSProperties = { ...btnBase, background: 'none', border: `1px solid ${colors.border}`, color: colors.secondary }
const outlinedPrimary: React.CSSProperties = { ...btnBase, background: 'none', border: `1px solid ${colors.primary}`, color: colors.primary }
const danger: React.CSSProperties = { ...btnBase, background: '#c0392b', border: 'none', color: '#fff' }
const label: React.CSSProperties = { fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em', color: colors.secondary }

interface Props {
  geometry: FloorPlanModel | null
  onSave: (variant: PlanKey, fs: FloorSet) => void | Promise<void>
  /** Crear/renombrar PERSISTEN de inmediato (operaciones de envelope, como clonar
   * en LevantamientoPanel — no ediciones dentro de un plan). Borrar cascadea
   * sobre los renders del plan en el servidor; por eso la confirmación de aquí
   * enseña el conteo ANTES. */
  onCreatePlan: (plan: ProjectPlan) => Promise<void>
  onRenamePlan: (planId: string, name: string) => Promise<void>
  onDeletePlan: (planId: string) => Promise<void>
  // Passthroughs de LevantamientoPanel — este wrapper decide QUÉ plan está
  // activo; el panel sigue siendo dueño de todo lo demás.
  onUploadImage: (file: File) => Promise<{ imageKey: string }>
  onReady?: (variant: PlanKey, api: PlanApi) => void
  onDirtyChange?: (dirty: boolean) => void
  base: string
  prompts: RenderPrompt[]
  renders: PropertyRender[]
  onGenerateRender: (variant: PlanKey, req: {
    promptId: number | null; promptText: string; plan: Blob; floorId: string; floorName: string
  }) => Promise<PropertyRender>
  onUploadRender?: (variant: PlanKey, req: { floorId: string; floorName: string; file: File })
    => Promise<PropertyRender>
  onEdit?: (renderId: number, promptText: string) => Promise<PropertyRender>
  onSavePrompt: (p: { name: string; body: string; kind: RenderPromptKind }) => Promise<RenderPrompt>
  onDeleteRender: (renderId: number) => Promise<void>
  onChoose: (renderId: number) => Promise<void>
  onUnchoose: (renderId: number) => Promise<void>
}

/**
 * PLANO DE PROYECTO con N planes: este wrapper es dueño de CUÁL plan está activo
 * y de las operaciones de la colección (crear, renombrar, borrar); todo lo demás
 * — el editor, la barra de rehacer, RENDERS — sigue siendo el mismo
 * `LevantamientoPanel` de siempre, montado una vez por plan activo con `key` por
 * plan: el editor captura su `initial` al montar, así que cambiar de plan DEBE
 * remontar (mismo motivo del key de generación interno del panel).
 *
 * Sin planes todavía, no hay cromo: se monta el panel con el id legado
 * ('planned') y su empty state de siempre — PARTIR DEL ORIGINAL / EMPEZAR EN
 * BLANCO crean el primer plan por el mismo camino que siempre (onSave), y la
 * página lo persiste con el nombre por default. Así una propiedad de un solo
 * plan se ve y se opera EXACTAMENTE como antes de esta feature.
 *
 * Cambiar de plan con el editor sucio pide confirmación de dos pasos (el patrón
 * del repo, nunca window.confirm): hoy cambiar de tab ya pierde lo no guardado
 * en silencio, pero entre planes el cambio será mucho más frecuente.
 */
export function PlanesPanel({
  geometry, onSave, onCreatePlan, onRenamePlan, onDeletePlan,
  onUploadImage, onReady, onDirtyChange,
  base, prompts, renders, onGenerateRender, onUploadRender, onEdit, onSavePrompt,
  onDeleteRender, onChoose, onUnchoose,
}: Props) {
  const plans = geometry?.variants.plans ?? []
  const [activePlanId, setActivePlanId] = useState<string | null>(null)
  const active = plans.find(p => p.id === activePlanId) ?? plans[0] ?? null

  const [dirty, setDirty] = useState(false)
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const planKey: PlanKey = active?.id ?? LEGACY_PLAN_ID

  function handleDirty(d: boolean) {
    setDirty(d)
    onDirtyChange?.(d)
  }

  function requestSwitch(planId: string) {
    if (planId === planKey) return
    if (dirty) { setPendingSwitch(planId); return }
    switchTo(planId)
  }

  function switchTo(planId: string) {
    setActivePlanId(planId)
    setPendingSwitch(null)
    setConfirmDelete(false)
    setRenaming(false)
    // El remontaje por `key` descarta el editor sucio: el estado local debe
    // decirlo también, o el aviso de "sucio" sobreviviría al plan que lo tenía.
    handleDirty(false)
  }

  async function run(op: () => Promise<void>, fallback: string) {
    setBusy(true); setError(null)
    try { await op() } catch (e) {
      setError(e instanceof Error ? e.message : fallback)
    } finally { setBusy(false) }
  }

  async function createPlan(fs: FloorSet, name: string) {
    const plan: ProjectPlan = { id: genId(), name, fs }
    await run(async () => {
      await onCreatePlan(plan)
      switchTo(plan.id)
      setCreating(false)
    }, 'No se pudo crear el plan')
  }

  const original = geometry?.variants.original ?? null
  const originalHasFloors = original != null && original.floors.length > 0
  const defaultName = `Plan ${plans.length + 1}`
  // El conteo real que la cascada del servidor va a borrar — mismo filtro que
  // RendersPanel usa para la lista (sourceVariant === plan id).
  const renderCount = active ? renders.filter(r => r.sourceVariant === active.id).length : 0

  const chrome = plans.length > 0 && active && (
    <div style={{ flexShrink: 0, display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap',
      padding: '6px 16px', borderBottom: `1px solid ${colors.border}`, background: colors.dark }}>
      <span style={label}>PLAN</span>
      {plans.length > 1 ? (
        <select value={active.id} onChange={e => requestSwitch(e.target.value)}
          aria-label="Plan de proyecto activo"
          style={{ padding: '4px 8px', fontFamily: fonts.sans, fontSize: '12px',
                   color: colors.neutral, background: colors.dark,
                   border: `1px solid ${colors.border}` }}>
          {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      ) : (
        <span style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral }}>{active.name}</span>
      )}
      <div style={{ flex: 1 }} />
      {error && <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.tertiary }}>{error}</span>}

      {pendingSwitch != null ? (
        <>
          <span style={label}>SE PIERDE LO NO GUARDADO DE ESTE PLAN</span>
          <button onClick={() => setPendingSwitch(null)} style={outlined}>CANCELAR</button>
          <button onClick={() => switchTo(pendingSwitch)} style={danger}>¿CAMBIAR DE PLAN?</button>
        </>
      ) : confirmDelete ? (
        <>
          <span style={label}>
            {renderCount > 0 ? `SE BORRARÁN ${renderCount} RENDERS DE ESTE PLAN` : 'SE BORRA ESTE PLAN'}
          </span>
          <button onClick={() => setConfirmDelete(false)} disabled={busy} style={outlined}>CANCELAR</button>
          <button disabled={busy} style={{ ...danger, opacity: busy ? 0.7 : 1 }}
            onClick={() => run(async () => {
              await onDeletePlan(active.id)
              setConfirmDelete(false)
              setActivePlanId(null)   // cae al primer plan restante (o al empty state)
            }, 'No se pudo borrar el plan')}>
            {busy ? 'BORRANDO…' : '¿CONFIRMAR BORRAR?'}
          </button>
        </>
      ) : renaming ? (
        <>
          <input value={newName} onChange={e => setNewName(e.target.value)}
            aria-label="Nuevo nombre del plan"
            style={{ padding: '4px 8px', fontFamily: fonts.sans, fontSize: '12px',
                     color: colors.neutral, background: colors.dark,
                     border: `1px solid ${colors.border}` }} />
          <button onClick={() => setRenaming(false)} style={outlined}>CANCELAR</button>
          <button disabled={busy || !newName.trim()} style={outlinedPrimary}
            onClick={() => run(async () => {
              await onRenamePlan(active.id, newName.trim())
              setRenaming(false)
            }, 'No se pudo renombrar')}>
            GUARDAR NOMBRE
          </button>
        </>
      ) : creating ? (
        <>
          {originalHasFloors && (
            <button disabled={busy} style={outlinedPrimary}
              onClick={() => createPlan(clone(original!), defaultName)}>
              PARTIR DEL ORIGINAL
            </button>
          )}
          <button disabled={busy} style={outlined}
            onClick={() => createPlan(clone(active.fs), `Copia de ${active.name}`)}>
            DUPLICAR ESTE
          </button>
          <button disabled={busy} style={outlined}
            onClick={() => createPlan(emptyFloorSet(), defaultName)}>
            EN BLANCO
          </button>
          <button onClick={() => setCreating(false)} style={outlined}>CANCELAR</button>
        </>
      ) : (
        <>
          <button onClick={() => { setNewName(active.name); setRenaming(true) }} style={outlined}>RENOMBRAR</button>
          <button onClick={() => setConfirmDelete(true)} style={outlined}>BORRAR</button>
          {/* Crear cambia al plan nuevo y REMONTA el editor: con edición sucia
              perdería lo no guardado sin el aviso que el selector sí da. Guardar
              primero es más honesto que un segundo diálogo de confirmación. */}
          <button onClick={() => setCreating(true)} disabled={dirty}
            title={dirty ? 'Guarda los cambios primero' : undefined}
            style={{ ...outlinedPrimary, opacity: dirty ? 0.5 : 1, cursor: dirty ? 'not-allowed' : 'pointer' }}>
            + NUEVO PLAN
          </button>
        </>
      )}
    </div>
  )

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {chrome}
      <LevantamientoPanel
        key={planKey}
        variant={planKey}
        geometry={geometry}
        onSave={onSave}
        onUploadImage={onUploadImage}
        onReady={onReady}
        onDirtyChange={handleDirty}
        base={base}
        prompts={prompts}
        renders={renders}
        onGenerateRender={onGenerateRender}
        onUploadRender={onUploadRender}
        onEdit={onEdit}
        onSavePrompt={onSavePrompt}
        onDeleteRender={onDeleteRender}
        onChoose={onChoose}
        onUnchoose={onUnchoose}
      />
    </div>
  )
}
