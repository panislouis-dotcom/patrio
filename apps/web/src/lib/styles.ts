import type React from 'react'
import { colors, fonts } from './theme'

export const fieldInput: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  borderBottom: `1px solid ${colors.border}`,
  color: colors.neutral,
  fontFamily: fonts.sans,
  fontSize: '11px',
  outline: 'none',
  padding: '2px 0',
  width: '100%',
}
