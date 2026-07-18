import { useEffect, useState } from 'react'
import {
  fetchTeam, createTeamMember, updateTeamMember, deleteTeamMember,
  fetchUsers, fetchMe, createUser, updateUser, deleteUser,
} from '../lib/api'
import type { TeamMember, MemberRole, User } from '../lib/types'
import { colors, fonts } from '../lib/theme'
// ─── Role metadata ───────────────────────────────

const ROLE_LABEL: Record<MemberRole, string> = {
  director:              'Director',
  responsable_proyecto:  'Responsable de Proyecto',
  lider_proyecto:        'Líder de Proyecto',
  maestro:               'Maestro',
  ayudante:              'Ayudante',
  finder:                'Finder',
}

const ROLE_DESC: Record<MemberRole, string> = {
  director:             'Visión estratégica, decisiones de inversión, relación con inversionistas',
  responsable_proyecto: 'Ownership completo del proyecto, presupuesto y timelines',
  lider_proyecto:       'Coordinación de equipo en campo, supervisión de obra',
  maestro:              'Ejecución de obra especializada, gestión de cuadrilla',
  ayudante:             'Apoyo en actividades de campo y obra',
  finder:               'Prospección y captación de inversionistas para el fondo',
}

const ROLE_COLOR: Record<MemberRole, string> = {
  director:             colors.primary,
  responsable_proyecto: colors.tertiary,
  lider_proyecto:       colors.accent1,
  maestro:              colors.accent2,
  ayudante:             colors.secondary,
  finder:               colors.neutral,
}

const ROLE_ORDER: MemberRole[] = [
  'director', 'responsable_proyecto', 'lider_proyecto', 'maestro', 'ayudante', 'finder',
]

// ─── Shared styles ───────────────────────────────

const inputBase = (extra?: React.CSSProperties): React.CSSProperties => ({
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  color: colors.neutral,
  fontFamily: fonts.sans,
  fontSize: '12px',
  padding: '5px 8px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  ...extra,
})

const labelBase: React.CSSProperties = {
  fontFamily: fonts.label,
  fontSize: '8px',
  letterSpacing: '0.12em',
  color: colors.secondary,
  textTransform: 'uppercase',
  display: 'block',
  marginBottom: '3px',
}

const btnBase = (variant: 'primary' | 'ghost' | 'danger'): React.CSSProperties => ({
  border: variant === 'ghost' ? `1px solid ${colors.border}` : 'none',
  background:
    variant === 'primary' ? colors.primary :
    variant === 'danger' ? '#8B2020' :
    'transparent',
  color: colors.neutral,
  fontFamily: fonts.label,
  fontSize: '9px',
  letterSpacing: '0.08em',
  padding: '5px 10px',
  cursor: 'pointer',
})

// ─── Org tree node ───────────────────────────────

