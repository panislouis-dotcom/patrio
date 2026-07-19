import type React from 'react'
import { colors, fonts } from './theme'

export const fieldInput: React.CSSProperties = {
  background: colors.surfaceAlt,
  border: `1px solid ${colors.border}`,
  borderRadius: '2px',
  color: colors.neutral,
  fontFamily: fonts.sans,
  fontSize: '13px',
  outline: 'none',
  padding: '6px 8px',
  width: '100%',
  boxSizing: 'border-box',
}
