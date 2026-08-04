import { useEffect, useRef, useState } from 'react'
import { colors, fonts } from '../lib/theme'
import type { PropertyImage, ImageType } from '../lib/types'

interface Props {
  images: PropertyImage[]
  base: string
  onUpload: (file: File, imageType: ImageType) => Promise<void>
  onDelete: (imageId: number) => Promise<void>
  /** Ausente = la galería no clasifica (proveedores): todo es 'general'. */
  onChangeType?: (imageId: number, next: ImageType) => Promise<void>
}

const TYPES: readonly ImageType[] = ['general', 'antes', 'despues']

const TYPE_COLOR: Record<ImageType, string> = {
  general: colors.secondary,
  antes: colors.tertiary,
  despues: colors.primary,
}
const TYPE_LABEL: Record<ImageType, string> = {
  general: 'GENERAL', antes: 'ANTES', despues: 'DESPUÉS',
}

/**
 * Una sola galería para toda propiedad. El tipo de foto cuenta la historia de
 * la obra (antes → después) cuando la hubo, y se queda en 'general' cuando no:
 * una casa en prospecto y una remodelada se miran con el mismo componente.
 */
export function PhotoGallery({ images, base, onUpload, onDelete, onChangeType }: Props) {
  const classified = onChangeType != null
  const [filter, setFilter] = useState<'all' | ImageType>('all')
  const [selected, setSelected] = useState(0)
  const [lightbox, setLightbox] = useState(false)
  const [uploading, setUploading] = useState<ImageType | null>(null)
  const [changing, setChanging] = useState<number | null>(null)
  const [hoveredThumb, setHoveredThumb] = useState<number | null>(null)
  const fileRefs = useRef<Partial<Record<ImageType, HTMLInputElement | null>>>({})
  const lightboxRef = useRef<HTMLDivElement>(null)

  const byType = (type: ImageType) => images.filter(img => img.imageType === type)
  // Orden antes → después para que la tira y las flechas cuenten la obra.
  const ordered = TYPES.flatMap(byType)
  const visible = filter === 'all' ? ordered : byType(filter)
  const total = visible.length
  const safeIdx = total > 0 ? Math.min(selected, total - 1) : 0
  const current = visible[safeIdx] ?? null

  useEffect(() => { setSelected(0) }, [filter])
  useEffect(() => { if (lightbox && lightboxRef.current) lightboxRef.current.focus() }, [lightbox])

  function prev() { setSelected(i => (i - 1 + total) % total) }
  function next() { setSelected(i => (i + 1) % total) }

  async function handleUpload(type: ImageType, e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setUploading(type)
    try { for (const f of files) await onUpload(f, type) }
    finally { setUploading(null); e.target.value = '' }
  }

  async function handleDelete(imageId: number) {
    await onDelete(imageId)
    setSelected(i => Math.max(0, i - 1))
  }

  /** Rota general → antes → después → general: un clic, sin menú. */
  async function handleCycleType(img: PropertyImage) {
    if (!onChangeType) return
    setChanging(img.id)
    try { await onChangeType(img.id, TYPES[(TYPES.indexOf(img.imageType) + 1) % TYPES.length]) }
    finally { setChanging(null) }
  }

  function handleLightboxKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') setLightbox(false)
    else if (e.key === 'ArrowLeft') prev()
    else if (e.key === 'ArrowRight') next()
  }

  function renderThumb(img: PropertyImage, i: number) {
    return (
      <div key={img.id} style={{ position: 'relative', flexShrink: 0 }}
        onMouseEnter={() => setHoveredThumb(img.id)} onMouseLeave={() => setHoveredThumb(null)}>
        <img src={`${base}/files/${img.filePath}`} alt="" onClick={() => setSelected(i)}
          style={{ width: '52px', height: '52px', objectFit: 'cover', cursor: 'pointer', display: 'block',
            outline: i === safeIdx ? `2px solid ${colors.primary}` : 'none', outlineOffset: '-2px',
            borderBottom: classified ? `3px solid ${TYPE_COLOR[img.imageType]}` : 'none', boxSizing: 'border-box' }} />
        <button onClick={() => handleDelete(img.id)}
          style={{ position: 'absolute', top: '2px', right: '2px', width: '16px', height: '16px', background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>&times;</button>
        {classified && hoveredThumb === img.id && (
          <button onClick={() => handleCycleType(img)} disabled={changing === img.id} title="Cambiar tipo"
            style={{ position: 'absolute', top: '2px', right: '20px', width: '16px', height: '16px', background: 'rgba(0,0,0,0.7)', border: 'none', color: colors.secondary, cursor: changing === img.id ? 'wait' : 'pointer', fontSize: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
            {changing === img.id ? '…' : '⇄'}
          </button>
        )}
      </div>
    )
  }

  function uploadButton(type: ImageType) {
    const color = classified ? TYPE_COLOR[type] : colors.neutral
    return (
      <button onClick={() => fileRefs.current[type]?.click()} disabled={uploading !== null}
        style={{ flexShrink: 0, width: '52px', height: '52px', background: 'transparent', border: `1px dashed ${classified ? `${color}55` : colors.border}`, color: uploading === type ? colors.secondary : color, cursor: uploading !== null ? 'wait' : 'pointer', fontFamily: fonts.label, fontSize: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', letterSpacing: '0.06em' }}>
        <span style={{ fontSize: '16px', lineHeight: 1 }}>{uploading === type ? '…' : '+'}</span>
        {classified && <span>{type}</span>}
      </button>
    )
  }

  // Un grupo etiquetado con su conteo, sus miniaturas y su botón de subida.
  // startIndex mapea cada miniatura a su posición en `visible`.
  function thumbGroup(type: ImageType, startIndex: number) {
    const thumbs = byType(type)
    return (
      <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
        {classified && (
          <span style={{ flexShrink: 0, alignSelf: 'center', fontFamily: fonts.label, fontSize: '8px', fontWeight: 600, letterSpacing: '0.12em', color: TYPE_COLOR[type], padding: '0 4px', whiteSpace: 'nowrap' }}>
            {TYPE_LABEL[type]}<span style={{ opacity: 0.5, marginLeft: '3px' }}>{thumbs.length}</span>
          </span>
        )}
        {thumbs.map((img, k) => renderThumb(img, startIndex + k))}
        {uploadButton(type)}
      </div>
    )
  }

  const allGroups: readonly ImageType[] = classified ? TYPES : ['general']
  const groups = filter === 'all' ? allGroups : [filter]
  let cursor = 0

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Filtro por tipo — solo tiene sentido cuando hay tipos que filtrar */}
      {classified && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '4px 8px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
          {(['all', ...TYPES] as const).map((f, idx) => (
            <button key={f} onClick={() => setFilter(f)} style={{
              fontFamily: fonts.label, fontSize: '7px', letterSpacing: '0.1em',
              padding: '3px 9px',
              border: `1px solid ${colors.border}`, marginLeft: idx === 0 ? 0 : '-1px',
              background: filter === f ? colors.surfaceAlt : 'transparent',
              color: filter === f ? colors.neutral : colors.secondary, cursor: 'pointer',
            }}>
              {f === 'all' ? 'TODAS' : TYPE_LABEL[f]}
              <span style={{ marginLeft: '4px', opacity: 0.5 }}>{f === 'all' ? images.length : byType(f).length}</span>
            </button>
          ))}
        </div>
      )}

      {/* Vista principal */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {current ? (
          <>
            <img src={`${base}/files/${current.filePath}`} alt="" onClick={() => setLightbox(true)}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', cursor: 'zoom-in', display: 'block' }} />
            {classified && (
              <div style={{ position: 'absolute', top: '10px', left: '10px', fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.1em', padding: '2px 7px', background: `${TYPE_COLOR[current.imageType]}22`, color: TYPE_COLOR[current.imageType], border: `1px solid ${TYPE_COLOR[current.imageType]}55` }}>
                {TYPE_LABEL[current.imageType]}
              </div>
            )}
            <div style={{ position: 'absolute', top: '10px', right: '12px', fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.1em', color: colors.secondary, background: 'rgba(0,0,0,0.6)', padding: '3px 8px' }}>
              {safeIdx + 1} / {total}
            </div>
            {total > 1 && (
              <>
                <button onClick={prev} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '40px', background: 'linear-gradient(to right, rgba(0,0,0,0.4), transparent)', border: 'none', color: colors.neutral, cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&#8249;</button>
                <button onClick={next} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '40px', background: 'linear-gradient(to left, rgba(0,0,0,0.4), transparent)', border: 'none', color: colors.neutral, cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&#8250;</button>
              </>
            )}
          </>
        ) : (
          <div style={{ fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em', color: colors.border }}>SIN FOTOS</div>
        )}
      </div>

      {/* Tira de miniaturas, agrupada por tipo */}
      <div style={{ flexShrink: 0, display: 'flex', gap: '4px', padding: '8px', overflowX: 'auto', background: colors.dark, borderTop: `1px solid ${colors.border}`, scrollbarWidth: 'none', alignItems: 'center' }}>
        {groups.map((type, i) => {
          const group = thumbGroup(type, cursor)
          cursor += byType(type).length
          return (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              {i > 0 && <div style={{ width: '1px', alignSelf: 'stretch', background: colors.border, flexShrink: 0, margin: '2px 4px' }} />}
              {group}
            </div>
          )
        })}
        {TYPES.map(type => (
          <input key={type} ref={el => { fileRefs.current[type] = el }} type="file" accept="image/*" multiple
            style={{ display: 'none' }} onChange={e => handleUpload(type, e)} />
        ))}
      </div>

      {/* Lightbox */}
      {lightbox && current && (
        <div ref={lightboxRef} onClick={() => setLightbox(false)} onKeyDown={handleLightboxKey} tabIndex={0}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, cursor: 'zoom-out', outline: 'none' }}>
          <img src={`${base}/files/${current.filePath}`} alt=""
            style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain' }} onClick={e => e.stopPropagation()} />
          {total > 1 && (
            <>
              <button onClick={e => { e.stopPropagation(); prev() }} style={{ position: 'absolute', left: '20px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '28px', padding: '12px 16px', borderRadius: '4px' }}>&#8249;</button>
              <button onClick={e => { e.stopPropagation(); next() }} style={{ position: 'absolute', right: '20px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '28px', padding: '12px 16px', borderRadius: '4px' }}>&#8250;</button>
            </>
          )}
          <div style={{ position: 'absolute', top: '16px', right: '20px', fontFamily: fonts.label, fontSize: '9px', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em' }}>
            {safeIdx + 1} / {total} &middot; ESC para cerrar
          </div>
        </div>
      )}
    </div>
  )
}
