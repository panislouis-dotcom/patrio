import { useEffect, useRef, useState } from 'react'
import { colors, fonts } from '../lib/theme'
import type { PropertyImage } from '../lib/types'

interface Props {
  images: PropertyImage[]
  base: string
  onUpload: (file: File) => Promise<void>
  onDelete: (imageId: number) => Promise<void>
}

export function PhotoGallery({ images, base, onUpload, onDelete }: Props) {
  const [selected, setSelected] = useState(0)
  const [lightbox, setLightbox] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const lightboxRef = useRef<HTMLDivElement>(null)

  const total = images.length
  const safeIdx = total > 0 ? Math.min(selected, total - 1) : 0
  const current = images[safeIdx] ?? null

  useEffect(() => {
    if (lightbox && lightboxRef.current) {
      lightboxRef.current.focus()
    }
  }, [lightbox])

  function prev() { setSelected(i => (i - 1 + total) % total) }
  function next() { setSelected(i => (i + 1) % total) }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setUploading(true)
    try {
      for (const file of files) {
        await onUpload(file)
      }
      setSelected(Math.max(0, total + files.length - 1))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function handleDelete(imageId: number) {
    await onDelete(imageId)
    setSelected(i => Math.max(0, i - 1))
  }

  function handleLightboxKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') setLightbox(false)
    else if (e.key === 'ArrowLeft') prev()
    else if (e.key === 'ArrowRight') next()
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Large preview */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {current ? (
          <>
            <img
              src={`${base}/files/${current.filePath}`}
              alt=""
              onClick={() => setLightbox(true)}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', cursor: 'zoom-in', display: 'block' }}
            />
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
      <div style={{ flexShrink: 0, display: 'flex', gap: '4px', padding: '8px', overflowX: 'auto', background: colors.dark, borderTop: `1px solid ${colors.border}`, scrollbarWidth: 'none' }}>
        {images.map((img, i) => (
          <div key={img.id} style={{ position: 'relative', flexShrink: 0 }}>
            <img
              src={`${base}/files/${img.filePath}`}
              alt=""
              onClick={() => setSelected(i)}
              style={{ width: '52px', height: '52px', objectFit: 'cover', cursor: 'pointer', display: 'block', border: i === safeIdx ? `2px solid ${colors.primary}` : '2px solid transparent', boxSizing: 'border-box' }}
            />
            <button
              onClick={() => handleDelete(img.id)}
              style={{ position: 'absolute', top: '2px', right: '2px', width: '16px', height: '16px', background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
            >&times;</button>
          </div>
        ))}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{ flexShrink: 0, width: '52px', height: '52px', background: 'transparent', border: `1px dashed ${colors.border}`, color: uploading ? colors.secondary : colors.neutral, cursor: uploading ? 'wait' : 'pointer', fontFamily: fonts.label, fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {uploading ? '…' : '+'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleUpload} />
      </div>

      {/* Lightbox */}
      {lightbox && current && (
        <div
          ref={lightboxRef}
          onClick={() => setLightbox(false)}
          onKeyDown={handleLightboxKey}
          tabIndex={0}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, cursor: 'zoom-out', outline: 'none' }}
        >
          <img src={`${base}/files/${current.filePath}`} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain' }} onClick={e => e.stopPropagation()} />
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
