import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import {
  fetchBudget, createBudgetLine, updateBudgetLine, deleteBudgetLine,
  renameBudgetChapter, deleteBudgetChapter, addBudgetPayment, deleteBudgetPayment, getProveedores,
  getCategories, fetchBudgetSources, applyBudgetSource,
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
    | 'constructionPaidVariance'
    /**
     * LOS DOS `$/m²`, que son dos cosas y por eso tienen dos nombres.
     * `constructionCostPerSqm` es el supuesto que alguien TECLEÓ en la ficha;
     * `budgetedCostPerSqm` es presupuesto ÷ metraje, derivado de esta misma
     * tabla. El pie los enseña rotulados, uno junto al otro, porque la distancia
     * entre ellos es información —dice cuánto se aleja el supuesto de lo que ya
     * está capturado— y no un descuadre que haya que corregir.
     */
    | 'constructionCostPerSqm' | 'budgetedCostPerSqm'>
  /**
   * Toda escritura devuelve la propiedad recalculada: la suma presupuestada ES
   * el costo de obra, así que mover un renglón mueve la inversión total, la
   * ganancia proyectada, el ROI y el cap rate. La ficha entera se refresca con
   * esto, de una sola vez y sin plomería nueva.
   */
  onPropertyChange: (property: Property) => void
  /** Ámbito del panel: sin él, el presupuesto de la PROPIEDAD (el que alimenta
   * finanzas); con él, el presupuesto-ESCENARIO de ese plan de proyecto
   * (addendum 2026-08-24). El montador (PresupuestosPanel) remonta por key al
   * cambiar de ámbito, así que aquí es constante de por vida del componente. */
  planId?: string
}

/** Una fila de la tabla. Un capítulo NO es una entidad: es agrupar por nombre. */
type Row =
  | { kind: 'chapter'; id: number; parentId: null; name: string; lines: BudgetLine[] }
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
 * Un `$/m²` como se lee: «$8,000/m²». El guion va a secas —«—/m²» sería ponerle
 * unidad a un dato que no existe— y el CERO SÍ se imprime: un presupuesto vacío
 * vale $0/m², que es un número y no un faltante. Es la misma regla de `fmt.ts`:
 * vacío es «—», cero es cero.
 */
