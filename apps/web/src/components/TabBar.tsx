import { NavLink, useLocation } from 'react-router-dom'
import { colors, fonts } from '../lib/theme'

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
        {onLogout && (
          <button
            onClick={onLogout}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: 'none',
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
