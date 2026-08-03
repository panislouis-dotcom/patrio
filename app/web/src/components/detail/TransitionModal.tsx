import { useState } from 'react'
import type { Property, Transition } from '../../lib/types'
import { PROPERTY_STATUS_LABEL } from '../../lib/status'
import type { PropertyStatus } from '../../lib/status'
import { colors, fonts } from '../../lib/theme'
import { fmtMXN } from '../../lib/fmt'

interface Field {
  key: string
  label: string
  kind: 'date' | 'money' | 'int'
  /** Obligatorio salvo que la propiedad ya lo traiga capturado. */
  required: (p: Property) => boolean
  /** Un campo que la propiedad ya resolvió no se pregunta. Por omisión, todos. */
  show?: (p: Property) => boolean
  prefill: (p: Property) => string
  /** Se resuelve contra la propiedad: algunos avisos solo tienen sentido con
      lo que ya trae capturado (la renta estimada, el desglose incompleto). */
  hint?: (p: Property) => string | undefined
}

const today = () => new Date().toISOString().slice(0, 10)
const str = (v: number | string | null) => (v == null ? '' : String(v))

/**
 * Los insumos que pide cada etapa destino — espejo de los cuerpos tipados de
 * POST /transition. Avanzar no es cambiar un campo: es afirmar que la propiedad
 * ya vive en la etapa siguiente, y cada etapa exige la evidencia de que así es.
 */
const FIELDS: Record<Exclude<PropertyStatus, 'prospecto'>, Field[]> = {
  oferta: [
    { key: 'projectedSale', label: 'VENTA PROYECTADA', kind: 'money',
      required: p => !(p.projectedSale && p.projectedSale > 0),
      prefill: p => str(p.projectedSale),
      hint: () => 'Toda oferta modela su salida, aunque el plan sea rentar.' },
  ],
  desarrollo: [
    { key: 'acquisitionDate', label: 'FECHA DE ADQUISICIÓN', kind: 'date',
      required: () => true, prefill: p => p.acquisitionDate ?? today() },
    { key: 'totalUnits', label: 'UNIDADES', kind: 'int',
      required: () => true, prefill: p => str(p.totalUnits) || '1' },
    // No se pide valuación: comprar no produce un avalúo. Se captura en la
    // ficha el día que exista uno de verdad.
    { key: 'totalInvestmentCaptured', label: 'INVERSIÓN TOTAL', kind: 'money',
      required: p => p.investmentBasis !== 'underwriting',
      // Con el desglose completo la inversión ya está sumada; preguntarla sería
      // pedir un dato que el sistema tiene mejor que quien lo teclea.
      show: p => p.investmentBasis !== 'underwriting',
      prefill: p => str(p.totalInvestmentCaptured),
      hint: () => 'El desglose de costos está incompleto, así que hace falta el total.' },
  ],
  en_renta: [
    { key: 'firstRentDate', label: 'FECHA DE LA PRIMERA RENTA', kind: 'date',
      required: () => true, prefill: p => p.firstRentDate ?? today() },
    // Sin prefill, y por la misma razón que el precio de venta: la renta que se
    // cobra es un hecho que se conoce. Arrastrarle la estimada lograba que se
    // confirmara sin leer, y esa confirmación borraba la proyección — el par
    // «modelamos X, cobramos Y» moría en el momento de empezar a valer algo.
    { key: 'rentMonthlyActual', label: 'RENTA MENSUAL COBRADA', kind: 'money',
      required: () => true, prefill: () => '',
      hint: p => p.rentMonthlyProjected
        ? `Se estimó ${fmtMXN(p.rentMonthlyProjected)} al mes. La estimación se conserva aparte.`
        : undefined },
    { key: 'currentValuation', label: 'VALUACIÓN', kind: 'money',
      required: () => false, prefill: p => str(p.currentValuation),
      hint: () => 'Opcional: solo si ya existe un avalúo.' },
    { key: 'valuationDate', label: 'FECHA DE VALUACIÓN', kind: 'date',
      required: () => false, prefill: p => p.valuationDate ?? '' },
  ],
  vendida: [
    { key: 'saleDate', label: 'FECHA DE VENTA', kind: 'date',
      required: () => true, prefill: () => today() },
    // Sin prefill: el precio de venta es un hecho que se conoce, y arrastrarle
    // la última valuación solo lograría que se confirmara sin leerlo.
    { key: 'salePrice', label: 'PRECIO DE VENTA', kind: 'money',
      required: () => true, prefill: () => '' },
  ],
  archivada: [],
}

