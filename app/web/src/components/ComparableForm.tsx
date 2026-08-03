import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { colors, fonts } from '../lib/theme'
import { createComparable, fetchZones } from '../lib/api'
import type { Zone, Comparable } from '../lib/types'

const inputStyle: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  color: colors.neutral,
  fontFamily: fonts.sans,
  fontSize: '13px',
  padding: '8px 10px',
  width: '100%',
  outline: 'none',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  fontFamily: fonts.label,
  fontSize: '9px',
  color: colors.secondary,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  marginBottom: '4px',
  display: 'block',
}

const errorTextStyle: React.CSSProperties = {
  fontFamily: fonts.sans,
  fontSize: '10px',
  color: '#E62300',
  marginTop: '4px',
}

const gridTwo: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '14px',
  marginBottom: '14px',
}

const gridThree: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: '14px',
  marginBottom: '14px',
}

const portalOptions: { value: string; label: string }[] = [
  { value: 'inmuebles24', label: 'Inmuebles24' },
  { value: 'vivanuncios', label: 'Vivanuncios' },
  { value: 'lamudi', label: 'Lamudi' },
  { value: 'propiedades_com', label: 'Propiedades.com' },
  { value: 'mercadolibre', label: 'Mercado Libre' },
  { value: 'doorvel', label: 'Doorvel' },
  { value: 'off_market', label: 'Off Market' },
  { value: 'other', label: 'Otro' },
]

const propertyTypeOptions: { value: string; label: string }[] = [
  { value: 'casa', label: 'Casa' },
  { value: 'depto', label: 'Departamento' },
  { value: 'duplex', label: 'Duplex' },
  { value: 'lote', label: 'Lote' },
  { value: 'local', label: 'Local' },
]

const conditionOptions: { value: string; label: string }[] = [
  { value: 'remodelada', label: 'Remodelada' },
  { value: 'nueva', label: 'Nueva' },
  { value: 'semi_nueva', label: 'Semi nueva' },
  { value: 'por_remodelar', label: 'Por remodelar' },
]

interface FormState {
  address: string
  zoneId: number | null
  m2: string
  price: string
  listingUrl: string
  sourcePortal: string
  listedAt: string
  neighborhood: string
  city: string
  lat: string
  lng: string
  bedrooms: string
  bathrooms: string
  parkingSpots: string
  propertyType: string
  condition: string
  notes: string
}

const initialState: FormState = {
  address: '',
  zoneId: null,
  m2: '',
  price: '',
  listingUrl: '',
  sourcePortal: 'inmuebles24',
  listedAt: '',
  neighborhood: '',
  city: '',
  lat: '',
  lng: '',
  bedrooms: '',
  bathrooms: '',
  parkingSpots: '',
  propertyType: 'casa',
  condition: 'semi_nueva',
  notes: '',
}

