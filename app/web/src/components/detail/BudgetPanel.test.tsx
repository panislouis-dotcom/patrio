import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type {
  Budget, BudgetCatalogChapter, BudgetItemSuggestion, BudgetLine, BudgetTemplate, Property,
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
    createBudgetLine: vi.fn(),
    updateBudgetLine: vi.fn(),
    deleteBudgetLine: vi.fn(),
    setBudgetTotal: vi.fn(),
    renameBudgetChapter: vi.fn(),
    deleteBudgetChapter: vi.fn(),
    addBudgetPayment: vi.fn(),
    deleteBudgetPayment: vi.fn(),
    // Inerte por omisión: el aviso de duplicado no debe cambiar el resultado de
    // ninguna prueba que no vaya sobre él. Que sea así ES la propiedad que se
    // quiere —sugiere y no bloquea— y las pruebas la ejercen abajo.
    suggestBudgetItems: vi.fn(async () => []),
    fetchBudgetCatalog: vi.fn(async () => CATALOGO),
    fetchBudgetTemplates: vi.fn(async () => PLANTILLAS),
    applyCatalogChapter: vi.fn(),
    applyBudgetSource: vi.fn(),
    createBudgetTemplate: vi.fn(),
  }
})

const proveedor = (over: Partial<Proveedor>): Proveedor => ({
  id: 1, name: 'Genérico', phone: '', email: '', website: '', zona: '',
  status: 'activo', vetoReason: null,
  ratingCalidad: null, ratingPuntualidad: null, ratingPrecio: null,
  notes: '', categories: [], photos: [], createdAt: '', updatedAt: '', ...over,
})

const categoria = (name: string) => ({ id: 1, name, description: '', createdAt: '' })

/** El catálogo, para el panel de CATÁLOGO Y PLANTILLAS. */
const CATALOGO: BudgetCatalogChapter[] = [
  {
    id: 1, name: 'Acabados', sortOrder: 0, isActive: true,
    items: [
      { id: 11, chapterId: 1, name: 'Piso cerámico 60×60', unit: 'm²', sortOrder: 0, isActive: true, usedInLines: 4 },
      { id: 12, chapterId: 1, name: 'Pintura vinílica', unit: 'm²', sortOrder: 1, isActive: true, usedInLines: 1 },
    ],
  },
]

/** Una plantilla es un presupuesto sin propiedad: su id es un id de presupuesto. */
const PLANTILLAS: BudgetTemplate[] = [
  { id: 500, name: 'Remodelación casa antigua', notes: '', lineCount: 18, total: 1_800_000, createdAt: '', updatedAt: '' },
  { id: 501, name: 'Obra nueva', notes: '', lineCount: 22, total: 2_300_000, createdAt: '', updatedAt: '' },
]

const PROVEEDORES: Proveedor[] = [
  proveedor({ id: 11, name: 'Albañiles del Norte', categories: [categoria('Albañilería')] }),
  proveedor({ id: 12, name: 'Plomería Ruiz', categories: [categoria('Instalaciones')] }),
  proveedor({ id: 13, name: 'El Que Nos Falló', status: 'vetado', vetoReason: 'no volvió' }),
]

const line = (over: Partial<BudgetLine>): BudgetLine => ({
  id: 1, budgetId: 9, itemId: null, chapterName: 'Albañilería', name: 'Muro de block',
  unit: 'm²', quantity: 10, unitPrice: 1_000, budgetedAmount: 10_000,
  supplierId: null, committedAmount: null, committedOn: null, committedVariance: null,
  actualQuantity: null, paidAmount: null, paidVariance: null, payments: [],
  closedAt: null, sortOrder: 0, notes: '', isResidual: false,
  createdAt: '', updatedAt: '', ...over,
})