interface Props {
  property: Property
  to: Exclude<PropertyStatus, 'prospecto'>
  onCancel: () => void
  onConfirm: (body: Transition) => Promise<void>
}

export function TransitionModal({ property, to, onCancel, onConfirm }: Props) {
  const fields = FIELDS[to].filter(f => f.show?.(property) ?? true)
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(fields.map(f => [f.key, f.prefill(property)])),
  )
  const [effectiveOn, setEffectiveOn] = useState(today())
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const missing = fields.filter(f => f.required(property) && !values[f.key]?.trim())
  const canConfirm = !saving && missing.length === 0

  async function confirm() {
    setSaving(true)
    setError(null)
    // Las cajas vacías simplemente no viajan: lo que no se captura aquí lo
    // conserva la propiedad tal como estaba.
    const captured = Object.fromEntries(
      fields
        .filter(f => values[f.key]?.trim())
        .map(f => [f.key, f.kind === 'date' ? values[f.key] : Number(values[f.key])]),
    )
    // El servidor valida el cuerpo contra el modelo tipado del destino; aquí lo
    // armamos por etapa, así que la unión se cierra en ese contrato, no antes.
    const body = { to, ...captured, effectiveOn, notes } as Transition
    try {
      await onConfirm(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo avanzar la etapa')
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', background: colors.surfaceAlt,
    border: `1px solid ${colors.border}`, color: colors.neutral,
    fontFamily: fonts.sans, fontSize: '12px', padding: '6px 10px', outline: 'none',
  }
  const labelStyle: React.CSSProperties = {
    fontFamily: fonts.label, fontSize: '8px', color: colors.secondary,
    letterSpacing: '0.08em', marginBottom: '3px',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: colors.dark, border: `1px solid ${colors.border}`, padding: '28px', width: '360px', maxHeight: 'calc(100vh - 80px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.15em', color: colors.secondary }}>
          {PROPERTY_STATUS_LABEL[property.status]} ▸ {PROPERTY_STATUS_LABEL[to]}
        </div>
        <div style={{ fontFamily: fonts.serif, fontSize: '16px', color: colors.neutral, marginBottom: '4px' }}>
          {property.name}
        </div>

        {to === 'archivada' && (
          <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, lineHeight: 1.6 }}>
            Archivar la saca del inventario activo sin borrar nada. Es terminal:
            de archivada no se regresa.
          </div>
        )}

        {fields.map(f => (
          <div key={f.key}>
            <div style={labelStyle}>
              {f.label}{f.required(property) ? ' *' : ''}
            </div>
            <input
              type={f.kind === 'date' ? 'date' : 'number'}
              value={values[f.key] ?? ''}
              aria-label={f.label}
              onChange={e => setValues(prev => ({ ...prev, [f.key]: e.target.value }))}
              style={inputStyle}
            />
            {f.hint?.(property) && (
              <div style={{ fontFamily: fonts.label, fontSize: '7px', color: colors.secondary, letterSpacing: '0.06em', marginTop: '3px', lineHeight: 1.5 }}>
                {f.hint(property)}
              </div>
            )}
          </div>
        ))}

        <div>
          <div style={labelStyle}>FECHA DEL CAMBIO</div>
          <input type="date" value={effectiveOn} aria-label="FECHA DEL CAMBIO"
            onChange={e => setEffectiveOn(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <div style={labelStyle}>NOTA</div>
          <input value={notes} aria-label="NOTA" placeholder="Por qué avanza"
            onChange={e => setNotes(e.target.value)} style={inputStyle} />
        </div>

        {error && (
          <div style={{ color: '#c0392b', fontFamily: fonts.sans, fontSize: '11px', lineHeight: 1.5 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
          <button
            onClick={onCancel}
            style={{ flex: 1, background: 'none', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: '8px' }}
          >
            CANCELAR
          </button>
          <button
            onClick={confirm}
            disabled={!canConfirm}
            style={{ flex: 2, background: to === 'archivada' ? colors.secondary : colors.primary, border: 'none', color: colors.neutral, cursor: canConfirm ? 'pointer' : 'not-allowed', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: '8px', opacity: canConfirm ? 1 : 0.6 }}
          >
            {saving ? 'AVANZANDO…' : `${PROPERTY_STATUS_LABEL[to]} ▸`}
          </button>
        </div>
      </div>
    </div>
  )
}
