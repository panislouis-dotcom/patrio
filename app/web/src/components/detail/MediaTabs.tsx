import { useState } from 'react'
import type React from 'react'
import { colors, fonts } from '../../lib/theme'

const TABS = ['mapa', 'fotos', 'plano', 'renders'] as const
type MediaTab = typeof TABS[number]

interface Props {
  mapa: React.ReactNode
  fotos: React.ReactNode
  plano: React.ReactNode
  renders: React.ReactNode
  style?: React.CSSProperties
}

/**
 * Center column of the detail pages: MAPA / FOTOS / PLANO / RENDERS tab bar
 * plus the active panel.
 *
 * RENDERS es su propia pestaña y no una vista de FOTOS a propósito: una foto es
 * evidencia y un render es una propuesta. Mezclarlos en la misma tira es cómo
 * una propuesta termina citada como si fuera el estado real del inmueble.
 */
export function MediaTabs({ mapa, fotos, plano, renders, style }: Props) {
  const [tab, setTab] = useState<MediaTab>('mapa')
  const panels: Record<MediaTab, React.ReactNode> = { mapa, fotos, plano, renders }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', ...style }}>
      <div style={{ flexShrink: 0, display: 'flex', borderBottom: `1px solid ${colors.border}`, padding: '0 20px', background: colors.dark }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: 'transparent', border: 'none',
            borderBottom: tab === t ? `2px solid ${colors.primary}` : '2px solid transparent',
            color: tab === t ? colors.neutral : colors.secondary,
            cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px',
            letterSpacing: '0.12em', padding: '10px 16px 8px', marginBottom: '-1px',
          }}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>
      {panels[tab]}
    </div>
  )
}
