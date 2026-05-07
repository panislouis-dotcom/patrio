import { NavLink, Outlet } from 'react-router-dom'
import { colors, fonts } from '../lib/theme'

const subTabs = [
  { path: '/procesos/plantillas', label: 'PLANTILLAS' },
  { path: '/procesos/instancias', label: 'INSTANCIAS' },
]

export function ProcesosTab() {
  return (
    <div style={{ height: 'calc(100vh - 49px)', display: 'flex', flexDirection: 'column' }}>
      {/* Sub-nav */}
      <div style={{
        display: 'flex',
        borderBottom: `1px solid ${colors.border}`,
        background: colors.dark,
      }}>
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
              transition: 'color 0.15s',
            })}
          >
            {label}
          </NavLink>
        ))}
      </div>
      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Outlet />
      </div>
    </div>
  )
}