function perSqm(n: number | null | undefined): string {
  return n != null ? `${fmtMXN(n)}/m²` : '—'
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

/**
 * Las dos formas de copiar un presupuesto. `directo` copia los montos tal cual;
 * `proporcional` copia la FORMA, dimensionada al costo que se espera del destino.
 *
 * Se llama PROPORCIONAL en el tipo, en la columna y en el popup. Un solo
 * vocabulario para el mismo concepto: «escala» sería un segundo nombre para
 * esto mismo, y a la semana nadie sabría si son dos cosas.
 */
type CopyMode = 'directo' | 'proporcional'

/** El presupuesto de origen partido en lo que escala y lo que no. */
interface Scope {
  /** F — las partidas fijas: entran con su monto original. */
  fixed: number
  /** S — el resto del origen: lo que el factor multiplica. */
  scaling: number
}

/**
 * Es la MISMA cuenta que hace `_proportional_factor` en el servidor, y por eso
 * el denominador es «el total del origen menos las fijas» y no «la suma de lo
 * proporcional»: las fijas se apartan de las dos puntas de la razón —ni
 * consumen factor ni lo reciben—.
 *
 * **LAS DOS SUMAS SALEN DEL MISMO CONJUNTO DE FILAS**, que es lo que esta copia
 * se lleva. El filtro de capítulos iba puesto sobre las fijas y no sobre el
 * total, así que un escalable que NO viajaba entraba igual al denominador y el
 * factor prometía algo sobre filas que nunca se copiaron. Hoy no se nota —la
 * proporcional exige el presupuesto entero, así que `chapters` llega en `null`—
 * pero la garantía enunciada y la aritmética tienen que ser la misma frase, no
 * dos que hoy dan igual.
 *
 * Cuenta TODOS los renglones, sin excepción: una holgura («por detallar») es un
 * renglón como cualquier otro, así que escala como cualquier otro y el destino
 * hereda también lo que al origen le falta por detallar.
 *
 * **La pregunta por lo fijo es `=== false`, no `!`.** El campo nace en TRUE en la
 * base, así que su ausencia significa «sí escala»: preguntado por falsedad, un
 * renglón que llegue sin el campo —datos de antes de que el servidor lo
 * publicara, una respuesta parcial— contaría como FIJO, que es justo lo
 * contrario de su default. Eso convertía un presupuesto entero en fijas y
 * bloqueaba el copiado con «las fijas suman lo mismo que el objetivo» sin que
 * un solo renglón estuviera marcado.
 */
function scopeOf(lines: BudgetLine[], chapters: string[] | null): Scope {
  let total = 0
  let fixed = 0
  for (const l of lines) {
    if (chapters !== null && !chapters.includes(l.chapterName)) continue
    total += l.budgetedAmount
    if (l.isProportional === false) fixed += l.budgetedAmount
  }
  return { fixed, scaling: total - fixed }
}

/**
 * Lo que va a pasar si se copia proporcional a UNA obra, o por qué no se puede.
 *
 * Es la misma cuenta que hace el servidor, y se hace aquí SOLO para enseñarla
 * antes de apretar: el factor que se aplica de verdad lo calcula él. Lo que la
 * pantalla no puede hacer es prometer un total y que entre otro, y por eso el
 * preview aparta las fijas en vez de enseñar `T` a secas.
 */
interface Plan {
  /** T — el costo de obra del destino, LEÍDO de su presupuesto. */
  target: number | null
  fixed: number
  scaling: number
  /** (T − F) / S. Null cuando falta el objetivo o no hay nada que escalar. */
  factor: number | null
  /** Por qué NO se puede copiar proporcional a esta obra. Null cuando sí se puede. */
  blocker: string | null
}

/**
 * El plan de una obra destino, a partir de su costo de obra ya capturado.
 *
 * **El objetivo no se teclea: se lee.** Cada propiedad ya tiene el suyo —la
 * suma de los renglones de su presupuesto— y preguntarlo otra vez aquí abriría
 * la puerta a copiar dimensionado a un número que no es el que esa obra dice
 * costar.
 *
 * Por eso queda UN solo insumo que puede faltar, y el bloqueo manda a donde sí
 * se captura: su ficha. La guarda de las fijas se queda porque es una imposi-
 * bilidad aritmética real —el servidor la rechaza con 422— y trae los dos montos,
 * porque «no caben» sin las cifras no dice cuánto le falta al objetivo.
 *
 * `replaceable` lo contesta el servidor por cada destino: la proporcional
 * REEMPLAZA, y sólo reemplaza donde no hay más que el estimado inicial. Se
 * pregunta aquí y no después porque un destino ocupado se rechaza SIEMPRE, y
 * enseñar «entra a $2,400,000» para luego devolver un 422 es prometer un número
 * que nunca iba a pasar. El predicado no se rehace de este lado —vive en
 * `_UNTOUCHED_BUDGET`, sobre columnas que el renglón ni siquiera publica— así
 * que se transporta, no se adivina.
 */
function planFor(target: number | null | undefined, scope: Scope, replaceable: boolean): Plan {
  const base = { target: null, fixed: scope.fixed, scaling: scope.scaling, factor: null }
  if (target == null || target <= 0) {
    return {
      ...base,
      blocker: 'esa obra todavía no tiene costo de obra: se captura renglón por renglón en su presupuesto',
    }
  }
  if (!replaceable) {
    return {
      ...base, target,
      blocker: 'esa obra ya tiene renglones capturados, y la proporcional dimensiona lo copiado a ese mismo costo: entraría encima y el total quedaría al doble. Cópiale DIRECTO, o borra allá esos renglones',
    }
  }
  if (target <= scope.fixed) {
    return {
      ...base, target,
      blocker: `las partidas fijas suman ${fmtMXN(scope.fixed)} y el costo de obra del destino es ${fmtMXN(target)}`,
    }
  }
  return {
    target, fixed: scope.fixed, scaling: scope.scaling,
    factor: scope.scaling > 0 ? (target - scope.fixed) / scope.scaling : null,
    blocker: null,
  }
}

/** Un nombre de capítulo que no choque con los que ya existen. */
function freshChapterName(taken: string[]): string {
  const base = 'Capítulo nuevo'
  if (!taken.includes(base)) return base
  for (let i = 2; ; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`
}

export function BudgetPanel({ property, onPropertyChange, planId }: Props) {
  // Cierre local con el ámbito puesto: los dos sitios de crear renglón pasan
  // objetos largos y este alias evita colar el planId al final de cada uno.
  const createLine = (data: Parameters<typeof createBudgetLine>[1]) =>
    createBudgetLine(propertyId, data, planId)
  const propertyId = property.id

  const [lines, setLines] = useState<BudgetLine[]>([])
  const [chapters, setChapters] = useState<string[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  /**
   * Los oficios con los que se contrata. Se cargan con el presupuesto porque el
   * oficio se captura EN EL RENGLÓN, en la visita normal: es lo que se sabe
   * mientras se presupuesta, mucho antes que quién lo va a hacer.
   */
  const [categories, setCategories] = useState<ProveedorCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Lo que hay que decir de una escritura cuyo efecto no se ve entero en
   * pantalla — hoy solo copiar, que mete renglones en capítulos cerrados. */
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
   * Si este presupuesto —el DESTINO cuando se jala de otra obra— admitiría una
   * copia proporcional. Arranca en `true`: mientras no se haya leído nada no hay
   * por qué bloquear, y la primera lectura llega antes que el panel de copiar.
   */
  const [budgetReplaceable, setBudgetReplaceable] = useState(true)
  const [sourceMode, setSourceMode] = useState<CopyMode>('directo')
  /**
   * El presupuesto del ORIGEN, entero, solo para el preview: sin sus renglones
   * no se sabe cuánto de él NO escala, y un preview que enseñara el objetivo sin
   * apartar las fijas mentiría sobre lo que va a pasar.
   *
   * NO pasa por `receive`: es de otra obra. Se pide al elegir origen y solo en
   * proporcional — en directo no hay nada que previsualizar.
   */
  const [sourceBudget, setSourceBudget] = useState<Budget | null>(null)

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
  const [targets, setTargets] = useState<BudgetSource[]>([])
  const [pickedTargets, setPickedTargets] = useState<number[]>([])
  /**
   * Qué capítulos viajan. `null` = nadie ha tocado una casilla, y entonces van
   * TODOS —el presupuesto entero, que es lo que se quiere copiar casi siempre—.
   * Es la misma convención que `collapsed`, y evita un efecto que llene la
   * selección cuando llegan los datos.
   */
  const [pickedChapters, setPickedChapters] = useState<Set<string> | null>(null)
  const [pushModePicked, setPushModePicked] = useState<CopyMode>('directo')
  /** Copiando ahora mismo: hay N llamadas en vuelo, una tras otra. */
  const [copying, setCopying] = useState(false)
  const [pushResults, setPushResults] = useState<PushResult[]>([])

  /**
   * Lo que se cambió y todavía no se manda, por renglón. Las celdas de texto y
   * de dinero guardan al SOLTARSE y no a cada tecla —teclear «1500» serían
   * cuatro escrituras, y cada una mueve el total— que es el mismo trato
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
    setBudgetReplaceable(next.replaceable)
  }

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchBudget(propertyId, planId), getProveedores(), getCategories()])
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
      const { budget, property: updated, linesAdded, linesSkipped } = await op()
      receive(budget)
      onPropertyChange(updated)
      // No hay nada que avisar sobre el TOTAL: es la suma de los renglones, así
      // que toda escritura lo mueve exactamente su propio importe y eso ya se ve
      // en el pie. El aviso que decía «el detalle rebasó el estimado» murió con
      // el residuo que lo hacía posible.
      //
      // `linesAdded` y `linesSkipped` solo llegan al copiar, y se dicen porque
      // copiar es la única escritura cuyo efecto no se ve entero en pantalla:
      // los renglones caen dentro de capítulos que están colapsados. Los
      // saltados se dicen aparte porque son lo que NO pasó: el destino ya los
      // tenía y no se sobrescriben nunca.
      setNotice(
        linesAdded != null
          ? ([
              linesAdded > 0 ? `Se copiaron ${linesAdded} renglones.` : null,
              linesSkipped ? `Se saltaron ${linesSkipped} que ya estaban aquí: no se sobrescribe nada.` : null,
            ].filter(Boolean).join(' ')
              || 'No había nada nuevo que copiar: esas partidas ya estaban.')
          : null,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
      fetchBudget(propertyId, planId).then(receive).catch(() => {})
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
    void run(() => updateBudgetLine(propertyId, lineId, patch, planId))
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
      out.push({ kind: 'chapter', id: chapterId, parentId: null, name, lines: chapterLines })
      chapterLines.forEach(line => out.push({ kind: 'line', id: line.id, parentId: chapterId, line }))
      out.push({ kind: 'add', id: -(2 * i + 2), parentId: chapterId, chapterName: name })
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
    // Presupuestos, no propiedades (addendum 2026-08-24): los escenarios de
    // ESTA obra también se ofrecen — solo se excluye el presupuesto actual.
    fetchBudgetSources(budgetId ?? undefined)
      .then(setSources)
      .catch(e => setError(e instanceof Error ? e.message : 'No se pudo leer de dónde copiar'))
  }

  /**
   * El presupuesto del origen, para poder apartar sus partidas fijas en el
   * preview. Solo en proporcional: en directo no hay ninguna cuenta que enseñar,
   * y traerlo sería una consulta por gusto.
   */
  useEffect(() => {
    const src = sources.find(s => s.id === pickedSource)
    if (sourceMode !== 'proporcional' || !src) { setSourceBudget(null); return }
    let vigente = true
    fetchBudget(src.propertyId)
      .then(b => { if (vigente) setSourceBudget(b) })
      .catch(() => { if (vigente) setSourceBudget(null) })
    return () => { vigente = false }
  }, [sourceMode, pickedSource, sources])

  function togglePush() {
    const opening = !pushing
    setPushing(opening)
    if (!opening) return
    setPushResults([])
    // ESTA obra se saca de la lista: copiarse sobre sí misma la rechaza el
    // servidor con un 422, y ofrecer una opción que solo puede dar error es
    // hacer que alguien descubra la regla chocando con ella. Es la misma razón
    // por la que `fetchBudgetSources` recibe a quién excluir.
    //
    // Las archivadas tampoco: `fetchProperties` las deja fuera salvo que se
    // pidan a propósito, y no se le presupuesta una obra a lo que ya se guardó.
    // Cada obra trae su propio costo de obra en su ficha —el total de su
    // presupuesto— y ése es su objetivo. No hay nada que pre-llenar ni que
    // teclear: lo que se lee es lo que se usa.
    fetchBudgetSources(budgetId ?? undefined, true)
      .then(setTargets)
      .catch(e => setError(e instanceof Error ? e.message : 'No se pudo leer a qué obras copiar'))
  }

  /**
   * Los capítulos que se pueden copiar: TODOS. Hubo uno que se quedaba —el del
   * residuo, que era lo que a ESTA obra le faltaba por detallar y allá habría
   * sido una partida ajena— y con él se fue la única excepción. Un capítulo de
   * holgura de hoy es un capítulo normal, y viaja como los demás.
   */
  const copyableChapters = chapters

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
   * Por qué la proporcional no está disponible ahora mismo, o null cuando sí.
   *
   * Es la MITAD del `_require_replaceable` del servidor que se contesta de este
   * lado: la proporcional dimensiona lo copiado al costo de obra del destino y
   * lo REEMPLAZA, así que un capítulo suelto —que por definición no suma el
   * presupuesto completo— no puede hacerlo. La otra mitad, si el destino está
   * ocupado, la contesta él en `replaceable`.
   */
  const pushProportionalBlocked = chaptersToPush === null
    ? null
    : 'un capítulo suelto no puede sumar el presupuesto completo del destino'

  /**
   * El modo con el que se copia DE VERDAD, que no siempre es el que dice el
   * radio: con capítulos elegidos, la proporcional deja de ser alcanzable y el
   * modo cae a directo. Derivado en vez de un `setPushMode` dentro de
   * `toggleChapter` porque así el estado ilegal no EXISTE: escrito como efecto
   * habría un render con el modo y los capítulos contradiciéndose, y sobre todo
   * habría dos sitios que mantener de acuerdo —el mismo desfase que ya se pagó
   * una vez entre el `disabled` del botón y su cursor—. Y porque la elección no
   * se pierde: al volver al presupuesto entero, el modo que ya se había pedido
   * regresa con él en lugar de haberse olvidado.
   */
  const pushMode: CopyMode = pushProportionalBlocked === null ? pushModePicked : 'directo'

  /**
   * Lo que de ESTE presupuesto escala y lo que no, ya acotado a los capítulos
   * elegidos. Es el origen de todos los planes de empuje: la forma es la misma
   * para las cinco obras destino, lo que cambia entre ellas es el objetivo.
   */
  const pushScope = scopeOf(lines, chaptersToPush)

  /**
   * El plan de UNA obra destino, contra SU costo de obra. En directo no hay nada
   * que planear: se copia tal cual y ninguna obra puede quedar bloqueada.
   */
  const planOf = (t: BudgetSource): Plan => planFor(t.total, pushScope, t.replaceable)
  /** «Casa Modesto» o «Casa Modesto · Plan A»: un escenario se nombra con su obra. */
  const budgetLabel = (s: BudgetSource) => (s.planName ? `${s.name} · ${s.planName}` : s.name)

  const chosenTargets = targets.filter(p => pickedTargets.includes(p.id))

  /**
   * Las obras a las que SÍ se les puede copiar ahora. En proporcional, una obra
   * sin costo de obra capturado queda fuera con su motivo a la vista —pero no
   * cancela a las demás: cada destino es una llamada independiente, y bloquear
   * las cinco porque a una le falta un dato sería castigar a las que sí están.
   */
  const readyTargets = pushMode === 'proporcional'
    ? chosenTargets.filter(p => planOf(p).blocker === null)
    : chosenTargets

  /**
   * Si el botón de copiar hace algo. Una sola definición porque la usan el
   * `disabled` y el cursor: escritas por separado se desfasaron —el botón
   * quedaba muerto pero con la manita— y esa mentira la ve el usuario.
   */
  const canPush = !copying
    && readyTargets.length > 0
    && (chaptersToPush === null || chaptersToPush.length > 0)

  /**
   * Lo que de aquel presupuesto escala y lo que no, y el objetivo de ESTA obra.
   *
   * Aquí el destino es ESTA obra, así que la reemplazabilidad que importa es la
   * SUYA, y viene en su propio payload: la lista de `/api/budget/sources` no
   * podía contestarla porque excluye a propósito al presupuesto que pregunta.
   * Con eso los dos sentidos bloquean antes de pedir, en vez de que uno de ellos
   * descubra el 422 después de haber prometido un total.
   *
   * El capítulo suelto no entra en la cuenta de este lado: al jalar se copia
   * siempre el presupuesto entero (`chapters` viaja en `null`), así que la mitad
   * de la regla que el cliente contesta ya está contestada que sí.
   */
  const sourceScope = scopeOf(sourceBudget?.lines ?? [], null)
  const sourcePlan = planFor(property.constructionBudgeted, sourceScope, budgetReplaceable)
  /** En directo se copia tal cual; en proporcional hace falta que el plan cierre. */
  const canPull = pickedSource !== ''
    && (sourceMode === 'directo' || sourcePlan.blocker === null)

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
    if (budgetId == null || readyTargets.length === 0) return
    const chosen = readyTargets
    const alcance = chaptersToPush === null
      ? 'todo el presupuesto'
      : `${chaptersToPush.length} capítulo${chaptersToPush.length === 1 ? '' : 's'}`
    if (!window.confirm(
      `¿Copiar ${alcance} a ${chosen.length} obra${chosen.length === 1 ? '' : 's'}? `
      + (pushMode === 'proporcional'
        ? 'Cada una entra dimensionada a su propio costo objetivo. '
        : '')
      + 'Los renglones que allá ya existan se saltan: no se sobrescribe nada.',
    )) return
    setError(null)
    setCopying(true)
    // Se van pintando conforme responden: con cinco destinos, esperar al último
    // para enseñar el primero deja la pantalla muda justo cuando más está
    // pasando.
    //
    // Las bloqueadas arrancan ya en la lista con su motivo: fueron elegidas y no
    // se les copió nada, y un resultado que las omitiera dejaría creer que sí.
    setPushResults(chosenTargets
      .filter(p => !chosen.includes(p))
      .map(p => ({
        propertyId: p.id, name: budgetLabel(p), added: 0, skipped: 0, error: planOf(p).blocker,
      })))
    for (const p of chosen) {
      const base = { propertyId: p.id, name: budgetLabel(p) }
      try {
        // Una sola llamada por obra, y NADA que escribir antes: el objetivo es
        // el costo de obra que el destino ya tiene, y el servidor lo lee de su
        // propio presupuesto.
        //
        // El modo solo viaja en proporcional: en directo la llamada es la misma
        // de siempre, y mandar un campo de más sería decirle al servidor algo
        // sobre un modo que no se pidió.
        const { linesAdded, linesSkipped } = await (pushMode === 'proporcional'
          ? applyBudgetSource(p.propertyId, budgetId, chaptersToPush, true, p.planId ?? undefined)
          : applyBudgetSource(p.propertyId, budgetId, chaptersToPush, false, p.planId ?? undefined))
        setPushResults(prev => [...prev, {
          ...base, error: null, added: linesAdded ?? 0, skipped: linesSkipped ?? 0,
        }])
      } catch (e) {
        // Que una obra falle no cancela las demás: las que ya entraron quedan
        // aplicadas y las que faltan se siguen intentando. Por eso el fallo se
        // guarda CON EL NOMBRE de su obra en vez de tumbar todo el copiado.
        setPushResults(prev => [...prev, {
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
    void run(() => renameBudgetChapter(propertyId, from, to, planId))
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
   * DIRECTO o PROPORCIONAL. Es la misma pregunta en los dos sentidos del
   * copiado, así que es una sola función: escritos aparte, los dos bloques se
   * contestarían distinto a la semana.
   *
   * `scope` desambigua los dos grupos de radios cuando los dos paneles están
   * abiertos —comparten pantalla, y sin `name` distinto serían un solo grupo.
   *
   * `blocked` es el motivo por el que la PROPORCIONAL no se puede ahora, o null.
   * Deshabilita el radio en vez de dejar que se marque y falle después: el
   * servidor la rechaza de plano en ese caso, y ofrecerla sería prometer un
   * total que nunca iba a entrar. El motivo va al lado, porque un control
   * apagado sin explicación es peor que uno que se rompe.
   */
  const modeChoice = (
    scope: string, value: CopyMode, onPick: (m: CopyMode) => void,
    blocked: string | null = null,
  ) => (
    <div style={panelRow}>
      <span style={{ ...micro, letterSpacing: '0.1em', minWidth: '130px' }}>CÓMO SE COPIA</span>
      {([
        ['directo', 'directa', 'Los mismos montos, tal cual.'],
        ['proporcional', 'proporcional', 'La misma forma, dimensionada al costo de la obra destino.'],
      ] as const).map(([m, adj, dice]) => {
        const off = m === 'proporcional' && blocked !== null
        return (
          <label key={m} style={{ ...checkLabel, opacity: off ? 0.5 : 1 }}>
            <input
              type="radio"
              name={`modo-${scope}`}
              checked={value === m}
              disabled={off}
              aria-label={`Copia ${adj} ${scope}`}
              onChange={() => onPick(m)}
              style={{ accentColor: colors.primary, cursor: off ? 'not-allowed' : 'pointer' }}
            />
            <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>
              {m.toUpperCase()}
            </span>
            {off && <span style={micro}>No se puede: {blocked}.</span>}
            {!off && value === m && <span style={micro}>{dice}</span>}
          </label>
        )
      })}
    </div>
  )

  /**
   * El costo objetivo de UNA obra destino, EN SOLO LECTURA.
   *
   * **Aquí no se captura nada.** T es el costo de obra que esa propiedad ya
   * tiene: la SUMA DE LOS RENGLONES de su presupuesto. Tecleado, era una segunda
   * respuesta a una pregunta que su presupuesto ya contesta, y la copia podía
   * dimensionarse a un número que esa obra nunca dijo costar.
   *
   * Aquí vivía la descomposición «275 m² × $3,500/m² = $962,500», y se fue con
   * la liga: el total ya no es ese producto —es lo que sumen los renglones— así
   * que la igualdad había dejado de ser cierta. Los dos `$/m²` que sí importan
   * están rotulados en el pie de la tabla, que es donde se comparan.
   *
   * Y el preview APARTA LAS FIJAS. Enseñar solo el objetivo dejaría creer que
   * todo el presupuesto se mueve con el factor, cuando los permisos y las
   * licencias entran con su monto de siempre.
   */
  const targetRow = (opts: {
    label: string
    plan: Plan
  }) => (
    // La etiqueta es el nombre de la obra destino cuando son varias, así que
    // sirve de llave: no hay dos destinos con el mismo renglón.
    <div key={opts.label} style={panelRow}>
      <span style={{ ...micro, letterSpacing: '0.1em', minWidth: '130px' }}>{opts.label}</span>
      <span style={{ ...money, fontFamily: fonts.label }}>{fmtMXN(opts.plan.target)}</span>
      {opts.plan.blocker ? (
        <span style={{ ...micro, color: '#c0392b' }}>
          No se puede copiar proporcional: {opts.plan.blocker}.
        </span>
      ) : (
        <span style={micro}>
          {opts.plan.fixed > 0 ? `NO ESCALAN ${fmtMXN(opts.plan.fixed)}` : 'TODO ESCALA'}
          {opts.plan.factor != null ? ` · EL RESTO ×${opts.plan.factor.toFixed(2)}` : ''}
        </span>
      )}
    </div>
  )

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
            onClick={() => void run(() => createLine({
              chapterName: freshChapterName(chapters), name: 'Partida nueva',
            }))}
            style={ghost}
          >
            + CAPÍTULO
          </button>
          <button onClick={toggleSourcing} style={ghost}>
            COPIAR DE OTRO PRESUPUESTO {sourcing ? '▾' : '▸'}
          </button>
          {/* La otra dirección, y por eso es otro botón: «arrancar desde» jala
              un presupuesto ajeno hacia éste, esto se lleva el de éste hacia
              otros. Meterlas en el mismo bloque haría que se pareciera un
              copiado que trae a uno que manda. Desde el addendum 2026-08-24 las
              dos listas son de PRESUPUESTOS —obras y escenarios de plan,
              incluidos los de ESTA obra— y solo se excluye el actual. */}
          <button onClick={togglePush} style={ghost}>
            COPIAR A OTROS PRESUPUESTOS {pushing ? '▾' : '▸'}
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
                  {budgetLabel(f)} · {f.lineCount} renglones · {fmtMXN(f.total)}
                </option>
              ))}
            </select>
            <button
              disabled={!canPull}
              onClick={() => {
                // `canPull` ya incluye que haya origen elegido, y eso lo sabe
                // también el compilador: de aquí para abajo `pickedSource` es un id.
                if (!canPull) return
                // Se confirma porque escribe en el presupuesto: los renglones se
                // SUMAN a los que ya hay. Copiar dos veces ya no los duplica —el
                // servidor salta los que ya existen por capítulo y nombre— pero
                // tampoco es una operación que se quiera disparar de un dedazo.
                const cual = sources.find(t => t.id === pickedSource)
                if (!window.confirm(
                  `¿Copiar los ${cual?.lineCount ?? ''} renglones de «${cual?.name ?? ''}» a esta obra? `
                  + (sourceMode === 'proporcional'
                    ? `Entran dimensionados a ${fmtMXN(sourcePlan.target)}. `
                    : '')
                  + 'Se suman a lo que ya hay; los que ya existan aquí se saltan sin tocarlos.',
                )) return
                // El modo solo viaja en proporcional: en directo la llamada es
                // la de siempre, y mandar el modo que no se pidió sería decirle
                // al servidor algo que nadie contestó. El objetivo no viaja
                // nunca: es el costo de obra de ESTA obra, que él ya tiene.
                void run(() => (sourceMode === 'proporcional'
                  ? applyBudgetSource(propertyId, pickedSource, null, true, planId)
                  : applyBudgetSource(propertyId, pickedSource, null, false, planId)))
                setPickedSource('')
              }}
              style={{ ...ghost, cursor: canPull ? 'pointer' : 'not-allowed' }}
            >
              COPIAR RENGLONES
            </button>
            {/* Una obra sin nada detallado no aparece en la lista, y eso no es
                un defecto: no tiene nada que dar. Se dice, porque el vacío de un
                selector se lee como «se rompió». */}
            <span style={micro}>
              {sources.length > 0
                ? 'Se suman a lo que ya hay, y el total sube en lo que sumen.'
                : 'Todavía no hay de dónde copiar. Detalla partidas en otra obra y aparecerá aquí.'}
            </span>
          </div>

          {/* Las dos formas de copiar. El desglose de la obra de al lado sirve;
              su tamaño no — y por eso hay una segunda opción en vez de una sola
              copia idéntica. */}
          {modeChoice('de otra obra', sourceMode, setSourceMode)}

          {sourceMode === 'proporcional' && targetRow({
            label: 'COSTO DE OBRA',
            plan: sourcePlan,
          })}

          {/* Mientras no se elija origen no se sabe cuánto de él no escala, y
              enseñar el objetivo a secas haría creer que TODO se mueve. */}
          {sourceMode === 'proporcional' && pickedSource === '' && (
            <span style={micro}>
              Elige la obra de origen para ver cuánto de su presupuesto no escala.
            </span>
          )}
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
                  aria-label={`Copiar a ${budgetLabel(p)}`}
                  onChange={() => setPickedTargets(prev => (
                    prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id]
                  ))}
                  style={{ accentColor: colors.primary, cursor: 'pointer' }}
                />
                <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>
                  {budgetLabel(p)}
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
                Todavía no hay partidas que copiar: este presupuesto está vacío.
              </span>
            ) : (
              <>
                {copyableChapters.map(c => (
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
                {/* LOS DOS ESTADOS NO SON EL MISMO PEDIDO, y por eso se rotulan
                    distinto: «todo el presupuesto» viaja como `chapters: null`
                    —de ahí sale `entero`, y con él la proporcional— y una
                    selección viaja como lista, aunque tenga dentro todos los
                    capítulos.

                    El regreso es este BOTÓN y no una inferencia. Colapsar «están
                    todas marcadas» a `null` parece lo mismo y no lo es: `entero`
                    gobierna un `DELETE FROM budget_lines` en el destino, así que
                    la copia DIRECTA pasaría de sumarse a lo que hay a borrarle
                    primero su estimado. Un borrado disparado por marcar casillas
                    de vuelta no lo ve venir nadie. El botón, en cambio, devuelve
                    el estado con el que el panel ABRE: no inventa un significado
                    nuevo para un gesto que ya tenía otro. */}
                {chaptersToPush === null ? (
                  <span style={{ ...micro, letterSpacing: '0.1em' }}>· TODO EL PRESUPUESTO</span>
                ) : (
                  <>
                    <span style={{ ...micro, letterSpacing: '0.1em' }}>
                      · {chaptersToPush.length} DE {copyableChapters.length} CAPÍTULOS
                    </span>
                    <button
                      type="button"
                      onClick={() => setPickedChapters(null)}
                      style={ghost}
                    >
                      VOLVER A TODO EL PRESUPUESTO
                    </button>
                  </>
                )}
              </>
            )}
          </div>

          {/* Con capítulos elegidos la proporcional queda apagada CON SU MOTIVO:
              el servidor la rechaza de plano, así que ofrecerla aquí sería
              prometer un dimensionado que iba a volver como 422. */}
          {modeChoice('a otras obras', pushMode, setPushModePicked, pushProportionalBlocked)}

          {/* CADA DESTINO CON SU PROPIO COSTO DE OBRA, leído de su ficha. Dos
              obras del mismo tamaño pueden construirse a niveles de costo
              distintos, y por eso el objetivo es de cada una — pero ninguna lo
              contesta aquí: ya lo dice su presupuesto.

              Solo las elegidas: enseñar el objetivo de obras a las que no se va
              a copiar sería ruido. */}
          {pushMode === 'proporcional' && (
            chosenTargets.length === 0 ? (
              <span style={micro}>
                Elige a qué obras copiar para ver el costo de obra al que entra cada una.
              </span>
            ) : chosenTargets.map(p => targetRow({
              label: budgetLabel(p),
              plan: planOf(p),
            }))
          )}

          <div style={panelRow}>
            <span style={{ ...micro, letterSpacing: '0.1em', minWidth: '130px' }} />
            <button
              disabled={!canPush}
              onClick={() => void pushToTargets()}
              style={{ ...ghost, cursor: canPush ? 'pointer' : 'not-allowed' }}
            >
              {copying ? 'COPIANDO…' : 'COPIAR A ESTAS OBRAS'}
            </button>
            {/* Lo que hay que saber ANTES de apretar: que no pisa nada. Un
                renglón que ya existe allá puede traer proveedor, comprometido o
                pagos, y sobrescribirlo reescribiría dinero ya capturado. */}
            <span style={micro}>
              Se agregan a lo que cada obra ya tenga; los renglones que ya existan allá
              se saltan sin tocarse. El total de cada una sube en lo que le entre.
            </span>
            {/* Una obra bloqueada no cancela a las demás: se queda fuera con su
                motivo —arriba, renglón por renglón— y las otras se copian igual. */}
            {pushMode === 'proporcional' && readyTargets.length < chosenTargets.length && (
              <span style={{ ...micro, color: '#c0392b' }}>
                {chosenTargets.length - readyTargets.length} de las elegidas se quedan fuera
                por su motivo, arriba; a las demás sí se les copia.
              </span>
            )}
          </div>

          {/* El resultado, OBRA POR OBRA. Un «listo» que escondiera que a una de
              las tres no llegó nada sería peor que un error. */}
          {pushResults.length > 0 && (
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
        <table style={{ width: '100%', minWidth: '700px', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              <th style={th}>PARTIDA</th>
              <th style={{ ...th, textAlign: 'right' }}>CANT.</th>
              <th style={th}>UNIDAD</th>
              <th style={{ ...th, textAlign: 'right' }}>P. UNIT.</th>
              <th style={{ ...th, textAlign: 'right' }}>MONTOS</th>
              {/* VISIBLE SIEMPRE, no escondida en el popup de copiar: si solo
                  apareciera al copiar, nadie la capturaría hasta que ya lleva
                  prisa, y ahí se marca todo de corrido. Aquí se contesta el día
                  que se teclea la partida, que es cuando se sabe. */}
              <th
                style={{ ...th, textAlign: 'center' }}
                title="Si la partida crece con el tamaño de la obra. Los permisos y las licencias no."
              >
                PROPORCIONAL
              </th>
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
                        <input
                          key={row.name}
                          defaultValue={row.name}
                          aria-label={`Capítulo ${row.name}`}
                          onFocus={e => e.target.select()}
                          onBlur={e => renameChapter(row.name, e.target.value)}
                          style={{ ...cellInput, background: 'transparent', border: 'none', padding: '3px 0' }}
                        />
                        <span style={{ ...micro, flexShrink: 0 }}>({row.lines.length})</span>
                      </div>
                    </td>
                    <td style={td} colSpan={3} />
                    <td style={{ ...td, textAlign: 'right' }}>
                      <div style={{ ...money, fontFamily: fonts.label }}>{fmtMXN(r.budgeted)}</div>
                      {executionLine(r)}
                    </td>
                    {/* El capítulo no marca proporcional: la marca es del
                        RENGLÓN, y una casilla aquí sería una segunda captura del
                        mismo hecho que se desincroniza con sus partidas. */}
                    <td style={td} colSpan={2} />
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button
                        onClick={() => {
                          if (!window.confirm(`¿Quitar el capítulo «${row.name}» con sus ${row.lines.length} partidas? El costo de obra baja en ${fmtMXN(r.budgeted)}.`)) return
                          void run(() => deleteBudgetChapter(propertyId, row.name, planId))
                        }}
                        aria-label={`Quitar capítulo ${row.name}`}
                        style={kill}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                )
              }

              // ── «+ PARTIDA», al final de los renglones de su capítulo ──
              if (row.kind === 'add') {
                if (isCollapsed(row.chapterName)) return null
                return (
                  <tr key={`a${row.id}`} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td colSpan={8} style={{ padding: '3px 6px 6px', paddingLeft: `${6 + indent}px` }}>
                      <button
                        onClick={() => void run(() => createLine({
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

              // Aquí vivía el caso especial del residuo: un renglón de solo
              // lectura, sin ✕ y sin casilla de proporcional, porque su importe
              // lo ponía una resta. Ya no hay resta que proteger. El renglón que
              // siembra la calculadora al nacer la propiedad —«Estimado inicial ·
              // 200 m² × $8,000/m²»— se teclea y se borra como cualquier otro, y
              // cae por el mismo camino que los demás.
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
                  {/* Guarda al marcarse, como el proveedor y el oficio: aquí un
                      cambio ES un cambio, y no hay nada que esperar a soltar.

                      `=== false` y no la verdad a secas, por lo mismo que
                      `scopeOf`: el campo nace TRUE, así que un renglón que llegue
                      sin él está marcado. Preguntado por verdad, además, la
                      casilla se volvería no controlada al llegar `undefined`. */}
                  <td style={{ ...td, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={line.isProportional !== false}
                      aria-label={`Proporcional ${line.name}`}
                      onChange={e => editNow(line, { isProportional: e.target.checked })}
                      style={{ accentColor: colors.primary, cursor: 'pointer' }}
                    />
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
                      onClick={() => void run(() => deleteBudgetLine(propertyId, line.id, planId))}
                      aria-label={`Quitar ${line.name}`}
                      style={kill}
                    >
                      ✕
                    </button>
                  </td>
                </tr>,

                openPayments === line.id && (
                  <tr key={`p${line.id}`} style={{ borderBottom: `1px solid ${colors.border}`, background: colors.surface }}>
                    <td colSpan={8} style={{ padding: '6px 10px 8px', paddingLeft: `${20 + indent}px` }}>
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
                            onClick={() => void run(() => deleteBudgetPayment(propertyId, line.id, pay.id, planId))}
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
                            void run(() => addBudgetPayment(propertyId, line.id, { amount: payAmount, paidOn: payDate }, planId))
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
                enseña como obra del desglose y que alimenta la inversión. Y no
                se teclea: aquí vivía AJUSTAR, que fijaba el total por fuera y
                dejaba que «Otros» absorbiera la diferencia. Para mover el total
                se mueven los renglones — no hay otra puerta, y por eso el total
                siempre es exacto. */}
            <tr style={{ borderTop: `2px solid ${colors.border}`, background: colors.surface }}>
              <td colSpan={4} style={{ ...td, paddingTop: '8px' }}>
                <span style={{ ...micro, letterSpacing: '0.1em' }}>TOTAL · ES EL COSTO DE OBRA</span>
                {/* LOS DOS `$/m²`, ROTULADOS Y JUNTOS. Son dos cifras reales de
                    dos preguntas distintas —«a cuánto supuse el m²» y «a cuánto
                    va el m² con lo que llevo capturado»— y ninguna es el relevo
                    de la otra: la comparación solo es honesta mientras ninguna
                    sea el fallback de la que falta. Antes compartían el nombre
                    `constructionCostPerSqm` y se enseñaban sin rótulo en dos
                    pantallas distintas, que es como se leían como una sola cifra
                    que a veces cambiaba sola.

                    SEPARARSE ES EL DATO, no un descuadre: $50,000 supuestos
                    contra $4,850 presupuestados dicen que el supuesto va muy
                    arriba de lo capturado, y eso se lee, no se corrige. Por eso
                    ninguna va en rojo ni pide nada. */}
                {(property.constructionCostPerSqm != null || property.budgetedCostPerSqm != null) && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                      <span style={{ ...micro, letterSpacing: '0.1em' }}>TU ESTIMADO</span>
                      <span style={{ ...money, fontFamily: fonts.label }}>
                        {perSqm(property.constructionCostPerSqm)}
                      </span>
                      <span style={{ ...micro, letterSpacing: '0.1em' }}>· EL PRESUPUESTO</span>
                      <span style={{ ...money, fontFamily: fonts.label }}>
                        {perSqm(property.budgetedCostPerSqm)}
                      </span>
                    </div>
                    <div style={{ ...micro, whiteSpace: 'normal', maxWidth: '380px', marginTop: '3px' }}>
                      Tu estimado se captura en la ficha y no mueve un peso de aquí; el del
                      presupuesto es esta suma entre los m². Que se separen es el dato: dice
                      cuánto se aleja el supuesto de lo que ya llevas capturado.
                    </div>
                  </>
                )}
              </td>
              <td style={{ ...td, textAlign: 'right', paddingTop: '8px' }}>
                <div style={{ ...money, fontFamily: fonts.label, fontSize: '12px' }}>
                  {fmtMXN(property.constructionBudgeted)}
                </div>
                {executionLine(totalRollup)}
              </td>
              <td style={td} colSpan={3} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
