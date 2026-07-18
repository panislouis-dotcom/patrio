import { useEffect, useState } from 'react'
import { fetchUsers, fetchMe, createUser, updateUser, deleteUser } from '../lib/api'
import type { User, TeamMember } from '../lib/types'
import { colors, fonts } from '../lib/theme'

interface Props {
  members: TeamMember[]
}

export function UserManagementSection({ members }: Props) {
  const [users, setUsers] = useState<User[]>([])
  const [currentEmail, setCurrentEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Add form
  const [addEmail, setAddEmail] = useState('')
  const [addPassword, setAddPassword] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // Per-row reset password
  const [resetId, setResetId] = useState<number | null>(null)
  const [resetPw, setResetPw] = useState('')
  const [savingId, setSavingId] = useState<number | null>(null)

  useEffect(() => {
    Promise.all([fetchUsers(), fetchMe()]).then(([usrs, me]) => {
      setUsers(usrs)
      setCurrentEmail(me.email)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!addEmail.trim() || !addPassword) return
    setAdding(true)
    setAddError(null)
    try {
      const u = await createUser(addEmail.trim(), addPassword)
      setUsers(prev => [...prev, u])
      setAddEmail('')
      setAddPassword('')
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : 'Error al crear')
    } finally {
      setAdding(false)
    }
  }

  async function handleToggleActive(user: User) {
    setSavingId(user.id)
    try {
      const updated = await updateUser(user.id, { isActive: !user.isActive })
      setUsers(prev => prev.map(u => u.id === user.id ? updated : u))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setSavingId(null)
    }
  }

  async function handleResetPassword(user: User) {
    if (!resetPw) return
    setSavingId(user.id)
    try {
      await updateUser(user.id, { password: resetPw })
      setResetId(null)
      setResetPw('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setSavingId(null)
    }
  }

  async function handleDelete(user: User) {
    if (!window.confirm(`¿Eliminar usuario ${user.email}?`)) return
    setSavingId(user.id)
    try {
      await deleteUser(user.id)
      setUsers(prev => prev.filter(u => u.id !== user.id))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al eliminar')
    } finally {
      setSavingId(null)
    }
  }

  const labelStyle: React.CSSProperties = {
    fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.12em', color: colors.secondary,
  }
  const inputStyle: React.CSSProperties = {
    background: colors.surface, border: `1px solid ${colors.border}`,
    color: colors.neutral, fontFamily: fonts.sans, fontSize: '11px',
    padding: '4px 7px', outline: 'none',
  }

  const membersWithEmail = members.filter(m => m.email)

  return (
    <div>
      {/* Section header */}
      <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, padding: '12px 0 6px', borderBottom: `1px solid ${colors.border}`, marginBottom: '8px', marginTop: '4px' }}>
        USUARIOS
      </div>

      {loading ? (
        <div style={{ ...labelStyle, padding: '8px 0' }}>Cargando…</div>
      ) : (
        <>
          {error && (
            <div style={{ color: 'tomato', fontFamily: fonts.sans, fontSize: '11px', marginBottom: '8px' }}>{error}</div>
          )}

          {/* Users table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '14px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                {(['EMAIL', 'ESTADO', ''] as string[]).map(h => (
                  <th key={h} style={{ ...labelStyle, padding: '5px 8px', textAlign: 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(user => {
                const isSelf = user.email === currentEmail
                const isSaving = savingId === user.id
                const isResetting = resetId === user.id
                return (
                  <tr key={user.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={{ padding: '6px 8px' }}>
                      <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: user.isActive ? colors.neutral : colors.secondary }}>
                        {user.email}
                        {isSelf && <span style={{ ...labelStyle, marginLeft: '6px' }}>(tú)</span>}
                      </div>
                      {isResetting && (
                        <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                          <input
                            type="password"
                            value={resetPw}
                            onChange={e => setResetPw(e.target.value)}
                            placeholder="Nueva contraseña"
                            autoFocus
                            style={{ ...inputStyle, flex: 1 }}
                          />
                          <button
                            onClick={() => handleResetPassword(user)}
                            disabled={!resetPw || isSaving}
                            style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', padding: '3px 8px', opacity: isSaving ? 0.6 : 1 }}
                          >
                            {isSaving ? '…' : 'OK'}
                          </button>
                          <button
                            onClick={() => { setResetId(null); setResetPw('') }}
                            style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '3px 5px' }}
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.08em', color: user.isActive ? colors.primary : colors.secondary }}>
                        {user.isActive ? 'ACTIVO' : 'INACTIVO'}
                      </span>
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {!isResetting && (
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => { setResetId(user.id); setResetPw('') }}
                            disabled={isSaving}
                            style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', padding: '2px 7px', letterSpacing: '0.05em' }}
                          >
                            CONTRASEÑA
                          </button>
                          {!isSelf && (
                            <>
                              <button
                                onClick={() => handleToggleActive(user)}
                                disabled={isSaving}
                                style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', padding: '2px 7px', opacity: isSaving ? 0.5 : 1 }}
                              >
                                {user.isActive ? 'DESACTIVAR' : 'ACTIVAR'}
                              </button>
                              <button
                                onClick={() => handleDelete(user)}
                                disabled={isSaving}
                                style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '0 3px', opacity: isSaving ? 0.5 : 1 }}
                              >
                                ✕
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ padding: '8px', fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>
                    Sin usuarios
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Add user form */}
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ ...labelStyle, marginBottom: '2px' }}>AGREGAR USUARIO</div>
            {membersWithEmail.length > 0 && (
              <select
                value=""
                onChange={e => { if (e.target.value) setAddEmail(e.target.value) }}
                style={{ ...inputStyle, width: '100%' }}
              >
                <option value="">— llenar de miembro del equipo —</option>
                {membersWithEmail.map(m => (
                  <option key={m.id} value={m.email}>{m.name} ({m.email})</option>
                ))}
              </select>
            )}
            <input
              type="email"
              value={addEmail}
              onChange={e => setAddEmail(e.target.value)}
              placeholder="email@ejemplo.com"
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
            />
            <input
              type="password"
              value={addPassword}
              onChange={e => setAddPassword(e.target.value)}
              placeholder="Contraseña"
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
            />
            {addError && (
              <div style={{ color: 'tomato', fontFamily: fonts.sans, fontSize: '10px' }}>{addError}</div>
            )}
            <button
              type="submit"
              disabled={adding || !addEmail.trim() || !addPassword}
              style={{ background: addEmail && addPassword ? colors.primary : colors.border, border: 'none', color: colors.neutral, cursor: addEmail && addPassword ? 'pointer' : 'not-allowed', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '6px 12px', opacity: adding ? 0.6 : 1, alignSelf: 'flex-start' }}
            >
              {adding ? 'CREANDO…' : '+ CREAR USUARIO'}
            </button>
          </form>
        </>
      )}
    </div>
  )
}
