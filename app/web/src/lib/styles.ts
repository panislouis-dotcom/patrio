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

/**
 * Una página que llena lo que la barra de navegación deja — **sin saber cuánto
 * mide la barra**.
 *
 * Antes cada página lo calculaba con `calc(100vh - 49px)`, y ese 49 estaba
 * copiado a mano en QUINCE lugares de once archivos. Copiado y equivocado: la
 * barra mide 49px con una fila, pero **80 con dos**, que es lo que pasa en todo
 * `/propiedades/*` cuando aparecen TABLA · MAPA · SONAR · COMPARABLES. La
 * diferencia son 31px de desbordamiento en la página principal del producto, y
 * el síntoma es que al desplazarse la barra pegajosa se come el encabezado.
 *
 * Ya no hay número. `AppShell` es una columna flex y la página es su hueco: si
 * la barra crece, encoge o desaparece —en /login no se dibuja— la aritmética se
 * ajusta sola porque no hay aritmética.
 *
 * `minHeight: 0` no es adorno: sin él, un hijo flex se niega a encoger por
 * debajo de su contenido y las columnas que scrollean por dentro dejarían de
 * hacerlo, empujando el scroll a la página otra vez.
 */
export const pageFill: React.CSSProperties = { flex: 1, minHeight: 0 }
