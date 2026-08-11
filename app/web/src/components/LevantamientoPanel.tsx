import { useCallback, useState } from 'react'
import type React from 'react'
import { colors, fonts } from '../lib/theme'
import FloorPlanEditor, { type PlanApi } from './FloorPlanEditor'
import { clone, emptyFloorSet, type FloorPlanModel, type FloorSet, type VariantKey } from '../lib/floorplan/types'

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
}

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
export function LevantamientoPanel({ variant, geometry, onSave, onUploadImage, onReady, onDirtyChange }: Props) {
  const [confirmReclone, setConfirmReclone] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // El reducer del editor captura `initial` al montar y lo ignora después: cada
  // clonación bumpea esta generación para remontarlo con el planeado recién escrito.
  const [generation, setGeneration] = useState(0)

  const original = geometry?.variants.original ?? null
  const fs = variant === 'original' ? original : geometry?.variants.planned ?? null
  // Clonar un original sin pisos no produce nada editable: la acción ni se ofrece.
  const originalHasFloors = original != null && original.floors.length > 0

  const handleReady = useCallback((api: PlanApi) => onReady?.(variant, api), [onReady, variant])
  const handleSave = useCallback((set: FloorSet) => onSave(variant, set), [onSave, variant])

  // Escribe el planeado ENTERO de un golpe: un clon del original o una planta en
  // blanco. Es la única escritura que no pasa por el editor.
  async function writePlanned(source: FloorSet) {
    setCloning(true)
    setError(null)
    try {
      await onSave('planned', clone(source))
      setGeneration(g => g + 1)
      setConfirmReclone(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo escribir el planeado')
    } finally {
      setCloning(false)
    }
  }

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
            <button onClick={() => writePlanned(original!)} disabled={cloning} style={{ ...outlinedPrimary, opacity: cloning ? 0.6 : 1 }}>
              {cloning ? 'CLONANDO…' : 'PARTIR DEL ORIGINAL'}
            </button>
          )}
          <button onClick={() => writePlanned(emptyFloorSet())} disabled={cloning} style={outlined}>
            EMPEZAR EN BLANCO
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

  if (variant === 'original') return editor

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, display: 'flex', gap: '8px', alignItems: 'center',
        padding: '6px 16px', borderBottom: `1px solid ${colors.border}` }}>
        <span style={label}>PROPUESTA SOBRE EL ORIGINAL</span>
        <div style={{ flex: 1 }} />
        {error && <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.tertiary }}>{error}</span>}
        {originalHasFloors && (confirmReclone ? (
          <>
            <span style={label}>SE DESCARTA EL PLANEADO ACTUAL</span>
            <button onClick={() => setConfirmReclone(false)} style={outlined}>CANCELAR</button>
            <button onClick={() => writePlanned(original!)} disabled={cloning}
              style={{ ...danger, cursor: cloning ? 'not-allowed' : 'pointer', opacity: cloning ? 0.7 : 1 }}>
              {cloning ? 'CLONANDO…' : '¿CONFIRMAR RE-PARTIR?'}
            </button>
          </>
        ) : (
          <button onClick={() => setConfirmReclone(true)} style={outlined}>RE-PARTIR DEL ORIGINAL</button>
        ))}
      </div>
      {editor}
    </div>
  )
}
