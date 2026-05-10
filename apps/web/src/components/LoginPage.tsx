import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { colors, fonts } from '../lib/theme'

const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: 'none',
  borderBottom: `1px solid #333`,
  color: colors.neutral,
  fontFamily: fonts.sans,
  fontSize: '14px',
  padding: '8px 0',
  outline: 'none',
  boxSizing: 'border-box',
}

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        setError('Correo o contraseña incorrectos')
        return
      }
      const { access_token } = await res.json()
      login(access_token)
      navigate('/prospectos/tabla', { replace: true })
    } catch {
      setError('Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: colors.dark,
    }}>
      <div style={{ width: '320px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {/* Logo / brand */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: fonts.serif, fontSize: '32px', color: colors.neutral, letterSpacing: '0.02em' }}>
            Refigan
          </div>
          <div style={{ fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.2em', color: colors.secondary, marginTop: '6px' }}>
            PLATAFORMA INTERNA
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label
              htmlFor="email"
              style={{ display: 'block', fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '6px' }}
            >
              CORREO
            </label>
            <input
              id="email"
              name="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              aria-required="true"
              style={inputStyle}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              style={{ display: 'block', fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '6px' }}
            >
              CONTRASEÑA
            </label>
            <input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              aria-required="true"
              aria-describedby={error ? 'login-error' : undefined}
              style={inputStyle}
            />
          </div>

          {error && (
            <div id="login-error" role="alert" style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.tertiary }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            aria-busy={loading}
            style={{
              background: loading ? colors.border : colors.primary,
              border: 'none',
              color: colors.neutral,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: fonts.label,
              fontSize: '10px',
              letterSpacing: '0.15em',
              padding: '12px',
              transition: 'background 0.2s',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'INICIANDO…' : 'INICIAR SESIÓN'}
          </button>
        </form>
      </div>
    </div>
  )
}
