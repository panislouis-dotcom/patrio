import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { colors, fonts } from '../lib/theme'
import { fieldInput } from '../lib/styles'
import type { Cotizacion, Proveedor } from '../lib/types'
import { getCotizaciones, createCotizacion, selectCotizacion, deleteCotizacion, getProveedores } from '../lib/api'

interface Props {
  stateId: number
}

interface FormState {
  proveedorId: number | null
  monto: string
  moneda: 'MXN' | 'USD'
  descripcion: string
}

const EMPTY_FORM: FormState = {
  proveedorId: null,
  monto: '',
  moneda: 'MXN',
  descripcion: '',
}

export function CotizacionesSection({ stateId }: Props) {
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getCotizaciones(stateId).then(setCotizaciones).catch(console.error)
    getProveedores().then(setProveedores).catch(console.error)
  }, [stateId])

  const handleSave = async () => {
    const montoValue = parseFloat(form.monto)
    if (!form.monto || isNaN(montoValue) || montoValue <= 0 || saving) return
    setSaving(true)
    try {
      const created = await createCotizacion(stateId, {
        monto: montoValue,
        moneda: form.moneda,
        descripcion: form.descripcion,
        proveedorId: form.proveedorId ?? undefined,
        instanceNodeStateId: stateId,
      })
      setCotizaciones(prev => [...prev, created])
      setForm(EMPTY_FORM)
      setAdding(false)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const handleSelect = async (id: number) => {
    try {
      const updated = await selectCotizacion(id, stateId)
      // API guarantees only one cotizacion can be selected per node state
      setCotizaciones(prev =>
        prev.map(c => c.id === updated.id ? updated : { ...c, isSelected: false })
      )
    } catch (err) {
      console.error(err)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteCotizacion(id)
      setCotizaciones(prev => prev.filter(c => c.id !== id))
    } catch (err) {
      console.error(err)
    }
  }

  const labelStyle: CSSProperties = {
    fontFamily: fonts.label,
    fontSize: '9px',
    letterSpacing: '0.12em',
    color: colors.secondary,
  }

  const btnSmall = (variant: 'primary' | 'ghost' | 'danger'): CSSProperties => ({
    background: variant === 'primary' ? colors.primary : 'transparent',
    border: variant === 'danger' ? '1px solid #d44' : variant === 'ghost' ? `1px solid ${colors.border}` : 'none',
    borderRadius: '2px',
    color: variant === 'danger' ? '#B33333' : colors.neutral,
    cursor: 'pointer',
    fontFamily: fonts.label,
    fontSize: '9px',
    letterSpacing: '0.08em',
    padding: '4px 10px',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={labelStyle}>COTIZACIONES</span>
        {!adding && (
          <button onClick={() => setAdding(true)} style={btnSmall('ghost')}>
            + AGREGAR
          </button>
        )}
      </div>

      {/* Inline add form */}
      {adding && (
        <div style={{
          background: colors.surfaceAlt,
          border: `1px solid ${colors.border}`,
          borderRadius: '4px',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          {/* Supplier dropdown */}
          <select
            value={form.proveedorId ?? ''}
            onChange={e => setForm(f => ({ ...f, proveedorId: e.target.value ? parseInt(e.target.value) : null }))}
            style={{ ...fieldInput, cursor: 'pointer' }}
          >
            <option value="">Sin proveedor</option>
            {proveedores.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="number"
              placeholder="Monto"
              value={form.monto}
              onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
              style={{ ...fieldInput, flex: 2 }}
            />
            <select
              value={form.moneda}
              onChange={e => setForm(f => ({ ...f, moneda: e.target.value as 'MXN' | 'USD' }))}
              style={{ ...fieldInput, flex: 1, cursor: 'pointer' }}
            >
              <option value="MXN">MXN</option>
              <option value="USD">USD</option>
            </select>
          </div>

          <input
            type="text"
            placeholder="Descripción"
            value={form.descripcion}
            onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
            style={fieldInput}
          />

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleSave} disabled={!form.monto || isNaN(parseFloat(form.monto)) || parseFloat(form.monto) <= 0 || saving} style={btnSmall('primary')}>
              {saving ? '...' : 'GUARDAR'}
            </button>
            <button onClick={() => { setAdding(false); setForm(EMPTY_FORM) }} style={btnSmall('ghost')}>
              CANCELAR
            </button>
          </div>
        </div>
      )}

      {/* Cotizaciones list */}
      {cotizaciones.length === 0 && !adding && (
        <div style={{ fontSize: '12px', color: colors.secondary, fontFamily: fonts.sans }}>
          Sin cotizaciones registradas.
        </div>
      )}

      {cotizaciones.map(cot => (
        <div
          key={cot.id}
          style={{
            background: cot.isSelected ? '#EEF2EA' : colors.surfaceAlt,
            border: `1px solid ${cot.isSelected ? colors.primary : colors.border}`,
            borderRadius: '4px',
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
          }}
        >
          {/* Content */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div style={{ fontSize: '12px', color: colors.neutral, fontFamily: fonts.sans }}>
              {cot.proveedorName ?? cot.proveedorNameOverride ?? 'Sin proveedor'}
              {' — '}
              <span style={{ color: colors.primary }}>
                ${cot.monto.toLocaleString()} {cot.moneda}
              </span>
            </div>
            {cot.descripcion && (
              <div style={{ fontSize: '11px', color: colors.secondary, fontFamily: fonts.sans }}>
                {cot.descripcion}
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            {cot.isSelected ? (
              <span style={{ fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', color: colors.primary }}>
                ✓ SELECCIONADA
              </span>
            ) : (
              <button onClick={() => handleSelect(cot.id)} style={btnSmall('ghost')}>
                SELECCIONAR
              </button>
            )}
            <button onClick={() => handleDelete(cot.id)} style={{ ...btnSmall('danger'), padding: '4px 7px' }}>
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
