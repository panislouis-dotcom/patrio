import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import {
  fetchBudget, createBudgetLine, updateBudgetLine, deleteBudgetLine, setBudgetTotal,
  renameBudgetChapter, deleteBudgetChapter, addBudgetPayment, deleteBudgetPayment, getProveedores,
  getCategories, fetchBudgetSources, applyBudgetSource, fetchProperties,
} from '../../lib/api'
import type {
  Budget, BudgetLine, BudgetLinePatch,
  BudgetSource, BudgetWrite, Property, Proveedor, ProveedorCategory,
} from '../../lib/types'
import { colors, fonts } from '../../lib/theme'
import { fmtMXN } from '../../lib/fmt'
import { computeDepths } from '../../lib/treeUtils'
import { NumericInput } from '../NumericInput'

/**
 * El presupuesto de obra de una propiedad: capítulos y partidas, con las tres
 * cifras que el control de obra distingue —presupuestado, comprometido, pagado—
 * y la brecha entre el plan y lo que se pagó.
 *
 * No inventa patrones: compone tres que ya funcionan en el repo. El árbol
 * colapsable cuyos padres SUMAN SOLOS es el de `ProcesoInstanceDetail`
 * —`getProgress()` deriva el avance del capítulo de sus hijos y jamás lo
 * captura, igual que `totalInvestment` jamás se teclea—; el embudo de tres
 * montos es el de `PropertyInvestor`; el selector de proveedores que descarta
 * vetados es el de `ProcesoNodeDetail`.
 *
 * **Sin botón EDITAR/GUARDAR.** Las celdas están siempre activas. El toggle de
 * la ficha no sabría representar «agregué una fila» ni «borré una fila», y su
 * regla de PATCH —«caja vacía = no la toques»— dice justo lo contrario de lo que
 * quiere decir una celda de dinero que se deja en blanco.
 *
 * **Sin ventana de etapa.** El presupuesto acompaña a la propiedad desde
 * `prospecto`, como el desglose de costos: hay que poder presupuestar antes de
 * ofertar, y naciendo con ella no hay ningún traspaso que diseñar.
 *
 * **Móvil sin un solo `@media`.** No hay una línea de CSS responsivo en toda la
 * app, y ésta no es la pantalla para estrenar el primer breakpoint. Lo que la
 * hace usable en un teléfono son tres decisiones que además la mejoran en
 * pantalla grande: los capítulos abren COLAPSADOS —la vista inicial son cinco
 * renglones y no cuarenta—, los montos van APILADOS en una celda en vez de
 * ocupar cuatro columnas, y el scroll horizontal es LOCAL a la tabla.
 */

interface Props {
  /**
   * La propiedad, no su id: el TOTAL de la tabla se LEE de
   * `constructionBudgeted` en vez de volver a sumar los renglones. Sumarlos aquí
   * daría un número redondeado renglón por renglón contra uno redondeado al
   * final, y unos pesos de diferencia entre el pie de la tabla y la INVERSIÓN de
   * la ficha bastan para dejar de creerle a las dos.
   *
   * El `Pick` dice exactamente de qué depende esta pestaña. Pedir la `Property`
   * entera prometería que cualquiera de sus cincuenta campos podría importarle.
   */
  property: Pick<Property,
    'id' | 'constructionBudgeted' | 'constructionCommitted' | 'constructionPaid'
    | 'constructionPaidVariance'>
  /**
   * Toda escritura devuelve la propiedad recalculada: la suma presupuestada ES
   * el costo de obra, así que mover un renglón mueve la inversión total, la
   * ganancia proyectada, el ROI y el cap rate. La ficha entera se refresca con
   * esto, de una sola vez y sin plomería nueva.
   */
  onPropertyChange: (property: Property) => void
}

/** Una fila de la tabla. Un capítulo NO es una entidad: es agrupar por nombre. */
type Row =
  /**
   * `locked` marca el capítulo donde vive el residuo. No se renombra, no se
   * borra y no recibe partidas nuevas: es donde queda lo que falta por repartir,
   * no un capítulo más donde detallar. Las tres las rechaza también el servidor,
   * con su razón — aquí simplemente no se ofrecen.
   */
  | { kind: 'chapter'; id: number; parentId: null; name: string; lines: BudgetLine[]; locked: boolean }
  | { kind: 'line'; id: number; parentId: number; line: BudgetLine }
  | { kind: 'add'; id: number; parentId: number; chapterName: string }

/**
 * Lo que le pasó al presupuesto de UNA obra destino al copiarle éste.
 *
 * Es por obra y no un resumen sumado porque el copiado es una llamada por
 * destino: uno puede fallar mientras los otros entran, y «se copiaron 40
 * renglones» no diría a cuál de las tres obras no llegó nada. `added` y
 * `skipped` distinguen lo que entró de lo que ya estaba allá y no se tocó.
 */
interface PushResult {
  propertyId: number
  name: string
  /** El mensaje del servidor cuando esta obra falló; null cuando entró. */
  error: string | null
  added: number
  skipped: number
}

/**
 * Los tres montos de un conjunto de renglones, y su brecha. Un capítulo nunca
 * los captura: los deriva de sus partidas, como `getProgress()` deriva el avance
 * y como `totalInvestment` deriva el capital.
 */
interface Rollup {
  budgeted: number
  committed: number | null
  paid: number | null
  /** Pagado − presupuestado; null mientras no se haya pagado nada. */
  variance: number | null
}

/**
 * Suma que distingue «nadie capturó nada» de «capturaron cero», que es la misma
 * regla que el servidor sostiene columna por columna: si ningún renglón tiene
 * comprometido, el capítulo no comprometió $0 — no comprometió nada, y eso se
 * imprime «—». En cuanto UNO tenga cifra, los que no la tienen cuentan como 0.
 */
function sumOrNull(values: Array<number | null>): number | null {
  return values.some(v => v != null)
    ? values.reduce<number>((s, v) => s + (v ?? 0), 0)
    : null
}