export function ComparableForm() {
  const navigate = useNavigate()
  const [form, setForm] = useState<FormState>(initialState)
  const [zones, setZones] = useState<Zone[]>([])
  const [zonesLoading, setZonesLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})

  useEffect(() => {
    fetchZones()
      .then(setZones)
      .catch(() => setZones([]))
      .finally(() => setZonesLoading(false))
  }, [])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
    setErrors(prev => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {}
    if (!form.address.trim()) next.address = 'Requerido'
    const m2Num = Number(form.m2)
    if (!form.m2 || Number.isNaN(m2Num) || m2Num <= 0) next.m2 = 'Debe ser mayor a 0'
    const priceNum = Number(form.price)
    if (!form.price || Number.isNaN(priceNum) || priceNum <= 0) next.price = 'Debe ser mayor a 0'
    if (!form.listingUrl.trim()) next.listingUrl = 'Requerido'
    if (!form.sourcePortal) next.sourcePortal = 'Requerido'
    if (!form.listedAt) next.listedAt = 'Requerido'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    setSaving(true)
    setSubmitError(null)
    try {
      const payload: Partial<Comparable> = {
        address: form.address.trim(),
        zoneId: form.zoneId ?? undefined,
        m2: Number(form.m2),
        price: Number(form.price),
        listingUrl: form.listingUrl.trim(),
        sourcePortal: form.sourcePortal,
        listedAt: form.listedAt,
        neighborhood: form.neighborhood.trim(),
        city: form.city.trim(),
        lat: form.lat ? Number(form.lat) : null,
        lng: form.lng ? Number(form.lng) : null,
        bedrooms: form.bedrooms ? Number(form.bedrooms) : null,
        bathrooms: form.bathrooms ? Number(form.bathrooms) : null,
        parkingSpots: form.parkingSpots ? Number(form.parkingSpots) : null,
        propertyType: form.propertyType,
        condition: form.condition,
        notes: form.notes.trim(),
      }
      await createComparable(payload)
      navigate('/propiedades/comparables')
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
        <button
          onClick={() => navigate('/propiedades/comparables')}
          style={{
            background: 'none',
            border: 'none',
            color: colors.secondary,
            cursor: 'pointer',
            fontFamily: fonts.label,
            fontSize: '11px',
            letterSpacing: '0.1em',
            padding: 0,
          }}
        >
          ← COMPARABLES
        </button>
      </div>
      <h1 style={{
        fontFamily: fonts.serif,
        fontSize: '28px',
        color: colors.neutral,
        marginBottom: '24px',
        fontWeight: 400,
      }}>
        Nuevo Comparable
      </h1>

      <div style={gridTwo}>
        <div>
          <label style={labelStyle}>Dirección *</label>
          <input
            data-testid="input-address"
            style={inputStyle}
            type="text"
            value={form.address}
            onChange={e => set('address', e.target.value)}
          />
          {errors.address && <div style={errorTextStyle}>{errors.address}</div>}
        </div>
        <div>
          <label style={labelStyle}>Zona</label>
          {zonesLoading ? (
            <div style={{ ...inputStyle, color: colors.secondary, fontStyle: 'italic' }}>
              Cargando zonas...
            </div>
          ) : (
            <select
              style={{ ...inputStyle, cursor: 'pointer' }}
              value={form.zoneId ?? ''}
              onChange={e => set('zoneId', e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— sin zona —</option>
              {zones.map(z => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div style={gridThree}>
        <div>
          <label style={labelStyle}>m² *</label>
          <input
            data-testid="input-m2"
            style={inputStyle}
            type="number"
            value={form.m2}
            onChange={e => set('m2', e.target.value)}
          />
          {errors.m2 && <div style={errorTextStyle}>{errors.m2}</div>}
        </div>
        <div>
          <label style={labelStyle}>Precio (MXN) *</label>
          <input
            data-testid="input-price"
            style={inputStyle}
            type="number"
            value={form.price}
            onChange={e => set('price', e.target.value)}
          />
          {errors.price && <div style={errorTextStyle}>{errors.price}</div>}
        </div>
        <div>
          <label style={labelStyle}>Fecha listado *</label>
          <input
            data-testid="input-listed-at"
            style={inputStyle}
            type="date"
            value={form.listedAt}
            onChange={e => set('listedAt', e.target.value)}
          />
          {errors.listedAt && <div style={errorTextStyle}>{errors.listedAt}</div>}
        </div>
      </div>

      <div style={gridTwo}>
        <div>
          <label style={labelStyle}>URL del listing *</label>
          <input
            data-testid="input-listing-url"
            style={inputStyle}
            type="text"
            value={form.listingUrl}
            onChange={e => set('listingUrl', e.target.value)}
          />
          {errors.listingUrl && <div style={errorTextStyle}>{errors.listingUrl}</div>}
        </div>
        <div>
          <label style={labelStyle}>Portal *</label>
          <select
            style={{ ...inputStyle, cursor: 'pointer' }}
            value={form.sourcePortal}
            onChange={e => set('sourcePortal', e.target.value)}
          >
            {portalOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {errors.sourcePortal && <div style={errorTextStyle}>{errors.sourcePortal}</div>}
        </div>
      </div>

      <div style={gridTwo}>
        <div>
          <label style={labelStyle}>Colonia</label>
          <input
            style={inputStyle}
            type="text"
            value={form.neighborhood}
            onChange={e => set('neighborhood', e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>Ciudad</label>
          <input
            data-testid="input-city"
            style={inputStyle}
            type="text"
            value={form.city}
            onChange={e => set('city', e.target.value)}
          />
        </div>
      </div>

      <div style={gridTwo}>
        <div>
          <label style={labelStyle}>Latitud</label>
          <input
            style={inputStyle}
            type="number"
            step="any"
            value={form.lat}
            onChange={e => set('lat', e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>Longitud</label>
          <input
            style={inputStyle}
            type="number"
            step="any"
            value={form.lng}
            onChange={e => set('lng', e.target.value)}
          />
        </div>
      </div>

      <div style={gridThree}>
        <div>
          <label style={labelStyle}>Recámaras</label>
          <input
            style={inputStyle}
            type="number"
            value={form.bedrooms}
            onChange={e => set('bedrooms', e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>Baños</label>
          <input
            style={inputStyle}
            type="number"
            step="0.5"
            value={form.bathrooms}
            onChange={e => set('bathrooms', e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>Estacionamientos</label>
          <input
            style={inputStyle}
            type="number"
            value={form.parkingSpots}
            onChange={e => set('parkingSpots', e.target.value)}
          />
        </div>
      </div>

      <div style={gridTwo}>
        <div>
          <label style={labelStyle}>Tipo</label>
          <select
            style={{ ...inputStyle, cursor: 'pointer' }}
            value={form.propertyType}
            onChange={e => set('propertyType', e.target.value)}
          >
            {propertyTypeOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Condición</label>
          <select
            style={{ ...inputStyle, cursor: 'pointer' }}
            value={form.condition}
            onChange={e => set('condition', e.target.value)}
          >
            {conditionOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={labelStyle}>Notas</label>
        <textarea
          style={{ ...inputStyle, resize: 'vertical', minHeight: '80px' }}
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
        />
      </div>

      {submitError && (
        <div style={{ ...errorTextStyle, fontSize: '12px', marginBottom: '12px' }}>{submitError}</div>
      )}

      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={handleSubmit}
          disabled={saving}
          style={{
            background: saving ? colors.border : colors.primary,
            color: colors.neutral,
            border: 'none',
            cursor: saving ? 'not-allowed' : 'pointer',
            fontFamily: fonts.label,
            fontSize: '11px',
            letterSpacing: '0.1em',
            padding: '10px 24px',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'GUARDANDO…' : 'GUARDAR'}
        </button>
        <button
          onClick={() => navigate('/propiedades/comparables')}
          style={{
            background: 'transparent',
            color: colors.secondary,
            border: `1px solid ${colors.border}`,
            cursor: 'pointer',
            fontFamily: fonts.label,
            fontSize: '11px',
            letterSpacing: '0.1em',
            padding: '10px 24px',
          }}
        >
          CANCELAR
        </button>
      </div>
    </div>
  )
}
