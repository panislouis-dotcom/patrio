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
    renameBudgetChapter: vi.fn(),
    deleteBudgetChapter: vi.fn(),
    addBudgetPayment: vi.fn(),
    deleteBudgetPayment: vi.fn(),
    fetchBudgetSources: vi.fn(async () => FUENTES),
    applyBudgetSource: vi.fn(),
    fetchProperties: vi.fn(async () => []),
    // Mockeada para poder AFIRMAR QUE NO SE LLAMA: copiar ya no escribe la ficha
    // de nadie. El costo de obra del destino se lee de su presupuesto, y se
    // captura en su ficha —con su metraje y su $/m²—, nunca desde este popup.
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
  { id: 500, name: 'Zaragoza 100', propertyId: 4, lineCount: 18, total: 1_800_000,
    planId: null, planName: null, sqmConstruction: 200, constructionCostPerSqm: 10_000 },
  { id: 501, name: 'Modesto 415', propertyId: 3, lineCount: 22, total: 2_300_000,
    planId: null, planName: null, sqmConstruction: 250, constructionCostPerSqm: 10_000 },
]

/**
 * Los presupuestos DESTINO al empujar (addendum 2026-08-24: la lista es de
 * PRESUPUESTOS — obras y escenarios — y la exclusión del propio la hace el
 * servidor por id de presupuesto, no este cliente).
 */
const destino = (over: Partial<BudgetSource>): BudgetSource => ({
  // `total` ES el objetivo de una copia proporcional: la suma de los renglones
  // de esa obra. Era `fullTotal` mientras el residuo entraba en uno y no en el
  // otro; hoy hay una sola suma y el cliente dejó de leer el campo viejo.
  id: 300, name: 'Modesto 415', propertyId: 3, lineCount: 12, total: 2_000_000,
  planId: null, planName: null,
  sqmConstruction: null, constructionCostPerSqm: null, ...over,
})
const DESTINOS: BudgetSource[] = [
  destino({}),
  destino({ id: 400, name: 'Zaragoza 100', propertyId: 4, total: 3_000_000 }),
]

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
  closedAt: null, sortOrder: 0, notes: '',
  // Como nace en la 045: la mayoría de las partidas SÍ crecen con el tamaño de
  // la obra, así que lo que se captura a mano es la excepción.
  isProportional: true,
  createdAt: '', updatedAt: '', ...over,
})

/**
 * La HOLGURA: lo que todavía no se detalla, cargado como un renglón más.
 *
 * Era el residuo —una bandera del servidor, un importe que ponía una resta, sin
 * ✕ y sin casillas— y hoy es una partida ordinaria con el nombre que alguien le
 * puso. Se teclea, se borra y escala como cualquier otra, y por eso esta fixture
 * no le pasa nada especial a `line()`.
 */
const holgura = (unitPrice: number): BudgetLine => line({
  id: 99, chapterName: 'Otros', name: 'Otros, por detallar', unit: 'lote',
  quantity: 1, unitPrice, budgetedAmount: unitPrice,
})

const budget = (lines: BudgetLine[]): Budget => ({
  id: 9, propertyId: 7, lines,
  // El servidor publica los capítulos en su orden de lectura. Ninguno es
  // especial: el de la holgura se renombra, se borra y recibe partidas como
  // todos los demás.
  chapters: [...new Set(lines.map(l => l.chapterName))],
})

type PanelProperty = React.ComponentProps<typeof BudgetPanel>['property']

const propiedad = (over: Partial<PanelProperty> = {}): PanelProperty => ({
  // `constructionBudgeted` ES el costo objetivo cuando ESTA obra es el destino:
  // la suma de los renglones de su presupuesto, leída, no tecleada.
  id: 7, constructionBudgeted: 1_000_000,
  constructionCommitted: null, constructionPaid: null, constructionPaidVariance: null,
  // LOS DOS `$/m²`, que el pie enseña rotulados. Nacen vacíos porque el 40% de
  // las propiedades reales no tiene metraje ni supuesto capturado, y un
  // presupuesto sin ninguno de los dos sigue siendo un presupuesto.
  constructionCostPerSqm: null, budgetedCostPerSqm: null,
  ...over,
})

/**
 * La fila de un capítulo. Se busca SIEMPRE por su caja de nombre: todos se
 * renombran en su lugar, como toda celda de esta tabla. El del residuo era la
 * excepción —texto muerto, sin caja— y se fue con el residuo.
 */