/**
 * El rollup de un capítulo. Suma los importes YA REDONDEADOS que están en
 * pantalla, para que el subtotal sea exactamente lo que se ve arriba de él.
 *
 * La variación es `null` mientras no se haya pagado nada: sin un peso ejecutado
 * no hay ejecución que comparar, y «−$450,000» diría que la obra va ahorrando
 * cuando lo que pasa es que no ha empezado. Pagar exactamente lo presupuestado
 * sí da 0, y ese 0 se imprime — es el resultado más difícil de lograr en una
 * obra, no un dato faltante.
 */
function rollupOf(lines: BudgetLine[]): Rollup {
  const budgeted = lines.reduce((s, l) => s + l.budgetedAmount, 0)
  const paid = sumOrNull(lines.map(l => l.paidAmount))
  return {
    budgeted,
    committed: sumOrNull(lines.map(l => l.committedAmount)),
    paid,
    variance: paid != null ? paid - budgeted : null,
  }
}

/**
 * La vista previa de un renglón editado. Vuelve a multiplicar porque
 * presupuestado es cantidad × precio, y la pantalla no puede enseñar una
 * cantidad nueva junto a un importe viejo mientras se teclea.
 *
 * Es una VISTA PREVIA y nada más: al soltar la caja llega la cifra del servidor
 * y la pisa. Ninguna suma que alimente la inversión se calcula aquí — el TOTAL
 * de esta tabla se lee de la propiedad, no de estos renglones.
 */
function preview(line: BudgetLine, patch: BudgetLinePatch): BudgetLine {
  const next = { ...line, ...patch }
  return { ...next, budgetedAmount: Math.round(next.quantity * next.unitPrice) }
}

