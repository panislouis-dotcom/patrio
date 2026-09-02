import { useEffect, useState } from 'react'
import type React from 'react'
import { fetchProperty, replaceFeeTiers } from '../../lib/api'
import type { FeeTier, Property } from '../../lib/types'
import { colors, fonts } from '../../lib/theme'
import { fieldInput } from '../../lib/styles'
import { fmtPct, fmtRentas } from '../../lib/fmt'
import { NumericInput } from '../NumericInput'

interface Props {
  property: Property
  kind: 'venta' | 'renta'
  // La tasa/cantidad que aplica cuando no hay tramos — `exitFeeVentaRate`
  // (fracción 0-1) o `exitFeeRentaMonths` (número de rentas) de fees.py, que
  // YA resuelve al default del modelo sin tramos configurados (ver
  // comentario en fees.py). Solo se lee en el estado sin tramos: con tramos,
  // la tasa vigente depende del valor y ya la enseña la fila ($) de abajo
  // vía su propio hint. El nombre quedó de cuando ambos lados eran una
  // fracción — sigue sirviendo para los dos, solo cambia cómo se formatea.
  defaultRatePct: number | null
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

const tierValueDisplay: React.CSSProperties = {
  fontFamily: fonts.sans,
  fontSize: '11px',
  color: colors.neutral,
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

const linkBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: colors.secondary,
  cursor: 'pointer',
  fontFamily: fonts.label,
  fontSize: '9px',
  letterSpacing: '0.06em',
  textDecoration: 'underline',
  padding: 0,
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

function fmtNumber(n: number, decimal = false): string {
  if (decimal) return String(Math.round(n * 1e6) / 1e6)
  return Math.round(n).toLocaleString('en-US')
}

/**
 * La escalera de comisión de salida de un lado (`venta` o `renta`) de UNA
 * propiedad: `property.saleFeeTiers`/`rentFeeTiers`, escrita entera por PUT
 * (`replaceFeeTiers`, api.ts) — su propio sub-recurso, fuera de
 * `useEdits`/PATCH.
 *
 * **Dos estados fijos, no un híbrido.** VISTA: los tramos guardados se leen
 * como texto plano, sin ninguna ✕ ni caja — nada sugiere que se puede tocar
 * algo salvo el botón «editar tramos» (o «+ agregar tramo» si no hay ninguno
 * todavía). EDICIÓN (`editing`): recién ahí aparecen las cajas de captura,
 * la ✕ por renglón, «+ agregar tramo» y los botones Guardar/Cancelar. No hay
 * una ✕ aparte para "quitar toda la escalera": para vaciarla se borran sus
 * renglones uno por uno (mismo control que borrar cualquier otro) y se
 * guarda con la lista en cero — una escalera vacía es, para el servidor, el
 * mismo caso que nunca haber tenido una.
 *
 * Se probaron antes variantes con guardado automático al blur (con y sin
 * caja visible) y con guardado explícito pero sin separar vista/edición —
 * las tres confundían: sin botón visible no quedaba claro que se había
 * guardado; con la ✕ de "quitar todo" y la ✕ por renglón siempre a la vista
 * no quedaba claro cuál de las dos hacía qué, ni por qué se veían fuera de
 * cualquier "modo edición" explícito.
 *
 * No hay tramo piso ("si no") — el servidor lo rechaza de plano. Si el valor
 * no alcanza ningún umbral, la tasa que aplica es 0% automáticamente.
 */
export function FeeTierEditor({ property, kind, defaultRatePct, onPropertyChange }: Props) {
  const stored = kind === 'venta' ? property.saleFeeTiers : property.rentFeeTiers
  const storedKey = JSON.stringify(stored)
  const label = kind === 'venta' ? 'COMISIÓN VENTA — TRAMOS' : 'COMISIÓN RENTA — TRAMOS'
  // Venta captura una FRACCIÓN de precio (se muestra ×100 como %); renta
  // captura un NÚMERO DE RENTAS crudo, sin conversión.
  const rateLabel = kind === 'venta' ? 'TASA %' : 'RENTAS'
  // Contra qué se compara "DESDE $" en esta escalera — mismo texto que usa
  // `exitFeeHint` (PropertyDetailPage) para la fila ($) de abajo, repetido
  // aquí a propósito: sin esto, un umbral de renta ($ decenas de miles) y uno
  // de venta ($ millones) se capturan en la misma caja "$" sin ninguna pista
  // de a qué escala pertenece cada uno hasta DESPUÉS de guardar y ver un
  // resultado en $0 — como pasó en vivo con un umbral de renta copiado de la
  // escala de venta.
  // Más corto que el de `exitFeeHint` a propósito — ese vive junto al monto
  // resuelto y le sobra ancho; este va pegado al encabezado y con
  // "/PROYECCIÓN" desbordaba a dos líneas.
  const thresholdBasis = kind === 'venta' ? 'SOBRE PRECIO DE VENTA' : 'SOBRE RENTA MENSUAL'

  const [editing, setEditing] = useState(false)
  const [nonFloor, setNonFloor] = useState<DraftTier[]>(
    stored.map(t => ({ id: crypto.randomUUID(), threshold: t.threshold, rate: t.rate })),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-sincroniza el borrador y regresa a VISTA cuando la escalera GUARDADA
  // cambia de verdad —no cuando `property` cambia de referencia por
  // cualquier otro motivo (guardar un renglón del presupuesto, GUARDAR de la
  // ficha): la clave es el contenido de los tramos de ESTE lado, no la
  // propiedad entera. Cubre tanto el refetch del propio `save()` de este
  // componente como un cambio externo (otra pestaña, otro editor).
  useEffect(() => {
    setEditing(false)
    setNonFloor(stored.map(t => ({ id: crypto.randomUUID(), threshold: t.threshold, rate: t.rate })))
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey])

  function tiersOf(nf: DraftTier[]): FeeTier[] {
    return nf.map(t => ({ threshold: t.threshold ?? NaN, rate: t.rate ?? NaN }))
  }

  /** Mismo espejo que `validate_tiers` (fee_tiers.py): en venta la tasa es
   * una fracción en [0,1]; en renta es un número de rentas, sin tope
   * superior (2, 3, 4+ son valores reales, muy por arriba de 1) — solo se
   * exige que no sea negativo. Umbrales positivos y únicos en ambos casos.
   * No exige orden ascendente — el servidor reordena. */
  function validate(tiers: FeeTier[]): string | null {
    if (tiers.length === 0) return null
    const seen = new Set<number>()
    for (const t of tiers) {
      if (!Number.isFinite(t.rate) || t.rate < 0 || (kind === 'venta' && t.rate > 1)) {
        return kind === 'venta'
          ? 'Cada tramo necesita una tasa entre 0% y 100%.'
          : 'Cada tramo necesita un número de rentas mayor o igual a 0.'
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
    const tiers = tiersOf(nonFloor)
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
      // El `useEffect` de arriba también apaga `editing` cuando `storedKey`
      // cambia, pero si se guarda una lista igual a la que ya estaba (ej.
      // se agregó y luego se borró el mismo tramo antes de guardar, o la
      // escalera ya estaba vacía y se guarda vacía otra vez) `storedKey` no
      // cambia y ese efecto nunca se dispara — este apagado explícito cubre
      // ese caso.
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la escalera')
    } finally {
      setSaving(false)
    }
  }

  function startEditing() {
    setError(null)
    setEditing(true)
  }

  function cancelEditing() {
    setError(null)
    setEditing(false)
    setNonFloor(stored.map(t => ({ id: crypto.randomUUID(), threshold: t.threshold, rate: t.rate })))
  }

  function addTier() {
    setError(null)
    setEditing(true)
    setNonFloor(prev => [...prev, { id: crypto.randomUUID(), threshold: undefined, rate: undefined }])
  }

  function deleteTier(idx: number) {
    setError(null)
    setNonFloor(prev => prev.filter((_, i) => i !== idx))
  }

  function updateNonFloor(idx: number, patch: Partial<DraftTier>) {
    setError(null)
    setNonFloor(prev => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)))
  }

  return (
    <div style={{ padding: '10px 0', borderBottom: `1px solid ${colors.border}` }}>
      <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.1em', color: colors.secondary }}>{label}</span>
      <span style={{ fontFamily: fonts.label, fontSize: '7px', letterSpacing: '0.08em', color: colors.secondary, marginLeft: '6px' }}>
        · {thresholdBasis}
      </span>

      {!editing && stored.length === 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
          <span style={{ fontFamily: fonts.label, fontSize: '7px', letterSpacing: '0.08em', color: colors.secondary }}>SUPUESTO POR OMISIÓN</span>
          <span style={tierValueDisplay}>{kind === 'venta' ? fmtPct(defaultRatePct) : fmtRentas(defaultRatePct)}</span>
          <button onClick={addTier} style={smallBtn}>+ agregar tramo</button>
        </div>
      )}

      {!editing && stored.length > 0 && (
        <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {stored.map((tier, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontFamily: fonts.label, fontSize: '7px', letterSpacing: '0.06em', color: colors.secondary, flexShrink: 0 }}>DESDE $</span>
              <span style={tierValueDisplay}>{fmtNumber(tier.threshold)}</span>
              <span style={{ fontFamily: fonts.label, fontSize: '7px', letterSpacing: '0.06em', color: colors.secondary, flexShrink: 0 }}>{rateLabel}</span>
              <span style={tierValueDisplay}>{kind === 'venta' ? fmtNumber(tier.rate * 100, true) : fmtNumber(tier.rate, true)}</span>
            </div>
          ))}
          <div>
            <button onClick={startEditing} style={smallBtn}>editar tramos</button>
          </div>
        </div>
      )}

