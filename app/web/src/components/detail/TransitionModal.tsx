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
  prefill: (p: Property) => string
  /** Se pregunta solo cuando falta. Sirve para los insumos de los que el modal
      también ENSEÑA una cifra derivada: prellenarlos y dejarlos editables haría
      que esa cifra —calculada en el servidor sobre lo ya guardado— quedara vieja
      en pantalla mientras alguien teclea encima. Preguntar solo en su ausencia
      evita la contradicción sin duplicar el cálculo en el cliente. */
  show?: (p: Property) => boolean
  /** Se resuelve contra la propiedad: algunos avisos solo tienen sentido con
      lo que ya trae capturado, como la renta que se estimó. */
  hint?: (p: Property) => string | undefined
}

/** El mes en curso: las fechas del ciclo de vida se capturan por mes. */
const thisMonth = () => new Date().toISOString().slice(0, 7)
/** Hoy al día, para la fecha del EVENTO, que sí es un instante del historial. */
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
  // No se pide valuación: comprar no produce un avalúo. Se captura en la ficha
  // el día que exista uno de verdad. Tampoco la inversión: la suma el desglose.
  desarrollo: [
    { key: 'acquisitionDate', label: 'FECHA DE ADQUISICIÓN', kind: 'date',
      required: () => true, prefill: p => (p.acquisitionDate ?? thisMonth()).slice(0, 7) },
    { key: 'totalUnits', label: 'UNIDADES', kind: 'int',
      required: () => true, prefill: p => str(p.totalUnits) || '1' },
    // El tercer hecho de la compra, junto a la fecha y las unidades. Casi toda
    // propiedad llega con él —es el precio del anuncio— y entonces no se
    // pregunta: ya está capturado y la INVERSIÓN de abajo lo refleja. Cuando
    // falta, se pide aquí en vez de mandar a la ficha y de vuelta: es un insumo
    // del portón como los otros dos, y era el único que no se podía teclear.
    { key: 'purchasePrice', label: 'PRECIO DE COMPRA', kind: 'money',
      show: p => !(p.purchasePrice && p.purchasePrice > 0),
      required: () => true, prefill: () => '',
      hint: () => 'Lo que se paga por el inmueble como está. La obra a ejecutar se captura aparte.' },
  ],
  en_renta: [
    { key: 'firstRentDate', label: 'FECHA DE LA PRIMERA RENTA', kind: 'date',
      required: () => true, prefill: p => (p.firstRentDate ?? thisMonth()).slice(0, 7) },
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
      required: () => false, prefill: p => (p.valuationDate ?? '').slice(0, 7) },
  ],
  vendida: [
    { key: 'saleDate', label: 'FECHA DE VENTA', kind: 'date',
      required: () => true, prefill: () => thisMonth() },
    // Sin prefill: el precio de venta es un hecho que se conoce, y arrastrarle
    // la última valuación solo lograría que se confirmara sin leerlo.
    { key: 'salePrice', label: 'PRECIO DE VENTA', kind: 'money',
      required: () => true, prefill: () => '' },
  ],
  archivada: [],
}

/**
 * Un dato que la etapa destino EXIGE y que el modal ya no pregunta porque el
 * sistema lo tiene mejor que quien lo teclearía. Se enseña ya computado —
 * avanzar sigue siendo una afirmación sobre cifras concretas, y esconderlas
 * haría la afirmación a ciegas— y, cuando no se puede computar, `missing` dice
 * qué falta y dónde se captura, en vez de dejar que el gate del servidor
 * rebote la transición con un error que no explica nada.
 */
interface Readout {
  label: string
  value: string
  missing?: string
}

const READOUTS: Partial<Record<Exclude<PropertyStatus, 'prospecto'>, (p: Property) => Readout>> = {
  // Entrar a desarrollo es afirmar que la propiedad se compró, y una compra
  // tiene precio. Es además de dónde sale toda la inversión: sin él no hay
  // capital que repartir ni contra qué medir ninguna ganancia.
  desarrollo: p => ({
    label: 'INVERSIÓN',
    value: fmtMXN(p.totalInvestment),
    missing: p.purchasePrice && p.purchasePrice > 0
      ? undefined
      : 'Es la suma del desglose. Queda resuelta con el precio de compra que se pide arriba.',
  }),
}

interface Props {
  property: Property
  to: Exclude<PropertyStatus, 'prospecto'>
  onCancel: () => void
  onConfirm: (body: Transition) => Promise<void>
}

export function TransitionModal({ property, to, onCancel, onConfirm }: Props) {
  const fields = FIELDS[to].filter(f => f.show?.(property) ?? true)
  const readout = READOUTS[to]?.(property)
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(fields.map(f => [f.key, f.prefill(property)])),
  )
  const [effectiveOn, setEffectiveOn] = useState(today())
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const missing = fields.filter(f => f.required(property) && !values[f.key]?.trim())
  // Lo que traba el botón son los INSUMOS que faltan, no la cifra derivada que
  // falta por ellos. El readout se calcula sobre lo ya guardado, así que seguiría
  // diciendo «falta» mientras alguien teclea justo el dato que lo resuelve — y el
  // botón quedaría muerto con el formulario completo. Cada dato que el readout
  // necesita es campo obligatorio del portón; trabar por ambos era contarlo dos
  // veces, y la segunda cuenta usa datos viejos.
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
              type={f.kind === 'date' ? 'month' : 'number'}
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

        {readout && (
          <div>
            <div style={labelStyle}>{readout.label}</div>
            <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral, padding: '6px 0 2px' }}>
              {readout.value}
            </div>
            <div style={{ fontFamily: fonts.label, fontSize: '7px', color: readout.missing ? '#c0392b' : colors.secondary, letterSpacing: '0.06em', lineHeight: 1.5 }}>
              {readout.missing ?? 'Es la suma del desglose: no se teclea.'}
            </div>
          </div>
        )}

        {/* Esta sí va al día, y no es incoherencia: las fechas de arriba son
            HECHOS DE LA PROPIEDAD que solo se conocen al mes y solo se usan para
            contar meses; ésta es cuándo se registró el movimiento, que es un
            instante del historial y de donde salen los días-en-oferta. */}
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
