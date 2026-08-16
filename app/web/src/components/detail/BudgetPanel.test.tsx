import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type {
  Budget, BudgetLine, BudgetSource, Property,
  Proveedor,
} from '../../lib/types'
import { BudgetPanel } from './BudgetPanel'
import * as api from '../../lib/api'

vi.mock('../../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    fetchBudget: vi.fn(),
    getProveedores: vi.fn(async () => PROVEEDORES),
    getCategories: vi.fn(async () => OFICIOS),
    createBudgetLine: vi.fn(),
    updateBudgetLine: vi.fn(),
    deleteBudgetLine: vi.fn(),
    setBudgetTotal: vi.fn(),
    renameBudgetChapter: vi.fn(),
    deleteBudgetChapter: vi.fn(),
    addBudgetPayment: vi.fn(),
    deleteBudgetPayment: vi.fn(),
    fetchBudgetSources: vi.fn(async () => FUENTES),
    applyBudgetSource: vi.fn(),
    fetchProperties: vi.fn(async () => OBRAS),
    // El metraje que falta se captura en el popup y se guarda EN LA FICHA de la
    // obra destino: no es un dato de la copia, y por eso no viaja en `apply`.
    updateProperty: vi.fn(),
  }
})

const proveedor = (over: Partial<Proveedor>): Proveedor => ({
  id: 1, name: 'Genérico', phone: '', email: '', website: '', zona: '',
  status: 'activo', vetoReason: null,
  ratingCalidad: null, ratingPuntualidad: null, ratingPrecio: null,
  notes: '', categories: [], photos: [], createdAt: '', updatedAt: '', ...over,
})

/**
 * Los OFICIOS con los que se contrata. Existen como filas con id propio, y ése
 * es el cambio: el selector filtra comparando ese id contra el del renglón, no
 * el nombre del capítulo contra el de la categoría. Por eso «Albañilería» el
 * oficio y «Albañilería» el capítulo tienen que poder no ser lo mismo, y aquí
 * lo son a propósito —el nombre coincide, la llave no— para que una prueba que
 * pase por casualidad de textos no pueda pasar.
 */
const OFICIOS = [
  { id: 7, name: 'Albañilería', description: '', createdAt: '' },
  { id: 8, name: 'Instalaciones hidrosanitarias', description: '', createdAt: '' },
]

const categoria = (id: number, name: string) => ({ id, name, description: '', createdAt: '' })

/**
 * De dónde se puede copiar: los presupuestos de LAS OTRAS OBRAS, ya ordenados
 * por el servidor. Ya no hay plantillas — copiar de la obra parecida más
 * reciente es el único punto de partida que no es captura manual.
 */
const FUENTES: BudgetSource[] = [
  { id: 500, name: 'Zaragoza 100', propertyId: 4, lineCount: 18, total: 1_800_000 },
  { id: 501, name: 'Modesto 415', propertyId: 3, lineCount: 22, total: 2_300_000 },
]

/**
 * El inventario, que es de donde salen las obras DESTINO al empujar. La 7 es la
 * que se está viendo: tiene que quedar fuera de la lista, porque copiarse sobre
 * sí misma la rechaza el servidor con un 422.
 */
const OBRAS = [
  { id: 3, name: 'Modesto 415' },
  { id: 4, name: 'Zaragoza 100' },
  { id: 7, name: 'Esta misma obra' },
] as Property[]

const PROVEEDORES: Proveedor[] = [
  proveedor({ id: 11, name: 'Albañiles del Norte', categories: [categoria(7, 'Albañilería')] }),
  proveedor({
    id: 12, name: 'Plomería Ruiz',
    categories: [categoria(8, 'Instalaciones hidrosanitarias')],
  }),
  proveedor({ id: 13, name: 'El Que Nos Falló', status: 'vetado', vetoReason: 'no volvió' }),
]

const line = (over: Partial<BudgetLine>): BudgetLine => ({
  id: 1, budgetId: 9, chapterName: 'Albañilería', name: 'Muro de block',
  unit: 'm²', quantity: 10, unitPrice: 1_000, budgetedAmount: 10_000,
  // Sin oficio: es como nace un renglón tecleado a mano, y el estado en el que
  // vive la mayor parte de un presupuesto que apenas se está capturando.
  supplierCategoryId: null,
  supplierId: null, committedAmount: null, committedOn: null, committedVariance: null,
  actualQuantity: null, paidAmount: null, paidVariance: null, payments: [],
  closedAt: null, sortOrder: 0, notes: '', isResidual: false,
  // Como nace en la 045: la mayoría de las partidas SÍ crecen con el tamaño de
  // la obra, así que lo que se captura a mano es la excepción.
  isProportional: true,
  createdAt: '', updatedAt: '', ...over,
})

/** El renglón que la 032 le siembra a toda propiedad: el estimado grueso entero. */
const residual = (unitPrice: number): BudgetLine => line({
  id: 99, chapterName: 'Otros', name: 'Otros, por detallar', unit: 'lote',
  quantity: 1, unitPrice, budgetedAmount: unitPrice, isResidual: true,
})

const budget = (lines: BudgetLine[]): Budget => ({
  id: 9, propertyId: 7, lines,
  // El servidor publica los capítulos en su orden de lectura, con el residuo al
  // final: es lo que queda por detallar, no un capítulo más.
  chapters: [...new Set(lines.map(l => l.chapterName))],
})

type PanelProperty = React.ComponentProps<typeof BudgetPanel>['property']

const propiedad = (over: Partial<PanelProperty> = {}): PanelProperty => ({
  id: 7, constructionBudgeted: 1_000_000,
  constructionCommitted: null, constructionPaid: null, constructionPaidVariance: null,
  // Los dos insumos del costo objetivo cuando ESTA obra es el destino. Nacen
  // vacíos porque el 40% de las propiedades reales no tiene metraje: «sin
  // metraje» no es un borde, es el caso de todos los días.
  sqmConstruction: null, constructionCostPerSqm: null,
  ...over,
})

/**
 * La fila de un capítulo. Se busca por su caja de nombre —el capítulo se
 * renombra en su lugar, como toda celda de esta tabla— salvo el del residuo, que
 * es texto porque no se renombra.
 */
const chapterRow = (name: string, locked = false) =>
  (locked ? screen.getByText(name) : screen.getByLabelText(`Capítulo ${name}`)).closest('tr')!

async function renderPanel(b: Budget, property = propiedad(), onChange = vi.fn()) {
  vi.mocked(api.fetchBudget).mockResolvedValue(b)
  render(<BudgetPanel property={property} onPropertyChange={onChange} />)
  await screen.findByText('TOTAL · ES EL COSTO DE OBRA')
  return onChange
}

/** El presupuesto típico: dos capítulos detallados y el remanente sin repartir. */
const DETALLADO = budget([
  line({ id: 1, chapterName: 'Albañilería', name: 'Muro de block', quantity: 10, unitPrice: 1_000, budgetedAmount: 10_000 }),
  line({ id: 2, chapterName: 'Albañilería', name: 'Firme', quantity: 20, unitPrice: 1_500, budgetedAmount: 30_000 }),
  line({ id: 3, chapterName: 'Instalaciones', name: 'Hidráulica', quantity: 1, unitPrice: 60_000, budgetedAmount: 60_000 }),
  residual(900_000),
])