      {editing && (
        <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {nonFloor.length === 0 && (
            <span style={{ fontFamily: fonts.label, fontSize: '7px', letterSpacing: '0.08em', color: colors.secondary }}>
              SIN TRAMOS — SE USARÁ EL SUPUESTO POR OMISIÓN
            </span>
          )}
          {nonFloor.map((tier, idx) => (
            <div key={tier.id} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontFamily: fonts.label, fontSize: '7px', letterSpacing: '0.06em', color: colors.secondary, flexShrink: 0 }}>DESDE $</span>
              <NumericInput
                value={tier.threshold}
                onChange={n => updateNonFloor(idx, { threshold: n })}
                ariaLabel={`Umbral tramo ${idx + 1} — ${label}`}
                style={{ ...fieldInput, width: '110px' }}
              />
              <span style={{ fontFamily: fonts.label, fontSize: '7px', letterSpacing: '0.06em', color: colors.secondary, flexShrink: 0 }}>{rateLabel}</span>
              <NumericInput
                value={kind === 'venta' ? (tier.rate != null ? tier.rate * 100 : undefined) : tier.rate}
                onChange={n => updateNonFloor(idx, { rate: kind === 'venta' ? (n != null ? n / 100 : undefined) : n })}
                step={kind === 'venta' ? 0.1 : 0.5}
                ariaLabel={`${kind === 'venta' ? 'Tasa' : 'Número de rentas'} tramo ${idx + 1} — ${label}`}
                style={{ ...fieldInput, width: '70px' }}
              />
              <button onClick={() => deleteTier(idx)} title="Quitar tramo" aria-label={`Quitar tramo ${idx + 1} — ${label}`} style={smallBtn}>✕</button>
            </div>
          ))}

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
            <button onClick={addTier} style={smallBtn}>+ agregar tramo</button>
            <button
              onClick={() => void save()}
              disabled={saving}
              style={{ ...saveBtn, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'GUARDANDO…' : `GUARDAR CAMBIOS DE ${kind.toUpperCase()} ▸`}
            </button>
            <button onClick={cancelEditing} disabled={saving} style={linkBtn}>cancelar</button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginTop: '6px', fontFamily: fonts.sans, fontSize: '11px', color: '#c0392b' }}>{error}</div>
      )}
    </div>
  )
}
