import { useEffect, useState } from 'react'

/**
 * El único breakpoint de la app, y por qué existe.
 *
 * Debajo de 900px la ficha de una propiedad NO CABE en dos columnas: su columna
 * izquierda mide 360px fijos, así que en un teléfono de 390px a la columna de
 * medios le quedaban 15 y la pestaña PRESUPUESTO tenía **ancho visible cero** —
 * medido en el navegador, no supuesto. La página entera scrolleaba en
 * horizontal (905px contra 375) en vez de la tabla. El README declara la app
 * `phone-friendly` y ahí se usa, así que entregar una pestaña invisible en el
 * contexto principal de uso no es entregarla.
 *
 * ES EL ÚNICO, y es una excepción justificada, no el inicio de una convención
 * de breakpoints. Todo lo demás de esta app se adapta sin consultar el ancho:
 * los capítulos del presupuesto abren colapsados, los montos van apilados en
 * una celda y la tabla scrollea localmente. Esas tres siguen haciendo el
 * trabajo; lo que ninguna podía arreglar era el contenedor.
 *
 * POR QUÉ NO ES UN `@media` EN CSS, que fue lo primero que se propuso: en este
 * repo el estilo vive en atributos `style` inline —una sola `className` en todo
 * `src`, ningún `@media`— y una regla CSS **no le gana a un estilo inline sin
 * `!important`**. Habrían hecho falta cinco o seis, y con ellos un lector futuro
 * tendría que saber que el `style` que ve en el componente no es la última
 * palabra. `matchMedia` es la MISMA consulta de medios, evaluada donde los
 * estilos de verdad viven, sin pelearse con nada.
 */
export const NARROW = '(max-width: 900px)'

export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(
    // `matchMedia` no existe en jsdom sin polyfill; un entorno sin él no es un
    // teléfono, así que la respuesta honesta por omisión es «no es angosto».
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(NARROW).matches
      : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(NARROW)
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches)
    setNarrow(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return narrow
}