describe('BudgetPanel', () => {
  beforeEach(() => {
    // `clearAllMocks` borra las LLAMADAS, no las implementaciones: un
    // `mockResolvedValue` puesto por una prueba sobrevive a las siguientes y las
    // hace depender del orden en que corren. Reponer los valores por omisión
    // aquí es lo que las mantiene independientes.
    vi.clearAllMocks()
    vi.mocked(api.fetchBudgetSources).mockResolvedValue(FUENTES)
    vi.mocked(api.getCategories).mockResolvedValue(OFICIOS)
    vi.mocked(api.fetchProperties).mockResolvedValue(OBRAS)
    vi.mocked(api.updateProperty).mockResolvedValue(
      { id: 7, name: 'Esta misma obra', sqmConstruction: 250 } as Property)
  })

  it('abre con los capítulos colapsados: la vista inicial son renglones, no cuarenta', async () => {
    // Es la decisión que hace usable la tabla en un teléfono sin estrenar el
    // primer breakpoint responsivo de toda la app.
    await renderPanel(DETALLADO)

    expect(screen.getByLabelText('Capítulo Albañilería')).not.toBeNull()
    expect(screen.getByLabelText('Capítulo Instalaciones')).not.toBeNull()
    expect(screen.queryByLabelText('Partida Muro de block')).toBeNull()
    expect(screen.queryByLabelText('Partida Hidráulica')).toBeNull()

    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))
    expect(screen.getByLabelText('Partida Muro de block')).not.toBeNull()
    // Abrir uno no abre los demás
    expect(screen.queryByLabelText('Partida Hidráulica')).toBeNull()
  })

  it('el «+ PARTIDA» de un capítulo vive dentro de él, no al pie de la tabla', async () => {
    // Es una fila más del modelo, no un segundo recorrido después de la tabla:
    // recorrer dos veces amontonaba todos los botones al final, lejos del
    // capítulo al que agregan.
    await renderPanel(DETALLADO)
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))

    const filas = screen.getAllByRole('row')
    const donde = (el: HTMLElement) => filas.indexOf(el.closest('tr') as HTMLElement)

    expect(donde(screen.getByLabelText('Capítulo Albañilería')))
      .toBeLessThan(donde(screen.getByLabelText('Partida Firme')))
    expect(donde(screen.getByLabelText('Partida Firme')))
      .toBeLessThan(donde(screen.getByText('+ PARTIDA EN ALBAÑILERÍA')))
    expect(donde(screen.getByText('+ PARTIDA EN ALBAÑILERÍA')))
      .toBeLessThan(donde(screen.getByLabelText('Capítulo Instalaciones')))
  })

  it('las celdas de texto se seleccionan al enfocar, igual que las de dinero', async () => {
    // Toda partida nace llamándose «Partida nueva» y todo capítulo «Capítulo
    // nuevo»: texto de arranque, no dato. Sin selección al enfocar había que
    // borrarlo a mano, mientras que en cantidad o precio bastaba con teclear
    // encima — dos comportamientos para celdas contiguas de la misma fila.
    await renderPanel(DETALLADO)
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))

    for (const etiqueta of ['Partida Muro de block', 'Unidad de Muro de block', 'Capítulo Albañilería']) {
      const caja = screen.getByLabelText(etiqueta) as HTMLInputElement
      caja.setSelectionRange(0, 0)
      fireEvent.focus(caja)
      expect([caja.selectionStart, caja.selectionEnd]).toEqual([0, caja.value.length])
    }
  })

  it('el capítulo SUMA SOLO: nunca captura su total', async () => {
    // Mismo principio que `getProgress()` en ProcesoInstanceDetail y que
    // totalInvestment: un padre deriva su cifra de sus hijos y jamás la teclea.
    await renderPanel(DETALLADO)

    const albanileria = chapterRow('Albañilería')
    // 10,000 + 30,000, y ni una caja donde escribirlo
    expect(within(albanileria).getByText('$40,000')).not.toBeNull()
    expect(within(albanileria).queryByRole('spinbutton')).toBeNull()
    expect(within(albanileria).queryByLabelText(/^Precio unitario/)).toBeNull()

    const instalaciones = chapterRow('Instalaciones')
    expect(within(instalaciones).getByText('$60,000')).not.toBeNull()
  })

  it('«Otros, por detallar» es residuo automático y no se edita', async () => {
    // Baja al detallar y sube al quitar detalle. Editarlo a mano convertiría una
    // resta determinista en una segunda captura, y ahí nace el descuadre.
    await renderPanel(DETALLADO)
    fireEvent.click(screen.getByLabelText('Abrir Otros'))

    const fila = screen.getByText('Otros, por detallar').closest('tr')!
    // El importe y el precio unitario son el mismo peso: el residuo es un lote
    // de cantidad 1, y ésa es justamente la forma que lo hace una resta.
    expect(within(fila).getAllByText('$900,000')).toHaveLength(2)
    // Ni nombre, ni cantidad, ni precio, ni proveedor, ni forma de borrarlo
    expect(within(fila).queryByLabelText('Partida Otros, por detallar')).toBeNull()
    expect(within(fila).queryByLabelText('Cantidad de Otros, por detallar')).toBeNull()
    expect(within(fila).queryByLabelText('Precio unitario de Otros, por detallar')).toBeNull()
    expect(within(fila).queryByLabelText('Proveedor de Otros, por detallar')).toBeNull()
    // Ni oficio: el remanente no es trabajo de nadie —en cuanto se sepa de qué
    // es, deja de ser remanente y se vuelve una partida. El CHECK de la 035 lo
    // sostiene también en la base.
    expect(within(fila).queryByLabelText('Oficio de Otros, por detallar')).toBeNull()
    expect(within(fila).queryByLabelText('Quitar Otros, por detallar')).toBeNull()
    // Y dice lo que es, para que se vea que se reparte en vez de crecer
    expect(within(fila).getByText('SE REPARTE AL DETALLAR')).not.toBeNull()
  })

  it('su capítulo tampoco se renombra ni se borra', async () => {
    await renderPanel(DETALLADO)

    expect(screen.queryByLabelText('Capítulo Otros')).toBeNull()
    expect(screen.queryByLabelText('Quitar capítulo Otros')).toBeNull()
    // Ni recibe partidas nuevas: es donde queda lo que falta por repartir, no
    // un capítulo más donde detallar.
    fireEvent.click(screen.getByLabelText('Abrir Otros'))
    expect(screen.queryByText('+ PARTIDA EN OTROS')).toBeNull()
    // Los demás sí, las tres
    expect(screen.getByLabelText('Capítulo Albañilería')).not.toBeNull()
    expect(screen.getByLabelText('Quitar capítulo Albañilería')).not.toBeNull()
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))
    expect(screen.getByText('+ PARTIDA EN ALBAÑILERÍA')).not.toBeNull()
  })

  it('vacío es «—» y cero es cero, también en los montos sumados', async () => {
    // El bug ya mordió una vez: traducir 0 a guion hace que un comprometido de
    // $0 —firmé en cero— se vea idéntico a uno que nadie capturó.
    await renderPanel(budget([
      line({ id: 1, chapterName: 'Firmado en cero', committedAmount: 0, budgetedAmount: 10_000 }),
      line({ id: 2, chapterName: 'Sin firmar', committedAmount: null, budgetedAmount: 5_000 }),
      residual(0),
    ]))

    const firmado = chapterRow('Firmado en cero')
    expect(within(firmado).getByText(/COMP \$0 · PAG —/)).not.toBeNull()

    const sinFirmar = chapterRow('Sin firmar')
    expect(within(sinFirmar).getByText(/COMP — · PAG —/)).not.toBeNull()

    // Y un residuo en 0 se imprime $0: el presupuesto está repartido al 100%,
    // que es un hecho, no un dato que falte.
    fireEvent.click(screen.getByLabelText('Abrir Otros'))
    const otros = screen.getByText('Otros, por detallar').closest('tr')!
    expect(within(otros).getAllByText('$0').length).toBeGreaterThan(0)
    expect(within(otros).queryByText('—')).toBeNull()
  })

  it('pagar exactamente lo presupuestado da una variación de $0, no un guion', async () => {
    await renderPanel(budget([
      line({
        id: 1, chapterName: 'Albañilería', name: 'Muro de block',
        budgetedAmount: 10_000, paidAmount: 10_000, paidVariance: 0,
        payments: [{ id: 1, amount: 10_000, paidOn: '2026-05-01', notes: '', createdAt: '' }],
      }),
      residual(0),
    ]))
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))

    const fila = screen.getByLabelText('Partida Muro de block').closest('tr')!
    expect(within(fila).getByText('VAR $0')).not.toBeNull()
  })

  it('el total lo dice la propiedad, no una segunda suma de la tabla', async () => {
    // Sumar aquí los renglones daría un número redondeado uno por uno contra uno
    // redondeado al final, y unos pesos de diferencia contra la INVERSIÓN de la
    // ficha bastan para dejar de creerle a las dos.
    await renderPanel(DETALLADO, propiedad({
      constructionBudgeted: 1_000_000, constructionCommitted: 0,
      constructionPaid: 250_000, constructionPaidVariance: -750_000,
    }))

    const total = screen.getByText('TOTAL · ES EL COSTO DE OBRA').closest('tr')!
    expect(within(total).getByText('$1,000,000')).not.toBeNull()
    expect(within(total).getByText(/COMP \$0 · PAG \$250,000/)).not.toBeNull()
    // Y la brecha tampoco se vuelve a restar aquí: viene resuelta con las otras
    // tres, de la misma transacción que las produjo.
    expect(within(total).getByText(/VAR -\$750,000/)).not.toBeNull()
  })

  it('una celda de dinero guarda al soltarse, no a cada tecla', async () => {
    // `NumericInput.onChange` dispara con cada dígito: teclear «1500» serían
    // cuatro escrituras, y cada una recalcula el residuo en el servidor.
    const b = budget([line({ id: 1, name: 'Muro de block', unitPrice: 1_000 }), residual(0)])
    await renderPanel(b)
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))

    vi.mocked(api.updateBudgetLine).mockResolvedValue({
      line: null, budget: b, property: {} as Property, budgetIncrease: 0,
    })

    const caja = screen.getByLabelText('Precio unitario de Muro de block')
    fireEvent.change(caja, { target: { value: '1' } })
    fireEvent.change(caja, { target: { value: '15' } })
    fireEvent.change(caja, { target: { value: '1500' } })
    expect(api.updateBudgetLine).not.toHaveBeenCalled()

    fireEvent.blur(caja)
    await waitFor(() => expect(api.updateBudgetLine).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.updateBudgetLine).mock.calls[0].slice(1)).toEqual([1, { unitPrice: 1500 }])
  })

  it('vaciar el nombre de una partida no lo manda: se revierte a lo guardado', async () => {
    // `name` y `unit` son NOT NULL con CHECK (<> '') en la 032. Ahí un vacío no
    // es un vaciado sino un renglón roto, y el servidor solo rechaza el null —
    // una cadena vacía llegaría hasta el CHECK. No contradice la regla de las
    // celdas de dinero: en el comprometido el vacío ES el mensaje, y aquí no hay
    // ningún mensaje que mandar porque el campo no tiene estado vacío.
    const b = budget([line({ id: 1, name: 'Muro de block', unit: 'm²' }), residual(0)])
    await renderPanel(b)
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))

    const caja = screen.getByLabelText('Partida Muro de block') as HTMLInputElement
    fireEvent.change(caja, { target: { value: '' } })
    fireEvent.blur(caja)

    expect(api.updateBudgetLine).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Partida Muro de block') as HTMLInputElement).value)
      .toBe('Muro de block')
  })

  it('vaciar la unidad tampoco, y no se lleva por delante lo demás del renglón', async () => {
    // El nombre nuevo sí se guarda: revertir la celda que no puede quedar vacía
    // no puede descartar los cambios buenos que la acompañaban.
    const b = budget([line({ id: 1, name: 'Muro de block', unit: 'm²' }), residual(0)])
    await renderPanel(b)
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))
    vi.mocked(api.updateBudgetLine).mockResolvedValue({
      line: null, budget: b, property: propiedad() as Property, budgetIncrease: 0,
    })

    fireEvent.change(screen.getByLabelText('Partida Muro de block'), { target: { value: 'Muro de tabique' } })
    const unidad = screen.getByLabelText('Unidad de Muro de tabique')
    fireEvent.change(unidad, { target: { value: '  ' } })
    fireEvent.blur(unidad)

    await waitFor(() => expect(api.updateBudgetLine).toHaveBeenCalled())
    expect(vi.mocked(api.updateBudgetLine).mock.calls[0][2]).toEqual({ name: 'Muro de tabique' })
  })

  it('mientras se teclea, el importe sigue a la cantidad en vez de quedarse viejo', async () => {
    await renderPanel(budget([
      line({ id: 1, name: 'Muro de block', quantity: 10, unitPrice: 1_000, budgetedAmount: 10_000 }),
      residual(0),
    ]))
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))

    const fila = () => screen.getByLabelText('Partida Muro de block').closest('tr')!
    expect(within(fila()).getByText('$10,000')).not.toBeNull()

    fireEvent.change(screen.getByLabelText('Cantidad de Muro de block'), { target: { value: '25' } })
    expect(within(fila()).getByText('$25,000')).not.toBeNull()
  })

  it('detallar reparte: el residuo baja y el total no se mueve', async () => {
    // Es la respuesta del servidor la que se pinta, no un append local. Con un
    // append, «Otros» seguiría en su valor viejo y la tabla sumaría de más
    // contradiciendo al total que llegó en el mismo JSON.
    const onChange = await renderPanel(DETALLADO)
    const despues = budget([
      ...DETALLADO.lines.filter(l => !l.isResidual),
      line({ id: 4, chapterName: 'Albañilería', name: 'Partida nueva', quantity: 1, unitPrice: 0, budgetedAmount: 0 }),
      residual(880_000),
    ])
    vi.mocked(api.createBudgetLine).mockResolvedValue({
      line: null, budget: despues,
      property: { ...propiedad(), name: 'refrescada' } as Property,
      budgetIncrease: 0,
    })

    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))
    fireEvent.click(screen.getByText('+ PARTIDA EN ALBAÑILERÍA'))

    await waitFor(() => expect(api.createBudgetLine).toHaveBeenCalled())
    expect(vi.mocked(api.createBudgetLine).mock.calls[0][1]).toEqual({
      chapterName: 'Albañilería', name: 'Partida nueva',
    })
    // El residuo bajó solo, sin que el cliente lo calculara
    expect(within(chapterRow('Otros', true)).getByText('$880,000')).not.toBeNull()
    // Y la ficha entera se refresca con la propiedad que vino en la respuesta
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0]).toMatchObject({ name: 'refrescada' })
  })

  it('cuando el detalle rebasa el estimado, dice que el presupuesto creció', async () => {
    // Detallar y aumentar el presupuesto son dos operaciones. Que el total suba
    // en silencio las volvería indistinguibles.
    await renderPanel(DETALLADO)
    vi.mocked(api.createBudgetLine).mockResolvedValue({
      line: null, budget: budget([...DETALLADO.lines.filter(l => !l.isResidual), residual(0)]),
      property: propiedad() as Property, budgetIncrease: 120_000,
    })

    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))
    fireEvent.click(screen.getByText('+ PARTIDA EN ALBAÑILERÍA'))

    expect(await screen.findByText(/el presupuesto de obra subió \$120,000/)).not.toBeNull()
  })

  it('el oficio del renglón sugiere, pero ningún proveedor queda fuera', async () => {
    // El oficio FILTRA y nunca restringe: el día que el plomero haga albañilería
    // tiene que poder capturarse. Y filtra por ID, que es el cambio: antes
    // comparaba el nombre del capítulo contra el de la categoría del proveedor
    // —dos vocabularios que solo coincidían por casualidad— y con cero
    // categorías dadas de alta el grupo salía siempre vacío sin decirlo.
    await renderPanel(budget([
      line({ id: 1, name: 'Muro de block', supplierCategoryId: 7 }),
      residual(0),
    ]))
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))

    const selector = screen.getByLabelText('Proveedor de Muro de block')
    const opciones = within(selector).getAllByRole('option').map(o => o.textContent)
    expect(opciones).toContain('Albañiles del Norte')
    expect(opciones).toContain('Plomería Ruiz')
    // El vetado sí queda fuera: eso es una restricción, y es la correcta
    expect(opciones).not.toContain('El Que Nos Falló')
    // Y el del oficio va agrupado arriba, nombrado por el OFICIO y no por el
    // capítulo: son dos cosas y ahora se pueden llamar distinto.
    const grupo = within(selector).getByRole('group', { name: 'Hacen albañilería' })
    expect(within(grupo).getAllByRole('option').map(o => o.textContent))
      .toEqual(['Albañiles del Norte'])
  })

  it('un renglón sin oficio no finge un grupo de sugeridos vacío', async () => {
    // Es el defecto que este cambio vino a matar: el filtro por texto producía
    // un grupo «Hacen albañilería» que nunca contenía a nadie, y nada lo decía.
    // Sin oficio no hay a qué parecerse, así que van todos en un solo grupo.
    await renderPanel(DETALLADO)
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))

    const selector = screen.getByLabelText('Proveedor de Muro de block')
    expect(within(selector).queryByRole('group', { name: /^Hacen/ })).toBeNull()
    const todos = within(selector).getByRole('group', { name: 'Proveedores' })
    expect(within(todos).getAllByRole('option')).toHaveLength(2)
  })

  it('el oficio se captura por renglón, sin proveedor y sin mover un peso', async () => {
    // EL PUNTO DEL CAMBIO: se sabe qué TIPO de persona hace falta mucho antes
    // que quién. Un renglón con oficio y sin proveedor es el estado normal de
    // toda la obra mientras se presupuesta, no una fila a medio llenar.
    const b = budget([line({ id: 1, name: 'Muro de block' }), residual(0)])
    await renderPanel(b)
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))
    vi.mocked(api.updateBudgetLine).mockResolvedValue({
      line: null, budget: b, property: propiedad() as Property, budgetIncrease: 0,
    })

    const oficio = screen.getByLabelText('Oficio de Muro de block') as HTMLSelectElement
    expect(oficio.value).toBe('')
    expect(within(oficio).getAllByRole('option').map(o => o.textContent))
      .toEqual(['— Sin oficio', 'Albañilería', 'Instalaciones hidrosanitarias'])

    fireEvent.change(oficio, { target: { value: '7' } })
    await waitFor(() => expect(api.updateBudgetLine).toHaveBeenCalled())
    expect(vi.mocked(api.updateBudgetLine).mock.calls[0][2]).toEqual({ supplierCategoryId: 7 })

    // Y se quita, como cualquier otra celda: aquí la caja vacía SÍ vacía.
    fireEvent.change(oficio, { target: { value: '' } })
    await waitFor(() => expect(api.updateBudgetLine).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.updateBudgetLine).mock.calls[1][2]).toEqual({ supplierCategoryId: null })
  })

  it('sin oficios dados de alta el selector lo dice, en vez de quedarse mudo', async () => {
    // Hoy hay CERO categorías de proveedor en la base. Un selector con una sola
    // opción vacía se lee como «se rompió», que es exactamente lo que el filtro
    // por texto hacía sin decirlo.
    vi.mocked(api.getCategories).mockResolvedValue([])
    await renderPanel(DETALLADO)
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))

    const oficio = screen.getByLabelText('Oficio de Muro de block')
    expect(within(oficio).getAllByRole('option').map(o => o.textContent))
      .toEqual(['— No hay oficios dados de alta'])
  })

  it('un proveedor vetado que YA está asignado no desaparece del selector', async () => {
    // Sacarlo dejaría el selector en blanco, y guardar cualquier otra celda
    // borraría el proveedor sin que nadie lo hubiera pedido.
    await renderPanel(budget([
      line({ id: 1, name: 'Muro de block', supplierId: 13 }),
      residual(0),
    ]))
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))

    const selector = screen.getByLabelText('Proveedor de Muro de block') as HTMLSelectElement
    expect(selector.value).toBe('13')
    expect(within(selector).getAllByRole('option').map(o => o.textContent))
      .toContain('El Que Nos Falló')
  })

  it('quitar el proveedor manda null: en una celda, la caja vacía SÍ vacía', async () => {
    const b = budget([line({ id: 1, name: 'Muro de block', supplierId: 11 }), residual(0)])
    await renderPanel(b)
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))
    vi.mocked(api.updateBudgetLine).mockResolvedValue({
      line: null, budget: b, property: propiedad() as Property, budgetIncrease: 0,
    })

    fireEvent.change(screen.getByLabelText('Proveedor de Muro de block'), { target: { value: '' } })

    await waitFor(() => expect(api.updateBudgetLine).toHaveBeenCalled())
    expect(vi.mocked(api.updateBudgetLine).mock.calls[0][2]).toEqual({ supplierId: null })
  })

  it('ajustar el total es su propia operación, y mueve el residuo', async () => {
    const onChange = await renderPanel(DETALLADO)
    vi.mocked(api.setBudgetTotal).mockResolvedValue({
      line: null, budget: budget([...DETALLADO.lines.filter(l => !l.isResidual), residual(1_400_000)]),
      property: { ...propiedad({ constructionBudgeted: 1_500_000 }), name: 'crecida' } as Property,
      budgetIncrease: 0,
    })

    fireEvent.click(screen.getByText('AJUSTAR'))
    fireEvent.change(screen.getByLabelText('Nuevo total de obra'), { target: { value: '1500000' } })
    fireEvent.click(screen.getByText('FIJAR TOTAL'))

    await waitFor(() => expect(api.setBudgetTotal).toHaveBeenCalledWith(7, 1_500_000))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
  })

  it('el rechazo del servidor se lee tal como lo escribió', async () => {
    // «Otros» no se teclea y bajar el total por debajo de lo detallado tampoco:
    // las dos frases están escritas para quien las va a corregir, así que se
    // enseñan enteras en vez de un «error al guardar».
    await renderPanel(DETALLADO)
    vi.mocked(api.setBudgetTotal).mockRejectedValue(
      new Error('El presupuesto no puede quedar en $50,000 porque ya hay $100,000 detallados en partidas.'),
    )

    fireEvent.click(screen.getByText('AJUSTAR'))
    fireEvent.change(screen.getByLabelText('Nuevo total de obra'), { target: { value: '50000' } })
    fireEvent.click(screen.getByText('FIJAR TOTAL'))

    expect(await screen.findByText(/ya hay \$100,000 detallados en partidas/)).not.toBeNull()
  })

  it('los pagos se agregan y se borran; nunca se corrigen en su lugar', async () => {
    const conPago = line({
      id: 1, name: 'Muro de block', budgetedAmount: 10_000,
      paidAmount: 4_000, paidVariance: -6_000,
      payments: [{ id: 55, amount: 4_000, paidOn: '2026-05-01', notes: 'anticipo', createdAt: '' }],
    })
    const b = budget([conPago, residual(0)])
    await renderPanel(b)
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))
    fireEvent.click(screen.getByLabelText('Pagos de Muro de block'))

    expect(screen.getByText('anticipo')).not.toBeNull()
    // No hay forma de editar el monto de un pago: solo borrarlo y volver a ponerlo
    expect(screen.getByLabelText('Borrar pago de $4,000')).not.toBeNull()

    vi.mocked(api.addBudgetPayment).mockResolvedValue({
      line: null, budget: b, property: propiedad() as Property, budgetIncrease: 0,
    })
    fireEvent.change(screen.getByLabelText('Monto del pago'), { target: { value: '6000' } })
    fireEvent.change(screen.getByLabelText('Fecha del pago'), { target: { value: '2026-06-15' } })
    fireEvent.click(screen.getByText('AGREGAR PAGO'))

    await waitFor(() => expect(api.addBudgetPayment).toHaveBeenCalledWith(
      7, 1, { amount: 6_000, paidOn: '2026-06-15' },
    ))
  })

  // ── Arrancar desde otra obra ───────────────────────────────────────────────

  it('arrancar desde otra obra copia sus renglones por su id de presupuesto', async () => {
    // Lo que viaja es el id del PRESUPUESTO de la obra origen, no el de la obra.
    await renderPanel(DETALLADO)
    fireEvent.click(screen.getByText(/COPIAR DE OTRA OBRA/))
    const selector = await screen.findByLabelText('Presupuesto de origen')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.applyBudgetSource).mockResolvedValue({
      line: null, budget: DETALLADO, property: propiedad() as Property, budgetIncrease: 0,
    })

    // Una sola clase de origen: la lista va PLANA, sin encabezados de sección
    // que no separarían de nada.
    expect(within(selector).queryAllByRole('group')).toHaveLength(0)
    expect(within(selector).getByRole('option', { name: /Zaragoza 100/ })).not.toBeNull()
    expect(within(selector).getByRole('option', { name: /Modesto 415/ })).not.toBeNull()

    fireEvent.change(selector, { target: { value: '500' } })
    fireEvent.click(screen.getByText('COPIAR RENGLONES'))
    await waitFor(() => expect(api.applyBudgetSource).toHaveBeenCalledWith(7, 500))

    // Y otra obra es la misma llamada con otro id
    fireEvent.change(screen.getByLabelText('Presupuesto de origen'), { target: { value: '501' } })
    fireEvent.click(screen.getByText('COPIAR RENGLONES'))
    await waitFor(() => expect(api.applyBudgetSource).toHaveBeenCalledWith(7, 501))

    // Y se dice que reparten en vez de crecer, que es lo que hace el residuo
    expect(screen.getByText(/el residuo baja y el total no se mueve/)).not.toBeNull()
  })

  it('la obra que pregunta se excluye del servidor, no filtrando aquí', async () => {
    // `apply` rechaza copiarse sobre sí mismo con un 422, y ofrecer una opción
    // que solo puede dar error es hacer que alguien descubra la regla chocando.
    await renderPanel(DETALLADO)
    fireEvent.click(screen.getByText(/COPIAR DE OTRA OBRA/))
    await screen.findByLabelText('Presupuesto de origen')

    expect(api.fetchBudgetSources).toHaveBeenCalledWith(7)
  })

  it('sin nada de dónde copiar lo dice, en vez de dejar un selector vacío', async () => {
    // Una obra sin partidas detalladas no aparece en la lista y eso no es un
    // defecto: no tiene nada que dar. El vacío de un selector se lee como roto.
    vi.mocked(api.fetchBudgetSources).mockResolvedValue([])
    await renderPanel(DETALLADO)
    fireEvent.click(screen.getByText(/COPIAR DE OTRA OBRA/))

    expect(await screen.findByText(/Todavía no hay de dónde copiar/)).not.toBeNull()
  })

  it('copiar un presupuesto se confirma: es una escritura en masa que no se ve', async () => {
    // NO se confirma porque duplique: el servidor compara (capítulo, nombre)
    // normalizados y salta los que ya están, así que copiar dos veces deja el
    // presupuesto igual. Se confirma porque mete decenas de renglones de un
    // clic y caen dentro de capítulos colapsados: el efecto no está en
    // pantalla, y una escritura así no se dispara de un dedazo.
    await renderPanel(DETALLADO)
    fireEvent.click(screen.getByText(/COPIAR DE OTRA OBRA/))
    const selector = await screen.findByLabelText('Presupuesto de origen')
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    fireEvent.change(selector, { target: { value: '500' } })
    fireEvent.click(screen.getByText('COPIAR RENGLONES'))

    expect(api.applyBudgetSource).not.toHaveBeenCalled()
    expect(vi.mocked(window.confirm).mock.calls[0][0])
      .toMatch(/los 18 renglones de «Zaragoza 100»/)
  })

  it('copiar dice cuántos renglones cayeron: no se ven, los capítulos están cerrados', async () => {
    await renderPanel(DETALLADO)
    fireEvent.click(screen.getByText(/COPIAR DE OTRA OBRA/))
    await screen.findByLabelText('Presupuesto de origen')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.applyBudgetSource).mockResolvedValue({
      line: null, budget: DETALLADO, property: propiedad() as Property,
      budgetIncrease: 0, linesAdded: 18,
    })

    fireEvent.change(screen.getByLabelText('Presupuesto de origen'), { target: { value: '500' } })
    fireEvent.click(screen.getByText('COPIAR RENGLONES'))

    expect(await screen.findByText(/Se copiaron 18 renglones/)).not.toBeNull()
  })

  // ── Copiar a otras obras (la dirección contraria: empujar) ─────────────────

  /** Abre el bloque de empujar y espera a que lleguen las obras destino. */
  async function abrirEmpujar() {
    fireEvent.click(screen.getByText(/COPIAR A OTRAS OBRAS/))
    await screen.findByLabelText('Copiar a Modesto 415')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  }

  /** Lo que contesta `apply` en el DESTINO: lo que entró y lo que ya estaba. */
  const copiado = (added: number, skipped: number) => ({
    line: null, budget: DETALLADO, property: propiedad() as Property,
    budgetIncrease: 0, linesAdded: added, linesSkipped: skipped,
  })

  it('empuja con UNA llamada por obra destino, con los capítulos elegidos', async () => {
    // No hay ruta de reparto y es a propósito: cada presupuesto es independiente,
    // así que si el segundo destino falla el primero tiene que quedar aplicado.
    // La atomicidad correcta es por propiedad, y ésa ya la da el endpoint.
    await renderPanel(DETALLADO)
    await abrirEmpujar()
    vi.mocked(api.applyBudgetSource).mockResolvedValue(copiado(2, 0))

    fireEvent.click(screen.getByLabelText('Copiar a Modesto 415'))
    fireEvent.click(screen.getByLabelText('Copiar a Zaragoza 100'))
    // Todos los capítulos vienen marcados; se desmarca uno para copiar el otro
    fireEvent.click(screen.getByLabelText('Copiar capítulo Instalaciones'))
    fireEvent.click(screen.getByText('COPIAR A ESTAS OBRAS'))

    await waitFor(() => expect(api.applyBudgetSource).toHaveBeenCalledTimes(2))
    // El id de la URL es el DESTINO y el `budgetId` el del presupuesto de ESTA
    // obra: la misma llamada de «arrancar desde», al revés.
    expect(vi.mocked(api.applyBudgetSource).mock.calls).toEqual([
      [3, 9, ['Albañilería']],
      [4, 9, ['Albañilería']],
    ])
  })

  it('sin tocar una casilla viaja el presupuesto entero, no una lista armada aquí', async () => {
    // `null` no es «ninguno»: es «no se eligieron capítulos», que el servidor lee
    // como el presupuesto completo. Mandar la lista de todos sería una segunda
    // definición del mismo hecho, que se desincroniza el día que se renombre uno.
    await renderPanel(DETALLADO)
    await abrirEmpujar()
    vi.mocked(api.applyBudgetSource).mockResolvedValue(copiado(3, 0))

    fireEvent.click(screen.getByLabelText('Copiar a Modesto 415'))
    fireEvent.click(screen.getByText('COPIAR A ESTAS OBRAS'))

    await waitFor(() => expect(api.applyBudgetSource).toHaveBeenCalledWith(3, 9, null))
  })

  it('dice OBRA POR OBRA cuántos renglones entraron y cuántos ya estaban', async () => {
    // Deduplicar es SALTAR, nunca actualizar: un renglón que ya existe allá puede
    // traer proveedor o pagos. Un «listo» que escondiera que a una obra no le
    // entró nada sería peor que un error.
    await renderPanel(DETALLADO)
    await abrirEmpujar()
    vi.mocked(api.applyBudgetSource)
      .mockResolvedValueOnce(copiado(3, 0))
      .mockResolvedValueOnce(copiado(0, 3))

    fireEvent.click(screen.getByLabelText('Copiar a Modesto 415'))
    fireEvent.click(screen.getByLabelText('Copiar a Zaragoza 100'))
    fireEvent.click(screen.getByText('COPIAR A ESTAS OBRAS'))

    expect(await screen.findByText(/Modesto 415: 3 renglones agregados · 0 saltados/)).not.toBeNull()
    expect(await screen.findByText(/Zaragoza 100: 0 renglones agregados · 3 saltados/)).not.toBeNull()
  })

  it('una obra que falla no cancela las demás ni se traga su nombre', async () => {
    // Las que ya entraron quedan aplicadas, las que faltan se siguen intentando,
    // y el rechazo se lee tal como lo escribió el servidor —junto al nombre de la
    // obra a la que NO llegó nada.
    await renderPanel(DETALLADO)
    await abrirEmpujar()
    vi.mocked(api.applyBudgetSource)
      .mockRejectedValueOnce(new Error('El presupuesto de destino está cerrado.'))
      .mockResolvedValueOnce(copiado(4, 1))

    fireEvent.click(screen.getByLabelText('Copiar a Modesto 415'))
    fireEvent.click(screen.getByLabelText('Copiar a Zaragoza 100'))
    fireEvent.click(screen.getByText('COPIAR A ESTAS OBRAS'))

    await waitFor(() => expect(api.applyBudgetSource).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/Modesto 415: no se copió — El presupuesto de destino está cerrado\./))
      .not.toBeNull()
    expect(await screen.findByText(/Zaragoza 100: 4 renglones agregados · 1 saltados/)).not.toBeNull()
  })

  it('la respuesta es del DESTINO: no repinta esta obra ni su ficha', async () => {
    // `apply` contesta el presupuesto y la propiedad de la obra a la que se
    // copió. Pasarla por `run` sustituiría esta obra por otra en la pantalla.
    // De aquí solo sale una copia: no hay nada que refrescar.
    const onChange = await renderPanel(DETALLADO)
    await abrirEmpujar()
    vi.mocked(api.applyBudgetSource).mockResolvedValue({
      ...copiado(3, 0),
      property: { ...propiedad({ constructionBudgeted: 99 }), name: 'la otra obra' } as Property,
    })

    fireEvent.click(screen.getByLabelText('Copiar a Modesto 415'))
    fireEvent.click(screen.getByText('COPIAR A ESTAS OBRAS'))

    await waitFor(() => expect(api.applyBudgetSource).toHaveBeenCalled())
    expect(onChange).not.toHaveBeenCalled()
    const total = screen.getByText('TOTAL · ES EL COSTO DE OBRA').closest('tr')!
    expect(within(total).getByText('$1,000,000')).not.toBeNull()
  })

  it('esta obra no se ofrece como destino, y el residuo no se ofrece como capítulo', async () => {
    // Copiarse sobre sí misma da 422, y ofrecer una opción que solo puede fallar
    // es hacer que alguien descubra la regla chocando con ella. El capítulo del
    // residuo tampoco viaja nunca, así que su casilla no haría nada.
    await renderPanel(DETALLADO)
    await abrirEmpujar()

    expect(screen.queryByLabelText('Copiar a Esta misma obra')).toBeNull()
    expect(screen.getByLabelText('Copiar capítulo Albañilería')).not.toBeNull()
    expect(screen.getByLabelText('Copiar capítulo Instalaciones')).not.toBeNull()
    expect(screen.queryByLabelText('Copiar capítulo Otros')).toBeNull()
  })

  it('sin obra elegida no se copia: el botón no dispara nada', async () => {
    await renderPanel(DETALLADO)
    await abrirEmpujar()

    fireEvent.click(screen.getByText('COPIAR A ESTAS OBRAS'))
    expect(api.applyBudgetSource).not.toHaveBeenCalled()

    // Ni con obra pero sin un solo capítulo marcado: no hay nada que mandar.
    fireEvent.click(screen.getByLabelText('Copiar a Modesto 415'))
    fireEvent.click(screen.getByLabelText('Copiar capítulo Albañilería'))
    fireEvent.click(screen.getByLabelText('Copiar capítulo Instalaciones'))
    fireEvent.click(screen.getByText('COPIAR A ESTAS OBRAS'))
    expect(api.applyBudgetSource).not.toHaveBeenCalled()
  })

  // ── Copia PROPORCIONAL ─────────────────────────────────────────────────────

  /**
   * Un presupuesto con una partida que NO escala. Una licencia cuesta lo mismo
   * en una casa de 120 m² que en una de 300, y ésa es toda la razón por la que
   * la marca existe: sin ella, copiar al doble de obra la cobraría al doble.
   */
  const CON_FIJA = budget([
    line({
      id: 1, chapterName: 'Albañilería', name: 'Muro de block',
      quantity: 10, unitPrice: 1_000, budgetedAmount: 10_000,
    }),
    line({
      id: 2, chapterName: 'Permisos', name: 'Licencia de construcción',
      quantity: 1, unitPrice: 90_000, budgetedAmount: 90_000, isProportional: false,
    }),
    residual(900_000),
  ])

  it('la casilla PROPORCIONAL vive en la tabla, no en el popup, y guarda al marcarse', async () => {
    // Escondida en el popup de copiar nunca se capturaría hasta que ya se lleva
    // prisa, y ahí se marca todo de corrido. En la tabla se contesta el día que
    // se teclea la partida, que es cuando se sabe.
    await renderPanel(CON_FIJA)
    vi.mocked(api.updateBudgetLine).mockResolvedValue({
      line: null, budget: CON_FIJA, property: propiedad() as Property, budgetIncrease: 0,
    })
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))
    fireEvent.click(screen.getByLabelText('Abrir Permisos'))

    expect((screen.getByLabelText('Proporcional Muro de block') as HTMLInputElement).checked)
      .toBe(true)
    const fija = screen.getByLabelText('Proporcional Licencia de construcción') as HTMLInputElement
    expect(fija.checked).toBe(false)
    // El residuo no lleva casilla: escala siempre, y por eso el destino hereda
    // también cuánto le falta por detallar.
    expect(screen.queryByLabelText('Proporcional Otros, por detallar')).toBeNull()

    // Un cambio ES un cambio: guarda al marcarse, como el oficio y el proveedor.
    fireEvent.click(fija)
    await waitFor(() => expect(api.updateBudgetLine).toHaveBeenCalled())
    expect(vi.mocked(api.updateBudgetLine).mock.calls[0].slice(1))
      .toEqual([2, { isProportional: true }])
  })

  /** Abre «copiar de otra obra» y pide la copia PROPORCIONAL. */
  async function abrirProporcional() {
    fireEvent.click(screen.getByText(/COPIAR DE OTRA OBRA/))
    await screen.findByLabelText('Presupuesto de origen')
    fireEvent.click(screen.getByLabelText('Copia proporcional de otra obra'))
  }

  it('el costo objetivo se mueve al teclear, y arranca del $/m² derivado del destino', async () => {
    // `constructionCostPerSqm` es derivado —presupuesto ÷ metraje— y por eso
    // solo pre-llena: es a lo que HOY se construye esta obra, no a lo que se
    // decidió construir la que viene.
    await renderPanel(DETALLADO, propiedad({ sqmConstruction: 250, constructionCostPerSqm: 8_000 }))
    await abrirProporcional()

    expect(screen.getByText('$2,000,000')).not.toBeNull()

    // Y se mueve con cada tecla: T no espera a que se suelte la caja, porque lo
    // que se está decidiendo es justamente en qué número parar.
    const caja = screen.getByLabelText('Costo por m² de esta obra')
    fireEvent.change(caja, { target: { value: '12000' } })
    expect(screen.getByText('$3,000,000')).not.toBeNull()
    fireEvent.change(caja, { target: { value: '14000' } })
    expect(screen.getByText('$3,500,000')).not.toBeNull()
  })

  it('el preview aparta las partidas fijas del monto que escala', async () => {
    // Sin apartarlas el factor prometería que TODO el presupuesto se mueve
    // —×3.00— cuando la licencia entra con sus $90,000 de siempre y el resto
    // carga con la diferencia: ×3.20.
    await renderPanel(DETALLADO, propiedad({ sqmConstruction: 250 }))
    // Y las lee del ORIGEN, no de esta obra: lo que se va a copiar es aquello.
    vi.mocked(api.fetchBudget).mockImplementation(async id => (id === 4 ? CON_FIJA : DETALLADO))
    await abrirProporcional()
    fireEvent.change(screen.getByLabelText('Presupuesto de origen'), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText('Costo por m² de esta obra'), { target: { value: '12000' } })

    // F = $90,000 · S + R = $910,000 · factor = (3,000,000 − 90,000) / 910,000
    expect(await screen.findByText(/NO ESCALAN \$90,000 · EL RESTO ×3\.20/)).not.toBeNull()
  })

  it('con la caja del metraje VACÍA no se puede continuar, y lo que falta se nombra', async () => {
    // «Sin metraje» no es un borde: solo 3 de 5 propiedades reales lo tienen.
    // El bloqueo se queda para lo que nadie capturó —no se adivina ni se cae a
    // copia directa en silencio— pero no para lo que se puede capturar aquí.
    await renderPanel(DETALLADO, propiedad({ sqmConstruction: null, constructionCostPerSqm: 12_000 }))
    await abrirProporcional()
    fireEvent.change(screen.getByLabelText('Presupuesto de origen'), { target: { value: '500' } })

    expect(await screen.findByText(/falta el metraje de construcción/)).not.toBeNull()
    fireEvent.click(screen.getByText('COPIAR RENGLONES'))
    await waitFor(() => expect(api.applyBudgetSource).not.toHaveBeenCalled())
    expect(api.updateProperty).not.toHaveBeenCalled()
  })

  it('el metraje que falta se captura en el popup, y la caja dice que se guarda', async () => {
    // Éste es justo el momento en que a alguien le importa el metraje: mandarlo
    // a otra pantalla a capturarlo es como se pierde lo que venía a hacer. Y se
    // dice que se guarda, porque no es un dato de la copia sino de la propiedad.
    await renderPanel(DETALLADO, propiedad({ sqmConstruction: null, constructionCostPerSqm: 12_000 }))
    await abrirProporcional()

    expect(screen.getByLabelText('Metraje de construcción de esta obra')).not.toBeNull()
    expect(screen.getByText(/SE GUARDA EN SU FICHA/)).not.toBeNull()

    // Capturado, deja de estar bloqueada y el objetivo sale con ese metraje
    fireEvent.change(screen.getByLabelText('Metraje de construcción de esta obra'),
                     { target: { value: '250' } })
    expect(screen.queryByText(/falta el metraje de construcción/)).toBeNull()
    expect(screen.getByText('$3,000,000')).not.toBeNull()
  })

  it('el metraje se guarda en la ficha ANTES de copiar, no después ni en la copia', async () => {
    // El servidor calcula el objetivo con el metraje que lee de la ficha del
    // destino: copiar antes de guardarlo sería pedirle dimensionar con un dato
    // que todavía no existe.
    const onChange = await renderPanel(
      DETALLADO, propiedad({ sqmConstruction: null, constructionCostPerSqm: 12_000 }))
    await abrirProporcional()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.applyBudgetSource).mockResolvedValue({
      line: null, budget: DETALLADO, property: propiedad() as Property,
      budgetIncrease: 0, linesAdded: 18,
    })

    fireEvent.change(screen.getByLabelText('Presupuesto de origen'), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText('Metraje de construcción de esta obra'),
                     { target: { value: '250' } })
    fireEvent.click(screen.getByText('COPIAR RENGLONES'))

    await waitFor(() => expect(api.applyBudgetSource).toHaveBeenCalled())
    expect(api.updateProperty).toHaveBeenCalledWith(7, { sqmConstruction: 250 })
    expect(vi.mocked(api.updateProperty).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(api.applyBudgetSource).mock.invocationCallOrder[0])
    // Y la ficha se entera del metraje nuevo: es suyo, no de esta operación
    expect(onChange).toHaveBeenCalled()
  })

  it('sin $/m² tampoco, y se dice cuál de los dos falta — no «faltan datos»', async () => {
    await renderPanel(DETALLADO, propiedad({ sqmConstruction: 250, constructionCostPerSqm: null }))
    await abrirProporcional()
    fireEvent.change(screen.getByLabelText('Presupuesto de origen'), { target: { value: '500' } })

    expect(screen.getByText(/falta el \$\/m² de desarrollo/)).not.toBeNull()
    fireEvent.click(screen.getByText('COPIAR RENGLONES'))
    expect(api.applyBudgetSource).not.toHaveBeenCalled()

    // Capturado el que faltaba, sí se puede — y lo que viaja es el $/m², nunca
    // el factor: el servidor lo calcula, que es lo que hace verificable que la
    // suma dé exactamente el objetivo.
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.applyBudgetSource).mockResolvedValue({
      line: null, budget: DETALLADO, property: propiedad() as Property,
      budgetIncrease: 0, linesAdded: 18,
    })
    fireEvent.change(screen.getByLabelText('Costo por m² de esta obra'), { target: { value: '12000' } })
    fireEvent.click(screen.getByText('COPIAR RENGLONES'))

    await waitFor(() => expect(api.applyBudgetSource).toHaveBeenCalledWith(7, 500, null, { costPerSqm: 12_000 }))
  })

  it('en PUSH cada obra lleva su propio objetivo, y una bloqueada no frena a las demás', async () => {
    // Dos obras del mismo tamaño pueden construirse a niveles de costo
    // distintos: un solo $/m² para todas las copiaría al mismo precio por metro
    // sin decirlo.
    vi.mocked(api.fetchProperties).mockResolvedValue([
      { id: 3, name: 'Modesto 415', sqmConstruction: 200, constructionCostPerSqm: 12_000 },
      { id: 4, name: 'Zaragoza 100', sqmConstruction: null, constructionCostPerSqm: null },
    ] as Property[])
    await renderPanel(CON_FIJA)
    await abrirEmpujar()
    fireEvent.click(screen.getByLabelText('Copia proporcional a otras obras'))
    vi.mocked(api.applyBudgetSource).mockResolvedValue(copiado(2, 0))

    fireEvent.click(screen.getByLabelText('Copiar a Modesto 415'))
    fireEvent.click(screen.getByLabelText('Copiar a Zaragoza 100'))

    // T de Modesto sale de SU metraje y SU $/m², y su preview aparta las fijas
    expect(screen.getByText('$2,400,000')).not.toBeNull()
    expect(screen.getByText(/NO ESCALAN \$90,000/)).not.toBeNull()
    // Zaragoza queda bloqueada con el motivo a la vista, no en silencio
    expect(screen.getByText(/falta el metraje de construcción/)).not.toBeNull()
    expect(screen.getByText(/1 de las elegidas se quedan fuera/)).not.toBeNull()

    fireEvent.click(screen.getByText('COPIAR A ESTAS OBRAS'))

    await waitFor(() => expect(api.applyBudgetSource).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.applyBudgetSource).mock.calls[0]).toEqual([3, 9, null, { costPerSqm: 12_000 }])
    expect(await screen.findByText(/Modesto 415: 2 renglones agregados/)).not.toBeNull()
    // Y la que no entró se dice por su nombre, junto a las que sí
    expect(await screen.findByText(/Zaragoza 100: no se copió — falta el metraje/)).not.toBeNull()
  })

  it('en PUSH el metraje de cada obra se guarda en SU ficha antes de copiarle', async () => {
    // Y si ese guardado falla, falla ESA obra y nada más: el aislamiento por
    // destino es el mismo de siempre, ahora con dos pasos en vez de uno.
    vi.mocked(api.fetchProperties).mockResolvedValue([
      { id: 3, name: 'Modesto 415', sqmConstruction: null, constructionCostPerSqm: 12_000 },
      { id: 4, name: 'Zaragoza 100', sqmConstruction: null, constructionCostPerSqm: 10_000 },
    ] as Property[])
    await renderPanel(CON_FIJA)
    await abrirEmpujar()
    fireEvent.click(screen.getByLabelText('Copia proporcional a otras obras'))
    vi.mocked(api.applyBudgetSource).mockResolvedValue(copiado(2, 0))
    vi.mocked(api.updateProperty)
      .mockRejectedValueOnce(new Error('La obra está archivada.'))
      .mockResolvedValueOnce({ id: 4, name: 'Zaragoza 100', sqmConstruction: 300 } as Property)

    fireEvent.click(screen.getByLabelText('Copiar a Modesto 415'))
    fireEvent.click(screen.getByLabelText('Copiar a Zaragoza 100'))
    fireEvent.change(screen.getByLabelText('Metraje de construcción de Modesto 415'),
                     { target: { value: '200' } })
    fireEvent.change(screen.getByLabelText('Metraje de construcción de Zaragoza 100'),
                     { target: { value: '300' } })

    // Capturados los dos, ninguna queda bloqueada y cada una lleva SU objetivo
    expect(screen.getByText('$2,400,000')).not.toBeNull()
    expect(screen.getByText('$3,000,000')).not.toBeNull()

    fireEvent.click(screen.getByText('COPIAR A ESTAS OBRAS'))

    await waitFor(() => expect(api.applyBudgetSource).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.updateProperty).mock.calls)
      .toEqual([[3, { sqmConstruction: 200 }], [4, { sqmConstruction: 300 }]])
    // A la que sí se le guardó el metraje se le copió, y con su propio $/m²
    expect(vi.mocked(api.applyBudgetSource).mock.calls[0])
      .toEqual([4, 9, null, { costPerSqm: 10_000 }])
    // Y a la que falló se le dice CUÁL de los dos pasos falló, por su nombre
    expect(await screen.findByText(
      /Modesto 415: no se copió — el metraje no se pudo guardar: La obra está archivada\./,
    )).not.toBeNull()
    expect(await screen.findByText(/Zaragoza 100: 2 renglones agregados/)).not.toBeNull()
  })
})
