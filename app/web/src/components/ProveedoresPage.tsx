import { NavLink, Outlet } from 'react-router-dom'
import { colors, fonts } from '../lib/theme'
import { pageFill } from '../lib/styles'

const subTabs = [
  { path: '/proveedores/lista', label: 'PROVEEDORES' },
  { path: '/proveedores/tipos', label: 'TIPOS' },
]

export function ProveedoresPage() {
  return (
    <div style={{ ...pageFill, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}`, background: colors.dark, flexShrink: 0 }}>
        {subTabs.map(({ path, label }) => (
          <NavLink
            key={path}
            to={path}
            end
            style={({ isActive }) => ({
              padding: '10px 20px',
              fontFamily: fonts.label,
              fontSize: '10px',
              letterSpacing: '0.12em',
              color: isActive ? colors.neutral : colors.secondary,
              borderBottom: isActive ? `2px solid ${colors.tertiary}` : '2px solid transparent',
              textDecoration: 'none',
              transition: 'color 0.15s',
            })}
          >
            {label}
          </NavLink>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Outlet />
      </div>
    </div>
  )
}
