import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { suggestBudgetItems } from '../../lib/api'
import type { BudgetItemSuggestion } from '../../lib/types'
import { colors, fonts } from '../../lib/theme'

/**
 * La celda donde se escribe el nombre de una partida, con el aviso de duplicado.
 *
 * **Es la única pieza de interfaz que evita que el catálogo se pudra**, y en
 * este proyecto pesa más que en cualquier otro: no hay presupuestos viejos que
 * importar, así que la única fuente del catálogo es lo que se teclee de aquí en
 * adelante. Si el mismo trabajo se escribe «Piso cerámico», «Colocación piso
 * cerámico» y «Piso ceramico 60x60», el catálogo no tiene tres partidas: tiene
 * una partida partida en tres, cada trozo con una sola observación de precio, y
 * después de un año sigue sin poder sugerir un peso. No hay error que ver.
 *
 * **SUGIERE, NUNCA BLOQUEA.** Es la regla de la que dependen todas las demás
 * decisiones de este archivo. Si el sistema estorba, se captura basura o se deja
 * de capturar, y las dos son peores que un duplicado:
 *
 * - El renglón se guarda igual. El aviso no toca el `onBlur` que guarda ni puede
 *   impedirlo; vive al lado de la caja, no encima de ella.
 * - El aviso NO se cierra al perder el foco. Si se cerrara, sus botones serían
 *   inalcanzables —hacer clic en uno desenfoca la caja primero— y habría que
 *   sostenerlo con un `preventDefault` en el `mousedown`, que es un truco para
 *   sostener una decisión equivocada. Se cierra cuando alguien contesta.
 * - «NO, ES OTRA» baja al siguiente candidato en vez de callar del todo, y
 *   cuando se acaban ya no vuelve a preguntar por ese nombre.
 *
 * Las dos caras de la sugerencia importan desde el primer día. El CATÁLOGO es lo
 * curado; los RENGLONES SUELTOS son todo lo demás — y mientras el catálogo esté
 * vacío son la única memoria que existe. Adoptar un nombre suelto no liga nada,
 * junta el grupo: es lo que hace que la cola de promoción llegue a contar cuatro
 * y no cuatro veces uno.
 */

/** La misma normalización que el índice de la 030: `lower(btrim(name))`. */
const normalize = (s: string) => s.trim().toLowerCase()

/**
 * Lo que se espera a que dejen de teclear. `onChange` dispara con cada tecla, y
 * sin esto escribir «Piso cerámico» serían trece consultas de las que solo la
 * última dice algo.
 */
export const DEBOUNCE_MS = 250

/** Debajo de tres letras no hay nada que deduplicar: «pi» se parece a todo. */
const MIN_CHARS = 3

/**
 * Cuántos candidatos se traen. Se enseña UNO —una pregunta, no un menú— pero se
 * piden tres para que «NO, ES OTRA» tenga a dónde bajar.
 */
const CANDIDATES = 3

interface Props {
  value: string
  ariaLabel: string
  style: React.CSSProperties
  /**
   * El renglón que se está editando, para que el servidor lo excluya y no se
   * sugiera a sí mismo. Ausente al escribir uno nuevo: todavía no existe.
   */
  lineId?: number
  /**
   * El renglón ya tiene procedencia en el catálogo. No se pregunta nada: la
   * pregunta ya se contestó, y volver a hacerla es justo el estorbo que esta
   * pieza no se puede permitir.
   */
  linked: boolean
  onChange: (name: string) => void
  onBlur: () => void
  /**
   * Adoptar el candidato. Copia su nombre y su unidad; el `itemId` solo viaja
   * cuando viene del catálogo. **Nunca un importe**: el catálogo no guarda
   * precio, y reconocer una partida no puede reescribir lo que ya se capturó.
   */
  onAdopt: (suggestion: BudgetItemSuggestion) => void
}

export function DedupeNameCell({ value, ariaLabel, style, lineId, linked, onChange, onBlur, onAdopt }: Props) {
  const [suggestions, setSuggestions] = useState<BudgetItemSuggestion[]>([])
  /** Los nombres normalizados que alguien ya dijo que NO eran. No se re-pregunta. */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  /**
   * Cuál consulta es la vigente. Teclear rápido deja varias en vuelo y la más
   * lenta puede contestar al final: sin esto, el aviso enseñaría el resultado de
   * un nombre a medio escribir que ya nadie tiene en pantalla.
   */
  const latest = useRef(0)

  const query = value.trim()

  useEffect(() => {
    if (linked || query.length < MIN_CHARS) { setSuggestions([]); return }

    const ticket = ++latest.current
    const timer = setTimeout(() => {
      suggestBudgetItems(query, { limit: CANDIDATES, lineId })
        .then(found => { if (ticket === latest.current) setSuggestions(found) })
        // El aviso es una ayuda. Si el servidor no contesta, la captura sigue
        // exactamente igual: callarse es el modo degradado correcto, y un banner
        // rojo por una sugerencia que no llegó sería el estorbo que se evita.
        .catch(() => { if (ticket === latest.current) setSuggestions([]) })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query, linked, lineId])

  // El primero que nadie haya descartado. Vienen ordenados por similitud, así
  // que «el siguiente» es literalmente el siguiente.
  const hint = suggestions.find(s => !dismissed.has(normalize(s.name)))

  function dismiss(s: BudgetItemSuggestion) {
    setDismissed(prev => new Set(prev).add(normalize(s.name)))
  }

  function adopt(s: BudgetItemSuggestion) {
    // Se descarta al adoptarlo porque el nombre pasa a ser el suyo: sin esto la
    // consulta siguiente lo encontraría idéntico y preguntaría por lo que
    // acabamos de contestar.
    dismiss(s)
    onAdopt(s)
  }

  const action: React.CSSProperties = {
    background: 'transparent', border: `1px solid ${colors.border}`, cursor: 'pointer',
    fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.06em', padding: '1px 6px',
    color: colors.secondary,
  }

  return (
    <>
      <input
        value={value}
        aria-label={ariaLabel}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        style={style}
      />
      {hint && (
        <div
          role="status"
          style={{
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px',
            marginTop: '3px', fontFamily: fonts.sans, fontSize: '10px', color: colors.secondary,
          }}
        >
          <span>{question(hint, query)}</span>
          <button onClick={() => adopt(hint)} style={{ ...action, color: colors.primary, borderColor: colors.primary }}>
            {hint.itemId != null ? 'USAR LA DEL CATÁLOGO' : 'USAR ESE NOMBRE'}
          </button>
          <button onClick={() => dismiss(hint)} style={action}>NO, ES OTRA</button>
        </div>
      )}
    </>
  )
}

/**
 * Lo que se le pregunta a quien está capturando. Tres frases y no una porque los
 * tres casos piden decisiones distintas, y una frase genérica —«hay algo
 * parecido»— obliga a abrir otra pantalla para saber qué se está aceptando.
 */
function question(s: BudgetItemSuggestion, typed: string): string {
  if (s.itemId != null) {
    return normalize(s.name) === normalize(typed)
      ? `«${s.name}» ya está en el catálogo.`
      : `¿Es la misma que «${s.name}» del catálogo?`
  }
  // Todavía no está en el catálogo: alguien ya la escribió y nadie la ha
  // fichado. Escribirla igual es lo que hace que llegue a la cola de promoción
  // como un grupo de N en vez de como N grupos de uno.
  return s.usedInLines > 1
    ? `«${s.name}» ya se escribió en ${s.usedInLines} renglones.`
    : `«${s.name}» ya se escribió antes.`
}
