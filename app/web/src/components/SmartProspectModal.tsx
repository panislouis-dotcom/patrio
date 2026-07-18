import { useCallback, useEffect, useRef, useState } from 'react'
import { parseProspect, createProspect, uploadProspectImage } from '../lib/api'
import type { ParsedProspect } from '../lib/types'
import { PROPERTY_TYPES } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { LatLonPicker } from './LatLonPicker'

interface Props {
  onClose: () => void
  onCreated: () => void
}

const _DEFAULTS = {
  status:               'evaluating',
  type:                 '',
  acquisitionCostPct:   0.065,
  constructionOverhead: 1.3,
  latitude:             0,
  longitude:            0,
  sqmLand:              0,
  sqmConstruction:      0,
  landPrice:            0,
  permitsCost:          0,
  subdivisionCost:      0,
  constructionCostPerSqm: 0,
  projectedSale:        0,
  rentMonthly:          0,
  holdMonths:           12,
  notes:                '-',
}

const inp: React.CSSProperties = {
  background:   'transparent',
  border:       'none',
  color:        colors.neutral,
  fontFamily:   fonts.sans,
  fontSize:     '13px',
  padding:      '4px 0',
  width:        '100%',
  outline:      'none',
}

function Field({
  label, value, onChange, type = 'text', filled = false, placeholder = '',
}: {
  label: string
  value: string | number
  onChange: (v: string) => void
  type?: string
  filled?: boolean
  placeholder?: string
}) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
        <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          {label}
        </span>
        {filled && <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.primary, letterSpacing: '0.06em' }}>✓</span>}
      </div>
      <div style={{ borderBottom: `1px solid ${filled ? colors.primary : colors.border}`, transition: 'border-color 0.2s' }}>
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ ...inp, color: filled ? colors.neutral : colors.secondary }}
        />
      </div>
    </div>
  )
}

