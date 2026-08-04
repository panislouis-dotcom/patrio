import { useState } from 'react'
import type React from 'react'
import { colors, fonts } from '../../lib/theme'

export interface MediaTab {
  /** Lo que se lee en la pestaña. Se imprime en mayúsculas y ordena la barra. */
  label: string
  panel: React.ReactNode
}

interface Props {
  tabs: MediaTab[]
  style?: React.CSSProperties
}

/**
 * La columna central de las fichas: la barra de pestañas y el panel activo.
 *
 * Recibe una LISTA y no un prop por pestaña. Con `mapa` / `fotos` / `plano` como
 * nombres fijos, el orden en pantalla no lo decidía quien arma la ficha sino una
 * constante escondida aquí adentro, y agregar una cuarta pestaña obligaba a
 * tocar este archivo aunque no cambie nada de lo que hace. Sigue sin saber qué
 * hay dentro de cada panel: es una barra y un hueco.
 */
export function MediaTabs({ tabs, style }: Props) {
  const [active, setActive] = useState(0)
  const current = tabs[active] ?? tabs[0]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', ...style }}>
      <div style={{ flexShrink: 0, display: 'flex', borderBottom: `1px solid ${colors.border}`, padding: '0 20px', background: colors.dark }}>
        {tabs.map((t, i) => (
          <button key={t.label} onClick={() => setActive(i)} style={{
            background: 'transparent', border: 'none',
            borderBottom: i === active ? `2px solid ${colors.primary}` : '2px solid transparent',
            color: i === active ? colors.neutral : colors.secondary,
            cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px',
            letterSpacing: '0.12em', padding: '10px 16px 8px', marginBottom: '-1px',
          }}>
            {t.label.toUpperCase()}
          </button>
        ))}
      </div>
      {current?.panel}
    </div>
  )
}
