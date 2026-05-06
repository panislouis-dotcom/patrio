import { NavLink } from 'react-router-dom'
import { colors, fonts } from '../lib/theme'

const tabs = [
  { path: '/tabla', label: 'TABLA' },
  { path: '/mapa', label: 'MAPA' },
  { path: '/calidad', label: 'CALIDAD' },
]

export function TabBar() {
  return (
    <nav style={{
      display: 'flex',
      borderBottom: `1px solid ${colors.border}`,
      background: colors.dark,
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
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
      {tabs.map(({ path, label }) => (
        <NavLink
          key={path}
          to={path}
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
    </nav>
  )
}
