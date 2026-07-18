import { useState, useEffect } from 'react'
import type { CSSProperties } from 'react'
import { createProspect } from '../lib/api'
import { PROPERTY_TYPES } from '../lib/types'
import { colors, fonts } from '../lib/theme'

interface Props {
  onClose: () => void
  onCreated: () => void
  initialValues?: {
    name?: string
    address?: string
    city?: string
    landPrice?: number
  }
}

const inputStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  borderBottom: `1px solid ${colors.border}`,
  color: colors.neutral,
  fontFamily: fonts.sans,
  fontSize: '13px',
  padding: '4px 0',
  width: '100%',
  outline: 'none',
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: fonts.label,
      fontSize: '10px',
      color: colors.secondary,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      marginBottom: '4px',
    }}>
      {children}
    </div>
  )
}

export function QuickCaptureModal({ onClose, onCreated, initialValues }: Props) {
  const [name, setName] = useState(initialValues?.name ?? '')
  const [address, setAddress] = useState(initialValues?.address ?? '')
  const [city, setCity] = useState(initialValues?.city ?? 'Monterrey')
  const landPrice = initialValues?.landPrice ?? 0
  const [tipo, setTipo] = useState('')
  const [status, setStatus] = useState<'evaluating' | 'passed' | 'converted'>('evaluating')
  const [rentMonthly, setRentMonthly] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const rentVal = parseFloat(rentMonthly) || 0
  const canSave = !saving && name.trim() !== '' && address.trim() !== '' && rentVal > 0 && tipo !== ''

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await createProspect({
        name: name.trim(),
        address: address.trim(),
        city: city.trim(),
        status,
        type: tipo,
        latitude: 0,
        longitude: 0,
        sqmLand: 0,
        sqmConstruction: 0,
        landPrice,
        acquisitionCostPct: 0.065,
        permitsCost: 0,
        subdivisionCost: 0,
        constructionCostPerSqm: 0,
        constructionOverhead: 1.3,
        projectedSale: 0,
        rentMonthly: rentVal,
        holdMonths: 12,
      })
      setSaving(false)
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: colors.surfaceAlt,
        border: `1px solid ${colors.border}`,
        borderRadius: 2,
        padding: 32,
        width: 400,
      }}>
        <div style={{
          fontFamily: fonts.serif,
          fontSize: '18px',
          color: colors.neutral,
          marginBottom: '24px',
        }}>
          Nuevo prospecto
        </div>

        <div style={{ marginBottom: '16px' }}>
          <FieldLabel>Nombre</FieldLabel>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            style={inputStyle}
            autoFocus
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <FieldLabel>Dirección</FieldLabel>
          <input
            type="text"
            value={address}
            onChange={e => setAddress(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <FieldLabel>Ciudad</FieldLabel>
          <input
            type="text"
            value={city}
            onChange={e => setCity(e.target.value)}
            style={inputStyle}
          />
        </div>

        {initialValues?.landPrice ? (
          <div style={{ marginBottom: '16px' }}>
            <FieldLabel>Precio terreno (MXN)</FieldLabel>
            <div style={{ ...inputStyle, color: colors.secondary, cursor: 'default', paddingTop: '6px' }}>
              ${(initialValues.landPrice).toLocaleString('es-MX')}
            </div>
          </div>
        ) : null}

        <div style={{ marginBottom: '16px' }}>
          <FieldLabel>Tipo</FieldLabel>
          <select
            value={tipo}
            onChange={e => setTipo(e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="">— seleccionar —</option>
            {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <FieldLabel>Renta mensual (MXN)</FieldLabel>
          <input
            type="number"
            value={rentMonthly}
            onChange={e => setRentMonthly(e.target.value)}
            style={inputStyle}
            placeholder="ej. 20000"
          />
        </div>

        <div style={{ marginBottom: '24px' }}>
          <FieldLabel>Estado</FieldLabel>
          <select
            value={status}
            onChange={e => setStatus(e.target.value as 'evaluating' | 'passed' | 'converted')}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="evaluating">evaluating</option>
            <option value="passed">passed</option>
            <option value="converted">converted</option>
          </select>
        </div>

        {error && (
          <div style={{
            color: 'tomato',
            fontFamily: fonts.sans,
            fontSize: '12px',
            marginBottom: '16px',
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: `1px solid ${colors.border}`,
              color: colors.secondary,
              cursor: 'pointer',
              fontFamily: fonts.label,
              fontSize: '11px',
              letterSpacing: '0.1em',
              padding: '7px 14px',
            }}
          >
            CANCELAR
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            style={{
              background: canSave ? colors.primary : colors.border,
              border: 'none',
              color: colors.neutral,
              cursor: canSave ? 'pointer' : 'not-allowed',
              fontFamily: fonts.label,
              fontSize: '11px',
              letterSpacing: '0.1em',
              padding: '7px 14px',
            }}
          >
            GUARDAR
          </button>
        </div>
      </div>
    </div>
  )
}
