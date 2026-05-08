import { useEffect, useState } from 'react'
import { fetchTeam, createTeamMember, updateTeamMember, deleteTeamMember } from '../lib/api'
import type { TeamMember, MemberRole } from '../lib/types'
import { colors, fonts } from '../lib/theme'

const ROLE_LABEL: Record<MemberRole, string> = {
  director: 'Director',
  responsable_proyecto: 'Responsable de Proyecto',
  lider_proyecto: 'Líder de Proyecto',
  maestro: 'Maestro',
  ayudante: 'Ayudante',
  finder: 'Finder',
}

const ROLE_DESC: Record<MemberRole, string> = {
  director: 'Visión estratégica, decisiones de inversión, relación con inversionistas',
  responsable_proyecto: 'Ownership completo del proyecto, presupuesto y timelines',
  lider_proyecto: 'Coordinación de equipo en campo, supervisión de obra',
  maestro: 'Ejecución de obra especializada, gestión de cuadrilla',
  ayudante: 'Apoyo en actividades de campo y obra',
  finder: 'Prospección y captación de inversionistas para el fondo',
}

const ROLE_COLOR: Record<MemberRole, string> = {
  director: colors.primary,
  responsable_proyecto: colors.tertiary,
  lider_proyecto: colors.accent1,
  maestro: colors.accent2,
  ayudante: colors.secondary,
  finder: colors.neutral,
}

const ROLE_ORDER: MemberRole[] = ['director', 'responsable_proyecto', 'lider_proyecto', 'maestro', 'ayudante', 'finder']

function RoleBadge({ role }: { role: MemberRole }) {
  return (
    <span style={{
      fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.1em',
      color: ROLE_COLOR[role], textTransform: 'uppercase',
    }}>
      {ROLE_LABEL[role]}
    </span>
  )
}

// ─── Recursive org chart node ────────────────────

