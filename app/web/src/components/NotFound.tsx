import { useLocation, useNavigate } from 'react-router-dom'
import { colors, fonts } from '../lib/theme'

/**
 * La pantalla de una ruta que no existe.
 *
 * Sin ella, una URL mal tecleada o un enlace viejo pintaban la barra de
 * navegación y **nada más**: una app en blanco, indistinguible de una rota. En
 * consola sí salía «No routes matched», pero nadie mira la consola cuando cree
 * que el software se cayó.
 *
 * DICE LA RUTA QUE NO ENCONTRÓ, y eso no es adorno: la diferencia entre «me
 * equivoqué al teclear» y «este enlace ya no sirve» está justo ahí, y quien lo
 * lee es quien puede corregirla.
 *
 * Y NO ADIVINA A DÓNDE IBAS. `App` ya decidió que no hay redirecciones desde las
 * URLs viejas de prospectos y proyectos, porque los ids cambiaron con la fusión
 * y «mandar un bookmark a la propiedad equivocada es peor que un 404». Un
 * comodín que intentara acertar sería esa misma apuesta, hecha con menos
 * información.
 */
export function NotFound() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '14px', padding: '80px 24px', textAlign: 'center',
    }}>
      <div style={{ fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.15em', color: colors.secondary }}>
        RUTA NO ENCONTRADA
      </div>
      <div style={{ fontFamily: fonts.serif, fontSize: '20px', color: colors.neutral }}>
        Aquí no hay nada
      </div>
      <code style={{
        fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary,
        background: colors.surface, border: `1px solid ${colors.border}`, padding: '4px 10px',
        maxWidth: '100%', overflowWrap: 'anywhere',
      }}>
        {location.pathname}
      </code>
      <button
        onClick={() => navigate('/propiedades')}
        style={{
          background: 'transparent', border: `1px solid ${colors.primary}`, color: colors.primary,
          cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em',
          padding: '6px 14px', marginTop: '4px',
        }}
      >
        IR A PROPIEDADES
      </button>
    </div>
  )
}
