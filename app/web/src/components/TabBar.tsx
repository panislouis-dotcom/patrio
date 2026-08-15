import { useState, useRef, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { colors, fonts } from '../lib/theme'
import { changePassword } from '../lib/api'
import { ApiKeysSection } from './ApiKeysSection'

const topTabs = [
  { path: '/propiedades', label: 'PROPIEDADES' },
  { path: '/inversionistas', label: 'INVERSIONISTAS' },
  { path: '/proveedores', label: 'PROVEEDORES' },
  { path: '/obra', label: 'OBRA' },
  { path: '/procesos', label: 'PROCESOS' },
  { path: '/equipo', label: 'EQUIPO' },
]

// Un solo inventario, con las herramientas que lo alimentan al lado.
const propiedadesSubTabs = [
  { path: '/propiedades', label: 'TABLA' },
  { path: '/propiedades/mapa', label: 'MAPA' },
  { path: '/propiedades/sonar', label: 'SONAR' },
  { path: '/propiedades/scouting', label: 'SCOUTING' },
  { path: '/propiedades/comparables', label: 'COMPARABLES' },
]

interface TabBarProps {
  onLogout?: () => void
}

export function TabBar({ onLogout }: TabBarProps) {
  const location = useLocation()
  const inPropiedades = location.pathname.startsWith('/propiedades')

  const [showSettings, setShowSettings] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const gearRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!showSettings) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowSettings(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showSettings])

  function openSettings() {
    setShowSettings(s => !s)
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
      {/* Las dos filas SCROLLEAN EN SÍ MISMAS en vez de estirar la página. Con
          siete destinos, el engrane y SALIR, la barra mide ~905px y en un
          teléfono empujaba el documento entero a scrollear en horizontal: la
          ficha se iba de lado al deslizar. Es la misma regla que usa la tabla
          del presupuesto — el que se desborda se lleva su propio scroll. */}
      <div style={{ display: 'flex', overflowX: 'auto', scrollbarWidth: 'none' }}>
        <span style={{
          padding: '0 24px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          fontFamily: fonts.label,
          fontSize: '13px',
          letterSpacing: '0.15em',
          color: colors.primary,
          borderRight: `1px solid ${colors.border}`,
        }}>
          PATRIO
        </span>
        {topTabs.map(({ path, label }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/equipo' || path === '/procesos'}
            style={({ isActive }) => ({
              padding: '14px 20px',
              flexShrink: 0,
              whiteSpace: 'nowrap',
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

        {/* Right side: gear + logout */}
        <div style={{ marginLeft: 'auto', flexShrink: 0, display: 'flex', alignItems: 'stretch' }}>
          {/* Gear settings button + dropdown */}
          <div ref={panelRef} style={{ display: 'flex', alignItems: 'stretch', position: 'relative' }}>
            <button
              ref={gearRef}
              onClick={openSettings}
              title="Configuración"
              style={{
                background: 'transparent',
                border: 'none',
                color: showSettings ? colors.neutral : colors.secondary,
                cursor: 'pointer',
                padding: '0 16px',
                display: 'flex',
                alignItems: 'center',
                transition: 'color 0.15s',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>

            {/* Settings dropdown panel.
                position: FIXED (not absolute) so it escapes the `overflowX:auto` scroll
                container this bar lives in — an absolute child hung below the bar (top:100%)
                was clipped by that container and never showed, so the gear looked dead.
                A fixed element isn't clipped by an overflow ancestor (the <nav> is sticky, not
                transformed, so it doesn't trap it). Anchored under the gear via its rect; still
                a DOM child of panelRef, so the outside-click-to-close logic keeps working. */}
            {showSettings && (
              <div data-testid="settings-panel" style={{
                position: 'fixed',
                top: (gearRef.current?.getBoundingClientRect().bottom ?? 52) + 4,
                right: Math.max(8, window.innerWidth - (gearRef.current?.getBoundingClientRect().right ?? window.innerWidth)),
                background: colors.dark,
                border: `1px solid ${colors.border}`,
                padding: '16px',
                width: '360px',
                maxHeight: 'calc(100vh - 80px)',
                overflowY: 'auto',
                zIndex: 200,
                display: 'flex',
                flexDirection: 'column',
                gap: '0',
              }}>
                {/* API Keys */}
                <ApiKeysSection />

                {/* Change password */}
                <div style={{
                  fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em',
                  color: colors.secondary, padding: '16px 0 6px',
                  borderBottom: `1px solid ${colors.border}`, marginBottom: '8px', marginTop: '8px',
                }}>
                  CONTRASEÑA
                </div>
                <form onSubmit={handleChangePw} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <input
                    type="password"
                    value={currentPw}
                    onChange={e => setCurrentPw(e.target.value)}
                    placeholder="Contraseña actual"
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
                    <div style={{ color: '#E62300', fontFamily: fonts.sans, fontSize: '10px' }}>{pwError}</div>
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
                      marginTop: '2px',
                    }}
                  >
                    {pwSaving ? 'GUARDANDO…' : 'ACTUALIZAR'}
                  </button>
                </form>
              </div>
            )}
          </div>

          {/* Logout button — always visible to the right of the gear */}
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
        </div>
      </div>

      {inPropiedades && (
        <div style={{
          display: 'flex',
          overflowX: 'auto',
          scrollbarWidth: 'none',
          borderTop: `1px solid ${colors.border}`,
        }}>
          {propiedadesSubTabs.map(({ path, label }) => (
            <NavLink
              key={path}
              to={path}
              end
              style={({ isActive }) => ({
                padding: '8px 16px',
                flexShrink: 0,
                whiteSpace: 'nowrap',
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