/** Un nombre de capítulo que no choque con los que ya existen. */
function freshChapterName(taken: string[]): string {
  const base = 'Capítulo nuevo'
  if (!taken.includes(base)) return base
  for (let i = 2; ; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`
}

export function BudgetPanel({ property, onPropertyChange }: Props) {
  const propertyId = property.id

  const [lines, setLines] = useState<BudgetLine[]>([])
  const [chapters, setChapters] = useState<string[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  /**
   * Los oficios con los que se contrata. Viajan con el presupuesto y no con el
   * panel de catálogo porque el oficio se captura EN EL RENGLÓN, en la visita
   * normal: es lo que se sabe mientras se presupuesta, mucho antes que quién lo
   * va a hacer.
   */
  const [categories, setCategories] = useState<ProveedorCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Lo que el servidor avisa cuando el detalle rebasó el estimado. */
  const [notice, setNotice] = useState<string | null>(null)

  /**
   * `null` = nadie ha tocado nada, y entonces TODOS están colapsados. Que el
   * estado inicial diga «colapsados» —en vez de un efecto que los colapse al
   * llegar los datos— evita la carrera con el fetch, y el colapso es lo que hace
   * legible la tabla en un teléfono.
   *
   * Se guarda por NOMBRE y no por índice: agregar o quitar un capítulo recorre
   * los índices, y el colapso saltaría a otro capítulo.
   */
  const [collapsed, setCollapsed] = useState<Set<string> | null>(null)
  const [openPayments, setOpenPayments] = useState<number | null>(null)
  const [payAmount, setPayAmount] = useState<number | undefined>(undefined)
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [adjusting, setAdjusting] = useState(false)
  const [newTotal, setNewTotal] = useState<number | undefined>(undefined)

  /**
   * El panel de arrancar desde otra obra, y lo que necesita.
   *
   * Se pide al ABRIRLO y no al entrar a la pestaña: los presupuestos de los que
   * se puede copiar no son de esta propiedad, y casi toda visita es a capturar
   * un renglón, no a arrancar de cero. Traerlos siempre sería una consulta más
   * en la ficha para el caso raro.
   */
  const [sourcing, setSourcing] = useState(false)
  const [sources, setSources] = useState<BudgetSource[]>([])
  const [pickedSource, setPickedSource] = useState<number | ''>('')
  /** El id del PRESUPUESTO de esta obra: es lo que se copia al empujarlo a otras. */
  const [budgetId, setBudgetId] = useState<number | null>(null)

  /**
   * El panel de EMPUJAR: llevarse este presupuesto a otras obras.
   *
   * Es la otra dirección de «arrancar desde», no otra operación: ahí se jala un
   * presupuesto ajeno hacia ésta, aquí se lleva el de ésta hacia varias. El
   * servidor es el mismo `apply` con otro `property_id`, así que lo único que
   * cambia de verdad es de dónde sale el `budgetId` y cuántas veces se llama.
   *
   * Las obras destino se piden al ABRIRLO, por lo mismo que las fuentes: casi
   * toda visita al presupuesto es a capturar un renglón.
   */
  const [pushing, setPushing] = useState(false)
  const [targets, setTargets] = useState<Property[]>([])
  const [pickedTargets, setPickedTargets] = useState<number[]>([])
  /**
   * Qué capítulos viajan. `null` = nadie ha tocado una casilla, y entonces van
   * TODOS —el presupuesto entero, que es lo que se quiere copiar casi siempre—.
   * Es la misma convención que `collapsed`, y evita un efecto que llene la
   * selección cuando llegan los datos.
   */
  const [pickedChapters, setPickedChapters] = useState<Set<string> | null>(null)
  /** Copiando ahora mismo: hay N llamadas en vuelo, una tras otra. */
  const [copying, setCopying] = useState(false)
  const [pushResults, setPushResults] = useState<PushResult[] | null>(null)

  /**
   * Lo que se cambió y todavía no se manda, por renglón. Las celdas de texto y
   * de dinero guardan al SOLTARSE y no a cada tecla —teclear «1500» serían
   * cuatro escrituras, y cada una recalcula el residuo— que es el mismo trato
   * que `ProcesoInstanceDetail` le da a sus notas. Los controles discretos
   * (proveedor, fecha) sí guardan al cambiar: ahí un cambio es un cambio.
   */
  const pending = useRef(new Map<number, BudgetLinePatch>())

  /**
   * Lo último que dijo el servidor, para poder revertir una celda que no se
   * puede vaciar. `lines` lleva el borrador de lo que se está tecleando, así que
   * no sirve para saber a qué volver.
   */
  const served = useRef(new Map<number, BudgetLine>())

  /**
   * El presupuesto que dice el servidor, entero. Toma el `Budget` y no sus
   * renglones porque los tres estados que lo componen —lo servido, las filas y
   * el orden de los capítulos— tienen que moverse juntos o no moverse: los tres
   * vienen de la misma respuesta, y actualizarlos en tres llamadas es la forma
   * de que un día falte una.
   */
  function receive(next: Budget) {
    served.current = new Map(next.lines.map(l => [l.id, l]))
    setLines(next.lines)
    setChapters(next.chapters)
    setBudgetId(next.id)
  }

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchBudget(propertyId), getProveedores(), getCategories()])
      .then(([b, ps, cs]) => { receive(b); setProveedores(ps); setCategories(cs) })
      .catch(e => setError(e instanceof Error ? e.message : 'No se pudo cargar el presupuesto'))
      .finally(() => setLoading(false))
  }, [propertyId])

  /**
   * Toda escritura se lee igual. Si falla, la pantalla no se queda enseñando un
   * cambio que no se guardó: la verdad es del servidor y se vuelve a leer.
   */
  async function run(op: () => Promise<BudgetWrite>) {
    setError(null)
    try {
      const { budget, property: updated, budgetIncrease, linesAdded, linesSkipped } = await op()
      receive(budget)
      onPropertyChange(updated)
      // Detallar reparte un total que no se mueve. Cuando el detalle lo rebasa,
      // el residuo llega a 0 y la obra sí pasa a costar más — que ya no es
      // detallar sino aumentar el presupuesto. Se dice en vez de dejar que el
      // total suba en silencio.
      //
      // `linesAdded` y `linesSkipped` solo llegan al copiar, y se dicen porque
      // copiar es la única escritura cuyo efecto no se ve entero en pantalla:
      // los renglones caen dentro de capítulos que están colapsados. Los
      // saltados se dicen aparte porque son lo que NO pasó: el destino ya los
      // tenía y no se sobrescriben nunca.
      setNotice([
        linesAdded != null
          ? ([
              linesAdded > 0 ? `Se copiaron ${linesAdded} renglones.` : null,
              linesSkipped ? `Se saltaron ${linesSkipped} que ya estaban aquí: no se sobrescribe nada.` : null,
            ].filter(Boolean).join(' ')
              || 'No había nada nuevo que copiar: esas partidas ya estaban.')
          : null,
        budgetIncrease > 0
          ? `El detalle rebasó el estimado: el presupuesto de obra subió ${fmtMXN(budgetIncrease)}.`
          : null,
      ].filter(Boolean).join(' ') || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
      fetchBudget(propertyId).then(receive).catch(() => {})
    }
  }

  function edit(line: BudgetLine, patch: BudgetLinePatch) {
    pending.current.set(line.id, { ...(pending.current.get(line.id) ?? {}), ...patch })
    setLines(prev => prev.map(l => (l.id === line.id ? preview(l, patch) : l)))
  }

  function commit(lineId: number) {
    const patch = pending.current.get(lineId)
    if (!patch) return
    pending.current.delete(lineId)
    void run(() => updateBudgetLine(propertyId, lineId, patch))
  }

  /** Un cambio que ya es definitivo al hacerse: no espera a que suelten nada. */
  function editNow(line: BudgetLine, patch: BudgetLinePatch) {
    edit(line, patch)
    commit(line.id)
  }

  /**
   * Suelta una celda de texto que NO PUEDE quedar vacía.
   *
   * `name` y `unit` son NOT NULL con `CHECK (<> '')` en la 032. Ahí un vacío no
   * es un vaciado sino un renglón roto —el servidor lo dice con esas palabras
   * para el null— así que la caja vacía se revierte a lo guardado en vez de
   * mandarse. No contradice la regla de las celdas de dinero: en el comprometido
   * el vacío ES el mensaje, y aquí no hay ningún mensaje que mandar, porque el
   * campo no tiene estado vacío que representar.
   */
  function commitText(lineId: number, field: 'name' | 'unit') {
    const patch = pending.current.get(lineId)
    const draft = patch?.[field]
    if (draft !== undefined && !draft.trim()) {
      const { [field]: _descartado, ...resto } = patch!
      if (Object.keys(resto).length) pending.current.set(lineId, resto)
      else pending.current.delete(lineId)
      const saved = served.current.get(lineId)?.[field]
      if (saved !== undefined) {
        setLines(prev => prev.map(l => (l.id === lineId ? { ...l, [field]: saved } : l)))
      }
    }
    commit(lineId)
  }

  /**
   * La tabla, aplanada en el orden en que se lee: cada capítulo, sus partidas y
   * su «+ PARTIDA» al final. El botón de agregar es UNA FILA MÁS del modelo y no
   * un segundo recorrido después de la tabla — recorrer dos veces amontonaba
   * todos los «+ PARTIDA» al pie, lejos del capítulo al que pertenecen.
   */
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    chapters.forEach((name, i) => {
      // Negativos a propósito: estos ids se inventan aquí y así jamás pueden
      // chocar con los de un renglón, que vienen de un BIGSERIAL. Pares e
      // impares para que el capítulo y su fila de agregar tampoco choquen.
      const chapterId = -(2 * i + 1)
      const chapterLines = lines.filter(l => l.chapterName === name)
      const locked = chapterLines.some(l => l.isResidual)
      out.push({ kind: 'chapter', id: chapterId, parentId: null, name, lines: chapterLines, locked })
      chapterLines.forEach(line => out.push({ kind: 'line', id: line.id, parentId: chapterId, line }))
      if (!locked) out.push({ kind: 'add', id: -(2 * i + 2), parentId: chapterId, chapterName: name })
    })
    return out
  }, [lines, chapters])

  const depths = useMemo(() => computeDepths(rows), [rows])
  const isCollapsed = (name: string) => (collapsed === null ? true : collapsed.has(name))

  function toggleCollapse(name: string) {
    setCollapsed(prev => {
      const next = new Set(prev ?? chapters)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  function toggleSourcing() {
    const opening = !sourcing
    setSourcing(opening)
    if (!opening) return
    fetchBudgetSources(propertyId)
      .then(setSources)
      .catch(e => setError(e instanceof Error ? e.message : 'No se pudo leer de dónde copiar'))
  }

  function togglePush() {
    const opening = !pushing
    setPushing(opening)
    if (!opening) return
    setPushResults(null)
    // ESTA obra se saca de la lista: copiarse sobre sí misma la rechaza el
    // servidor con un 422, y ofrecer una opción que solo puede dar error es
    // hacer que alguien descubra la regla chocando con ella. Es la misma razón
    // por la que `fetchBudgetSources` recibe a quién excluir.
    //
    // Las archivadas tampoco: `fetchProperties` las deja fuera salvo que se
    // pidan a propósito, y no se le presupuesta una obra a lo que ya se guardó.
    fetchProperties()
      .then(ps => setTargets(ps.filter(p => p.id !== propertyId)))
      .catch(e => setError(e instanceof Error ? e.message : 'No se pudo leer a qué obras copiar'))
  }

  /**
   * Los capítulos que SÍ se pueden copiar. El del residuo queda fuera: es lo que
   * a ESTA obra le falta por detallar, y en la de al lado sería una partida que
   * le come su propio residuo. El servidor nunca lo copia —por eso `lineCount`
   * cuenta lo copiable— así que ofrecerlo sería una casilla que no hace nada.
   */
  const copyableChapters = useMemo(
    () => chapters.filter(c => lines.some(l => l.chapterName === c && !l.isResidual)),
    [chapters, lines],
  )

  const chapterPicked = (name: string) => (pickedChapters === null ? true : pickedChapters.has(name))

  function toggleChapter(name: string) {
    setPickedChapters(prev => {
      const next = new Set(prev ?? copyableChapters)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  /**
   * Lo que se manda en `chapters`. `null` cuando nadie tocó una casilla, y eso
   * es literal: no se eligieron capítulos, se copia el presupuesto entero. Con
   * casillas tocadas viaja la lista, en el orden de lectura del presupuesto.
   */
  const chaptersToPush = pickedChapters === null
    ? null
    : copyableChapters.filter(c => pickedChapters.has(c))

  /**
   * Empujar este presupuesto a las obras elegidas: UNA LLAMADA POR OBRA.
   *
   * No hay ruta de reparto y no es un descuido. Cada presupuesto es
   * independiente, así que si el tercer destino falla, deshacer los dos que ya
   * entraron sería incorrecto y no seguro; la atomicidad correcta es por
   * propiedad, y ésa ya la da el endpoint.
   *
   * Y NO pasa por `run`: la respuesta trae el presupuesto y la propiedad DEL
   * DESTINO. Pintarla aquí sustituiría esta obra por otra en la pantalla y en la
   * ficha. Lo que esta obra tiene no cambia con esto —de aquí solo sale una
   * copia—, así que no hay nada que refrescar.
   */
  async function pushToTargets() {
    if (budgetId == null || pickedTargets.length === 0) return
    const chosen = targets.filter(p => pickedTargets.includes(p.id))
    const alcance = chaptersToPush === null
      ? 'todo el presupuesto'
      : `${chaptersToPush.length} capítulo${chaptersToPush.length === 1 ? '' : 's'}`
    if (!window.confirm(
      `¿Copiar ${alcance} a ${chosen.length} obra${chosen.length === 1 ? '' : 's'}? `
      + 'Los renglones que allá ya existan se saltan: no se sobrescribe nada.',
    )) return
    setError(null)
    setCopying(true)
    // Se van pintando conforme responden: con cinco destinos, esperar al último
    // para enseñar el primero deja la pantalla muda justo cuando más está
    // pasando.
    setPushResults([])
    for (const p of chosen) {
      const base = { propertyId: p.id, name: p.name }
      try {
        const { linesAdded, linesSkipped } = await applyBudgetSource(p.id, budgetId, chaptersToPush)
        setPushResults(prev => [...(prev ?? []), {
          ...base, error: null, added: linesAdded ?? 0, skipped: linesSkipped ?? 0,
        }])
      } catch (e) {
        // Que una obra falle no cancela las demás: las que ya entraron quedan
        // aplicadas y las que faltan se siguen intentando. Por eso el fallo se
        // guarda CON EL NOMBRE de su obra en vez de tumbar todo el copiado.
        setPushResults(prev => [...(prev ?? []), {
          ...base, added: 0, skipped: 0,
          error: e instanceof Error ? e.message : 'No se pudo copiar',
        }])
      }
    }
    setCopying(false)
  }

  function renameChapter(from: string, to: string) {
    if (!to.trim() || to === from) return
    setCollapsed(prev => {
      if (prev === null || !prev.has(from)) return prev
      const next = new Set(prev)
      next.delete(from)
      next.add(to)
      return next
    })
    void run(() => renameBudgetChapter(propertyId, from, to))
  }

  // ── Estilos ─────────────────────────────────────────────────────────────────

  const cellInput: React.CSSProperties = {
    background: colors.surface, border: `1px solid ${colors.border}`, color: colors.neutral,
    fontFamily: fonts.sans, fontSize: '11px', padding: '3px 5px', outline: 'none',
    boxSizing: 'border-box', width: '100%',
  }
  const numInput: React.CSSProperties = { ...cellInput, textAlign: 'right' }
  const th: React.CSSProperties = {
    padding: '4px 6px', fontFamily: fonts.label, fontSize: '8px', color: colors.secondary,
    letterSpacing: '0.08em', textAlign: 'left', whiteSpace: 'nowrap',
  }
  const td: React.CSSProperties = { padding: '4px 6px', verticalAlign: 'top' }
  const money: React.CSSProperties = {
    fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral,
    textAlign: 'right', whiteSpace: 'nowrap',
  }
  const micro: React.CSSProperties = {
    fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, whiteSpace: 'nowrap',
  }
  const ghost: React.CSSProperties = {
    background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary,
    cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.06em',
    padding: '2px 8px',
  }
  /** El bloque que se despliega bajo los botones. Los dos copiados usan el mismo. */
  const panelBox: React.CSSProperties = {
    border: `1px solid ${colors.border}`, background: colors.surface,
    padding: '10px 12px', marginBottom: '10px',
    display: 'flex', flexDirection: 'column', gap: '10px',
  }
  const panelRow: React.CSSProperties = {
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px',
  }
  const checkLabel: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer',
  }
  const kill: React.CSSProperties = {
    background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer',
    fontFamily: fonts.label, fontSize: '10px', padding: '0 2px',
  }

  /**
   * Comprometido y pagado APILADOS bajo el presupuestado, en tipografía menor.
   * Es lo que permite tener las tres cifras sin tres columnas — y sin tres
   * columnas la tabla cabe en un teléfono sin inventar un breakpoint.
   */
  const executionLine = (r: Rollup) => (
    <div style={{ ...micro, marginTop: '2px' }}>
      COMP {fmtMXN(r.committed)} · PAG {fmtMXN(r.paid)}
      {r.variance != null && (
        <span style={{ color: r.variance > 0 ? '#c0392b' : colors.primary }}>
          {' '}· VAR {fmtMXN(r.variance)}
        </span>
      )}
    </div>
  )

  const categoryName = (id: number | null) =>
    categories.find(c => c.id === id)?.name ?? null

  /**
   * Los proveedores de un renglón. El OFICIO del renglón FILTRA pero nunca
   * restringe: los que se dedican a eso salen arriba, y todos los demás siguen
   * ahí abajo. El día que el plomero haga albañilería tiene que poder capturarse.
   *
   * **Filtra por id.** Antes comparaba el NOMBRE del capítulo contra el de las
   * categorías del proveedor —dos vocabularios independientes que solo podían
   * coincidir por casualidad— y con cero categorías dadas de alta el grupo de
   * sugeridos salía siempre vacío sin que nada lo dijera. Ahora es la misma
   * llave en los dos lados.
   *
   * Sin oficio no hay a qué parecerse y van todos en un grupo: es lo honesto
   * mientras se presupuesta, y es un grupo vacío menos que fingir.
   *
   * Los vetados no se ofrecen — pero uno YA asignado se queda en la lista, porque
   * sacarlo dejaría el selector en blanco y guardar cualquier otra celda borraría
   * el proveedor sin que nadie lo hubiera pedido.
   */
  function supplierOptions(categoryId: number | null, selectedId: number | null) {
    const usable = proveedores.filter(p => p.status !== 'vetado' || p.id === selectedId)
    if (categoryId == null) return { sugeridos: [], resto: usable }
    const matches = (p: Proveedor) => p.categories.some(c => c.id === categoryId)
    return { sugeridos: usable.filter(matches), resto: usable.filter(p => !matches(p)) }
  }

  if (loading) {
    return (
      <div style={{ padding: '24px', fontFamily: fonts.label, fontSize: '11px', color: colors.secondary }}>
        Cargando…
      </div>
    )
  }

  /** El pie de la tabla no vuelve a sumar nada: las cuatro cifras son del servidor. */
  const totalRollup: Rollup = {
    budgeted: property.constructionBudgeted ?? 0,
    committed: property.constructionCommitted,
    paid: property.constructionPaid,
    variance: property.constructionPaidVariance,
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em' }}>
          PRESUPUESTO DE OBRA
        </span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={() => void run(() => createBudgetLine(propertyId, {
              chapterName: freshChapterName(chapters), name: 'Partida nueva',
            }))}
            style={ghost}
          >
            + CAPÍTULO
          </button>
          <button onClick={toggleSourcing} style={ghost}>
            COPIAR DE OTRA OBRA {sourcing ? '▾' : '▸'}
          </button>
          {/* La otra dirección, y por eso es otro botón: «arrancar desde» jala
              un presupuesto ajeno hacia esta obra, esto se lleva el de esta obra
              hacia otras. Meterlas en el mismo bloque haría que se pareciera un
              copiado que trae a uno que manda. */}
          <button onClick={togglePush} style={ghost}>
            COPIAR A OTRAS OBRAS {pushing ? '▾' : '▸'}
          </button>
        </div>
      </div>

      {/* ARRANCAR DESDE: la única forma de no empezar en blanco que no es
          capturar a mano. Ya no hay plantillas —solo valían curadas, y eso pide
          que alguien las mantenga, mientras que la obra parecida más reciente
          está más actualizada sin que nadie haga nada— así que el selector es
          una sola lista de obras. */}
      {sourcing && (
        <div style={panelBox}>
          <div style={panelRow}>
            <span style={{ ...micro, letterSpacing: '0.1em', minWidth: '130px' }}>
              ARRANCAR DESDE
            </span>
            <select
              value={pickedSource}
              aria-label="Presupuesto de origen"
              onChange={e => setPickedSource(e.target.value ? Number(e.target.value) : '')}
              style={{ ...cellInput, width: '220px' }}
            >
              {/* Una sola clase de origen, así que la lista va PLANA: un
                  `optgroup` con todo adentro sería un encabezado que no separa
                  de nada. */}
              <option value="">— Elegir obra</option>
              {sources.map(f => (
                <option key={f.id} value={f.id}>
                  {f.name} · {f.lineCount} renglones · {fmtMXN(f.total)}
                </option>
              ))}
            </select>
            <button
              disabled={pickedSource === ''}
              onClick={() => {
                if (pickedSource === '') return
                // Se confirma porque escribe en el presupuesto: los renglones se
                // SUMAN a los que ya hay. Copiar dos veces ya no los duplica —el
                // servidor salta los que ya existen por capítulo y nombre— pero
                // tampoco es una operación que se quiera disparar de un dedazo.
                const cual = sources.find(t => t.id === pickedSource)
                if (!window.confirm(
                  `¿Copiar los ${cual?.lineCount ?? ''} renglones de «${cual?.name ?? ''}» a esta obra? `
                  + 'Se suman a lo que ya hay; los que ya existan aquí se saltan sin tocarlos.',
                )) return
                void run(() => applyBudgetSource(propertyId, pickedSource))
                setPickedSource('')
              }}
              style={{ ...ghost, cursor: pickedSource === '' ? 'not-allowed' : 'pointer' }}
            >
              COPIAR RENGLONES
            </button>
            {/* Una obra sin nada detallado no aparece en la lista, y eso no es
                un defecto: no tiene nada que dar. Se dice, porque el vacío de un
                selector se lee como «se rompió». */}
            <span style={micro}>
              {sources.length > 0
                ? 'Se suman a lo que ya hay; el residuo baja y el total no se mueve.'
                : 'Todavía no hay de dónde copiar. Detalla partidas en otra obra y aparecerá aquí.'}
            </span>
          </div>
        </div>
      )}

      {/* EMPUJAR: de esta obra hacia otras. Mismo endpoint que «arrancar desde»
          —el `property_id` de la URL es siempre el destino— llamado una vez por
          obra elegida. */}
      {pushing && (
        <div style={panelBox}>
          <div style={panelRow}>
            <span style={{ ...micro, letterSpacing: '0.1em', minWidth: '130px' }}>
              A QUÉ OBRAS
            </span>
            {targets.length === 0 ? (
              <span style={micro}>
                No hay otras obras a las que copiar todavía.
              </span>
            ) : targets.map(p => (
              <label key={p.id} style={checkLabel}>
                <input
                  type="checkbox"
                  checked={pickedTargets.includes(p.id)}
                  aria-label={`Copiar a ${p.name}`}
                  onChange={() => setPickedTargets(prev => (
                    prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id]
                  ))}
                  style={{ accentColor: colors.primary, cursor: 'pointer' }}
                />
                <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>
                  {p.name}
                </span>
              </label>
            ))}
          </div>

          {/* Los capítulos salen del presupuesto que ya está en pantalla: el
              servidor los manda con `get_budget`, en su orden de lectura. Todos
              marcados, porque copiar el presupuesto entero es lo normal y
              elegir capítulos es la excepción. */}
          <div style={panelRow}>
            <span style={{ ...micro, letterSpacing: '0.1em', minWidth: '130px' }}>
              QUÉ SE COPIA
            </span>
            {copyableChapters.length === 0 ? (
              <span style={micro}>
                Todavía no hay partidas detalladas que copiar: el residuo no viaja.
              </span>
            ) : copyableChapters.map(c => (
              <label key={c} style={checkLabel}>
                <input
                  type="checkbox"
                  checked={chapterPicked(c)}
                  aria-label={`Copiar capítulo ${c}`}
                  onChange={() => toggleChapter(c)}
                  style={{ accentColor: colors.primary, cursor: 'pointer' }}
                />
                <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>
                  {c}
                </span>
              </label>
            ))}
          </div>

          <div style={panelRow}>
            <span style={{ ...micro, letterSpacing: '0.1em', minWidth: '130px' }} />
            <button
              disabled={copying || pickedTargets.length === 0
                || (chaptersToPush !== null && chaptersToPush.length === 0)}
              onClick={() => void pushToTargets()}
              style={{
                ...ghost,
                cursor: pickedTargets.length > 0 && !copying ? 'pointer' : 'not-allowed',
              }}
            >
              {copying ? 'COPIANDO…' : 'COPIAR A ESTAS OBRAS'}
            </button>
            {/* Lo que hay que saber ANTES de apretar: que no pisa nada. Un
                renglón que ya existe allá puede traer proveedor, comprometido o
                pagos, y sobrescribirlo reescribiría dinero ya capturado. */}
            <span style={micro}>
              Se agregan a lo que cada obra ya tenga; los renglones que ya existan allá
              se saltan sin tocarse. El residuo de cada una se reajusta solo.
            </span>
          </div>

          {/* El resultado, OBRA POR OBRA. Un «listo» que escondiera que a una de
              las tres no llegó nada sería peor que un error. */}
          {pushResults && pushResults.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {pushResults.map(r => (
                <div
                  key={r.propertyId}
                  style={{
                    fontFamily: fonts.sans, fontSize: '11px',
                    color: r.error ? '#c0392b' : colors.tertiary,
                  }}
                >
                  {r.error
                    ? `${r.name}: no se copió — ${r.error}`
                    : `${r.name}: ${r.added} renglones agregados · ${r.skipped} saltados por ya existir`}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ color: '#c0392b', fontFamily: fonts.sans, fontSize: '11px', marginBottom: '8px' }}>
          {error}
        </div>
      )}
      {notice && (
        <div style={{ color: colors.tertiary, fontFamily: fonts.sans, fontSize: '11px', marginBottom: '8px' }}>
          {notice}
        </div>
      )}

      {/* El scroll horizontal es de la TABLA, no de la página: en un teléfono se
          arrastra la tabla a un lado y el resto de la ficha se queda quieto. */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: '620px', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              <th style={th}>PARTIDA</th>
              <th style={{ ...th, textAlign: 'right' }}>CANT.</th>
              <th style={th}>UNIDAD</th>
              <th style={{ ...th, textAlign: 'right' }}>P. UNIT.</th>
              <th style={{ ...th, textAlign: 'right' }}>MONTOS</th>
              {/* Dos celdas apiladas y un solo encabezado: el oficio y el
                  proveedor son la misma pregunta en dos momentos —qué tipo de
                  persona y luego quién— y separarlos en dos columnas partiría
                  en dos lo que se lee de corrido. */}
              <th style={th}>OFICIO Y PROVEEDOR</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const indent = (depths.get(row.id) ?? 0) * 14

              // ── Capítulo: suma solo, nunca captura ──
              if (row.kind === 'chapter') {
                const r = rollupOf(row.lines)
                const { locked } = row
                return (
                  <tr key={`c${row.id}`} style={{
                    background: colors.surfaceAlt,
                    borderLeft: `2px solid ${colors.primary}`,
                    borderBottom: `1px solid ${colors.border}`,
                  }}>
                    <td style={{ ...td, paddingLeft: `${6 + indent}px` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <button
                          onClick={() => toggleCollapse(row.name)}
                          aria-label={`${isCollapsed(row.name) ? 'Abrir' : 'Cerrar'} ${row.name}`}
                          style={{ ...kill, color: colors.secondary }}
                        >
                          {isCollapsed(row.name) ? '▶' : '▼'}
                        </button>
                        {locked ? (
                          <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>
                            {row.name}
                          </span>
                        ) : (
                          <input
                            key={row.name}
                            defaultValue={row.name}
                            aria-label={`Capítulo ${row.name}`}
                            onFocus={e => e.target.select()}
                            onBlur={e => renameChapter(row.name, e.target.value)}
                            style={{ ...cellInput, background: 'transparent', border: 'none', padding: '3px 0' }}
                          />
                        )}
                        <span style={{ ...micro, flexShrink: 0 }}>({row.lines.length})</span>
                      </div>
                    </td>
                    <td style={td} colSpan={3} />
                    <td style={{ ...td, textAlign: 'right' }}>
                      <div style={{ ...money, fontFamily: fonts.label }}>{fmtMXN(r.budgeted)}</div>
                      {executionLine(r)}
                    </td>
                    <td style={td} />
                    <td style={{ ...td, textAlign: 'right' }}>
                      {!locked && (
                        <button
                          onClick={() => {
                            if (!window.confirm(`¿Quitar el capítulo «${row.name}» con sus ${row.lines.length} partidas? Lo detallado vuelve a «Otros, por detallar» y el total no se mueve.`)) return
                            void run(() => deleteBudgetChapter(propertyId, row.name))
                          }}
                          aria-label={`Quitar capítulo ${row.name}`}
                          style={kill}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                )
              }

              // ── «+ PARTIDA», al final de los renglones de su capítulo ──
              if (row.kind === 'add') {
                if (isCollapsed(row.chapterName)) return null
                return (
                  <tr key={`a${row.id}`} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td colSpan={7} style={{ padding: '3px 6px 6px', paddingLeft: `${6 + indent}px` }}>
                      <button
                        onClick={() => void run(() => createBudgetLine(propertyId, {
                          chapterName: row.chapterName, name: 'Partida nueva',
                        }))}
                        style={ghost}
                      >
                        + PARTIDA EN {row.chapterName.toUpperCase()}
                      </button>
                    </td>
                  </tr>
                )
              }

              const line = row.line
              if (isCollapsed(line.chapterName)) return null

              // ── El residuo: se calcula solo, no se teclea ──
              // Baja al detallar y sube al quitar detalle. Editarlo a mano
              // convertiría una resta determinista en una segunda captura, y ahí
              // es donde nace el descuadre. Para mover el total está AJUSTAR, que
              // es otra operación precisamente porque significa otra cosa.
              if (line.isResidual) {
                return (
                  <tr key={line.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={{ ...td, paddingLeft: `${6 + indent}px` }}>
                      <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>
                        {line.name}
                      </span>
                    </td>
                    <td style={{ ...td, ...money, color: colors.secondary }}>{line.quantity}</td>
                    <td style={{ ...td, ...micro }}>{line.unit}</td>
                    <td style={{ ...td, ...money, color: colors.secondary }}>{fmtMXN(line.unitPrice)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <div style={{ ...money, color: colors.secondary }}>{fmtMXN(line.budgetedAmount)}</div>
                      <div style={{ ...micro, marginTop: '2px' }}>SE REPARTE AL DETALLAR</div>
                    </td>
                    <td style={td} colSpan={2} />
                  </tr>
                )
              }

              const { sugeridos, resto } = supplierOptions(line.supplierCategoryId, line.supplierId)
              const oficio = categoryName(line.supplierCategoryId)
              return [
                <tr key={line.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={{ ...td, paddingLeft: `${6 + indent}px` }}>
                    <input
                      value={line.name}
                      aria-label={`Partida ${line.name}`}
                      onChange={e => edit(line, { name: e.target.value })}
                      onFocus={e => e.target.select()}
                      onBlur={() => commitText(line.id, 'name')}
                      style={cellInput}
                    />
                  </td>
                  <td style={td}>
                    <NumericInput
                      value={line.quantity}
                      step={0.001}
                      ariaLabel={`Cantidad de ${line.name}`}
                      onChange={n => edit(line, { quantity: n ?? 0 })}
                      onBlur={() => commit(line.id)}
                      style={numInput}
                    />
                  </td>
                  <td style={td}>
                    <input
                      value={line.unit}
                      aria-label={`Unidad de ${line.name}`}
                      onChange={e => edit(line, { unit: e.target.value })}
                      onFocus={e => e.target.select()}
                      onBlur={() => commitText(line.id, 'unit')}
                      style={cellInput}
                    />
                  </td>
                  <td style={td}>
                    <NumericInput
                      value={line.unitPrice}
                      ariaLabel={`Precio unitario de ${line.name}`}
                      onChange={n => edit(line, { unitPrice: n ?? 0 })}
                      onBlur={() => commit(line.id)}
                      style={numInput}
                    />
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <div style={money}>{fmtMXN(line.budgetedAmount)}</div>
                    <div style={{ ...micro, marginTop: '2px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                      COMP
                      <NumericInput
                        value={line.committedAmount ?? undefined}
                        placeholder="—"
                        ariaLabel={`Comprometido de ${line.name}`}
                        onChange={n => edit(line, { committedAmount: n ?? null })}
                        onBlur={() => commit(line.id)}
                        style={{ ...numInput, width: '72px', fontSize: '9px', padding: '1px 3px' }}
                      />
                      · PAG {fmtMXN(line.paidAmount)}
                      <button
                        onClick={() => setOpenPayments(prev => (prev === line.id ? null : line.id))}
                        aria-label={`Pagos de ${line.name}`}
                        style={{ ...ghost, padding: '0 5px', fontSize: '10px', lineHeight: '14px' }}
                      >
                        {openPayments === line.id ? '−' : '+'}
                      </button>
                    </div>
                    {/* La brecha no se esconde y no se bloquea: el presupuesto
                        era un plan, el pago es un hecho, y lo útil es justo la
                        diferencia. Corregir el presupuestado para que empate
                        sería borrar la única información que esto produce. */}
                    {line.paidVariance != null && (
                      <div style={{ ...micro, color: line.paidVariance > 0 ? '#c0392b' : colors.primary }}>
                        VAR {fmtMXN(line.paidVariance)}
                      </div>
                    )}
                  </td>
                  <td style={td}>
                    {/* EL OFICIO ARRIBA, Y NO ES UN ADORNO DEL PROVEEDOR: se
                        sabe semanas antes. Al presupuestar ya se sabe que la
                        partida es de plomería; a quién se le da se decide
                        después, y un renglón con oficio y sin proveedor es el
                        estado normal de toda la obra mientras se presupuesta.

                        Elegirlo no cambia el proveedor ya puesto: filtrar no es
                        restringir, y borrar una asignación por reordenar una
                        lista sería la peor forma de enterarse. */}
                    <select
                      value={line.supplierCategoryId ?? ''}
                      aria-label={`Oficio de ${line.name}`}
                      onChange={e => editNow(line, {
                        supplierCategoryId: e.target.value ? Number(e.target.value) : null,
                      })}
                      style={{
                        ...cellInput, display: 'block',
                        fontSize: '10px', color: colors.secondary,
                      }}
                    >
                      {/* Con cero oficios dados de alta el selector sería un
                          control muerto sin decirlo — que es exactamente lo que
                          hacía el filtro por texto. Lo dice. */}
                      <option value="">
                        {categories.length > 0 ? '— Sin oficio' : '— No hay oficios dados de alta'}
                      </option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <select
                      value={line.supplierId ?? ''}
                      aria-label={`Proveedor de ${line.name}`}
                      onChange={e => editNow(line, { supplierId: e.target.value ? Number(e.target.value) : null })}
                      style={{ ...cellInput, display: 'block', marginTop: '2px' }}
                    >
                      <option value="">— Sin proveedor</option>
                      {sugeridos.length > 0 && (
                        <optgroup label={`Hacen ${(oficio ?? '').toLowerCase()}`}>
                          {sugeridos.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </optgroup>
                      )}
                      {resto.length > 0 && (
                        <optgroup label={sugeridos.length > 0 ? 'Los demás' : 'Proveedores'}>
                          {resto.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </optgroup>
                      )}
                    </select>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button
                      onClick={() => void run(() => deleteBudgetLine(propertyId, line.id))}
                      aria-label={`Quitar ${line.name}`}
                      style={kill}
                    >
                      ✕
                    </button>
                  </td>
                </tr>,

                openPayments === line.id && (
                  <tr key={`p${line.id}`} style={{ borderBottom: `1px solid ${colors.border}`, background: colors.surface }}>
                    <td colSpan={7} style={{ padding: '6px 10px 8px', paddingLeft: `${20 + indent}px` }}>
                      <div style={{ ...micro, letterSpacing: '0.1em', marginBottom: '4px' }}>
                        PAGOS DE {line.name.toUpperCase()}
                      </div>
                      {/* Un pago no se corrige: se borra y se vuelve a capturar.
                          La tabla es append-only porque corregir en su lugar
                          borraría que alguna vez se dijo otra cosa. */}
                      {line.payments.map(pay => (
                        <div key={pay.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' }}>
                          <span style={{ ...money, minWidth: '90px' }}>{fmtMXN(pay.amount)}</span>
                          <span style={micro}>{pay.paidOn}</span>
                          {pay.notes && <span style={micro}>{pay.notes}</span>}
                          <button
                            onClick={() => void run(() => deleteBudgetPayment(propertyId, line.id, pay.id))}
                            aria-label={`Borrar pago de ${fmtMXN(pay.amount)}`}
                            style={kill}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                        <NumericInput
                          value={payAmount}
                          placeholder="Monto"
                          ariaLabel="Monto del pago"
                          onChange={setPayAmount}
                          style={{ ...numInput, width: '100px' }}
                        />
                        <input
                          type="date"
                          value={payDate}
                          aria-label="Fecha del pago"
                          onChange={e => setPayDate(e.target.value)}
                          style={{ ...cellInput, width: '130px' }}
                        />
                        <button
                          disabled={!payAmount || !payDate}
                          onClick={() => {
                            if (!payAmount || !payDate) return
                            void run(() => addBudgetPayment(propertyId, line.id, { amount: payAmount, paidOn: payDate }))
                            setPayAmount(undefined)
                          }}
                          style={{
                            ...ghost,
                            borderColor: payAmount ? colors.primary : colors.border,
                            color: payAmount ? colors.primary : colors.secondary,
                            cursor: payAmount ? 'pointer' : 'not-allowed',
                          }}
                        >
                          AGREGAR PAGO
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              ]
            })}

            {/* El TOTAL se lee de la propiedad: es la MISMA cifra que la ficha
                enseña como obra del desglose y que alimenta la inversión. */}
            <tr style={{ borderTop: `2px solid ${colors.border}`, background: colors.surface }}>
              <td colSpan={4} style={{ ...td, paddingTop: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ ...micro, letterSpacing: '0.1em' }}>TOTAL · ES EL COSTO DE OBRA</span>
                  <button
                    onClick={() => { setAdjusting(v => !v); setNewTotal(property.constructionBudgeted ?? 0) }}
                    style={ghost}
                  >
                    {adjusting ? 'CANCELAR' : 'AJUSTAR'}
                  </button>
                </div>
                {/* Aumentar el presupuesto y detallarlo son dos operaciones, y
                    ésta es la que sí mueve el total. Separarlas es lo que
                    permite contestar si el alcance creció o solo se abrió. */}
                {adjusting && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                    <NumericInput
                      value={newTotal}
                      ariaLabel="Nuevo total de obra"
                      onChange={setNewTotal}
                      style={{ ...numInput, width: '130px' }}
                    />
                    <button
                      onClick={() => {
                        if (newTotal == null) return
                        void run(() => setBudgetTotal(propertyId, newTotal))
                        setAdjusting(false)
                      }}
                      style={{ ...ghost, borderColor: colors.primary, color: colors.primary }}
                    >
                      FIJAR TOTAL
                    </button>
                    <span style={micro}>Mueve «Otros», no las partidas detalladas.</span>
                  </div>
                )}
              </td>
              <td style={{ ...td, textAlign: 'right', paddingTop: '8px' }}>
                <div style={{ ...money, fontFamily: fonts.label, fontSize: '12px' }}>
                  {fmtMXN(property.constructionBudgeted)}
                </div>
                {executionLine(totalRollup)}
              </td>
              <td style={td} colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
