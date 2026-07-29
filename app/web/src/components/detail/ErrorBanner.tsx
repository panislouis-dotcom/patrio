import { colors, fonts } from '../../lib/theme'

/**
 * A save failure sits between the header and the panels: GUARDAR lives in the
 * header and is reachable from every tab, so its error has to be too.
 */
export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div style={{
      flexShrink: 0,
      padding: '8px 24px',
      borderBottom: `1px solid ${colors.border}`,
      background: colors.surface,
      color: colors.tertiary,
      fontFamily: fonts.sans,
      fontSize: '11px',
    }}>
      {message}
    </div>
  )
}
