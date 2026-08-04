import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import {
  fetchBudget, createBudgetLine, updateBudgetLine, deleteBudgetLine, setBudgetTotal,
  renameBudgetChapter, deleteBudgetChapter, addBudgetPayment, deleteBudgetPayment, getProveedores,
  fetchBudgetCatalog, fetchBudgetTemplates, applyBudgetSource, applyCatalogChapter,
  createBudgetTemplate,
} from '../../lib/api'
import type {
  Budget, BudgetCatalogChapter, BudgetItemSuggestion, BudgetLine, BudgetLinePatch,
  BudgetTemplate, BudgetWrite, Property, Proveedor,
} from '../../lib/types'
import { colors, fonts } from '../../lib/theme'
import { fmtMXN } from '../../lib/fmt'
import { computeDepths } from '../../lib/treeUtils'
import { NumericInput } from '../NumericInput'
import { DedupeNameCell } from '../budget/DedupeNameCell'

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
   * El panel de catálogo y plantillas, y lo que necesita.
   *
   * Se pide al ABRIRLO y no al entrar a la pestaña: el catálogo y los
   * presupuestos de los que se puede copiar no son de esta propiedad, y casi
   * toda visita es a capturar un renglón, no a arrancar de cero. Traerlos
   * siempre serían dos consultas más en la ficha para el caso raro.
   */
  const [sourcing, setSourcing] = useState(false)
  const [catalog, setCatalog] = useState<BudgetCatalogChapter[]>([])
  const [templates, setTemplates] = useState<BudgetTemplate[]>([])
  const [pickedChapter, setPickedChapter] = useState<number | ''>('')
  const [pickedSource, setPickedSource] = useState<number | ''>('')
  const [templateName, setTemplateName] = useState('')
  /** El id del PRESUPUESTO, que es lo que se copia al guardarlo como plantilla. */
  const [budgetId, setBudgetId] = useState<number | null>(null)

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
    Promise.all([fetchBudget(propertyId), getProveedores()])
      .then(([b, ps]) => { receive(b); setProveedores(ps) })
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
      const { budget, property: updated, budgetIncrease, linesAdded } = await op()
      receive(budget)
      onPropertyChange(updated)
      // Detallar reparte un total que no se mueve. Cuando el detalle lo rebasa,
      // el residuo llega a 0 y la obra sí pasa a costar más — que ya no es
      // detallar sino aumentar el presupuesto. Se dice en vez de dejar que el
      // total suba en silencio.
      //
      // `linesAdded` solo llega al copiar, y se dice porque copiar es la única
      // escritura cuyo efecto no se ve entero en pantalla: los renglones caen
      // dentro de capítulos que están colapsados.
      setNotice([
        linesAdded != null
          ? (linesAdded > 0
              ? `Se copiaron ${linesAdded} renglones.`
              : 'No había nada nuevo que copiar: esas partidas ya estaban.')
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
   * Adoptar la partida que el aviso de duplicado propuso.
   *
   * Copia el TEXTO —nombre y unidad— y la procedencia solo cuando la sugerencia
   * viene del catálogo. Tres cosas que a propósito NO hace:
   *
   * - **No mueve el renglón de capítulo**, aunque la partida del catálogo viva
   *   en otro. `chapterName` es una copia del renglón, no una referencia; y
   *   reorganizar la tabla debajo de quien está capturando por haber contestado
   *   una pregunta es exactamente el estorbo que hunde el módulo.
   * - **No toca cantidad ni precio.** El catálogo no guarda precio a propósito,
   *   y pisar el que alguien acaba de teclear sería inventarle uno.
   * - **No liga nada cuando la sugerencia es un renglón suelto** — no hay a qué
   *   ligarse todavía. Lo que consigue ahí es que los dos se escriban igual, que
   *   es lo que hace que lleguen juntos a la cola de promoción.
   */
  function adopt(line: BudgetLine, s: BudgetItemSuggestion) {
    editNow(line, {
      name: s.name, unit: s.unit,
      ...(s.itemId != null ? { itemId: s.itemId } : {}),
    })
  }

  /**
   * Suelta una celda de texto que NO PUEDE quedar vacía.
   *
   * `name` y `unit` son NOT NULL con `CHECK (<> '')` en la 028. Ahí un vacío no
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
    Promise.all([fetchBudgetCatalog(), fetchBudgetTemplates()])
      .then(([c, t]) => { setCatalog(c); setTemplates(t) })
      .catch(e => setError(e instanceof Error ? e.message : 'No se pudo leer el catálogo'))
  }

  /**
   * Guardar esta obra como plantilla. Es el ÚNICO de los tres copiados que no
   * pasa por `run`: no devuelve un presupuesto ni una propiedad porque no toca
   * ninguno de los dos —lo que escribe es un presupuesto nuevo, sin propiedad, y
   * la obra de la que salió queda exactamente igual.
   */
  async function saveTemplate() {
    const name = templateName.trim()
    if (!name || budgetId == null) return
    setError(null)
    try {
      const created = await createBudgetTemplate({ name, fromBudgetId: budgetId })
      setTemplates(prev => [...prev, created])
      setTemplateName('')
      setNotice(`Se guardó «${created.name}» como plantilla, con ${created.lineCount} renglones.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la plantilla')
    }
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

  /**
   * Los proveedores de un renglón. La categoría del capítulo FILTRA pero nunca
   * restringe: los que se dedican a eso salen arriba, y todos los demás siguen
   * ahí abajo. El día que el plomero haga albañilería tiene que poder capturarse.
   *
   * Los vetados no se ofrecen — pero uno YA asignado se queda en la lista, porque
   * sacarlo dejaría el selector en blanco y guardar cualquier otra celda borraría
   * el proveedor sin que nadie lo hubiera pedido.
   */
  function supplierOptions(chapterName: string, selectedId: number | null) {
    const usable = proveedores.filter(p => p.status !== 'vetado' || p.id === selectedId)
    const chapter = chapterName.trim().toLowerCase()
    const matches = (p: Proveedor) =>
      p.categories.some(c => c.name.trim().toLowerCase() === chapter)
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
            CATÁLOGO Y PLANTILLAS {sourcing ? '▾' : '▸'}
          </button>
        </div>
      </div>

      {/* Las tres formas de no empezar en blanco, juntas porque las tres son la
          MISMA operación —copiar— usada en tres direcciones. Una plantilla es un
          presupuesto sin propiedad, así que arrancar desde una plantilla y
          arrancar desde la obra de al lado no se distinguen ni aquí ni en el
          servidor: son un renglón de este panel con dos grupos en su selector. */}
      {sourcing && (
        <div style={{
          border: `1px solid ${colors.border}`, background: colors.surface,
          padding: '10px 12px', marginBottom: '10px',
          display: 'flex', flexDirection: 'column', gap: '10px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
            <span style={{ ...micro, letterSpacing: '0.1em', minWidth: '130px' }}>
              BAJAR UN CAPÍTULO
            </span>
            <select
              value={pickedChapter}
              aria-label="Capítulo del catálogo"
              onChange={e => setPickedChapter(e.target.value ? Number(e.target.value) : '')}
              style={{ ...cellInput, width: '220px' }}
            >
              <option value="">— Elegir capítulo del catálogo</option>
              {catalog.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.items.length})</option>
              ))}
            </select>
            <button
              disabled={pickedChapter === ''}
              onClick={() => {
                if (pickedChapter === '') return
                void run(() => applyCatalogChapter(propertyId, pickedChapter))
                setPickedChapter('')
              }}
              style={{ ...ghost, cursor: pickedChapter === '' ? 'not-allowed' : 'pointer' }}
            >
              BAJAR
            </button>
            {/* Se dice aquí porque es lo que más sorprende: el esqueleto no
                mueve un peso, y no es un defecto. */}
            <span style={micro}>Nacen en cantidad 0 — el catálogo no guarda precio.</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
            {/* «Arrancar desde otra obra» es la MISMA llamada con el id del
                presupuesto de al lado —el servidor no las distingue, y con razón:
                una plantilla es un presupuesto sin propiedad. Hoy solo se pueden
                elegir plantillas porque no hay endpoint que liste los
                presupuestos de las demás obras; en cuanto lo haya, es un
                `optgroup` más en este mismo selector. */}
            <span style={{ ...micro, letterSpacing: '0.1em', minWidth: '130px' }}>
              ARRANCAR DESDE
            </span>
            <select
              value={pickedSource}
              aria-label="Presupuesto de origen"
              onChange={e => setPickedSource(e.target.value ? Number(e.target.value) : '')}
              style={{ ...cellInput, width: '220px' }}
            >
              <option value="">— Elegir plantilla</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.lineCount} renglones · {fmtMXN(t.total)}
                </option>
              ))}
            </select>
            <button
              disabled={pickedSource === ''}
              onClick={() => {
                if (pickedSource === '') return
                // A diferencia de bajar un capítulo, esto NO es idempotente:
                // copiar dos veces duplica los renglones, porque dos renglones
                // con el mismo nombre pueden ser dos renglones legítimos y el
                // servidor no puede saber cuál es el caso. Lo sabe quien copia.
                const cual = templates.find(t => t.id === pickedSource)
                if (!window.confirm(
                  `¿Copiar los ${cual?.lineCount ?? ''} renglones de «${cual?.name ?? ''}» a esta obra? `
                  + 'Se suman a lo que ya hay; copiar dos veces los duplica.',
                )) return
                void run(() => applyBudgetSource(propertyId, pickedSource))
                setPickedSource('')
              }}
              style={{ ...ghost, cursor: pickedSource === '' ? 'not-allowed' : 'pointer' }}
            >
              COPIAR RENGLONES
            </button>
            <span style={micro}>Se suman a lo que ya hay; el residuo baja y el total no se mueve.</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
            <span style={{ ...micro, letterSpacing: '0.1em', minWidth: '130px' }}>
              GUARDAR COMO
            </span>
            <input
              value={templateName}
              placeholder="Nombre de la plantilla"
              aria-label="Nombre de la plantilla"
              onChange={e => setTemplateName(e.target.value)}
              style={{ ...cellInput, width: '220px' }}
            />
            <button
              disabled={!templateName.trim()}
              onClick={() => void saveTemplate()}
              style={{ ...ghost, cursor: templateName.trim() ? 'pointer' : 'not-allowed' }}
            >
              GUARDAR PLANTILLA
            </button>
            {/* El residuo no viaja: es lo que a ESTA obra le falta por detallar,
                y en una plantilla sería una partida que le come el residuo a la
                siguiente. */}
            <span style={micro}>Copia las partidas detalladas, sin proveedores ni pagos.</span>
          </div>
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
              <th style={th}>PROVEEDOR</th>
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

              const { sugeridos, resto } = supplierOptions(line.chapterName, line.supplierId)
              return [
                <tr key={line.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={{ ...td, paddingLeft: `${6 + indent}px` }}>
                    {/* La celda que evita que el catálogo se pudra. Sugiere
                        mientras se escribe y no bloquea nada: el renglón se
                        guarda al soltar la caja, conteste o no quien captura. */}
                    <DedupeNameCell
                      value={line.name}
                      ariaLabel={`Partida ${line.name}`}
                      style={cellInput}
                      lineId={line.id}
                      linked={line.itemId != null}
                      onChange={name => edit(line, { name })}
                      onBlur={() => commitText(line.id, 'name')}
                      onAdopt={s => adopt(line, s)}
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
                    <select
                      value={line.supplierId ?? ''}
                      aria-label={`Proveedor de ${line.name}`}
                      onChange={e => editNow(line, { supplierId: e.target.value ? Number(e.target.value) : null })}
                      style={cellInput}
                    >
                      <option value="">— Sin proveedor</option>
                      {sugeridos.length > 0 && (
                        <optgroup label={`Hacen ${line.chapterName.toLowerCase()}`}>
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