export function SmartProspectModal({ onClose, onCreated }: Props) {
  const [step, setStep]           = useState<'capture' | 'review'>('capture')
  const [url, setUrl]             = useState('')
  const [text, setText]           = useState('')
  const [parsing, setParsing]     = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)

  const [parsed, setParsed]       = useState<ParsedProspect | null>(null)
  const [name, setName]           = useState('')
  const [address, setAddress]     = useState('')
  const [city, setCity]           = useState('Monterrey')
  const [landPrice, setLandPrice] = useState(0)
  const [sqmLand, setSqmLand]     = useState(0)
  const [sqmConstruction, setSqmConstruction]               = useState(0)
  const [projectedSale, setProjectedSale]                   = useState(0)
  const [holdMonths, setHoldMonths]                         = useState(12)
  const [constructionCostPerSqm, setConstructionCostPerSqm] = useState(0)
  const [rentMonthly, setRentMonthly] = useState(0)

  const [image, setImage]               = useState<Blob | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const [tipo, setTipo]           = useState('')

  const [saving, setSaving]       = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lat, setLat]             = useState(0)
  const [lon, setLon]             = useState(0)

  const handleImageSelect = useCallback((blob: Blob) => {
    setImagePreview(prev => { if (prev) URL.revokeObjectURL(prev); return null })
    setImage(blob)
    setImagePreview(URL.createObjectURL(blob))
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])


  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (step !== 'capture') return
      const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'))
      if (!item) return
      const blob = item.getAsFile()
      if (blob) handleImageSelect(blob)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [handleImageSelect, step])

  async function handleAnalyze() {
    setParsing(true)
    setParseError(null)
    try {
      const result = await parseProspect(url.trim(), text.trim(), image ?? undefined)
      setParsed(result)
      setName(result.name || '')
      setAddress(result.address || '')
      setCity(result.city || 'Monterrey')
      setTipo(result.type || '')
      setLandPrice(result.price || 0)
      setSqmLand(result.sqmLand || 0)
      setSqmConstruction(result.sqmConstruction || 0)
      setLat(result.latitude ?? 0)
      setLon(result.longitude ?? 0)
      setStep('review')
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Error al analizar')
    } finally {
      setParsing(false)
    }
  }

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setSaveError(null)
    try {
      const created = await createProspect({
        ..._DEFAULTS,
        name:                 name.trim(),
        address:              address.trim() || name.trim(),
        city:                 city.trim() || 'Monterrey',
        type:                 tipo,
        landPrice,
        sqmLand,
        sqmConstruction,
        projectedSale,
        holdMonths,
        constructionCostPerSqm,
        rentMonthly,
        url:                  url.trim() || undefined,
        notes:                text.trim() || parsed?.notes || undefined,
        latitude:             lat,
        longitude:            lon,
      })
      if (image && created?.id) {
        try { await uploadProspectImage(created.id, image instanceof File ? image : new File([image], 'screenshot.png', { type: image.type })) } catch { /* non-fatal */ }
      }
      onCreated()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  // Count how many key fields were filled by the parser
  const filledCount = parsed
    ? [parsed.name, parsed.address, parsed.price, parsed.sqmLand, parsed.sqmConstruction, parsed.latitude]
        .filter(v => v !== '' && v !== 0 && v != null).length
    : 0

  const canAnalyze = (url.trim() || text.trim() || image) && !parsing

  const saveBlockers: string[] = []
  if (!name.trim())                                    saveBlockers.push('Nombre')
  if (!landPrice)                                      saveBlockers.push('Precio de terreno')
  if (!projectedSale)                                  saveBlockers.push('Venta proyectada (para ROI y profit)')
  if (!rentMonthly)                                    saveBlockers.push('Renta mensual (para cap rate)')
  if (sqmConstruction > 0 && !constructionCostPerSqm) saveBlockers.push('Costo/m² de construcción')
  const canSave = !saving && saveBlockers.length === 0

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  }
  const box: React.CSSProperties = {
    background:   colors.surfaceAlt,
    border:       `1px solid ${colors.border}`,
    borderRadius: '2px',
    padding:      '28px 32px',
    width:        '440px',
    maxWidth:     'calc(100vw - 32px)',
    maxHeight:    'calc(100vh - 64px)',
    overflowY:    'auto',
  }
  const btn = (primary: boolean, disabled = false): React.CSSProperties => ({
    background:   primary ? colors.primary : 'transparent',
    border:       primary ? 'none' : `1px solid ${colors.border}`,
    color:        primary ? colors.neutral : colors.secondary,
    fontFamily:   fonts.label,
    fontSize:     '10px',
    letterSpacing: '0.1em',
    padding:      '6px 14px',
    cursor:       disabled ? 'not-allowed' : 'pointer',
    opacity:      disabled ? 0.5 : 1,
  })

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={box}>

        {/* Header */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontFamily: fonts.label, fontSize: '11px', color: colors.neutral, letterSpacing: '0.12em' }}>
            NUEVO PROSPECTO
          </div>
          {step === 'review' && (
            <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.primary, letterSpacing: '0.08em', marginTop: '4px' }}>
              ◈ {filledCount} campo{filledCount !== 1 ? 's' : ''} encontrado{filledCount !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        {/* ── Step 1: Capture ── */}
        {step === 'capture' && (
          <>
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.1em', marginBottom: '4px', textTransform: 'uppercase' }}>
                URL (opcional)
              </div>
              <div style={{ borderBottom: `1px solid ${colors.border}` }}>
                <input
                  type="url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://lamudi.com.mx/..."
                  style={{ ...inp, color: url ? colors.neutral : colors.secondary }}
                  autoFocus
                />
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.1em', marginBottom: '4px', textTransform: 'uppercase' }}>
                Descripción / notas
              </div>
              <div style={{ border: `1px solid ${colors.border}`, padding: '8px' }}>
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Pega descripción, mensaje, o escribe lo que sabes de la propiedad…"
                  rows={4}
                  style={{ ...inp, resize: 'vertical', lineHeight: '1.5', color: text ? colors.neutral : colors.secondary }}
                />
              </div>
            </div>

            {/* Image paste / drop zone */}
            <div
              style={{
                border: `1px dashed ${imagePreview ? colors.primary : colors.border}`,
                borderRadius: '2px',
                padding: '16px',
                marginBottom: '20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                position: 'relative',
              }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault()
                const file = e.dataTransfer.files[0]
                if (file?.type.startsWith('image/')) handleImageSelect(file)
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) handleImageSelect(file)
                }}
              />
              {imagePreview ? (
                <>
                  <img src={imagePreview} alt="preview" style={{ maxHeight: '120px', maxWidth: '100%', objectFit: 'contain' }} />
                  <button
                    style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.06em' }}
                    onClick={e => {
                      e.stopPropagation()
                      if (imagePreview) URL.revokeObjectURL(imagePreview)
                      setImage(null)
                      setImagePreview(null)
                    }}
                  >
                    QUITAR IMAGEN
                  </button>
                </>
              ) : (
                <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.06em', textAlign: 'center' }}>
                  PEGAR IMAGEN (Ctrl+V) · ARRASTRAR · O HACER CLIC
                </span>
              )}
            </div>

            {parseError && (
              <div style={{ fontFamily: fonts.label, fontSize: '10px', color: 'tomato', marginBottom: '16px' }}>
                {parseError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button style={btn(false)} onClick={onClose}>CANCELAR</button>
              <button style={btn(false)} onClick={() => setStep('review')}>LLENAR MANUALMENTE ▸</button>
              <button style={btn(true, !canAnalyze)} onClick={handleAnalyze} disabled={!canAnalyze}>
                {parsing ? 'ANALIZANDO…' : 'ANALIZAR ▸'}
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: Review ── */}
        {step === 'review' && (
          <>
            <Field
              label="Nombre"
              value={name}
              onChange={setName}
              filled={!!parsed?.name}
              placeholder="Nombre del prospecto"
            />
            <Field
              label="Dirección"
              value={address}
              onChange={setAddress}
              filled={!!parsed?.address}
              placeholder="Calle, colonia, ciudad"
            />

            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Tipo
                </span>
                {tipo && <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.primary, letterSpacing: '0.06em' }}>✓</span>}
              </div>
              <div style={{ borderBottom: `1px solid ${tipo ? colors.primary : colors.border}`, transition: 'border-color 0.2s' }}>
                <select
                  value={tipo}
                  onChange={e => setTipo(e.target.value)}
                  style={{ ...inp, color: tipo ? colors.neutral : colors.secondary, cursor: 'pointer' }}
                >
                  <option value="">— seleccionar —</option>
                  {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <Field
                label="Ciudad"
                value={city}
                onChange={setCity}
                filled={!!parsed?.city && parsed.city !== 'Monterrey'}
                placeholder="Monterrey"
              />
              <Field
                label="M² Terreno"
                value={sqmLand || ''}
                onChange={v => setSqmLand(parseFloat(v) || 0)}
                type="number"
                filled={(parsed?.sqmLand ?? 0) > 0}
                placeholder="0"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <Field
                label="M² Construcción"
                value={sqmConstruction || ''}
                onChange={v => setSqmConstruction(parseFloat(v) || 0)}
                type="number"
                filled={(parsed?.sqmConstruction ?? 0) > 0}
                placeholder="0"
              />
              <Field
                label="Costo constr./m² (MXN)"
                value={constructionCostPerSqm || ''}
                onChange={v => setConstructionCostPerSqm(parseFloat(v) || 0)}
                type="number"
                filled={false}
                placeholder="0"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <Field
                label="Precio terreno (MXN)"
                value={landPrice || ''}
                onChange={v => setLandPrice(parseFloat(v) || 0)}
                type="number"
                filled={(parsed?.price ?? 0) > 0}
                placeholder="0"
              />
              <Field
                label="Venta proyectada (MXN)"
                value={projectedSale || ''}
                onChange={v => setProjectedSale(parseFloat(v) || 0)}
                type="number"
                filled={false}
                placeholder="0"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <Field
                label="Renta mensual (MXN)"
                value={rentMonthly || ''}
                onChange={v => setRentMonthly(parseFloat(v) || 0)}
                type="number"
                filled={false}
                placeholder="0"
              />
              <Field
                label="Plazo (meses)"
                value={holdMonths || ''}
                onChange={v => setHoldMonths(parseInt(v) || 12)}
                type="number"
                filled={false}
                placeholder="12"
              />
            </div>

            {/* Geo info strip */}
            {parsed?.municipioName && (
              <div style={{ marginBottom: '8px' }}>
                <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.primary, letterSpacing: '0.06em' }}>
                  📍 {parsed.municipioName}{parsed.colonia ? ` · ${parsed.colonia}` : ''}
                </span>
              </div>
            )}

            {/* Lat/lon picker */}
            <div style={{ marginBottom: '20px' }}>
              <LatLonPicker lat={lat} lon={lon} onChange={(newLat, newLon) => { setLat(newLat); setLon(newLon) }} />
            </div>

            {saveBlockers.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                {saveBlockers.map((b, i) => (
                  <div key={i} style={{ fontFamily: fonts.label, fontSize: '9px', color: 'tomato', letterSpacing: '0.05em', lineHeight: '1.8' }}>
                    ✕ {b}
                  </div>
                ))}
              </div>
            )}

            {saveError && (
              <div style={{ fontFamily: fonts.label, fontSize: '10px', color: 'tomato', marginBottom: '16px' }}>
                {saveError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
              <button style={btn(false)} onClick={() => { setStep('capture'); setSaveError(null) }}>← VOLVER</button>
              <button style={btn(true, !canSave)} onClick={handleSave} disabled={!canSave}>
                {saving ? 'GUARDANDO…' : 'GUARDAR ▸'}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