function OrgNode({ member, members }: { member: TeamMember; members: TeamMember[] }) {
  const children = members.filter(m => m.managerId === member.id)
  const roleColor = ROLE_COLOR[member.role]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Node card */}
      <div style={{
        background: colors.surfaceAlt,
        border: `1px solid ${colors.border}`,
        borderTop: `3px solid ${roleColor}`,
        padding: '10px 16px',
        width: '150px',
        textAlign: 'center',
      }}>
        <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral, marginBottom: '4px' }}>
          {member.name}
        </div>
        <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.08em', color: roleColor, textTransform: 'uppercase' }}>
          {ROLE_LABEL[member.role]}
        </span>
      </div>

      {children.length > 0 && (
        <>
          {/* Stem down */}
          <div style={{ width: '1px', height: '20px', background: colors.border }} />

          {/* Children row with horizontal connector */}
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            {children.map((child, i) => {
              const isFirst = i === 0
              const isLast = i === children.length - 1
              const isOnly = children.length === 1
              return (
                <div key={child.id} style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  // Horizontal connector: border-top on each cell, clipped at edges
                  borderTop: isOnly ? 'none' : `1px solid ${colors.border}`,
                  borderLeft: (!isOnly && isFirst) ? `1px solid ${colors.border}` : 'none',
                  borderRight: (!isOnly && isLast) ? `1px solid ${colors.border}` : 'none',
                  paddingLeft: '20px',
                  paddingRight: '20px',
                }}>
                  <div style={{ width: '1px', height: '20px', background: colors.border }} />
                  <OrgNode member={child} members={members} />
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Add member form ─────────────────────────────

function AddMemberForm({ members, onCreated }: { members: TeamMember[]; onCreated: (m: TeamMember) => void }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState<MemberRole>('ayudante')
  const [managerId, setManagerId] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const member = await createTeamMember({
        name: name.trim(),
        role,
        managerId: managerId ? Number(managerId) : null,
      })
      onCreated(member)
      setName('')
      setRole('ayudante')
      setManagerId('')
    } catch {
      setError('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    color: colors.neutral,
    fontFamily: fonts.sans,
    fontSize: '12px',
    padding: '5px 8px',
    outline: 'none',
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Nombre"
        style={{ ...inputStyle, minWidth: '160px' }}
      />
      <select
        value={role}
        onChange={e => setRole(e.target.value as MemberRole)}
        style={{ ...inputStyle }}
      >
        {ROLE_ORDER.map(r => (
          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
        ))}
      </select>
      <select
        value={managerId}
        onChange={e => setManagerId(e.target.value)}
        style={{ ...inputStyle }}
      >
        <option value="">— Sin manager</option>
        {members.map(m => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
      <button
        type="submit"
        disabled={saving || !name.trim()}
        style={{
          background: saving ? colors.border : colors.primary,
          border: 'none',
          color: colors.neutral,
          cursor: saving ? 'not-allowed' : 'pointer',
          fontFamily: fonts.label,
          fontSize: '10px',
          letterSpacing: '0.08em',
          padding: '6px 12px',
          opacity: saving ? 0.6 : 1,
        }}
      >
        {saving ? 'GUARDANDO…' : '+ AGREGAR'}
      </button>
      {error && <span style={{ color: 'tomato', fontFamily: fonts.label, fontSize: '10px' }}>{error}</span>}
    </form>
  )
}

// ─── Main tab ────────────────────────────────────

export function OrgTab() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editRole, setEditRole] = useState<MemberRole>('ayudante')
  const [editManagerId, setEditManagerId] = useState<string>('')
  const [savingId, setSavingId] = useState<number | null>(null)

  useEffect(() => {
    fetchTeam().then(data => { setMembers(data); setLoading(false) })
  }, [])

  const roots = members.filter(m => m.managerId === null)

  function startEdit(m: TeamMember) {
    setEditingId(m.id)
    setEditRole(m.role)
    setEditManagerId(m.managerId != null ? String(m.managerId) : '')
  }

  async function saveEdit(m: TeamMember) {
    setSavingId(m.id)
    try {
      const updated = await updateTeamMember(m.id, {
        role: editRole,
        managerId: editManagerId ? Number(editManagerId) : null,
      })
      setMembers(prev => prev.map(x => x.id === updated.id ? updated : x))
      setEditingId(null)
    } finally {
      setSavingId(null)
    }
  }

  async function handleDelete(m: TeamMember) {
    setSavingId(m.id)
    try {
      await deleteTeamMember(m.id)
      setMembers(prev => prev.filter(x => x.id !== m.id))
      setEditingId(null)
    } finally {
      setSavingId(null)
    }
  }

  const inputStyle = {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    color: colors.neutral,
    fontFamily: fonts.sans,
    fontSize: '11px',
    padding: '3px 6px',
    outline: 'none',
  }

  return (
    <div style={{ height: 'calc(100vh - 49px)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: `1px solid ${colors.border}` }}>
        <span style={{ fontFamily: fonts.label, fontSize: '11px', color: colors.neutral, letterSpacing: '0.1em' }}>EQUIPO</span>
        <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>{members.length} miembro{members.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Content — two columns */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {loading ? (
          <div style={{ padding: '24px 16px', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>Cargando…</div>
        ) : (
          <>
            {/* Left: list */}
            <div style={{ width: '400px', flexShrink: 0, borderRight: `1px solid ${colors.border}`, overflow: 'auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Role legend */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {ROLE_ORDER.map(r => (
                  <div key={r} style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                    <span style={{ fontFamily: fonts.label, fontSize: '9px', color: ROLE_COLOR[r], letterSpacing: '0.1em', textTransform: 'uppercase' }}>{ROLE_LABEL[r]}</span>
                    <span style={{ fontFamily: fonts.sans, fontSize: '10px', color: colors.secondary }}>{ROLE_DESC[r]}</span>
                  </div>
                ))}
              </div>

              <div style={{ borderTop: `1px solid ${colors.border}` }} />

              {/* Members table */}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <th style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'left', letterSpacing: '0.12em' }}>NOMBRE</th>
                    <th style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'left', letterSpacing: '0.12em' }}>ROL</th>
                    <th style={{ padding: '6px 10px', width: '70px' }} />
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => {
                    const manager = members.find(x => x.id === m.managerId)
                    const isEditing = editingId === m.id
                    const isSaving = savingId === m.id

                    return (
                      <tr key={m.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                        {/* Name + manager subtext */}
                        <td style={{ padding: '6px 10px' }}>
                          <div style={{ color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px' }}>{m.name}</div>
                          {!isEditing && (
                            <div style={{ color: colors.secondary, fontFamily: fonts.label, fontSize: '10px', marginTop: '1px' }}>
                              {manager?.name ?? '—'}
                            </div>
                          )}
                        </td>
                        {/* Role — selects stacked in edit mode */}
                        <td style={{ padding: '6px 10px' }}>
                          {isEditing ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <select value={editRole} onChange={e => setEditRole(e.target.value as MemberRole)} style={{ ...inputStyle, width: '100%' }}>
                                {ROLE_ORDER.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                              </select>
                              <select value={editManagerId} onChange={e => setEditManagerId(e.target.value)} style={{ ...inputStyle, width: '100%' }}>
                                <option value="">— Sin manager</option>
                                {members.filter(x => x.id !== m.id).map(x => (
                                  <option key={x.id} value={x.id}>{x.name}</option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <RoleBadge role={m.role} />
                          )}
                        </td>
                        {/* Actions */}
                        <td style={{ padding: '6px 10px', textAlign: 'right', verticalAlign: 'middle' }}>
                          {isEditing ? (
                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                              <button
                                onClick={() => saveEdit(m)}
                                disabled={isSaving}
                                style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '3px 8px', opacity: isSaving ? 0.6 : 1 }}
                              >
                                {isSaving ? '…' : 'OK'}
                              </button>
                              <button
                                onClick={() => handleDelete(m)}
                                disabled={isSaving}
                                style={{ background: 'tomato', border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '3px 8px', opacity: isSaving ? 0.6 : 1 }}
                              >
                                BORRAR
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '10px', padding: '3px 6px' }}
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startEdit(m)}
                              style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '3px 8px', letterSpacing: '0.06em' }}
                            >
                              EDITAR
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Right: org chart */}
            <div style={{ flex: 1, overflow: 'auto', padding: '40px 24px', display: 'flex', gap: '40px', justifyContent: 'center', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {roots.map(root => (
                <OrgNode key={root.id} member={root} members={members} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Add member footer */}
      <div style={{ padding: '12px 16px', borderTop: `1px solid ${colors.border}`, background: colors.dark }}>
        <AddMemberForm
          members={members}
          onCreated={m => setMembers(prev => [...prev, m])}
        />
      </div>
    </div>
  )
}
