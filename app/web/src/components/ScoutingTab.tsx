import { colors, fonts } from '../lib/theme'

// Scaffold: Scouting es el hogar del sourcing de oportunidades. Por ahora solo
// se dibujan las dos áreas —el listado del scraping solicitado (que integrará al
// Sonar) y el directorio de asesores—; la lógica se desarrolla después.

const sectionLabel: React.CSSProperties = {
  fontFamily: fonts.label,
  fontSize: '10px',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: colors.secondary,
  marginBottom: 10,
}

const th: React.CSSProperties = {
  padding: '6px 10px',
  fontFamily: fonts.label,
  fontSize: '9px',
  letterSpacing: '0.1em',
  color: colors.secondary,
  textAlign: 'left',
}

export function ScoutingTab() {
  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Header */}
      <div>
        <div style={{ fontFamily: fonts.sans, fontSize: '18px', color: colors.neutral }}>Scouting</div>
        <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, marginTop: 4 }}>
          Sourcing de oportunidades: propiedades del scraping solicitado y directorio de asesores.
        </div>
      </div>

      {/* Área 1 — Propiedades (scraping): placeholder */}
      <div>
        <div style={sectionLabel}>Propiedades · scraping</div>
        <div
          style={{
            border: `1px dashed ${colors.border}`,
            borderRadius: 3,
            padding: '44px 20px',
            textAlign: 'center',
            background: colors.surface,
            color: colors.secondary,
            fontFamily: fonts.sans,
            fontSize: '12px',
            lineHeight: 1.6,
          }}
        >
          Aquí irá el listado de propiedades del scraping solicitado.
          <br />
          <span style={{ fontSize: '10px' }}>(Se integrará con el Sonar — pendiente de desarrollo.)</span>
        </div>
      </div>

      {/* Área 2 — Asesores */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={sectionLabel}>Asesores</div>
          <button
            disabled
            title="Pendiente de desarrollo"
            style={{
              background: colors.border,
              border: 'none',
              color: colors.secondary,
              fontFamily: fonts.label,
              fontSize: '9px',
              letterSpacing: '0.08em',
              padding: '6px 12px',
              cursor: 'not-allowed',
              opacity: 0.7,
            }}
          >
            + AGREGAR ASESOR
          </button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              {['NOMBRE', 'EMPRESA', 'TELÉFONO'].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td
                colSpan={3}
                style={{
                  padding: '28px 10px',
                  textAlign: 'center',
                  color: colors.secondary,
                  fontFamily: fonts.sans,
                  fontSize: '11px',
                  fontStyle: 'italic',
                }}
              >
                Sin asesores todavía.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
