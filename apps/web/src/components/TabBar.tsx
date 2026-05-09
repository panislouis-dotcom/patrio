import { useState, useRef, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { colors, fonts } from '../lib/theme'
import { changePassword } from '../lib/api'

const topTabs = [
  { path: '/prospectos', label: 'PROSPECTOS' },
  { path: '/proyectos', label: 'PROYECTOS' },
  { path: '/inversionistas', label: 'INVERSIONISTAS' },
  { path: '/sonar', label: 'SONAR' },
  { path: '/procesos', label: 'PROCESOS' },
  { path: '/equipo', label: 'EQUIPO' },
]

const prospectoSubTabs = [
  { path: '/prospectos/tabla', label: 'TABLA' },
  { path: '/prospectos/mapa', label: 'MAPA' },
]

interface TabBarProps {
  onLogout?: () => void
}

export function TabBar({ onLogout }: TabBarProps) {
  const location = useLocation()
  const inProspectos = location.pathname.startsWith('/prospectos')

  const [showPwForm, setShowPwForm] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showPwForm) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowPwForm(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showPwForm])

  function openPwForm() {
    setShowPwForm(s => !s)
    setCurrentPw(''); setNewPw(''); setConfirmPw('')
    setPwError(null); setPwSuccess(false)
  }

  async function handleChangePw(e: React.FormEvent) {
    e.preventDefault()
    if (newPw !== confirmPw) { setPwError('Las contraseñas no coinciden'); return }
    if (newPw.length < 6) { setPwError('Mínimo 6 caracteres'); return }
    setPwSaving(true); setPwError(null)
    try {
      await changePassword(currentPw, newPw)
      setPwSuccess(true)
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch (err: unknown) {
      setPwError(err instanceof Error ? err.message : 'Error')
    } finally {
      setPwSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    color: colors.neutral,
    fontFamily: fonts.sans,
    fontSize: '11px',
    padding: '4px 7px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  }

  return (
    <nav style={{
      borderBottom: `1px solid ${colors.border}`,
      background: colors.dark,
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      <div style={{ display: 'flex' }}>
        <span style={{
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          fontFamily: fonts.label,
          fontSize: '13px',
          letterSpacing: '0.15em',
          color: colors.primary,
          borderRight: `1px solid ${colors.border}`,
        }}>
          REFIGAN
        </span>
        {topTabs.map(({ path, label }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/sonar' || path === '/equipo' || path === '/procesos'}
            style={({ isActive }) => ({
              padding: '14px 20px',
              fontFamily: fonts.label,
              fontSize: '11px',
              letterSpacing: '0.12em',
              color: isActive ? colors.neutral : colors.secondary,
              borderBottom: isActive ? `2px solid ${colors.tertiary}` : '2px solid transparent',
              transition: 'color 0.15s',
            })}
          >
            {label}
          </NavLink>
        ))}
        <div ref={panelRef} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'stretch', position: 'relative' }}>
          <button
            onClick={openPwForm}
            style={{
              background: 'transparent',
              border: 'none',
              color: showPwForm ? colors.neutral : colors.secondary,
              cursor: 'pointer',
              fontFamily: fonts.label,
              fontSize: '9px',
              letterSpacing: '0.1em',
              padding: '0 12px',
              transition: 'color 0.15s',
            }}
          >
            CONTRASEÑA
          </button>
          {onLogout && (
            <button
              onClick={onLogout}
              style={{
                background: 'transparent',
                border: 'none',
                borderLeft: `1px solid ${colors.border}`,
                color: colors.secondary,
                cursor: 'pointer',
                fontFamily: fonts.label,
                fontSize: '9px',
                letterSpacing: '0.1em',
                padding: '0 16px',
                transition: 'color 0.15s',
              }}
            >
              SALIR
            </button>
          )}
          {showPwForm && (
            <div style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '4px',
              background: colors.dark,
              border: `1px solid ${colors.border}`,
              padding: '16px',
              width: '240px',
              zIndex: 200,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.14em', color: colors.secondary, marginBottom: '4px' }}>
                CAMBIAR CONTRASEÑA
              </div>
              <form onSubmit={handleChangePw} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <input
                  type="password"
                  value={currentPw}
                  onChange={e => setCurrentPw(e.target.value)}
                  placeholder="Contraseña actual"
                  autoFocus
                  style={inputStyle}
                />
                <input
                  type="password"
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  placeholder="Nueva contraseña"
                  style={inputStyle}
                />
                <input
                  type="password"
                  value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  placeholder="Confirmar nueva"
                  style={inputStyle}
                />
                {pwError && (
                  <div style={{ color: 'tomato', fontFamily: fonts.sans, fontSize: '10px' }}>{pwError}</div>
                )}
                {pwSuccess && (
                  <div style={{ color: colors.primary, fontFamily: fonts.sans, fontSize: '10px' }}>Contraseña actualizada</div>
                )}
                <button
                  type="submit"
                  disabled={pwSaving || !currentPw || !newPw || !confirmPw}
                  style={{
                    background: (currentPw && newPw && confirmPw) ? colors.primary : colors.border,
                    border: 'none',
                    color: colors.neutral,
                    cursor: (currentPw && newPw && confirmPw) ? 'pointer' : 'not-allowed',
                    fontFamily: fonts.label,
                    fontSize: '9px',
                    letterSpacing: '0.08em',
                    padding: '6px 12px',
                    opacity: pwSaving ? 0.6 : 1,
                    alignSelf: 'flex-start',
                  }}
                >
                  {pwSaving ? 'GUARDANDO…' : 'ACTUALIZAR'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
      {inProspectos && (
        <div style={{
          display: 'flex',
          borderTop: `1px solid ${colors.border}`,
        }}>
          {prospectoSubTabs.map(({ path, label }) => (
            <NavLink
              key={path}
              to={path}
              end
              style={({ isActive }) => ({
                padding: '8px 16px',
                fontFamily: fonts.label,
                fontSize: '9px',
                letterSpacing: '0.12em',
                color: isActive ? colors.neutral : colors.secondary,
                borderBottom: isActive ? `2px solid ${colors.tertiary}` : '2px solid transparent',
                transition: 'color 0.15s',
              })}
            >
              {label}
            </NavLink>
          ))}
        </div>
      )}
    </nav>
  )
}
