import { NavLink, Outlet } from 'react-router-dom'
import { colors, fonts } from '../../lib/theme'
import { pageFill } from '../../lib/styles'

/**
 * La casa de lo que el presupuesto de obra sabe pero no le pertenece a ninguna
 * propiedad: el catálogo, lo que está por entrar en él, y las plantillas.
 *
 * Aparte de COMPARABLES aunque las dos sean «tablas de referencia»: los
 * comparables son insumo del analizador de mercado y esto es insumo del
 * presupuesto. Juntarlas las agruparía por su forma —una lista que se cura— y no
 * por lo que alimentan, que es lo único que sirve para saber dónde buscarlas.
 *
 * Mismo esqueleto que `ProveedoresPage`: sub-pestañas y un `<Outlet/>`. No hay
 * nada nuevo que inventar en la navegación de este repo.
 */
const subTabs = [
  { path: '/obra/catalogo', label: 'CATÁLOGO' },
  { path: '/obra/por-promover', label: 'POR PROMOVER' },
  { path: '/obra/plantillas', label: 'PLANTILLAS' },
]

export function ObraPage() {
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
