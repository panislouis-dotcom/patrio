import { useEffect, useState } from 'react'
import { BASE } from '../lib/api'
import { getToken } from '../lib/auth'
import { colors, fonts } from '../lib/theme'

interface ApiKey {
  id: number
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
}

interface NewKey extends ApiKey {
  token: string
}

const labelStyle: React.CSSProperties = {
  fontFamily: fonts.label,
  fontSize: '8px',
  letterSpacing: '0.12em',
  color: colors.secondary,
}

const inputStyle: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  color: colors.neutral,
  fontFamily: fonts.sans,
  fontSize: '11px',
  padding: '4px 7px',
  outline: 'none',
}

function authHeaders(): HeadersInit {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [revealedKey, setRevealedKey] = useState<NewKey | null>(null)
  const [copied, setCopied] = useState(false)

  const [revokingId, setRevokingId] = useState<number | null>(null)

  useEffect(() => {
    fetch(`${BASE}/api/auth/api-keys`, { headers: authHeaders() })
      .then(r => r.json())
      .then((data: ApiKey[]) => { setKeys(data); setLoading(false) })
      .catch(() => { setError('Error al cargar'); setLoading(false) })
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch(`${BASE}/api/auth/api-keys`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: newName.trim() }),
      })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const created: NewKey = await res.json()
      setRevealedKey(created)
      setKeys(prev => [created, ...prev])
      setNewName('')
    } catch {
      setCreateError('Error al crear')
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id: number) {
    setRevokingId(id)
    try {
      const res = await fetch(`${BASE}/api/auth/api-keys/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!res.ok && res.status !== 404) throw new Error()
      setKeys(prev => prev.filter(k => k.id !== id))
      if (revealedKey?.id === id) setRevealedKey(null)
    } catch {
      setError('Error al revocar')
    } finally {
      setRevokingId(null)
    }
  }

  function handleCopy() {
    if (!revealedKey) return
    navigator.clipboard.writeText(revealedKey.token).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div>
      <div style={{
        fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em',
        color: colors.secondary, padding: '12px 0 6px',
        borderBottom: `1px solid ${colors.border}`, marginBottom: '8px', marginTop: '16px',
      }}>
        API KEYS
      </div>

      {loading && <div style={{ ...labelStyle, padding: '8px 0' }}>Cargando…</div>}
      {error && <div style={{ color: '#E62300', fontFamily: fonts.sans, fontSize: '11px', marginBottom: '8px' }}>{error}</div>}

      {/* Revealed token — shown once */}
      {revealedKey && (
        <div style={{
          background: '#EEF2EA',
          border: `1px solid ${colors.primary}`,
          padding: '10px 12px',
          marginBottom: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}>
          <div style={{ ...labelStyle, color: colors.primary }}>COPIA ESTE TOKEN AHORA — NO SE MOSTRARÁ DE NUEVO</div>
          <div style={{
            fontFamily: 'monospace', fontSize: '11px', color: colors.neutral,
            wordBreak: 'break-all', padding: '4px 0',
          }}>
            {revealedKey.token}
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={handleCopy}
              style={{
                background: copied ? colors.primary : 'transparent',
                border: `1px solid ${colors.primary}`,
                color: colors.neutral, cursor: 'pointer',
                fontFamily: fonts.label, fontSize: '8px', padding: '3px 10px',
              }}
            >
              {copied ? 'COPIADO' : 'COPIAR'}
            </button>
            <button
              onClick={() => setRevealedKey(null)}
              style={{
                background: 'transparent', border: `1px solid ${colors.border}`,
                color: colors.secondary, cursor: 'pointer',
                fontFamily: fonts.label, fontSize: '9px', padding: '3px 7px',
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Keys table */}
      {!loading && keys.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '14px' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              {['NOMBRE', 'PREFIJO', 'CREADO', 'ÚLTIMO USO', ''].map(h => (
                <th key={h} style={{ ...labelStyle, padding: '5px 8px', textAlign: 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map(k => (
              <tr key={k.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={{ padding: '6px 8px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>{k.name}</td>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: '10px', color: colors.secondary }}>{k.key_prefix}…</td>
                <td style={{ padding: '6px 8px', ...labelStyle }}>{fmtDate(k.created_at)}</td>
                <td style={{ padding: '6px 8px', ...labelStyle }}>{k.last_used_at ? fmtDate(k.last_used_at) : '—'}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                  <button
                    onClick={() => handleRevoke(k.id)}
                    disabled={revokingId === k.id}
                    style={{
                      background: 'transparent', border: `1px solid ${colors.border}`,
                      color: colors.secondary, cursor: 'pointer',
                      fontFamily: fonts.label, fontSize: '8px', padding: '2px 8px',
                      opacity: revokingId === k.id ? 0.5 : 1,
                    }}
                  >
                    {revokingId === k.id ? '…' : 'REVOCAR'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!loading && keys.length === 0 && (
        <div style={{ ...labelStyle, padding: '8px 0', marginBottom: '12px' }}>Sin API keys</div>
      )}

      {/* Create form */}
      <form onSubmit={handleCreate} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Nombre de la key"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          style={{
            background: newName.trim() ? colors.primary : colors.border,
            border: 'none', color: colors.neutral,
            cursor: newName.trim() ? 'pointer' : 'not-allowed',
            fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em',
            padding: '5px 12px', opacity: creating ? 0.6 : 1, flexShrink: 0,
          }}
        >
          {creating ? 'CREANDO…' : '+ CREAR KEY'}
        </button>
      </form>
      {createError && <div style={{ color: '#E62300', fontFamily: fonts.sans, fontSize: '10px', marginTop: '4px' }}>{createError}</div>}
    </div>
  )
}
