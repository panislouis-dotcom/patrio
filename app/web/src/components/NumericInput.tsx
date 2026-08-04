import { useState, useEffect } from 'react'
import type React from 'react'

interface Props {
  value: number | undefined
  onChange: (n: number | undefined) => void
  style?: React.CSSProperties
  placeholder?: string
  /** Provide for decimal fields (e.g. step=0.1 for percentages). Omit for integers/currency. */
  step?: number
  /** Names the box where the visible label is not tied to it, e.g. an in-place edit row. */
  ariaLabel?: string
  /**
   * Se avisa al soltar la caja. Lo usa la captura que guarda sola —una celda de
   * dinero del presupuesto— para mandar UN cambio y no uno por tecla: `onChange`
   * dispara con cada dígito, así que teclear «1500» serían cuatro escrituras.
   * La ficha, que guarda con un botón, no lo pasa y no cambia en nada.
   */
  onBlur?: () => void
}

/**
 * Una caja de número que se muestra formateada y se edita en crudo.
 *
 * AL ENFOCAR SE SELECCIONA TODO, y esa línea tiene una consecuencia que ha
 * costado tiempo entender más de una vez:
 *
 *   `onFocus` reescribe el contenido al valor sin formato y agenda un
 *   `select()` en un `setTimeout(0)`. A una persona no le afecta —para cuando
 *   teclea, el clic ya seleccionó todo y su primera tecla reemplaza—, pero **un
 *   tecleo automatizado carácter por carácter corre una carrera contra ese
 *   timeout**: las primeras teclas caen antes del `select()` y se APILAN sobre
 *   el valor viejo, y el `select()` llega a media palabra y borra lo tecleado
 *   hasta ahí.
 *
 * Medido, no supuesto: escribir «1» sobre una caja en «0» dejó **10**, y
 * escribir «200000» dejó **0**. Ninguno de los dos es un defecto del
 * componente; los dos parecen uno.
 *
 * **Quien automatice estas cajas tiene que hacer CLIC y después escribir**, o
 * usar un `fill()` que reemplace el contenido de una vez. Nunca teclear en frío
 * sobre una caja recién enfocada. Con Playwright: `.click()` y luego `.fill()`,
 * no `.pressSequentially()` a secas.
 */
export function NumericInput({ value, onChange, style, placeholder, step, ariaLabel, onBlur }: Props) {
  const isDecimal = step != null && step < 1

  function fmt(n: number | undefined): string {
    if (n == null) return ''
    if (isDecimal) return String(n)
    return Math.round(n).toLocaleString('en-US')
  }

  const [focused, setFocused] = useState(false)
  const [raw, setRaw] = useState(fmt(value))

  useEffect(() => {
    if (!focused) setRaw(fmt(value))
  }, [value, focused])

  return (
    <input
      type="text"
      inputMode={isDecimal ? 'decimal' : 'numeric'}
      value={focused ? raw : fmt(value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      style={style}
      onChange={e => {
        const s = e.target.value
        setRaw(s)
        const clean = s.replace(/,/g, '')
        const n = parseFloat(clean)
        onChange(clean === '' || isNaN(n) ? undefined : n)
      }}
      onFocus={e => {
        setFocused(true)
        setRaw(value != null ? String(value) : '')
        setTimeout(() => e.target.select(), 0)
      }}
      onBlur={() => { setFocused(false); onBlur?.() }}
    />
  )
}
