import { useState } from 'react'
import type React from 'react'
import { colors, fonts } from '../../lib/theme'

const TABS = ['mapa', 'fotos', 'plano'] as const
type MediaTab = typeof TABS[number]

interface Props {
  mapa: React.ReactNode
  fotos: React.ReactNode
  plano: React.ReactNode
  style?: React.CSSProperties
}

/** Center column of the detail pages: MAPA / FOTOS / PLANO tab bar plus the active panel. */
export function MediaTabs({ mapa, fotos, plano, style }: Props) {
  const [tab, setTab] = useState<MediaTab>('mapa')
  const panels: Record<MediaTab, React.ReactNode> = { mapa, fotos, plano }

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
