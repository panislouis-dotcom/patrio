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
}

/** A StatRow that swaps its value for an input while the page is in edit mode. */
export function EditableRow({ label, editing, value, input, hint }: Props) {
  const right = editing && input != null
    ? <span style={{ width: '55%', flexShrink: 0 }}>{input}</span>
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
