// app/web/src/components/floorplanStyles.ts
import type React from 'react'
import { colors, fonts } from '../lib/theme'

/** Shared toolbar/inline button, mirroring the tab style in ProjectDetailPage. */
export function btn(active: boolean): React.CSSProperties {
  return {
    background: active ? colors.primary : 'transparent',
    border: `1px solid ${active ? colors.primary : colors.border}`,
    borderRadius: '2px', color: active ? colors.dark : colors.secondary, cursor: 'pointer',
    fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em', padding: '6px 12px', textTransform: 'uppercase',
  }
}

/** btn(false) con el atenuado estándar cuando está deshabilitado (UNDO/REDO, convertir, …). */
export function btnDisabled(disabled: boolean): React.CSSProperties {
  return { ...btn(false), opacity: disabled ? 0.4 : 1, cursor: disabled ? 'default' : 'pointer' }
}