function OrgNode({
  member, members, users, selectedId, onSelect,
}: {
  member: TeamMember
  members: TeamMember[]
  users: User[]
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  const [hover, setHover] = useState(false)
  const children = members.filter(m => m.managerId === member.id)
  const roleColor = ROLE_COLOR[member.role]
  const isSelected = selectedId === member.id
  const linkedUser = member.email
    ? users.find(u => u.email === member.email)
    : undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Card */}
      <div
        onClick={() => onSelect(member.id)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          width: '190px',
          background: isSelected ? '#243424' : hover ? '#1d2e1d' : colors.surfaceAlt,
          border: `1px solid ${isSelected ? roleColor : hover ? '#3a4e3a' : colors.border}`,
          borderTop: `4px solid ${roleColor}`,
          padding: '11px 14px 10px',
          cursor: 'pointer',
          position: 'relative',
          userSelect: 'none',
        }}
      >
        {/* System access dot */}
        {linkedUser && (
          <div style={{
            position: 'absolute', top: '9px', right: '9px',
            width: '6px', height: '6px', borderRadius: '50%',
            background: linkedUser.isActive ? colors.primary : '#4a4a4a',
          }} />
        )}

        {/* Name */}
        <div style={{
          fontFamily: fonts.sans, fontSize: '13px', color: colors.neutral,
          fontWeight: 500, marginBottom: '5px',
          paddingRight: linkedUser ? '12px' : '0',
        }}>
          {member.name}
        </div>

        {/* Role badge */}
        <span style={{
          fontFamily: fonts.label, fontSize: '7.5px', letterSpacing: '0.1em',
          color: roleColor, textTransform: 'uppercase',
        }}>
          {ROLE_LABEL[member.role]}
        </span>

        {/* Email */}
        {member.email && (
          <div style={{
            marginTop: '6px',
            fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.03em',
            color: colors.secondary,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {member.email}
          </div>
        )}
      </div>

      {/* Tree connectors + children */}
      {children.length > 0 && (
        <>
          <div style={{ width: '1px', height: '24px', background: colors.border }} />
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            {children.map((child, i) => {
              const isFirst = i === 0
              const isLast = i === children.length - 1
              const isOnly = children.length === 1
              return (
                <div key={child.id} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  borderTop: isOnly ? 'none' : `1px solid ${colors.border}`,
                  borderLeft: !isOnly && isFirst ? `1px solid ${colors.border}` : 'none',
                  borderRight: !isOnly && isLast ? `1px solid ${colors.border}` : 'none',
                  paddingLeft: '16px', paddingRight: '16px',
                }}>
                  <div style={{ width: '1px', height: '24px', background: colors.border }} />
                  <OrgNode
                    member={child} members={members} users={users}
                    selectedId={selectedId} onSelect={onSelect}
                  />
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Detail / Add panel ──────────────────────────

type PanelMode = 'view' | 'edit' | 'add'

function MemberPanel({
  member, members, users, currentEmail, mode: initialMode,
  onSave, onDelete, onClose, onUserChange,
}: {
  member: TeamMember | null
  members: TeamMember[]
  users: User[]
  currentEmail: string
  mode: PanelMode
  onSave: (m: TeamMember) => void
  onDelete: (id: number) => void
  onClose: () => void
  onUserChange: (users: User[]) => void
}) {
  const [mode, setMode] = useState<PanelMode>(initialMode)

  // member fields
  const [name, setName] = useState(member?.name ?? '')
  const [role, setRole] = useState<MemberRole>(member?.role ?? 'ayudante')
  const [managerId, setManagerId] = useState(member?.managerId != null ? String(member.managerId) : '')
  const [email, setEmail] = useState(member?.email ?? '')
  const [notes, setNotes] = useState(member?.notes ?? '')

  // user management
  const [resetId, setResetId] = useState<number | null>(null)
  const [resetPw, setResetPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [userError, setUserError] = useState<string | null>(null)
  const [userSaving, setUserSaving] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmDeleteUser, setConfirmDeleteUser] = useState(false)

  const linkedUser = email ? users.find(u => u.email === email) : undefined

  useEffect(() => {
    setMode(initialMode)
    setName(member?.name ?? '')
    setRole(member?.role ?? 'ayudante')
    setManagerId(member?.managerId != null ? String(member.managerId) : '')
    setEmail(member?.email ?? '')
    setNotes(member?.notes ?? '')
    setError(null)
    setResetId(null)
    setResetPw('')
    setNewPw('')
    setUserError(null)
  }, [member, initialMode])

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: name.trim(),
        role,
        managerId: managerId ? Number(managerId) : null,
        email: email.trim(),
        notes: notes.trim(),
      }
      const saved = member
        ? await updateTeamMember(member.id, payload)
        : await createTeamMember(payload)
      onSave(saved)
      setMode('view')
    } catch {
      setError('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!member) return
    setSaving(true)
    try {
      await deleteTeamMember(member.id)
      onDelete(member.id)
    } catch (e) {
      setConfirmDelete(false)
      setError(e instanceof Error ? e.message : 'Error al eliminar')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateUser() {
    if (!email || !newPw) return
    setUserSaving(true)
    setUserError(null)
    try {
      const u = await createUser(email.trim(), newPw)
      onUserChange([...users, u])
      setNewPw('')
    } catch (err: unknown) {
      setUserError(err instanceof Error ? err.message : 'Error al crear')
    } finally {
      setUserSaving(false)
    }
  }

  async function handleToggleActive() {
    if (!linkedUser) return
    setUserSaving(true)
    try {
      const updated = await updateUser(linkedUser.id, { isActive: !linkedUser.isActive })
      onUserChange(users.map(u => u.id === updated.id ? updated : u))
    } catch {
      setUserError('Error')
    } finally {
      setUserSaving(false)
    }
  }

  async function handleResetPw() {
    if (!linkedUser || !resetPw) return
    setUserSaving(true)
    try {
      await updateUser(linkedUser.id, { password: resetPw })
      setResetId(null)
      setResetPw('')
    } catch {
      setUserError('Error')
    } finally {
      setUserSaving(false)
    }
  }

  async function handleDeleteUser() {
    if (!linkedUser) return
    setUserSaving(true)
    try {
      await deleteUser(linkedUser.id)
      onUserChange(users.filter(u => u.id !== linkedUser.id))
    } catch {
      setConfirmDeleteUser(false)
      setUserError('Error al eliminar')
    } finally {
      setUserSaving(false)
    }
  }

  const isEditing = mode === 'edit' || mode === 'add'
  const roleColorCurrent = ROLE_COLOR[member?.role ?? role]

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0,
      width: '320px',
      background: colors.dark,
      borderLeft: `1px solid ${colors.border}`,
      display: 'flex', flexDirection: 'column',
      zIndex: 10,
    }}>
      {/* Panel header */}
      <div style={{
        padding: '12px 14px',
        borderBottom: `1px solid ${colors.border}`,
        borderTop: `3px solid ${mode === 'add' ? colors.primary : roleColorCurrent}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '8px',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {isEditing ? (
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Nombre completo"
              autoFocus={mode === 'add'}
              style={inputBase({ fontSize: '14px', fontWeight: 500 })}
            />
          ) : (
            <div style={{ fontFamily: fonts.sans, fontSize: '14px', color: colors.neutral, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {member?.name}
            </div>
          )}
        </div>
        <button onClick={onClose} style={{ ...btnBase('ghost'), padding: '3px 7px', fontSize: '12px', flexShrink: 0 }}>✕</button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

        {/* Role */}
        <div>
          <span style={labelBase}>Rol</span>
          {isEditing ? (
            <select value={role} onChange={e => setRole(e.target.value as MemberRole)} style={inputBase()}>
              {ROLE_ORDER.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontFamily: fonts.label, fontSize: '10px', letterSpacing: '0.08em', color: roleColorCurrent, textTransform: 'uppercase' }}>
                {ROLE_LABEL[member!.role]}
              </span>
              <span style={{ fontFamily: fonts.sans, fontSize: '10px', color: colors.secondary }}>
                {ROLE_DESC[member!.role]}
              </span>
            </div>
          )}
        </div>

        {/* Manager */}
        <div>
          <span style={labelBase}>Reporta a</span>
          {isEditing ? (
            <select value={managerId} onChange={e => setManagerId(e.target.value)} style={inputBase()}>
              <option value="">— Sin manager</option>
              {members.filter(m => m.id !== member?.id).map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          ) : (
            <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral }}>
              {members.find(m => m.id === member?.managerId)?.name ?? <span style={{ color: colors.secondary }}>—</span>}
            </div>
          )}
        </div>

        {/* Email */}
        <div>
          <span style={labelBase}>Email</span>
          {isEditing ? (
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="email@ejemplo.com"
              style={inputBase()}
            />
          ) : (
            <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral }}>
              {member?.email || <span style={{ color: colors.secondary }}>—</span>}
            </div>
          )}
        </div>

        {/* Notes */}
        <div>
          <span style={labelBase}>Notas</span>
          {isEditing ? (
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              style={{ ...inputBase(), resize: 'vertical' }}
            />
          ) : (
            <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: member?.notes ? colors.neutral : colors.secondary }}>
              {member?.notes || '—'}
            </div>
          )}
        </div>

        {/* Edit / save actions */}
        {isEditing ? (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button onClick={handleSave} disabled={saving || !name.trim()} style={{ ...btnBase('primary'), opacity: saving || !name.trim() ? 0.5 : 1 }}>
              {saving ? 'GUARDANDO…' : mode === 'add' ? 'CREAR MIEMBRO' : 'GUARDAR'}
            </button>
            {mode === 'edit' && (
              <button onClick={() => setMode('view')} style={btnBase('ghost')}>CANCELAR</button>
            )}
            {error && <span style={{ fontFamily: fonts.label, fontSize: '9px', color: '#E62300' }}>{error}</span>}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={() => setMode('edit')} style={btnBase('ghost')}>EDITAR</button>
            {confirmDelete ? (
              <>
                <button onClick={() => setConfirmDelete(false)} style={btnBase('ghost')}>CANCELAR</button>
                <button onClick={handleDelete} disabled={saving} style={{ ...btnBase('danger'), opacity: saving ? 0.5 : 1 }}>
                  {saving ? 'BORRANDO…' : '¿CONFIRMAR?'}
                </button>
              </>
            ) : (
              <button onClick={() => setConfirmDelete(true)} style={btnBase('danger')}>BORRAR</button>
            )}
          </div>
        )}

        {/* ─── System access section ─── */}
        {!isEditing && (
          <>
            <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: '12px' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '10px' }}>
                ACCESO AL SISTEMA
              </div>

              {userError && (
                <div style={{ color: '#E62300', fontFamily: fonts.sans, fontSize: '10px', marginBottom: '8px' }}>{userError}</div>
              )}

              {linkedUser ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {/* Status */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: linkedUser.isActive ? colors.primary : '#4a4a4a', flexShrink: 0 }} />
                      <span style={{ fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.06em', color: linkedUser.isActive ? colors.primary : colors.secondary }}>
                        {linkedUser.isActive ? 'ACTIVO' : 'INACTIVO'}
                      </span>
                    </div>
                    {linkedUser.email !== currentEmail && (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button onClick={handleToggleActive} disabled={userSaving} style={{ ...btnBase('ghost'), opacity: userSaving ? 0.5 : 1 }}>
                          {linkedUser.isActive ? 'DESACTIVAR' : 'ACTIVAR'}
                        </button>
                        {confirmDeleteUser ? (
                          <>
                            <button onClick={() => setConfirmDeleteUser(false)} style={btnBase('ghost')}>CANCELAR</button>
                            <button onClick={handleDeleteUser} disabled={userSaving} style={{ ...btnBase('danger'), opacity: userSaving ? 0.5 : 1 }}>
                              {userSaving ? 'BORRANDO…' : '¿CONFIRMAR?'}
                            </button>
                          </>
                        ) : (
                          <button onClick={() => setConfirmDeleteUser(true)} style={btnBase('danger')}>BORRAR</button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Reset password */}
                  {resetId === linkedUser.id ? (
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <input
                        type="password"
                        value={resetPw}
                        onChange={e => setResetPw(e.target.value)}
                        placeholder="Nueva contraseña"
                        autoFocus
                        style={inputBase({ flex: 1, width: 'auto' } as React.CSSProperties)}
                      />
                      <button onClick={handleResetPw} disabled={!resetPw || userSaving} style={{ ...btnBase('primary'), opacity: !resetPw || userSaving ? 0.5 : 1 }}>
                        {userSaving ? '…' : 'OK'}
                      </button>
                      <button onClick={() => { setResetId(null); setResetPw('') }} style={{ ...btnBase('ghost'), padding: '3px 6px' }}>✕</button>
                    </div>
                  ) : (
                    <button onClick={() => setResetId(linkedUser.id)} style={btnBase('ghost')}>CAMBIAR CONTRASEÑA</button>
                  )}
                </div>
              ) : email ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>Sin acceso al sistema</div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input
                      type="password"
                      value={newPw}
                      onChange={e => setNewPw(e.target.value)}
                      placeholder="Contraseña inicial"
                      style={inputBase({ flex: 1, width: 'auto' } as React.CSSProperties)}
                    />
                    <button onClick={handleCreateUser} disabled={!newPw || userSaving} style={{ ...btnBase('primary'), opacity: !newPw || userSaving ? 0.5 : 1 }}>
                      {userSaving ? '…' : 'CREAR'}
                    </button>
                  </div>
                  {userError && <span style={{ fontFamily: fonts.label, fontSize: '9px', color: '#E62300' }}>{userError}</span>}
                </div>
              ) : (
                <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>Agrega un email para habilitar acceso.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main tab ────────────────────────────────────

export function OrgTab() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [currentEmail, setCurrentEmail] = useState('')
  const [loading, setLoading] = useState(true)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [panelMode, setPanelMode] = useState<PanelMode | null>(null)

  useEffect(() => {
    Promise.all([fetchTeam(), fetchUsers(), fetchMe()]).then(([team, usrs, me]) => {
      setMembers(team)
      setUsers(usrs)
      setCurrentEmail(me.email)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const roots = members.filter(m => m.managerId === null)
  const selectedMember = members.find(m => m.id === selectedId) ?? null

  function handleSelectNode(id: number) {
    if (selectedId === id && panelMode !== null) {
      closePanel()
    } else {
      setSelectedId(id)
      setPanelMode('view')
    }
  }

  function closePanel() {
    setSelectedId(null)
    setPanelMode(null)
  }

  function openAdd() {
    setSelectedId(null)
    setPanelMode('add')
  }

  function handleSave(saved: TeamMember) {
    setMembers(prev => {
      const exists = prev.find(m => m.id === saved.id)
      return exists ? prev.map(m => m.id === saved.id ? saved : m) : [...prev, saved]
    })
    setSelectedId(saved.id)
    setPanelMode('view')
  }

  function handleDelete(id: number) {
    setMembers(prev => prev.filter(m => m.id !== id))
    closePanel()
  }

  return (
    <div style={{ height: 'calc(100vh - 49px)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0,
      }}>
        <span style={{ fontFamily: fonts.label, fontSize: '11px', color: colors.neutral, letterSpacing: '0.1em' }}>EQUIPO</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>
            {members.length} miembro{members.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={openAdd}
            style={{
              ...btnBase('primary'),
              background: panelMode === 'add' ? '#5a7a4e' : colors.primary,
              padding: '5px 12px',
            }}
          >
            + AGREGAR
          </button>
        </div>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {loading ? (
          <div style={{ padding: '40px', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px', textAlign: 'center' }}>
            Cargando…
          </div>
        ) : (
          <>
            {/* Scrollable chart */}
            <div
              style={{
                position: 'absolute', inset: 0,
                overflow: 'auto',
                padding: '48px 40px',
                paddingRight: panelMode !== null ? '360px' : '40px',
              }}
              onClick={e => {
                if (e.target === e.currentTarget) closePanel()
              }}
            >
              {roots.length === 0 ? (
                <div style={{ textAlign: 'center', color: colors.secondary, fontFamily: fonts.sans, fontSize: '12px' }}>
                  Sin miembros. Agrega el primero.
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '48px', justifyContent: 'center', alignItems: 'flex-start', flexWrap: 'wrap', minWidth: 'fit-content' }}>
                  {roots.map(root => (
                    <OrgNode
                      key={root.id}
                      member={root}
                      members={members}
                      users={users}
                      selectedId={selectedId}
                      onSelect={handleSelectNode}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Detail / Add panel */}
            {panelMode !== null && (panelMode === 'add' || selectedMember) && (
              <MemberPanel
                key={panelMode === 'add' ? 'add' : selectedId}
                member={panelMode === 'add' ? null : selectedMember}
                members={members}
                users={users}
                currentEmail={currentEmail}
                mode={panelMode}
                onSave={handleSave}
                onDelete={handleDelete}
                onClose={closePanel}
                onUserChange={setUsers}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
