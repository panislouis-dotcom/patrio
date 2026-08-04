/**
 * Los formatos de la app, y una sola regla que los gobierna:
 *
 *   **Vacío es «—». Cero es cero.**
 *
 * El backend cuida esa distinción con cuidado —`underwriting.py` devuelve None y
 * nunca 0 «porque un 0 se leería como salir a mano»— y estas tres funciones la
 * deshacían en el último metro: traducían 0 a guion, así que una venta a costo
 * exacto, un ROI de 0.0% y una inversión de $0 se veían idénticos a un dato que
 * nadie capturó. Son tres respuestas distintas y ahora se ven distintas.
 *
 * `null`/`undefined` es lo único que da guion. Si una cifra sale 0 y ese 0 no es
 * verdad, el arreglo va donde se calcula, no aquí: esconderlo desde el formato
 * apaga también los ceros legítimos.
 */

/** Una fracción guardada (0.062) → «6.2%». Cero es 0.0%, no ausencia. */
export function fmtPct(n: number | null | undefined): string {
  return n != null ? `${(n * 100).toFixed(1)}%` : '—'
}

/**
 * Lo mismo, con signo: «+21.0%», «-15.3%».
 *
 * El signo no es decoración ni se pone en todas partes — se pone donde el número
 * PUEDE ser negativo y esa diferencia cambia la lectura: rendimientos y
 * ganancias. Un cap rate o un porcentaje de costos de adquisición no se firman,
 * porque no existen en negativo y un «+» ahí solo es ruido.
 *
 * Vive aquí y no en la ficha porque el héroe y la fila de abajo enseñaban el
 * MISMO dato con dos formatos —«+21.0%» arriba, «21.0%» abajo— y dos formatos
 * para una cifra invitan a leerlas como dos cifras.
 */
export function fmtPctSigned(n: number | null | undefined): string {
  return n != null ? `${n > 0 ? '+' : ''}${(n * 100).toFixed(1)}%` : '—'
}

/** Compacto para tablas: $2.4M, $850k, $0. Lleva el signo de los negativos. */
export function fmtM(n: number | null | undefined): string {
  if (n == null) return '—'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(0)}k`
  return `${sign}$${Math.round(abs)}`
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
               'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/**
 * Una fecha del ciclo de vida, al mes: «2026-01-15» y «2026-01» dan los dos
 * «ene 2026».
 *
 * **El mes ES la granularidad del dominio**, no un redondeo de presentación.
 * Ninguna fecha de una propiedad mueve un cálculo al día — adquisición, primera
 * renta, venta y valuación pasan todas por `months_between`, que ignora el día —
 * y ninguna se ha capturado nunca al día: las columnas son `DATE` y todas las
 * filas guardadas traen día 1, heredado de las columnas de texto `YYYY-MM` de
 * la migración. Imprimir «1 de enero» ahí era precisión aparente, que es el
 * defecto que este plan entero persigue.
 *
 * Por eso los inputs son `type="month"` y esta función tira el día que reciba:
 * la pantalla no puede afirmar una precisión que la captura no tiene.
 *
 * El mes va en letra a propósito. «03/04» se lee al revés según el país; «abr»
 * no se puede leer mal. Es el mismo formato que usa el PDF.
 */
export function fmtMonth(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [year, month] = iso.split('-')
  const index = Number(month) - 1
  if (!year || !MESES[index]) return iso
  return `${MESES[index]} ${year}`
}

/**
 * Una cuenta con su sustantivo concordado: «1 renglón», «4 renglones».
 *
 * Vive aquí y no suelto en cada pantalla porque ya se había escrito tres veces
 * y una de las tres se equivocaba — la cola de promoción concordaba OBRA/OBRAS
 * correctamente y en la misma línea imprimía «2 RENGLONES» para uno solo. Una
 * regla de idioma repetida a mano se aplica a medias, y en una app en español
 * «1 RENGLONES» es lo primero que se lee de una plantilla.
 */
export function plural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/** Pesos enteros con separadores: «$1,234,567». Cero es $0. */
export function fmtMXN(n: number | null | undefined): string {
  if (n == null) return '—'
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

/**
 * Día exacto de un timestamp: «2 ago 2026». A diferencia de `fmtMonth`, que
 * redondea al mes porque las fechas del ciclo de vida son hitos, aquí el día
 * importa: distingue dos renders de la misma semana.
 */
export function fmtDia(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
