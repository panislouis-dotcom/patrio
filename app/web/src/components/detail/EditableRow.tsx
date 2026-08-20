import type React from 'react'
import { colors, fonts } from '../../lib/theme'

interface Props {
  label: string
  editing: boolean
  value: React.ReactNode
  /** Omit for derived fields — the row stays read-only even while editing. */
  input?: React.ReactNode
  /** Small caption beside the value, e.g. "CALCULADA DEL DESGLOSE". */
  hint?: string
  /**
   * Vaciar el campo. Es una acción aparte y explícita porque una caja en blanco
   * ya significa otra cosa — "no lo toques" — y confundir las dos es como se
   * borran datos sin querer.
   */
  onClear?: () => void
  /**
   * Label+hint arriba, valor/input abajo, ambos alineados a la izquierda — sin
   * la columna de ancho fijo del layout de fila. El layout normal (label
   * izquierda, valor derecha) asume el ancho completo de la página; metido en
   * una columna angosta de grid (ver COMISIONES DEL FONDO) el texto se
   * amontona. No cambia ningún otro renglón: por default es `false`.
   */
  stacked?: boolean
}

/** A StatRow that swaps its value for an input while the page is in edit mode. */
export function EditableRow({ label, editing, value, input, hint, onClear, stacked }: Props) {
  const clearButton = onClear && (
    <button
      onClick={onClear}
      title="Vaciar el campo"
      aria-label={`Vaciar ${label}`}
      style={{ flexShrink: 0, background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', lineHeight: 1, padding: '4px 6px' }}
    >
      ✕
    </button>
  )

  if (stacked) {
    // Una sola línea de flex-wrap, no un div anidado: los renglones de
    // COMISIONES DEL FONDO se ubican con `screen.getByText(label).closest('div')`
    // — un wrapper extra para label+hint pondría el valor fuera de ese `.closest`.
    // `flexBasis: '100%'` fuerza el salto de línea sin perder el mismo div plano.
    const stackedRight = editing && input != null
      ? <span style={{ flexBasis: '100%', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>{input}{clearButton}</span>
      : <span style={{ flexBasis: '100%', marginTop: '4px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>{value}</span>
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px', padding: '6px 0', borderBottom: `1px solid ${colors.border}` }}>
        <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.1em', color: colors.secondary }}>{label}</span>
        {hint && <span style={{ fontFamily: fonts.label, fontSize: '7px', letterSpacing: '0.08em', color: colors.secondary }}>{hint}</span>}
        {stackedRight}
      </div>
    )
  }

  // El input queda como hijo directo del 55%: con o sin botón de vaciar, todas
  // las filas alinean su caja en la misma columna.
  const right = editing && input != null
    ? (
      <span style={{ width: '55%', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
        {input}
        {clearButton}
      </span>
    )
    : <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>{value}</span>

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${colors.border}` }}>
      <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.1em', color: colors.secondary }}>{label}</span>
      {/* The hint is a sibling, not a wrapper: nesting it would make the 55% above
          resolve against the leftover space instead of the row, shrinking hinted
          inputs below the width of every other row. */}
      {hint && (
        <span style={{ flex: 1, minWidth: 0, paddingLeft: '6px', paddingRight: '6px', textAlign: 'right', fontFamily: fonts.label, fontSize: '7px', letterSpacing: '0.08em', color: colors.secondary }}>
          {hint}
        </span>
      )}
      {right}
    </div>
  )
}