/** El renglón que la 028 le siembra a toda propiedad: el estimado grueso entero. */
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
  beforeEach(() => { vi.clearAllMocks() })

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
    // `name` y `unit` son NOT NULL con CHECK (<> '') en la 028. Ahí un vacío no
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

  it('el proveedor del capítulo se sugiere, pero ninguno queda fuera', async () => {
    // La categoría FILTRA y nunca restringe: el día que el plomero haga
    // albañilería tiene que poder capturarse.
    await renderPanel(DETALLADO)
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))

    const selector = screen.getByLabelText('Proveedor de Muro de block')
    const opciones = within(selector).getAllByRole('option').map(o => o.textContent)
    expect(opciones).toContain('Albañiles del Norte')
    expect(opciones).toContain('Plomería Ruiz')
    // El vetado sí queda fuera: eso es una restricción, y es la correcta
    expect(opciones).not.toContain('El Que Nos Falló')
    // Y el del capítulo va agrupado arriba
    expect(within(selector).getByRole('group', { name: 'Hacen albañilería' })).not.toBeNull()
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

  // ── El catálogo que aprende ───────────────────────────────────────────────

  it('adoptar la del catálogo copia el texto y la procedencia, y ningún importe', async () => {
    // Reconocer una partida no puede reescribir lo que ya se capturó: el
    // catálogo no guarda precio, y el que alguien acaba de teclear se queda.
    const b = budget([
      line({ id: 1, name: 'Piso ceramico', unit: 'm2', unitPrice: 1_200, quantity: 40 }),
      residual(0),
    ])
    await renderPanel(b)
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))
    vi.mocked(api.suggestBudgetItems).mockResolvedValue([{
      source: 'catalog', itemId: 11, chapterId: 1, chapterName: 'Acabados',
      name: 'Piso cerámico 60×60', unit: 'm²', similarity: 0.72, usedInLines: 4,
    } satisfies BudgetItemSuggestion])
    vi.mocked(api.updateBudgetLine).mockResolvedValue({
      line: null, budget: b, property: propiedad() as Property, budgetIncrease: 0,
    })

    fireEvent.change(screen.getByLabelText('Partida Piso ceramico'), {
      target: { value: 'Piso ceramico 60x60' },
    })
    fireEvent.click(await screen.findByText('USAR LA DEL CATÁLOGO'))

    await waitFor(() => expect(api.updateBudgetLine).toHaveBeenCalled())
    // El nombre, la unidad y la procedencia. Ni precio, ni cantidad, ni capítulo:
    // mover el renglón a otro capítulo reorganizaría la tabla debajo de quien
    // está capturando por haber contestado una pregunta.
    expect(vi.mocked(api.updateBudgetLine).mock.calls[0][2]).toEqual({
      name: 'Piso cerámico 60×60', unit: 'm²', itemId: 11,
    })
  })

  it('un renglón que ya viene del catálogo no vuelve a preguntar', async () => {
    await renderPanel(budget([
      line({ id: 1, name: 'Piso cerámico 60×60', itemId: 11 }),
      residual(0),
    ]))
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))

    fireEvent.change(screen.getByLabelText('Partida Piso cerámico 60×60'), {
      target: { value: 'Piso cerámico 60×60 rectificado' },
    })
    await new Promise(r => setTimeout(r, 320))

    expect(api.suggestBudgetItems).not.toHaveBeenCalled()
  })

  it('una partida dada de baja en el catálogo no rompe el renglón que la usó', async () => {
    // La otra mitad de la baja lógica, y la razón de que el borrado físico no
    // exista: apagar una partida la saca de la obra NUEVA, y los renglones que
    // ya la citan siguen enteros y editables, con su importe intacto.
    const b = budget([
      line({
        id: 1, name: 'Pintura vinílica', itemId: 12, unit: 'm²',
        quantity: 80, unitPrice: 150, budgetedAmount: 12_000,
      }),
      residual(0),
    ])
    // El catálogo ya no la ofrece
    vi.mocked(api.fetchBudgetCatalog).mockResolvedValue([
      { ...CATALOGO[0], items: [CATALOGO[0].items[0]] },
    ])
    await renderPanel(b)
    fireEvent.click(screen.getByLabelText('Abrir Albañilería'))

    const fila = screen.getByLabelText('Partida Pintura vinílica').closest('tr')!
    expect(within(fila).getByText('$12,000')).not.toBeNull()

    // Y se sigue capturando encima con toda normalidad
    vi.mocked(api.updateBudgetLine).mockResolvedValue({
      line: null, budget: b, property: propiedad() as Property, budgetIncrease: 0,
    })
    const caja = screen.getByLabelText('Precio unitario de Pintura vinílica')
    fireEvent.change(caja, { target: { value: '175' } })
    fireEvent.blur(caja)

    await waitFor(() => expect(api.updateBudgetLine).toHaveBeenCalledWith(7, 1, { unitPrice: 175 }))
  })

  it('bajar un capítulo del catálogo trae el esqueleto, sin mover un peso', async () => {
    const onChange = await renderPanel(DETALLADO)
    fireEvent.click(screen.getByText(/CATÁLOGO Y PLANTILLAS/))
    await screen.findByLabelText('Capítulo del catálogo')
    vi.mocked(api.applyCatalogChapter).mockResolvedValue({
      line: null, budget: DETALLADO, property: propiedad() as Property, budgetIncrease: 0,
    })

    fireEvent.change(screen.getByLabelText('Capítulo del catálogo'), { target: { value: '1' } })
    fireEvent.click(screen.getByText('BAJAR'))

    await waitFor(() => expect(api.applyCatalogChapter).toHaveBeenCalledWith(7, 1))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    // Se dice en pantalla, porque es lo que más sorprende
    expect(screen.getByText(/Nacen en cantidad 0 — el catálogo no guarda precio/)).not.toBeNull()
  })

  it('arrancar desde una plantilla copia sus renglones por su id de presupuesto', async () => {
    // El id de una plantilla ES un id de presupuesto: el mismo campo por el que
    // viajaría el de otra obra. El servidor no distingue las dos, y con razón.
    await renderPanel(DETALLADO)
    fireEvent.click(screen.getByText(/CATÁLOGO Y PLANTILLAS/))
    const selector = await screen.findByLabelText('Presupuesto de origen')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.applyBudgetSource).mockResolvedValue({
      line: null, budget: DETALLADO, property: propiedad() as Property, budgetIncrease: 0,
    })

    fireEvent.change(selector, { target: { value: '500' } })
    fireEvent.click(screen.getByText('COPIAR RENGLONES'))

    await waitFor(() => expect(api.applyBudgetSource).toHaveBeenCalledWith(7, 500))
    // Y se dice que reparten en vez de crecer, que es lo que hace el residuo
    expect(screen.getByText(/el residuo baja y el total no se mueve/)).not.toBeNull()
  })

  it('copiar un presupuesto se confirma, porque copiar dos veces duplica', async () => {
    // No es idempotente, al revés que bajar un capítulo del catálogo: dos
    // renglones con el mismo nombre pueden ser dos renglones legítimos y el
    // servidor no puede saber cuál es el caso. Lo sabe quien copia.
    await renderPanel(DETALLADO)
    fireEvent.click(screen.getByText(/CATÁLOGO Y PLANTILLAS/))
    const selector = await screen.findByLabelText('Presupuesto de origen')
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    fireEvent.change(selector, { target: { value: '500' } })
    fireEvent.click(screen.getByText('COPIAR RENGLONES'))

    expect(api.applyBudgetSource).not.toHaveBeenCalled()
    expect(vi.mocked(window.confirm).mock.calls[0][0])
      .toMatch(/los 18 renglones de «Remodelación casa antigua»/)
  })

  it('copiar dice cuántos renglones cayeron: no se ven, los capítulos están cerrados', async () => {
    await renderPanel(DETALLADO)
    fireEvent.click(screen.getByText(/CATÁLOGO Y PLANTILLAS/))
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

  it('bajar dos veces el mismo capítulo no duplica, y lo dice', async () => {
    // `apply-chapter` SÍ es idempotente: `item_id` da identidad exacta. Por eso
    // el botón se puede dejar siempre activo sin confirmación.
    await renderPanel(DETALLADO)
    fireEvent.click(screen.getByText(/CATÁLOGO Y PLANTILLAS/))
    await screen.findByLabelText('Capítulo del catálogo')
    vi.mocked(api.applyCatalogChapter).mockResolvedValue({
      line: null, budget: DETALLADO, property: propiedad() as Property,
      budgetIncrease: 0, linesAdded: 0,
    })

    fireEvent.change(screen.getByLabelText('Capítulo del catálogo'), { target: { value: '1' } })
    fireEvent.click(screen.getByText('BAJAR'))

    expect(await screen.findByText(/No había nada nuevo que copiar/)).not.toBeNull()
  })

  it('guardar como plantilla copia ESTE presupuesto y no toca la obra', async () => {
    const onChange = await renderPanel(DETALLADO)
    fireEvent.click(screen.getByText(/CATÁLOGO Y PLANTILLAS/))
    await screen.findByLabelText('Nombre de la plantilla')
    // El servidor contesta el DETALLE: `lines` es el ARREGLO de renglones y NO
    // trae `lineCount`. Fijarlo con la forma real es lo que impide que la
    // pantalla vuelva a leer el conteo de la lista en la respuesta de la
    // escritura — que se pinta «undefined renglones» sin que falle nada.
    vi.mocked(api.createBudgetTemplate).mockResolvedValue({
      id: 600, name: 'Obra nueva', notes: '', createdAt: '', updatedAt: '',
      lines: [line({ id: 1 }), line({ id: 2 }), line({ id: 3 })],
    })

    fireEvent.change(screen.getByLabelText('Nombre de la plantilla'), { target: { value: '  Obra nueva  ' } })
    fireEvent.click(screen.getByText('GUARDAR PLANTILLA'))

    // El id del PRESUPUESTO, que es lo que se copia
    await waitFor(() => expect(api.createBudgetTemplate).toHaveBeenCalledWith({
      name: 'Obra nueva', fromBudgetId: 9,
    }))
    expect(await screen.findByText(/Se guardó «Obra nueva» como plantilla, con 3 renglones/))
      .not.toBeNull()
    // Y la lista se vuelve a leer en vez de meterle dentro la respuesta del
    // detalle: son dos formas distintas de una plantilla.
    await waitFor(() => expect(api.fetchBudgetTemplates).toHaveBeenCalledTimes(2))
    // La obra de la que salió queda exactamente igual: nada que refrescar
    expect(onChange).not.toHaveBeenCalled()
  })
})
