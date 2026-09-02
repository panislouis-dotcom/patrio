import { useEffect, useState } from 'react'
import type React from 'react'
import { fetchProperty, replaceFeeTiers } from '../../lib/api'
import type { FeeTier, Property } from '../../lib/types'
import { colors, fonts } from '../../lib/theme'
import { fieldInput } from '../../lib/styles'
import { NumericInput } from '../NumericInput'

interface Props {
  property: Property
  kind: 'venta' | 'renta'
  onPropertyChange: (property: Property) => void
}

/** Un tramo en edición: `undefined` es "caja vacía todavía", distinto de un 0
 * capturado — igual que en el resto de la ficha, una caja vacía no es un cero.
 *
 * `id` es identidad de RENDERIZADO local, nunca se manda al servidor
 * (`tiersOf` arma `{threshold, rate}` a mano): sirve solo para el `key` del
 * renglón en el JSX, para que borrar el tramo N no le herede su
 * `NumericInput` al que era N+1 —un `key={idx}` los reasigna por posición y
 * hoy "funciona" de pura casualidad, porque `NumericInput` resincroniza su
 * texto visible al perder el foco. */
interface DraftTier {
  id: string
  threshold: number | undefined
  rate: number | undefined
}

/**
 * Dos pintas para el mismo campo, según haya algo sin guardar (`dirty`):
 * guardado → se ve como el resto de los valores capturados de la ficha
 * (`EditableRow` en modo lectura: `fonts.sans`, 11px, `colors.neutral`, sin
 * caja). Con cambios pendientes → caja de captura de verdad (`fieldInput`,
 * mismo estilo que el resto del formulario), para que se note a simple vista
 * que hay algo sin guardar. Antes el campo era SIEMPRE una caja (o SIEMPRE
 * texto) sin importar si había algo pendiente — en ambos casos se leía mal:
 * como caja permanente parecía "siempre en edición" aunque no hubiera nada
 * que guardar; como texto permanente no se notaba cuándo sí había algo sin
 * guardar.
 */
const tierValueDisplay: React.CSSProperties = {
  fontFamily: fonts.sans,
  fontSize: '11px',
  color: colors.neutral,
  background: 'transparent',
  border: 'none',
  padding: 0,
  outline: 'none',
}

const smallBtn: React.CSSProperties = {
  flexShrink: 0,
  background: 'transparent',
  border: `1px solid ${colors.border}`,
  color: colors.secondary,
  cursor: 'pointer',
  fontFamily: fonts.label,
  fontSize: '9px',
  lineHeight: 1,
  padding: '4px 6px',
}

/** Mismo botón primario que `DetailHeader`'s GUARDAR — mismo `colors.primary`
 * de fondo, mismo `padding`/`letterSpacing`, misma flecha ▸ y el mismo
 * "GUARDANDO…" mientras se resuelve, para que se lea como el mismo tipo de
 * acción aunque viva en un sub-panel y no en el encabezado de la ficha. */
const saveBtn: React.CSSProperties = {
  cursor: 'pointer',
  fontFamily: fonts.label,
  fontSize: '9px',
  letterSpacing: '0.1em',
  flexShrink: 0,
  background: colors.primary,
  border: 'none',
  color: colors.neutral,
  padding: '6px 16px',
  transition: 'opacity 0.2s',
}

