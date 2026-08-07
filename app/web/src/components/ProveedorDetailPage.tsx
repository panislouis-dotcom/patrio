import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { colors, fonts } from '../lib/theme'
import { fieldInput } from '../lib/styles'
import type { Proveedor, ProveedorCategory, ProveedorAssignment } from '../lib/types'
import { updateProveedor, setProveedorCategories, deleteProveedor, uploadProveedorPhoto, deleteProveedorPhoto, getProveedorAssignments } from '../lib/api'
import { RatingDisplay } from './RatingDisplay'
import { PhotoGallery } from './PhotoGallery'
import { PROCESS_STATUS_COLOR, PROCESS_STATUS_LABEL } from '../lib/status'

const STATUS_COLOR: Record<string, string> = {
  activo: colors.primary,
  inactivo: colors.secondary,
  vetado: '#B33333',
}

interface Props {
  proveedor: Proveedor
  allCategories: ProveedorCategory[]
  base: string
  onBack: () => void
  onUpdate: (p: Proveedor) => void
  onDelete: (id: number) => void
}

export function ProveedorDetailPage({ proveedor, allCategories, base, onBack, onUpdate, onDelete }: Props) {
  const navigate = useNavigate()
  const [leftTab, setLeftTab] = useState<'info' | 'editar' | 'fotos'>('info')
  const [saving, setSaving] = useState(false)
  const [assignments, setAssignments] = useState<ProveedorAssignment[]>([])
  // Edit form state — initialize from proveedor
  const [form, setForm] = useState({
    name: proveedor.name,
    phone: proveedor.phone,
    email: proveedor.email,
    website: proveedor.website,
    zona: proveedor.zona,
    status: proveedor.status as string,
    vetoReason: proveedor.vetoReason ?? '',
    ratingCalidad: proveedor.ratingCalidad,
    ratingPuntualidad: proveedor.ratingPuntualidad,
    ratingPrecio: proveedor.ratingPrecio,
    notes: proveedor.notes ?? '',
  })
  const [selectedCatIds, setSelectedCatIds] = useState<number[]>((proveedor.categories ?? []).map(c => c.id))
  const [localPhotos, setLocalPhotos] = useState(proveedor.photos ?? [])
  const [localCategories, setLocalCategories] = useState<ProveedorCategory[]>(allCategories)

  useEffect(() => {
    setForm({
      name: proveedor.name,
      phone: proveedor.phone,
      email: proveedor.email,
      website: proveedor.website,
      zona: proveedor.zona,
      status: proveedor.status as string,
      vetoReason: proveedor.vetoReason ?? '',
      ratingCalidad: proveedor.ratingCalidad,
      ratingPuntualidad: proveedor.ratingPuntualidad,
      ratingPrecio: proveedor.ratingPrecio,
      notes: proveedor.notes ?? '',
    })
    setSelectedCatIds((proveedor.categories ?? []).map(c => c.id))
    setLocalPhotos(proveedor.photos ?? [])
  }, [proveedor.id])

  useEffect(() => {
    getProveedorAssignments(proveedor.id).then(setAssignments).catch(() => setAssignments([]))
  }, [proveedor.id])

  useEffect(() => {
    setLocalCategories(allCategories)
  }, [allCategories])

  const handleSave = async () => {
    setSaving(true)
    try {
      const data: Record<string, unknown> = { ...form }
      // Only send vetoReason if status is vetado
      if (data.status !== 'vetado') delete data.vetoReason
      const updated = await updateProveedor(proveedor.id, data)
      const withCats = await setProveedorCategories(proveedor.id, selectedCatIds)
      onUpdate({ ...updated, categories: withCats.categories, photos: localPhotos })
    } catch (err) {
      console.error('Save failed', err)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`¿Eliminar "${proveedor.name}"?`)) return
    await deleteProveedor(proveedor.id)
    onDelete(proveedor.id)
  }

  const handleUploadPhoto = async (file: File) => {
    const photo = await uploadProveedorPhoto(proveedor.id, file)
    setLocalPhotos(prev => [...prev, photo])
  }

  const handleDeletePhoto = async (photoId: number) => {
    await deleteProveedorPhoto(proveedor.id, photoId)
    setLocalPhotos(prev => prev.filter(p => p.id !== photoId))
  }

  // Un proveedor no tiene obra que contar: sus fotos no llevan tipo, y la
  // galería —sin onChangeType— se comporta como una tira simple sin grupos.
  const galleryImages = localPhotos.map(p => ({ id: p.id, filePath: p.filePath }))

  const TAB_LABELS: Record<string, string> = { info: 'INFO', editar: 'EDITAR', fotos: 'FOTOS' }

  const tabBtn = (tab: 'info' | 'editar' | 'fotos'): React.CSSProperties => ({
    background: 'transparent', border: 'none',
    borderBottom: leftTab === tab ? `2px solid ${colors.primary}` : '2px solid transparent',
    color: leftTab === tab ? colors.neutral : colors.secondary,
    cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px',
    letterSpacing: '0.12em', padding: '10px 16px 8px', textTransform: 'uppercase',
  })

  const fieldLabel: React.CSSProperties = {
    fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em',
    color: colors.secondary, marginBottom: '4px', display: 'block',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>←</button>
        <span style={{ flex: 1, fontFamily: fonts.serif, fontSize: '18px', color: colors.neutral }}>{proveedor.name}</span>
        <span style={{ fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', color: STATUS_COLOR[proveedor.status] }}>
          {proveedor.status.toUpperCase()}
        </span>
        <button onClick={handleDelete} style={{ background: 'transparent', border: `1px solid #d44`, borderRadius: '2px', color: '#B33333', cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '5px 10px' }}>ELIMINAR</button>
      </div>

      {/* Body: 360px left + flex-1 right */}
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', flex: 1, overflow: 'hidden' }}>
        {/* Left panel */}
        <div style={{ borderRight: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
            {(['info', 'editar', 'fotos'] as const).map(tab => (
              <button key={tab} onClick={() => setLeftTab(tab)} style={tabBtn(tab)}>
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            {/* INFO TAB */}
            {leftTab === 'info' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Contact info */}
                {[
                  { label: 'TELÉFONO', value: proveedor.phone },
                  { label: 'EMAIL', value: proveedor.email },
                  { label: 'WEBSITE', value: proveedor.website },
                  { label: 'ZONA', value: proveedor.zona },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <span style={fieldLabel}>{label}</span>
                    <div style={{ fontSize: '12px', color: value ? colors.neutral : colors.secondary, fontFamily: fonts.sans }}>
                      {value || '—'}
                    </div>
                  </div>
                ))}

                {/* Ratings */}
                <div>
                  <span style={fieldLabel}>RATINGS</span>
                  {[
                    { label: 'Calidad', value: proveedor.ratingCalidad },
                    { label: 'Puntualidad', value: proveedor.ratingPuntualidad },
                    { label: 'Precio', value: proveedor.ratingPrecio },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <span style={{ fontSize: '12px', color: colors.secondary, fontFamily: fonts.sans }}>{label}</span>
                      <RatingDisplay value={value} mode="dots" />
                    </div>
                  ))}
                </div>

                {/* Categories */}
                {(proveedor.categories ?? []).length > 0 && (
                  <div>
                    <span style={fieldLabel}>ESPECIALIDADES</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {(proveedor.categories ?? []).map(c => (
                        <span key={c.id} style={{ background: colors.surfaceAlt, border: `1px solid ${colors.border}`, borderRadius: '2px', color: colors.neutral, fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '3px 8px' }}>
                          {c.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Notes */}
                {proveedor.notes && (
                  <div>
                    <span style={fieldLabel}>NOTAS</span>
                    <div style={{ fontSize: '12px', color: colors.secondary, fontFamily: fonts.sans, lineHeight: 1.5 }}>{proveedor.notes}</div>
                  </div>
                )}

                {/* Veto reason */}
                {proveedor.status === 'vetado' && proveedor.vetoReason && (
                  <div style={{ background: '#FBEAEA', border: '1px solid #d44', borderRadius: '4px', padding: '10px 12px' }}>
                    <span style={{ ...fieldLabel, color: '#B33333' }}>RAZÓN DE VETO</span>
                    <div style={{ fontSize: '12px', color: colors.neutral, fontFamily: fonts.sans }}>{proveedor.vetoReason}</div>
                  </div>
                )}
              </div>
            )}

            {/* EDITAR TAB */}
            {leftTab === 'editar' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[
                  { key: 'name', label: 'NOMBRE' },
                  { key: 'phone', label: 'TELÉFONO' },
                  { key: 'email', label: 'EMAIL' },
                  { key: 'website', label: 'WEBSITE' },
                  { key: 'zona', label: 'ZONA DE COBERTURA' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <span style={fieldLabel}>{label}</span>
                    <input
                      value={(form as Record<string, unknown>)[key] as string ?? ''}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                      style={fieldInput}
                    />
                  </div>
                ))}

                {/* Status */}
                <div>
                  <span style={fieldLabel}>STATUS</span>
                  <select
                    data-testid="status-select"
                    value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    style={{ ...fieldInput, cursor: 'pointer' }}
                  >
                    <option value="activo">Activo</option>
                    <option value="inactivo">Inactivo</option>
                    <option value="vetado">Vetado</option>
                  </select>
                </div>

                {/* Veto reason — only show when vetado */}
                {form.status === 'vetado' && (
                  <div>
                    <span style={{ ...fieldLabel, color: '#B33333' }}>RAZÓN DE VETO *</span>
                    <input
                      value={form.vetoReason}
                      onChange={e => setForm(f => ({ ...f, vetoReason: e.target.value }))}
                      style={{ ...fieldInput, borderColor: '#d44' }}
                    />
                  </div>
                )}

                {/* Ratings */}
                {[
                  { key: 'ratingCalidad', label: 'CALIDAD (1-5)' },
                  { key: 'ratingPuntualidad', label: 'PUNTUALIDAD (1-5)' },
                  { key: 'ratingPrecio', label: 'PRECIO (1-5)' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <span style={fieldLabel}>{label}</span>
                    <select
                      value={(form as Record<string, unknown>)[key] as number ?? ''}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value ? parseInt(e.target.value) : null }))}
                      style={{ ...fieldInput, cursor: 'pointer' }}
                    >
                      <option value="">Sin calificar</option>
                      {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                ))}

                {/* Category single-select */}
                <div>
                  <span style={fieldLabel}>TIPO</span>
                  <select
                    value={selectedCatIds[0] ?? ''}
                    onChange={e => setSelectedCatIds(e.target.value ? [Number(e.target.value)] : [])}
                    style={{ ...fieldInput, cursor: 'pointer' }}
                  >
                    <option value="">— Sin tipo</option>
                    {localCategories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                {/* Notes */}
                <div>
                  <span style={fieldLabel}>NOTAS</span>
                  <textarea
                    value={form.notes ?? ''}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    rows={4}
                    style={{ ...fieldInput, resize: 'vertical' as const }}
                  />
                </div>

                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{ background: colors.primary, border: 'none', borderRadius: '2px', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: '10px', marginTop: '8px' }}
                >
                  {saving ? '...' : 'GUARDAR'}
                </button>
              </div>
            )}

            {/* FOTOS TAB */}
            {leftTab === 'fotos' && (
              <PhotoGallery
                images={galleryImages}
                base={base}
                onUpload={handleUploadPhoto}
                onDelete={handleDeletePhoto}
              />
            )}
          </div>
        </div>

        {/* Right panel — ratings + process assignments */}
        <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Ratings summary */}
          <div>
            <div style={{ fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em', color: colors.secondary, marginBottom: '12px' }}>CALIFICACIONES</div>
            {[
              { label: 'Calidad', value: proveedor.ratingCalidad },
              { label: 'Puntualidad', value: proveedor.ratingPuntualidad },
              { label: 'Precio', value: proveedor.ratingPrecio },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary }}>{label}</span>
                <RatingDisplay value={value} mode="dots" size={10} />
              </div>
            ))}
          </div>

          {/* Process task assignments */}
          <div>
            <div style={{ fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em', color: colors.secondary, marginBottom: '10px' }}>
              TAREAS ASIGNADAS ({assignments.length})
            </div>
            {assignments.length === 0 ? (
              <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>
                No asignado a ninguna tarea todavía.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {assignments.map(a => (
                  <button
                    key={a.stateId}
                    onClick={() => navigate(`/procesos/tareas/${a.instanceId}/nodos/${a.nodeId}`)}
                    style={{
                      background: colors.surfaceAlt,
                      border: `1px solid ${colors.border}`,
                      borderRadius: '3px',
                      cursor: 'pointer',
                      padding: '8px 12px',
                      textAlign: 'left',
                      width: '100%',
                    }}
                  >
                    <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, marginBottom: '2px' }}>
                      {a.nodeName}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.06em' }}>
                        {a.instanceName}
                      </span>
                      <span style={{ fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', color: PROCESS_STATUS_COLOR[a.status] ?? colors.secondary }}>
                        {PROCESS_STATUS_LABEL[a.status] ?? a.status}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
