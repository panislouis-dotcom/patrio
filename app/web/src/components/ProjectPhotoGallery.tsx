import { useEffect, useRef, useState } from 'react'
import { colors, fonts } from '../lib/theme'
import type { ProjectImage, ImageType } from '../lib/types'

interface Props {
  images: ProjectImage[]
  base: string
  onUpload: (file: File, imageType: ImageType) => Promise<void>
  onDelete: (imageId: number) => Promise<void>
  onFlipType: (imageId: number, newType: ImageType) => Promise<void>
}

const TYPE_COLOR: Record<ImageType, string> = {
  antes: colors.tertiary,
  despues: colors.primary,
}
const TYPE_LABEL: Record<ImageType, string> = { antes: 'ANTES', despues: 'DESPUÉS' }

export function ProjectPhotoGallery({ images, base, onUpload, onDelete, onFlipType }: Props) {
  const [filter, setFilter] = useState<'all' | ImageType>('all')
  const [selected, setSelected] = useState(0)
  const [lightbox, setLightbox] = useState(false)
  const [uploading, setUploading] = useState<ImageType | null>(null)
  const [flipping, setFlipping] = useState<number | null>(null)
  const [hoveredThumb, setHoveredThumb] = useState<number | null>(null)
  const antesRef = useRef<HTMLInputElement>(null)
  const despuesRef = useRef<HTMLInputElement>(null)
  const lightboxRef = useRef<HTMLDivElement>(null)

  const visible = filter === 'all' ? images : images.filter(img => img.imageType === filter)
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

  async function handleFlip(img: ProjectImage) {
    setFlipping(img.id)
    try { await onFlipType(img.id, img.imageType === 'antes' ? 'despues' : 'antes') }
    finally { setFlipping(null) }
  }

  function handleLightboxKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') setLightbox(false)
    else if (e.key === 'ArrowLeft') prev()
    else if (e.key === 'ArrowRight') next()
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '4px 8px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
        {(['all', 'antes', 'despues'] as const).map((f, idx) => (
          <button key={f} onClick={() => setFilter(f)} style={{
            fontFamily: fonts.label, fontSize: '7px', letterSpacing: '0.1em',
            textTransform: 'uppercase', padding: '3px 9px',
            border: `1px solid ${colors.border}`, marginLeft: idx === 0 ? 0 : '-1px',
            background: filter === f ? colors.surfaceAlt : 'transparent',
            color: filter === f ? colors.neutral : colors.secondary, cursor: 'pointer',
          }}>
            {f === 'all' ? 'TODAS' : f === 'antes' ? 'ANTES' : 'DESPUÉS'}
          </button>
        ))}
      </div>

      {/* Main preview */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {current ? (
          <>
            <img src={`${base}/files/${current.filePath}`} alt="" onClick={() => setLightbox(true)}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', cursor: 'zoom-in', display: 'block' }} />
            <div style={{ position: 'absolute', top: '10px', left: '10px', fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.1em', padding: '2px 7px', background: `${TYPE_COLOR[current.imageType]}22`, color: TYPE_COLOR[current.imageType], border: `1px solid ${TYPE_COLOR[current.imageType]}55` }}>
              {TYPE_LABEL[current.imageType]}
            </div>
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

      {/* Thumbnail strip */}
      <div style={{ flexShrink: 0, display: 'flex', gap: '4px', padding: '8px', overflowX: 'auto', background: colors.dark, borderTop: `1px solid ${colors.border}`, scrollbarWidth: 'none', alignItems: 'center' }}>
        {visible.map((img, i) => (
          <div key={img.id} style={{ position: 'relative', flexShrink: 0 }}
            onMouseEnter={() => setHoveredThumb(img.id)} onMouseLeave={() => setHoveredThumb(null)}>
            <img src={`${base}/files/${img.filePath}`} alt="" onClick={() => setSelected(i)}
              style={{ width: '52px', height: '52px', objectFit: 'cover', cursor: 'pointer', display: 'block', border: i === safeIdx ? `2px solid ${colors.primary}` : '2px solid transparent', boxSizing: 'border-box' }} />
            {/* type dot */}
            <div style={{ position: 'absolute', bottom: '3px', left: '3px', width: '7px', height: '7px', borderRadius: '50%', background: TYPE_COLOR[img.imageType] }} />
            {/* delete */}
            <button onClick={() => handleDelete(img.id)} style={{ position: 'absolute', top: '2px', right: '2px', width: '16px', height: '16px', background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>&times;</button>
            {/* flip — on hover */}
            {hoveredThumb === img.id && (
              <button onClick={() => handleFlip(img)} disabled={flipping === img.id}
                style={{ position: 'absolute', top: '2px', right: '20px', width: '16px', height: '16px', background: 'rgba(0,0,0,0.7)', border: 'none', color: colors.secondary, cursor: flipping === img.id ? 'wait' : 'pointer', fontSize: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                {flipping === img.id ? '…' : '⇄'}
              </button>
            )}
          </div>
        ))}

        {/* Upload ANTES */}
        <button onClick={() => antesRef.current?.click()} disabled={uploading !== null}
          style={{ flexShrink: 0, width: '52px', height: '52px', background: 'transparent', border: `1px dashed ${colors.tertiary}55`, color: uploading === 'antes' ? colors.secondary : colors.tertiary, cursor: uploading !== null ? 'wait' : 'pointer', fontFamily: fonts.label, fontSize: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', letterSpacing: '0.06em' }}>
          <span style={{ fontSize: '16px', lineHeight: 1 }}>{uploading === 'antes' ? '…' : '+'}</span>
          <span>antes</span>
        </button>

        {/* Upload DESPUÉS */}
        <button onClick={() => despuesRef.current?.click()} disabled={uploading !== null}
          style={{ flexShrink: 0, width: '52px', height: '52px', background: 'transparent', border: `1px dashed ${colors.primary}55`, color: uploading === 'despues' ? colors.secondary : colors.primary, cursor: uploading !== null ? 'wait' : 'pointer', fontFamily: fonts.label, fontSize: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', letterSpacing: '0.06em' }}>
          <span style={{ fontSize: '16px', lineHeight: 1 }}>{uploading === 'despues' ? '…' : '+'}</span>
          <span>después</span>
        </button>

        <input ref={antesRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => handleUpload('antes', e)} />
        <input ref={despuesRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => handleUpload('despues', e)} />
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
