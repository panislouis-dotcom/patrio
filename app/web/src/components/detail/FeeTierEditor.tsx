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

/**
 * La escalera de comisión de salida de un lado (`venta` o `renta`) de UNA
 * propiedad: `property.saleFeeTiers`/`rentFeeTiers`, escrita entera por PUT
 * (`replaceFeeTiers`, api.ts) — su propio sub-recurso, fuera de
 * `useEdits`/PATCH.
 *
 * **Sin modo edición.** Mismo motivo que `BudgetPanel`: las cajas están
 * siempre activas. El toggle EDITAR/GUARDAR de la ficha no sabría representar
 * "agregué un tramo" ni "borré un tramo".
 *
 * **Cada campo comita solo, al soltarlo** (`onBlur`), igual que
 * `BudgetPanel.commit`. Un tramo se manda ENTERO (el arreglo completo) porque
 * `replaceFeeTiers` es un reemplazo atómico, no un CRUD por renglón — no hay
 * "PATCH del tramo 2". Borrar un renglón es distinto: ya es una decisión
 * completa al hacer clic, así que comita de inmediato (`editNow`, mismo
 * patrón que `BudgetPanel`), sin esperar un blur que nunca llega en un botón.
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
  const [error, setError] = useState<string | null>(null)

  // Re-sincroniza el borrador cuando la escalera GUARDADA cambia de verdad —no
  // cuando `property` cambia de referencia por cualquier otro motivo (guardar
  // un renglón del presupuesto, GUARDAR de la ficha): la clave es el contenido
  // de los tramos de ESTE lado, no la propiedad entera, para no pisar un tramo
  // a medio teclear por un cambio que no le pertenece.
  //
  // Riesgo conocido y aceptado: esta resync SÍ puede pisar un tramo que se
  // está editando en ese instante, no solo uno ajeno. Si el usuario cambia el
  // umbral de un renglón y tabula (el blur dispara `commit`: PUT + GET, dos
  // vueltas), y antes de que resuelva hace clic en la TASA de ESE MISMO
  // renglón y teclea sin soltar, cuando el commit del umbral por fin resuelve
  // esta lambda reconstruye `nonFloor` entero desde el servidor y pisa esa
  // tasa a medio teclear en memoria —aunque la caja siga mostrando lo
  // tecleado, porque `NumericInput` solo resincroniza su texto visible cuando
  // no tiene foco—. Si el usuario suelta después, se manda la tasa VIEJA sin
  // ningún error. Mismo trato que `BudgetPanel.receive()` le da a
  // `pending.current` y que `replace_fee_tiers` (properties_db.py) documenta
  // en su propio docstring: se acepta sin blindaje porque esta es una
  // herramienta interna de un solo editor a la vez, no un formulario con
  // escrituras concurrentes reales.
  useEffect(() => {
    setHasLadder(stored.length > 0)
    setNonFloor(stored.map(t => ({ id: crypto.randomUUID(), threshold: t.threshold, rate: t.rate })))
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

  async function commit(tiers: FeeTier[]) {
    const err = validate(tiers)
    if (err) { setError(err); return }
    setError(null)
    try {
      await replaceFeeTiers(property.id, kind, tiers)
      const fresh = await fetchProperty(property.id)
      onPropertyChange(fresh)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la escalera')
    }
  }

  function addTier() {
    setError(null)
    if (!hasLadder) {
      setHasLadder(true)
      setNonFloor([{ id: crypto.randomUUID(), threshold: undefined, rate: undefined }])
      return
    }
    setNonFloor(prev => [...prev, { id: crypto.randomUUID(), threshold: undefined, rate: undefined }])
  }

  function deleteTier(idx: number) {
    const nf = nonFloor.filter((_, i) => i !== idx)
    setNonFloor(nf)
    void commit(tiersOf(nf, hasLadder))
  }

  function clearAll() {
    setHasLadder(false)
    setNonFloor([])
    setError(null)
    void commit([])
  }

  function updateNonFloor(idx: number, patch: Partial<DraftTier>) {
    setNonFloor(prev => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)))
  }

  const clearButton = hasLadder && (
    <button onClick={clearAll} title="Quitar la escalera y volver al default" aria-label={`Quitar escalera de ${label}`} style={smallBtn}>
      ✕
    </button>
  )

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
                onBlur={() => commit(tiersOf(nonFloor, hasLadder))}
                ariaLabel={`Umbral tramo ${idx + 1} — ${label}`}
                style={{ ...fieldInput, width: '110px' }}
              />
              <span style={{ fontFamily: fonts.label, fontSize: '7px', letterSpacing: '0.06em', color: colors.secondary, flexShrink: 0 }}>TASA %</span>
              <NumericInput
                value={tier.rate != null ? tier.rate * 100 : undefined}
                onChange={n => updateNonFloor(idx, { rate: n != null ? n / 100 : undefined })}
                onBlur={() => commit(tiersOf(nonFloor, hasLadder))}
                step={0.1}
                ariaLabel={`Tasa tramo ${idx + 1} — ${label}`}
                style={{ ...fieldInput, width: '70px' }}
              />
              <button onClick={() => deleteTier(idx)} title="Quitar tramo" aria-label={`Quitar tramo ${idx + 1} — ${label}`} style={smallBtn}>✕</button>
            </div>
          ))}

          <div>
            <button onClick={addTier} style={smallBtn}>+ agregar tramo</button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginTop: '6px', fontFamily: fonts.sans, fontSize: '11px', color: '#c0392b' }}>{error}</div>
      )}
    </div>
  )
}
