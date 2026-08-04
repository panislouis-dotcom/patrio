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