/**
 * La escalera de comisión de salida de un lado (`venta` o `renta`) de UNA
 * propiedad: `property.saleFeeTiers`/`rentFeeTiers`, escrita entera por PUT
 * (`replaceFeeTiers`, api.ts) — su propio sub-recurso, fuera de
 * `useEdits`/PATCH.
 *
 * **Guardado explícito, no automático.** A diferencia de `BudgetPanel` (que
 * comita cada celda sola, al soltarla), aquí NADA toca el servidor hasta que
 * se hace clic en «Guardar cambios de {kind}»: agregar un tramo, teclear un
 * umbral o una tasa, borrar un renglón o quitar la escalera entera son puras
 * mutaciones del borrador local (`nonFloor`/`hasLadder`/`dirty`). El botón
 * solo aparece cuando `dirty` es cierto (hay algo sin guardar) y manda el
 * arreglo COMPLETO de tramos —`replaceFeeTiers` es un reemplazo atómico, no
 * un CRUD por renglón, no hay "PATCH del tramo 2".
 *
 * Se probaron antes dos variantes de guardado automático (comitar en cada
 * blur, con y sin caja visible) y las dos confundían: sin un botón visible no
 * quedaba claro que sí se había guardado, y validar en cada blur mostraba un
 * error real ("cada tramo necesita una tasa...") en un renglón que el usuario
 * apenas empezaba a llenar, antes de tener oportunidad de terminarlo. Con
 * guardado explícito ninguno de los dos pasa: la validación solo corre al
 * hacer clic en Guardar, nunca a medio tecleo.
 *
 * No hay tramo piso ("si no") — el servidor lo rechaza de plano. Si el valor
 * no alcanza ningún umbral, la tasa que aplica es 0% automáticamente.
 */