const chapterRow = (name: string) =>
  screen.getByLabelText(`Capítulo ${name}`).closest('tr')!

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
  holgura(900_000),
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

  it('«Otros, por detallar» SE EDITA Y SE BORRA como cualquier otra partida', async () => {
    // LA INVERSIÓN DE LA REGLA VIEJA. Era un renglón de solo lectura —sin caja
    // de nombre, sin cantidad, sin precio, sin proveedor y sin ✕— porque su
    // importe lo ponía una resta contra un total fijado por fuera. Hoy no hay
    // resta que proteger: una holgura es un renglón con el nombre que alguien le
    // puso, y el renglón que la calculadora siembra al nacer la propiedad
    // («Estimado inicial · 200 m² × $8,000/m²») entra por esta misma puerta.
    const b = budget([line({ id: 1, name: 'Muro de block' }), holgura(900_000)])
    await renderPanel(b)
    fireEvent.click(screen.getByLabelText('Abrir Otros'))
    vi.mocked(api.updateBudgetLine).mockResolvedValue({
      line: null, budget: b, property: propiedad() as Property,
    })

    const fila = screen.getByLabelText('Partida Otros, por detallar').closest('tr')!
    // Las mismas celdas que cualquier partida, todas activas
    expect(within(fila).getByLabelText('Cantidad de Otros, por detallar')).not.toBeNull()
    expect(within(fila).getByLabelText('Precio unitario de Otros, por detallar')).not.toBeNull()
    expect(within(fila).getByLabelText('Oficio de Otros, por detallar')).not.toBeNull()
    expect(within(fila).getByLabelText('Proveedor de Otros, por detallar')).not.toBeNull()
    // Y ya no dice que se reparte, porque no se reparte
    expect(within(fila).queryByText('SE REPARTE AL DETALLAR')).toBeNull()

    // Se teclea
    const precio = within(fila).getByLabelText('Precio unitario de Otros, por detallar')
    fireEvent.change(precio, { target: { value: '800000' } })
    fireEvent.blur(precio)
    await waitFor(() => expect(api.updateBudgetLine).toHaveBeenCalled())
    expect(vi.mocked(api.updateBudgetLine).mock.calls[0].slice(1))
      .toEqual([99, { unitPrice: 800000 }, undefined])

    // Y se borra, que era el 400 más caro de la pantalla vieja
    vi.mocked(api.deleteBudgetLine).mockResolvedValue({
      line: null, budget: budget([line({ id: 1, name: 'Muro de block' })]),
      property: propiedad({ constructionBudgeted: 10_000 }) as Property,
    })
    fireEvent.click(within(fila).getByLabelText('Quitar Otros, por detallar'))
    await waitFor(() => expect(api.deleteBudgetLine).toHaveBeenCalledWith(7, 99, undefined))
  })

  it('su capítulo se renombra, se borra y recibe partidas, como todos', async () => {
    // Era el único capítulo bloqueado —el que alojaba el residuo— y con él se
    // fue la última fila con dos clases de comportamiento en esta tabla.
    await renderPanel(DETALLADO)

    expect(screen.getByLabelText('Capítulo Otros')).not.toBeNull()
    expect(screen.getByLabelText('Quitar capítulo Otros')).not.toBeNull()
    fireEvent.click(screen.getByLabelText('Abrir Otros'))
    expect(screen.getByText('+ PARTIDA EN OTROS')).not.toBeNull()
    // Y los demás siguen igual que siempre
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
      holgura(0),
    ]))

    const firmado = chapterRow('Firmado en cero')
    expect(within(firmado).getByText(/COMP \$0 · PAG —/)).not.toBeNull()

    const sinFirmar = chapterRow('Sin firmar')
    expect(within(sinFirmar).getByText(/COMP — · PAG —/)).not.toBeNull()

    // Y una holgura en 0 se imprime $0: no queda nada por detallar, que es un
    // hecho, no un dato que falte.
    fireEvent.click(screen.getByLabelText('Abrir Otros'))
    const otros = screen.getByLabelText('Partida Otros, por detallar').closest('tr')!
    expect(within(otros).getAllByText('$0').length).toBeGreaterThan(0)
  })

  it('pagar exactamente lo presupuestado da una variación de $0, no un guion', async () => {
    await renderPanel(budget([
      line({
        id: 1, chapterName: 'Albañilería', name: 'Muro de block',
        budgetedAmount: 10_000, paidAmount: 10_000, paidVariance: 0,
        payments: [{ id: 1, amount: 10_000, paidOn: '2026-05-01', notes: '', createdAt: '' }],
      }),
      holgura(0),
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
    const b = budget([line({ id: 1, name: 'Muro de block', unitPrice: 1_000 }), holgura(0)])
    await renderPanel(b)
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))

    vi.mocked(api.updateBudgetLine).mockResolvedValue({
      line: null, budget: b, property: {} as Property,
    })

    const caja = screen.getByLabelText('Precio unitario de Muro de block')
    fireEvent.change(caja, { target: { value: '1' } })
    fireEvent.change(caja, { target: { value: '15' } })
    fireEvent.change(caja, { target: { value: '1500' } })
    expect(api.updateBudgetLine).not.toHaveBeenCalled()

    fireEvent.blur(caja)
    await waitFor(() => expect(api.updateBudgetLine).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.updateBudgetLine).mock.calls[0].slice(1)).toEqual([1, { unitPrice: 1500 }, undefined])
  })

  it('vaciar el nombre de una partida no lo manda: se revierte a lo guardado', async () => {
    // `name` y `unit` son NOT NULL con CHECK (<> '') en la 032. Ahí un vacío no
    // es un vaciado sino un renglón roto, y el servidor solo rechaza el null —
    // una cadena vacía llegaría hasta el CHECK. No contradice la regla de las
    // celdas de dinero: en el comprometido el vacío ES el mensaje, y aquí no hay
    // ningún mensaje que mandar porque el campo no tiene estado vacío.
    const b = budget([line({ id: 1, name: 'Muro de block', unit: 'm²' }), holgura(0)])
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
    const b = budget([line({ id: 1, name: 'Muro de block', unit: 'm²' }), holgura(0)])
    await renderPanel(b)
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))
    vi.mocked(api.updateBudgetLine).mockResolvedValue({
      line: null, budget: b, property: propiedad() as Property,
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
      holgura(0),
    ]))
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))

    const fila = () => screen.getByLabelText('Partida Muro de block').closest('tr')!
    expect(within(fila()).getByText('$10,000')).not.toBeNull()

    fireEvent.change(screen.getByLabelText('Cantidad de Muro de block'), { target: { value: '25' } })
    expect(within(fila()).getByText('$25,000')).not.toBeNull()
  })

  it('agregar una partida SUBE el total en su importe: nada la absorbe', async () => {
    // La regla nueva, y la vieja al revés. Antes «Otros» bajaba lo que subiera
    // el detalle y el total no se enteraba; hoy el total es la suma de sus
    // renglones, así que una partida de $45,000 lo sube $45,000 y ese
    // movimiento ES el hallazgo. Se pinta la respuesta del servidor y no un
    // append local: la tabla y `constructionBudgeted` vienen del mismo JSON.
    const onChange = await renderPanel(DETALLADO)
    const despues = budget([
      ...DETALLADO.lines,
      line({ id: 4, chapterName: 'Albañilería', name: 'Partida nueva', quantity: 1, unitPrice: 45_000, budgetedAmount: 45_000 }),
    ])
    vi.mocked(api.createBudgetLine).mockResolvedValue({
      line: null, budget: despues,
      property: { ...propiedad({ constructionBudgeted: 1_045_000 }), name: 'refrescada' } as Property,
    })

    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))
    fireEvent.click(screen.getByText('+ PARTIDA EN ALBAÑILERÍA'))

    await waitFor(() => expect(api.createBudgetLine).toHaveBeenCalled())
    expect(vi.mocked(api.createBudgetLine).mock.calls[0][1]).toEqual({
      chapterName: 'Albañilería', name: 'Partida nueva',
    })
    // La holgura NO se movió: nadie la reparte
    expect(within(chapterRow('Otros')).getByText('$900,000')).not.toBeNull()
    // Y el capítulo que recibió la partida subió su importe exacto
    expect(within(chapterRow('Albañilería')).getByText('$85,000')).not.toBeNull()
    // El total del pie es de la PROPIEDAD, y sube porque la respuesta lo trae
    // así: $1,000,000 + $45,000. Es la ficha la que lo vuelve a bajar aquí, con
    // la propiedad recalculada que llegó en la misma transacción.
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0]).toMatchObject({
      name: 'refrescada', constructionBudgeted: 1_045_000,
    })
  })

  it('agregar una partida no avisa nada: ya no existe «el detalle rebasó el estimado»', async () => {
    // El aviso decía cuánto había rebasado el detalle al residuo, y era la única
    // forma en que el total podía moverse cuando detallar no lo movía. Esa
    // condición ya no puede ocurrir —toda escritura mueve el total su propio
    // importe— así que el texto sería falso en cada renglón que se agregue.
    await renderPanel(DETALLADO)
    vi.mocked(api.createBudgetLine).mockResolvedValue({
      line: null, budget: budget([...DETALLADO.lines, line({ id: 4, name: 'Extra', budgetedAmount: 120_000 })]),
      property: propiedad({ constructionBudgeted: 1_120_000 }) as Property,
    })

    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))
    fireEvent.click(screen.getByText('+ PARTIDA EN ALBAÑILERÍA'))

    await waitFor(() => expect(api.createBudgetLine).toHaveBeenCalled())
    expect(screen.queryByText(/rebasó/)).toBeNull()
    expect(screen.queryByText(/el presupuesto de obra subió/)).toBeNull()
  })

  it('el oficio del renglón sugiere, pero ningún proveedor queda fuera', async () => {
    // El oficio FILTRA y nunca restringe: el día que el plomero haga albañilería
    // tiene que poder capturarse. Y filtra por ID, que es el cambio: antes
    // comparaba el nombre del capítulo contra el de la categoría del proveedor
    // —dos vocabularios que solo coincidían por casualidad— y con cero
    // categorías dadas de alta el grupo salía siempre vacío sin decirlo.
    await renderPanel(budget([
      line({ id: 1, name: 'Muro de block', supplierCategoryId: 7 }),
      holgura(0),
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
    const b = budget([line({ id: 1, name: 'Muro de block' }), holgura(0)])
    await renderPanel(b)
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))
    vi.mocked(api.updateBudgetLine).mockResolvedValue({
      line: null, budget: b, property: propiedad() as Property,
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
      holgura(0),
    ]))
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))

    const selector = screen.getByLabelText('Proveedor de Muro de block') as HTMLSelectElement
    expect(selector.value).toBe('13')
    expect(within(selector).getAllByRole('option').map(o => o.textContent))
      .toContain('El Que Nos Falló')
  })

  it('quitar el proveedor manda null: en una celda, la caja vacía SÍ vacía', async () => {
    const b = budget([line({ id: 1, name: 'Muro de block', supplierId: 11 }), holgura(0)])
    await renderPanel(b)
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))
    vi.mocked(api.updateBudgetLine).mockResolvedValue({
      line: null, budget: b, property: propiedad() as Property,
    })

    fireEvent.change(screen.getByLabelText('Proveedor de Muro de block'), { target: { value: '' } })

    await waitFor(() => expect(api.updateBudgetLine).toHaveBeenCalled())
    expect(vi.mocked(api.updateBudgetLine).mock.calls[0][2]).toEqual({ supplierId: null })
  })

  it('los dos $/m² se enseñan ROTULADOS: tu estimado contra el presupuesto', async () => {
    // Son dos cifras de dos preguntas distintas —«a cuánto supuse el m²» y «a
    // cuánto va el m² con lo que llevo capturado»— y hasta el 2026-08-30
    // compartían el nombre `constructionCostPerSqm` y se enseñaban sin rótulo en
    // dos pantallas, que es como se leían como una sola que a veces cambiaba
    // sola. Los números del caso real: $50,000 supuestos contra $4,850
    // presupuestados. Separarse ES el dato, así que ninguno se esconde ni se
    // pinta como error.
    await renderPanel(DETALLADO, propiedad({
      constructionCostPerSqm: 50_000, budgetedCostPerSqm: 4_850,
    }))

    const total = screen.getByText('TOTAL · ES EL COSTO DE OBRA').closest('tr')!
    expect(within(total).getByText('TU ESTIMADO')).not.toBeNull()
    expect(within(total).getByText('$50,000/m²')).not.toBeNull()
    expect(within(total).getByText('· EL PRESUPUESTO')).not.toBeNull()
    expect(within(total).getByText('$4,850/m²')).not.toBeNull()
    // Y se dice de dónde sale cada uno, para que la distancia se lea como dato
    expect(within(total).getByText(/Tu estimado se captura en la ficha/)).not.toBeNull()
  })

  it('sin supuesto capturado el derivado se enseña igual, y el que falta es «—»', async () => {
    // El 40% de las propiedades reales no tiene el supuesto tecleado. Enseñar
    // ahí el derivado bajo el rótulo «tu estimado» lo convertiría en el fallback
    // del que falta, que es exactamente lo que hace deshonesta la comparación.
    await renderPanel(DETALLADO, propiedad({
      constructionCostPerSqm: null, budgetedCostPerSqm: 4_850,
    }))

    const total = screen.getByText('TOTAL · ES EL COSTO DE OBRA').closest('tr')!
    expect(within(total).getByText('—')).not.toBeNull()
    expect(within(total).getByText('$4,850/m²')).not.toBeNull()
  })

  it('un presupuesto VACÍO es un estado legítimo: $0 de verdad, no un faltante', async () => {
    // Es la primera vez que `constructionBudgeted = 0` es legal —`_require_budget`
    // ya no siembra un renglón fantasma— y 0 es un número, no un dato que falte:
    // ni «—», ni «cargando», ni una tabla en blanco.
    await renderPanel(budget([]), propiedad({
      constructionBudgeted: 0, constructionCostPerSqm: 8_000, budgetedCostPerSqm: 0,
    }))

    const total = screen.getByText('TOTAL · ES EL COSTO DE OBRA').closest('tr')!
    expect(within(total).getByText('$0')).not.toBeNull()
    expect(within(total).getByText('$0/m²')).not.toBeNull()
    expect(within(total).getByText('$8,000/m²')).not.toBeNull()
    expect(screen.queryByText('Cargando…')).toBeNull()
    // Y desde el vacío se sigue pudiendo capturar: el + CAPÍTULO no depende de
    // que ya haya algo.
    expect(screen.getByText('+ CAPÍTULO')).not.toBeNull()
  })

  it('sin ninguno de los dos $/m² no se inventa un renglón de comparación', async () => {
    await renderPanel(DETALLADO, propiedad({
      constructionCostPerSqm: null, budgetedCostPerSqm: null,
    }))

    expect(screen.queryByText('TU ESTIMADO')).toBeNull()
    expect(screen.queryByText('· EL PRESUPUESTO')).toBeNull()
  })

  it('no hay AJUSTAR: el total no se fija por fuera, se mueve moviendo renglones', async () => {
    // Fijar el total desde afuera era la otra mitad de la absorción: alguien
    // decía «que sean $1.5M» y «Otros» cargaba con la diferencia. Sin residuo no
    // hay dónde alojar esa resta, y con el total = suma no hay nada que fijar.
    await renderPanel(DETALLADO)

    expect(screen.queryByText('AJUSTAR')).toBeNull()
    expect(screen.queryByText('FIJAR TOTAL')).toBeNull()
    expect(screen.queryByLabelText('Nuevo total de obra')).toBeNull()
  })

  it('el rechazo del servidor se lee tal como lo escribió', async () => {
    // Las frases del servidor están escritas para quien las va a corregir, así
    // que se enseñan enteras en vez de un «error al guardar».
    const b = budget([line({ id: 1, name: 'Muro de block' }), holgura(0)])
    await renderPanel(b)
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))
    vi.mocked(api.updateBudgetLine).mockRejectedValue(
      new Error('La cantidad no puede ser negativa: un renglón de obra no se descuenta.'),
    )

    const caja = screen.getByLabelText('Cantidad de Muro de block')
    fireEvent.change(caja, { target: { value: '-5' } })
    fireEvent.blur(caja)

    expect(await screen.findByText(/un renglón de obra no se descuenta/)).not.toBeNull()
  })

  it('los pagos se agregan y se borran; nunca se corrigen en su lugar', async () => {
    const conPago = line({
      id: 1, name: 'Muro de block', budgetedAmount: 10_000,
      paidAmount: 4_000, paidVariance: -6_000,
      payments: [{ id: 55, amount: 4_000, paidOn: '2026-05-01', notes: 'anticipo', createdAt: '' }],
    })
    const b = budget([conPago, holgura(0)])
    await renderPanel(b)
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))
    fireEvent.click(screen.getByLabelText('Pagos de Muro de block'))

    expect(screen.getByText('anticipo')).not.toBeNull()
    // No hay forma de editar el monto de un pago: solo borrarlo y volver a ponerlo
    expect(screen.getByLabelText('Borrar pago de $4,000')).not.toBeNull()

    vi.mocked(api.addBudgetPayment).mockResolvedValue({
      line: null, budget: b, property: propiedad() as Property,
    })
    fireEvent.change(screen.getByLabelText('Monto del pago'), { target: { value: '6000' } })
    fireEvent.change(screen.getByLabelText('Fecha del pago'), { target: { value: '2026-06-15' } })
    fireEvent.click(screen.getByText('AGREGAR PAGO'))

    await waitFor(() => expect(api.addBudgetPayment).toHaveBeenCalledWith(
      7, 1, { amount: 6_000, paidOn: '2026-06-15' }, undefined,
    ))
  })

  // ── Arrancar desde otra obra ───────────────────────────────────────────────

  it('arrancar desde otra obra copia sus renglones por su id de presupuesto', async () => {
    // Lo que viaja es el id del PRESUPUESTO de la obra origen, no el de la obra.
    await renderPanel(DETALLADO)
    fireEvent.click(screen.getByText(/COPIAR DE OTRO PRESUPUESTO/))
    const selector = await screen.findByLabelText('Presupuesto de origen')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.applyBudgetSource).mockResolvedValue({
      line: null, budget: DETALLADO, property: propiedad() as Property,
    })

    // Una sola clase de origen: la lista va PLANA, sin encabezados de sección
    // que no separarían de nada.
    expect(within(selector).queryAllByRole('group')).toHaveLength(0)
    expect(within(selector).getByRole('option', { name: /Zaragoza 100/ })).not.toBeNull()
    expect(within(selector).getByRole('option', { name: /Modesto 415/ })).not.toBeNull()

    fireEvent.change(selector, { target: { value: '500' } })
    fireEvent.click(screen.getByText('COPIAR RENGLONES'))
    await waitFor(() => expect(api.applyBudgetSource).toHaveBeenCalledWith(7, 500, null, false, undefined))

    // Y otra obra es la misma llamada con otro id
    fireEvent.change(screen.getByLabelText('Presupuesto de origen'), { target: { value: '501' } })
    fireEvent.click(screen.getByText('COPIAR RENGLONES'))
    await waitFor(() => expect(api.applyBudgetSource).toHaveBeenCalledWith(7, 501, null, false, undefined))

    // Y se dice que SUMAN, que es lo que ahora pasa de verdad: no hay residuo
    // que reparta nada, así que lo copiado se ve en el total.
    expect(screen.getByText(/el total sube en lo que sumen/)).not.toBeNull()
  })

  it('la obra que pregunta se excluye del servidor, no filtrando aquí', async () => {
    // `apply` rechaza copiarse sobre sí mismo con un 422, y ofrecer una opción
    // que solo puede dar error es hacer que alguien descubra la regla chocando.
    await renderPanel(DETALLADO)
    fireEvent.click(screen.getByText(/COPIAR DE OTRO PRESUPUESTO/))
    await screen.findByLabelText('Presupuesto de origen')

    expect(api.fetchBudgetSources).toHaveBeenCalledWith(9)
  })

  it('sin nada de dónde copiar lo dice, en vez de dejar un selector vacío', async () => {
    // Una obra sin partidas detalladas no aparece en la lista y eso no es un
    // defecto: no tiene nada que dar. El vacío de un selector se lee como roto.
    vi.mocked(api.fetchBudgetSources).mockResolvedValue([])
    await renderPanel(DETALLADO)
    fireEvent.click(screen.getByText(/COPIAR DE OTRO PRESUPUESTO/))

    expect(await screen.findByText(/Todavía no hay de dónde copiar/)).not.toBeNull()
  })

  it('copiar un presupuesto se confirma: es una escritura en masa que no se ve', async () => {
    // NO se confirma porque duplique: el servidor compara (capítulo, nombre)
    // normalizados y salta los que ya están, así que copiar dos veces deja el
    // presupuesto igual. Se confirma porque mete decenas de renglones de un
    // clic y caen dentro de capítulos colapsados: el efecto no está en
    // pantalla, y una escritura así no se dispara de un dedazo.
    await renderPanel(DETALLADO)
    fireEvent.click(screen.getByText(/COPIAR DE OTRO PRESUPUESTO/))
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
    fireEvent.click(screen.getByText(/COPIAR DE OTRO PRESUPUESTO/))
    await screen.findByLabelText('Presupuesto de origen')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.applyBudgetSource).mockResolvedValue({
      line: null, budget: DETALLADO, property: propiedad() as Property,
      linesAdded: 18,
    })

    fireEvent.change(screen.getByLabelText('Presupuesto de origen'), { target: { value: '500' } })
    fireEvent.click(screen.getByText('COPIAR RENGLONES'))

    expect(await screen.findByText(/Se copiaron 18 renglones/)).not.toBeNull()
  })

  // ── Copiar a otras obras (la dirección contraria: empujar) ─────────────────

  /** Abre el bloque de empujar y espera a que lleguen las obras destino. */
  async function abrirEmpujar(targets: BudgetSource[] = DESTINOS) {
    vi.mocked(api.fetchBudgetSources).mockResolvedValue(targets)
    fireEvent.click(screen.getByText(/COPIAR A OTROS PRESUPUESTOS/))
    await screen.findByLabelText(`Copiar a ${targets[0].name}`)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  }

  /** Lo que contesta `apply` en el DESTINO: lo que entró y lo que ya estaba. */
  const copiado = (added: number, skipped: number) => ({
    line: null, budget: DETALLADO, property: propiedad() as Property,
    linesAdded: added, linesSkipped: skipped,
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
    // Todos los capítulos vienen marcados —los TRES, que hoy incluye el de la
    // holgura— y se desmarcan dos para copiar el que queda.
    fireEvent.click(screen.getByLabelText('Copiar capítulo Instalaciones'))
    fireEvent.click(screen.getByLabelText('Copiar capítulo Otros'))
    fireEvent.click(screen.getByText('COPIAR A ESTAS OBRAS'))

    await waitFor(() => expect(api.applyBudgetSource).toHaveBeenCalledTimes(2))
    // El id de la URL es el DESTINO y el `budgetId` el del presupuesto de ESTA
    // obra: la misma llamada de «arrancar desde», al revés.
    expect(vi.mocked(api.applyBudgetSource).mock.calls).toEqual([
      [3, 9, ['Albañilería'], false, undefined],
      [4, 9, ['Albañilería'], false, undefined],
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

    await waitFor(() => expect(api.applyBudgetSource).toHaveBeenCalledWith(3, 9, null, false, undefined))
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

  it('este presupuesto se excluye en el servidor, y TODOS sus capítulos se ofrecen', async () => {
    // Copiarse sobre sí mismo da 422, y ofrecer una opción que solo puede fallar
    // es hacer que alguien descubra la regla chocando con ella. La exclusión es
    // por id de PRESUPUESTO (así los escenarios de esta obra sí aparecen), y
    // `includeEmpty`: a un presupuesto vacío sí se le puede copiar.
    //
    // El capítulo de la holgura SÍ se ofrece, y ése es el cambio: era el único
    // que se quedaba —el servidor nunca copiaba el residuo— y hoy viaja como
    // cualquier otro, porque ya no hay nada que lo distinga.
    await renderPanel(DETALLADO)
    await abrirEmpujar()

    expect(api.fetchBudgetSources).toHaveBeenCalledWith(9, true)
    expect(screen.getByLabelText('Copiar capítulo Albañilería')).not.toBeNull()
    expect(screen.getByLabelText('Copiar capítulo Instalaciones')).not.toBeNull()
    expect(screen.getByLabelText('Copiar capítulo Otros')).not.toBeNull()
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
    fireEvent.click(screen.getByLabelText('Copiar capítulo Otros'))
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
    holgura(900_000),
  ])

  it('la casilla PROPORCIONAL vive en la tabla, no en el popup, y guarda al marcarse', async () => {
    // Escondida en el popup de copiar nunca se capturaría hasta que ya se lleva
    // prisa, y ahí se marca todo de corrido. En la tabla se contesta el día que
    // se teclea la partida, que es cuando se sabe.
    await renderPanel(CON_FIJA)
    vi.mocked(api.updateBudgetLine).mockResolvedValue({
      line: null, budget: CON_FIJA, property: propiedad() as Property,
    })
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))
    fireEvent.click(screen.getByLabelText('Abrir Permisos'))

    expect((screen.getByLabelText('Proporcional Muro de block') as HTMLInputElement).checked)
      .toBe(true)
    const fija = screen.getByLabelText('Proporcional Licencia de construcción') as HTMLInputElement
    expect(fija.checked).toBe(false)
    // Y la holgura lleva su casilla como todas: es un renglón ordinario, no un
    // renglón que escala «siempre» porque una regla del servidor lo diga.
    fireEvent.click(screen.getByLabelText('Abrir Otros'))
    expect((screen.getByLabelText('Proporcional Otros, por detallar') as HTMLInputElement).checked)
      .toBe(true)

    // Un cambio ES un cambio: guarda al marcarse, como el oficio y el proveedor.
    fireEvent.click(fija)
    await waitFor(() => expect(api.updateBudgetLine).toHaveBeenCalled())
    expect(vi.mocked(api.updateBudgetLine).mock.calls[0].slice(1))
      .toEqual([2, { isProportional: true }, undefined])
  })

  /** Abre «copiar de otra obra» y pide la copia PROPORCIONAL. */
  async function abrirProporcional() {
    fireEvent.click(screen.getByText(/COPIAR DE OTRO PRESUPUESTO/))
    await screen.findByLabelText('Presupuesto de origen')
    fireEvent.click(screen.getByLabelText('Copia proporcional de otra obra'))
  }

  /**
   * Un renglón COMO LLEGA DE ANTES: sin el campo `isProportional`. El default de
   * la base es TRUE, así que su ausencia significa «sí escala» — y preguntarlo
   * por falsedad lo convertía en fijo, que es justo lo contrario.
   */
  const sinCampo = (over: Partial<BudgetLine>): BudgetLine => {
    const { isProportional: _ausente, ...resto } = line(over)
    return resto as BudgetLine
  }

  it('un renglón SIN el campo proporcional escala: la ausencia es su default, no su opuesto', async () => {
    // Pasó de verdad: con los renglones viejos en memoria, las 8 partidas se
    // contaron como fijas por `!l.isProportional` y el copiado se bloqueó con
    // «las fijas suman lo mismo que el objetivo» sin una sola marcada en la base.
    const VIEJO = budget([
      sinCampo({ id: 1, chapterName: 'Albañilería', name: 'Muro de block', budgetedAmount: 10_000 }),
      sinCampo({ id: 2, chapterName: 'Albañilería', name: 'Firme', budgetedAmount: 30_000 }),
      holgura(960_000),
    ])
    vi.mocked(api.fetchProperties).mockResolvedValue([
      { id: 3, name: 'Modesto 415', constructionBudgeted: 2_000_000 },
    ] as Property[])
    await renderPanel(VIEJO)

    // En la tabla la casilla sale MARCADA, no en blanco ni sin controlar
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))
    expect((screen.getByLabelText('Proporcional Muro de block') as HTMLInputElement).checked)
      .toBe(true)

    await abrirEmpujar()
    fireEvent.click(screen.getByLabelText('Copia proporcional a otras obras'))
    fireEvent.click(screen.getByLabelText('Copiar a Modesto 415'))

    // Nada es fijo: F = $0, S = $1,000,000, T = $2,000,000 → ×2.00
    expect(screen.getByText(/TODO ESCALA · EL RESTO ×2\.00/)).not.toBeNull()
    expect(screen.queryByText(/las partidas fijas suman/)).toBeNull()
    expect(screen.queryByText(/se quedan fuera/)).toBeNull()
  })

  it('el objetivo se LEE del destino y se muestra en solo lectura: no hay nada que teclear', async () => {
    // El costo de obra de una propiedad ya está capturado —es la SUMA de los
    // renglones de su presupuesto— y volver a preguntarlo aquí dejaba copiar
    // dimensionado a un número que esa obra nunca dijo costar.
    //
    // Aquí se enseñaba además «275 m² × $3,500/m² = $962,500». Esa igualdad
    // dejó de ser cierta el día que el total pasó a ser la suma: ni el metraje
    // ni el supuesto de $/m² lo determinan ya, así que la descomposición se fue.
    await renderPanel(DETALLADO, propiedad({
      constructionBudgeted: 962_500, constructionCostPerSqm: 3_500, budgetedCostPerSqm: 3_500,
    }))
    await abrirProporcional()

    // El objetivo es el MISMO número que el total de la tabla, a secas
    const renglon = screen.getByText('COSTO DE OBRA').closest('div')!
    expect(within(renglon).getByText('$962,500')).not.toBeNull()
    expect(screen.queryByText(/275 m² ×/)).toBeNull()
    // Y ni una caja: ni la del $/m² ni la del metraje
    expect(screen.queryByLabelText(/Costo por m²/)).toBeNull()
    expect(screen.queryByLabelText(/Metraje de construcción/)).toBeNull()
    expect(screen.queryByText(/SE GUARDA EN SU FICHA/)).toBeNull()
  })

  it('el preview aparta las partidas fijas del monto que escala', async () => {
    // Sin apartarlas el factor prometería que TODO el presupuesto se mueve
    // —×3.00— cuando la licencia entra con sus $90,000 de siempre y el resto
    // carga con la diferencia: ×3.20.
    await renderPanel(DETALLADO, propiedad({ constructionBudgeted: 3_000_000 }))
    // Y las lee del ORIGEN, no de esta obra: lo que se va a copiar es aquello.
    vi.mocked(api.fetchBudget).mockImplementation(async id => (id === 4 ? CON_FIJA : DETALLADO))
    await abrirProporcional()
    fireEvent.change(screen.getByLabelText('Presupuesto de origen'), { target: { value: '500' } })

    // F = $90,000 · S + R = $910,000 · factor = (3,000,000 − 90,000) / 910,000
    expect(await screen.findByText(/NO ESCALAN \$90,000 · EL RESTO ×3\.20/)).not.toBeNull()
  })

  it('una obra sin costo de obra no se puede copiar proporcional, y se manda a su ficha', async () => {
    // El objetivo ya no se puede capturar aquí, así que el bloqueo señala el
    // único lugar donde ese dato existe: la ficha de esa obra, con su metraje y
    // su $/m². Nada se escribe desde el popup.
    await renderPanel(DETALLADO, propiedad({ constructionBudgeted: 0 }))
    await abrirProporcional()
    fireEvent.change(screen.getByLabelText('Presupuesto de origen'), { target: { value: '500' } })

    expect(await screen.findByText(/todavía no tiene costo de obra: se captura renglón por renglón/))
      .not.toBeNull()
    fireEvent.click(screen.getByText('COPIAR RENGLONES'))
    await waitFor(() => expect(api.applyBudgetSource).not.toHaveBeenCalled())
    expect(api.updateProperty).not.toHaveBeenCalled()
  })

  it('en proporcional viaja el MODO y nada más: ni el objetivo ni el factor', async () => {
    // El objetivo lo lee el servidor del presupuesto del destino, y el factor lo
    // calcula él: mandados desde aquí, la garantía de que la suma dé exactamente
    // el objetivo sería imposible de verificar del lado que la sostiene.
    await renderPanel(DETALLADO, propiedad({ constructionBudgeted: 3_000_000 }))
    await abrirProporcional()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.applyBudgetSource).mockResolvedValue({
      line: null, budget: DETALLADO, property: propiedad() as Property,
      linesAdded: 18,
    })

    fireEvent.change(screen.getByLabelText('Presupuesto de origen'), { target: { value: '500' } })
    fireEvent.click(screen.getByText('COPIAR RENGLONES'))

    await waitFor(() => expect(api.applyBudgetSource).toHaveBeenCalledWith(7, 500, null, true, undefined))
    // Y no se escribe la ficha de nadie antes de copiar: no hay nada que guardar
    expect(api.updateProperty).not.toHaveBeenCalled()
  })

  it('en PUSH cada obra entra a SU propio costo de obra, y una bloqueada no frena a las demás', async () => {
    // Dos obras del mismo tamaño pueden construirse a niveles de costo
    // distintos: el objetivo es de cada una, leído de su propio presupuesto.
    await renderPanel(CON_FIJA)
    await abrirEmpujar([
      destino({ total: 2_400_000 }),
      destino({ id: 400, name: 'Zaragoza 100', propertyId: 4, total: 0 }),
    ])
    fireEvent.click(screen.getByLabelText('Copia proporcional a otras obras'))
    vi.mocked(api.applyBudgetSource).mockResolvedValue(copiado(2, 0))

    fireEvent.click(screen.getByLabelText('Copiar a Modesto 415'))
    fireEvent.click(screen.getByLabelText('Copiar a Zaragoza 100'))

    // T de Modesto es SU costo de obra —la suma de sus renglones, a secas— y el
    // preview aparta las fijas del origen
    expect(screen.getByText('$2,400,000')).not.toBeNull()
    expect(screen.getByText(/NO ESCALAN \$90,000/)).not.toBeNull()
    // Zaragoza queda bloqueada con el motivo a la vista, no en silencio
    expect(screen.getByText(/todavía no tiene costo de obra/)).not.toBeNull()
    expect(screen.getByText(/1 de las elegidas se quedan fuera/)).not.toBeNull()

    fireEvent.click(screen.getByText('COPIAR A ESTAS OBRAS'))

    await waitFor(() => expect(api.applyBudgetSource).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.applyBudgetSource).mock.calls[0]).toEqual([3, 9, null, true, undefined])
    // Ninguna ficha se escribe antes de copiar: el objetivo ya estaba capturado
    expect(api.updateProperty).not.toHaveBeenCalled()
    expect(await screen.findByText(/Modesto 415: 2 renglones agregados/)).not.toBeNull()
    // Y la que no entró se dice por su nombre, junto a las que sí
    expect(await screen.findByText(/Zaragoza 100: no se copió — esa obra todavía no tiene costo de obra/))
      .not.toBeNull()
  })

  it('una obra que falla en proporcional no cancela a las siguientes', async () => {
    // El aislamiento por destino es el mismo de siempre: cada obra es una
    // llamada, y el rechazo del servidor se lee junto al nombre de la suya.
    await renderPanel(CON_FIJA)
    await abrirEmpujar([
      destino({ total: 2_400_000 }),
      destino({ id: 400, name: 'Zaragoza 100', propertyId: 4, total: 3_000_000 }),
    ])
    fireEvent.click(screen.getByLabelText('Copia proporcional a otras obras'))
    vi.mocked(api.applyBudgetSource)
      .mockRejectedValueOnce(new Error('El presupuesto de destino está cerrado.'))
      .mockResolvedValueOnce(copiado(2, 0))

    fireEvent.click(screen.getByLabelText('Copiar a Modesto 415'))
    fireEvent.click(screen.getByLabelText('Copiar a Zaragoza 100'))
    fireEvent.click(screen.getByText('COPIAR A ESTAS OBRAS'))

    await waitFor(() => expect(api.applyBudgetSource).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.applyBudgetSource).mock.calls)
      .toEqual([[3, 9, null, true, undefined], [4, 9, null, true, undefined]])
    expect(await screen.findByText(/Modesto 415: no se copió — El presupuesto de destino está cerrado\./))
      .not.toBeNull()
    expect(await screen.findByText(/Zaragoza 100: 2 renglones agregados/)).not.toBeNull()
  })
})
