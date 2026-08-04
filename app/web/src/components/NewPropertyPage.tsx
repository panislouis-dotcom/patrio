import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createProperty } from '../lib/api'
import type { PropertyCreate } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { PropertyForm } from './PropertyForm'

/**
 * El alta con formulario completo, para cuando ya se sabe todo del inmueble.
 * (La captura rápida con IA vive en el modal de la tabla.) Nace prospecto: la
 * etapa no se elige, se recorre.
 */
const DEFAULTS: Partial<PropertyCreate> = {
  city: 'Monterrey',
  acquisitionCostPct: 0.065,
  constructionOverhead: 1.3,
  holdMonths: 12,
}

export function NewPropertyPage() {
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function handleSave(data: PropertyCreate) {
    setSaving(true)
    setSaveError(null)
    try {
      const created = await createProperty(data)
      navigate(`/propiedades/${created.id}`, { replace: true })
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
        <button
          onClick={() => navigate('/propiedades')}
          style={{ background: 'none', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '11px', letterSpacing: '0.1em', padding: 0 }}
        >
          ← PROPIEDADES
        </button>
      </div>
      <PropertyForm initial={DEFAULTS} onSave={handleSave} saving={saving} saveError={saveError} />
    </div>
  )
}