export function FeeTierEditor({ property, kind, onPropertyChange }: Props) {
  const stored = kind === 'venta' ? property.saleFeeTiers : property.rentFeeTiers
  const storedKey = JSON.stringify(stored)
  const label = kind === 'venta' ? 'COMISIÓN VENTA — TRAMOS' : 'COMISIÓN RENTA — TRAMOS'

  const [hasLadder, setHasLadder] = useState(stored.length > 0)
  const [nonFloor, setNonFloor] = useState<DraftTier[]>(
    stored.map(t => ({ id: crypto.randomUUID(), threshold: t.threshold, rate: t.rate })),
  )
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-sincroniza el borrador cuando la escalera GUARDADA cambia de verdad —no
  // cuando `property` cambia de referencia por cualquier otro motivo (guardar
  // un renglón del presupuesto, GUARDAR de la ficha): la clave es el contenido
  // de los tramos de ESTE lado, no la propiedad entera, para no pisar un tramo
  // a medio teclear por un cambio que no le pertenece. Incluye el propio
  // refetch que hace `save()` al terminar — ahí `dirty` ya se puso en falso a
  // mano, esto es un segundo cierre del mismo círculo, no el único.
  useEffect(() => {
    setHasLadder(stored.length > 0)
    setNonFloor(stored.map(t => ({ id: crypto.randomUUID(), threshold: t.threshold, rate: t.rate })))
    setDirty(false)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey])

  function tiersOf(nf: DraftTier[], ladder: boolean): FeeTier[] {
    if (!ladder) return []
    return nf.map(t => ({ threshold: t.threshold ?? NaN, rate: t.rate ?? NaN }))
  }

  /** Mismo espejo que `validate_tiers` (fee_tiers.py): tasa en [0,1], umbrales
   * positivos y únicos. No exige orden ascendente — el servidor reordena. */
  function validate(tiers: FeeTier[]): string | null {
    if (tiers.length === 0) return null
    const seen = new Set<number>()
    for (const t of tiers) {
      if (!Number.isFinite(t.rate) || t.rate < 0 || t.rate > 1) {
        return 'Cada tramo necesita una tasa entre 0% y 100%.'
      }
      if (!Number.isFinite(t.threshold) || t.threshold <= 0) {
        return 'El umbral de cada tramo debe ser mayor a $0.'
      }
      if (seen.has(t.threshold)) {
        return `Los umbrales deben ser únicos (se repite ${t.threshold.toLocaleString('en-US')}).`
      }
      seen.add(t.threshold)
    }
    return null
  }

  async function save() {
    const tiers = tiersOf(nonFloor, hasLadder)
    if (tiers.some(t => Number.isNaN(t.threshold) || Number.isNaN(t.rate))) {
      setError('Completa el umbral y la tasa de cada tramo antes de guardar.')
      return
    }
    const err = validate(tiers)
    if (err) { setError(err); return }
    setError(null)
    setSaving(true)
    try {
      await replaceFeeTiers(property.id, kind, tiers)
      const fresh = await fetchProperty(property.id)
      onPropertyChange(fresh)
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la escalera')
    } finally {
      setSaving(false)
    }
  }

  function addTier() {
    setError(null)
    setDirty(true)
    if (!hasLadder) {
      setHasLadder(true)
      setNonFloor([{ id: crypto.randomUUID(), threshold: undefined, rate: undefined }])
      return
    }
    setNonFloor(prev => [...prev, { id: crypto.randomUUID(), threshold: undefined, rate: undefined }])
  }

  function deleteTier(idx: number) {
    setError(null)
    setDirty(true)
    setNonFloor(prev => prev.filter((_, i) => i !== idx))
  }

  function clearAll() {
    setError(null)
    setDirty(true)
    setHasLadder(false)
    setNonFloor([])
  }

  function updateNonFloor(idx: number, patch: Partial<DraftTier>) {
    setError(null)
    setDirty(true)
    setNonFloor(prev => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)))
  }

  const clearButton = hasLadder && (
    <button onClick={clearAll} title="Quitar la escalera y volver al default" aria-label={`Quitar escalera de ${label}`} style={smallBtn}>
      ✕
    </button>
  )

  const valueStyle = dirty ? fieldInput : tierValueDisplay

  return (
    <div style={{ padding: '10px 0', borderBottom: `1px solid ${colors.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.1em', color: colors.secondary }}>{label}</span>
        {clearButton}
      </div>

      {!hasLadder && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
          <span style={{ fontFamily: fonts.label, fontSize: '7px', letterSpacing: '0.08em', color: colors.secondary }}>SUPUESTO POR OMISIÓN</span>
          <button onClick={addTier} style={smallBtn}>+ agregar tramo</button>
        </div>
      )}

      {hasLadder && (
        <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {nonFloor.map((tier, idx) => (
            <div key={tier.id} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontFamily: fonts.label, fontSize: '7px', letterSpacing: '0.06em', color: colors.secondary, flexShrink: 0 }}>DESDE $</span>
              <NumericInput
                value={tier.threshold}
                onChange={n => updateNonFloor(idx, { threshold: n })}
                ariaLabel={`Umbral tramo ${idx + 1} — ${label}`}
                style={{ ...valueStyle, width: dirty ? '110px' : '90px' }}
              />
              <span style={{ fontFamily: fonts.label, fontSize: '7px', letterSpacing: '0.06em', color: colors.secondary, flexShrink: 0 }}>TASA %</span>
              <NumericInput
                value={tier.rate != null ? tier.rate * 100 : undefined}
                onChange={n => updateNonFloor(idx, { rate: n != null ? n / 100 : undefined })}
                step={0.1}
                ariaLabel={`Tasa tramo ${idx + 1} — ${label}`}
                style={{ ...valueStyle, width: dirty ? '70px' : '40px' }}
              />
              <button onClick={() => deleteTier(idx)} title="Quitar tramo" aria-label={`Quitar tramo ${idx + 1} — ${label}`} style={smallBtn}>✕</button>
            </div>
          ))}

          <div>
            <button onClick={addTier} style={smallBtn}>+ agregar tramo</button>
          </div>
        </div>
      )}

      {dirty && (
        <div style={{ marginTop: '8px' }}>
          <button
            onClick={() => void save()}
            disabled={saving}
            style={{ ...saveBtn, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'GUARDANDO…' : `GUARDAR CAMBIOS DE ${kind.toUpperCase()} ▸`}
          </button>
        </div>
      )}

      {error && (
        <div style={{ marginTop: '6px', fontFamily: fonts.sans, fontSize: '11px', color: '#c0392b' }}>{error}</div>
      )}
    </div>
  )
}
