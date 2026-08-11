import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Property } from '../lib/types'
import { emptyFloorGraph, type FloorPlanModel } from '../lib/floorplan/types'
import { PropertyDetailPage } from './PropertyDetailPage'
import * as api from '../lib/api'

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  CircleMarker: () => null,
  useMapEvents: () => null,
}))

vi.mock('../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    fetchProperty: vi.fn(),
    updateProperty: vi.fn(),
    deleteProperty: vi.fn(),
    clearPropertyFields: vi.fn(),
    transitionProperty: vi.fn(),
    fetchPropertyGeometry: vi.fn(async () => ({})),
    savePropertyGeometry: vi.fn(),
    fetchPropertyInvestors: vi.fn(async () => []),
    fetchInvestors: vi.fn(async () => []),
    fetchInstances: vi.fn(async () => []),
    fetchTeam: vi.fn(async () => []),
    // El presupuesto no tiene compuerta de etapa, pero su panel solo se monta
    // cuando alguien abre la pestaña.
    fetchBudget: vi.fn(async () => ({ id: 1, propertyId: 7, lines: [], chapters: [] })),
    getProveedores: vi.fn(async () => []),
    // Fuera de su ventana el servidor responde 422; la ficha lo absorbe.
    fetchPropertyProfit: vi.fn(async () => { throw new Error('fuera de ventana') }),
  }
})

const BASE_PROPERTY: Property = {
  id: 7, status: 'prospecto', name: 'Lote Contry',
  assetType: 'lote', strategyType: null,
  address: 'Contry 55', city: 'Monterrey', url: 'https://example.com',
  latitude: 25.63, longitude: -100.27, notes: 'buena zona', isFavorite: false,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  images: [], geometry: {}, milestones: {},
  sqmLand: 400, sqmConstruction: 250, purchasePrice: 3_000_000,
  acquisitionCostPct: 0.065, permitsCost: 150_000, subdivisionCost: 50_000,
  // Derivada, no capturada: 3,900,000 presupuestados ÷ 250 m² de obra.
  constructionCostPerSqm: 15_600,
  projectedSale: 9_000_000, holdMonths: 12,
  rentMonthlyProjected: 30_000, rentMonthlyActual: null,
  // Son DOS: el overhead se retiró del contrato con la fórmula que multiplicaba.
  assumptions: {
    acquisitionCostPct: { value: 0.065, source: 'captured' },
    holdMonths: { value: 12, source: 'captured' },
  },
  totalInvestment: 7_295_000,
  totalUnits: null, acquisitionDate: null, firstRentDate: null,
  valuationDate: null, currentValuation: null, saleDate: null, salePrice: null,
  acquisitionCosts: 195_000, acquisitionTotal: 3_195_000,
  // La obra es la suma del presupuesto. Nadie ha firmado ni pagado nada todavía,
  // y eso es null y no $0: un cero ahí se leería como un hecho.
  constructionBudgeted: 3_900_000,
  constructionCommitted: null, constructionPaid: null,
  constructionCommittedVariance: null, constructionPaidVariance: null,
  projectedProfit: 1_705_000, projectedRoi: 0.23, projectedRoiTotal: 0.23,
  capRate: 0.049, rentAnnual: 360_000,
  unrealizedGain: null, unrealizedGainPct: null, roi: null, holdMonthsActual: null,
  capRateActual: null, rentAnnualActual: null,
  realizedGain: null, realizedGainPct: null, realizedRoi: null,
  score: 78, issues: [],
}

/**
 * Comprada all-in: los 3,730,000 son el precio de compra con 0% de costos de
 * adquisición y nada de obra. Es la forma que toma una propiedad cuyo total se
 * tecleaba a mano — la misma cifra, dicha por su nombre — y por eso su desglose
 * suma exactamente la inversión con la que se dividen todas sus métricas.
 */
const RENTED: Property = {
  ...BASE_PROPERTY, status: 'en_renta', name: 'Casa Centro',
  totalUnits: 3, acquisitionDate: '2022-09-01', firstRentDate: '2023-09-01',
  valuationDate: '2026-04-01', currentValuation: 6_200_000,
  purchasePrice: 3_730_000, acquisitionCostPct: 0,
  permitsCost: 0, subdivisionCost: 0,
  // Sin metraje de obra no hay cociente que publicar: dividir entre cero no da
  // «$0/m²», no da nada.
  sqmConstruction: 0, constructionCostPerSqm: null,
  assumptions: {
    ...BASE_PROPERTY.assumptions,
    acquisitionCostPct: { value: 0, source: 'captured' },
  },
  acquisitionCosts: 0, acquisitionTotal: 3_730_000,
  constructionBudgeted: 0,
  totalInvestment: 3_730_000,
  projectedProfit: 5_270_000, projectedRoi: 1.4129, projectedRoiTotal: 1.4129,
  capRate: 0.0965,
  rentMonthlyActual: 34_000, capRateActual: 0.1094, rentAnnualActual: 408_000,
  unrealizedGain: 2_470_000, unrealizedGainPct: 0.6622, roi: 0.1385, holdMonthsActual: 47,
  score: null,
}

const SOLD: Property = {
  ...RENTED, status: 'vendida', name: 'Edificio Uno',
  saleDate: '2026-06-01', salePrice: 8_000_000,
  // La proyección y el desglose sobreviven a la venta: son el expediente contra
  // el que se lee el resultado. Lo que muere es la marca viva — una propiedad
  // vendida no tiene ganancia «no realizada»: la realizó.
  unrealizedGain: null, unrealizedGainPct: null, roi: null,
  realizedGain: 4_270_000, realizedGainPct: 1.1448, realizedRoi: 0.2251,
}

/**
 * Comprada de un tirón y sin modelar: lo único capturado es lo que costó
 * adquirirla. Todo lo derivado sale null, que es la respuesta honesta cuando
 * nadie proyectó nada.
 */
const ALL_IN: Property = {
  ...BASE_PROPERTY, status: 'desarrollo', name: 'Bodega Sur', score: null,
  totalUnits: 1, acquisitionDate: '2025-01-01',
  purchasePrice: 10_000_000, acquisitionCostPct: 0,
  permitsCost: 0, subdivisionCost: 0,
  sqmLand: null, sqmConstruction: 0, constructionCostPerSqm: null,
  assumptions: {
    ...BASE_PROPERTY.assumptions,
    acquisitionCostPct: { value: 0, source: 'captured' },
  },
  totalInvestment: 10_000_000,
  acquisitionCosts: 0, acquisitionTotal: 10_000_000,
  constructionBudgeted: 0,
  projectedSale: null, projectedProfit: null, projectedRoi: null, projectedRoiTotal: null,
  rentMonthlyProjected: null, capRate: null, rentAnnual: null,
}

async function renderPage(property: Property) {
  vi.mocked(api.fetchProperty).mockResolvedValue(property)
  vi.mocked(api.updateProperty).mockResolvedValue(property)
  vi.mocked(api.clearPropertyFields).mockResolvedValue({ ...property, rentMonthlyProjected: null })
  vi.mocked(api.transitionProperty).mockResolvedValue({ ...property, status: 'oferta' })
  render(
    <MemoryRouter initialEntries={[`/propiedades/${property.id}`]}>
      <Routes><Route path="/propiedades/:id" element={<PropertyDetailPage />} /></Routes>
    </MemoryRouter>,
  )
  await screen.findByText('DATOS')
}

describe('PropertyDetailPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('un prospecto muestra su score y su proyección, y ningún resultado de venta', async () => {
    await renderPage(BASE_PROPERTY)

    expect(screen.getByText('ROI PROY. ANUAL')).not.toBeNull()
    expect(screen.getByText('Score 78')).not.toBeNull()
    expect(screen.getByText('PROYECCIÓN')).not.toBeNull()
    // Lo realizado solo existe cuando hay una venta que reportar
    expect(screen.queryByText('GANANCIA REALIZADA')).toBeNull()
    // Antes de la oferta no hay capital que levantar
    expect(screen.queryByText('FINANZAS')).toBeNull()
  })

  it('con una sola pestaña no hay tira de tabs que elegir — el contenido se pinta directo', async () => {
    // Antes de la oferta GENERAL es la única opción, y una tira de tabs con un
    // solo botón no deja elegir nada: solo le resta espacio a la columna. La
    // tira aparece de nuevo en cuanto hay algo entre qué cambiar (FINANZAS).
    await renderPage(BASE_PROPERTY)
    expect(screen.queryByRole('button', { name: 'GENERAL' })).toBeNull()
    expect(screen.getByText('DATOS')).not.toBeNull()

    await renderPage(RENTED)
    expect(screen.getByRole('button', { name: 'GENERAL' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'FINANZAS' })).not.toBeNull()
  })

  it('una propiedad en renta muestra lo realizado sin esconder lo de antes', async () => {
    await renderPage(RENTED)

    expect(screen.getByText('ROI ANUAL')).not.toBeNull()
    expect(screen.getByText('GANANCIA NO REALIZADA')).not.toBeNull()
    // "En pasos de después ves todo lo de antes": la proyección sigue ahí
    expect(screen.getByText('PROYECCIÓN')).not.toBeNull()
    expect(screen.getByText('VENTA PROYECTADA')).not.toBeNull()
    // El score dejó de existir al comprar: no hay a quién ganarle
    expect(screen.queryByText(/^Score/)).toBeNull()
    // Y las herramientas de etapa ya abrieron
    expect(screen.getByText('FINANZAS')).not.toBeNull()
    expect(screen.getByText('TAREAS')).not.toBeNull()
  })

  it('solo una vendida muestra las métricas realizadas', async () => {
    await renderPage(SOLD)

    expect(screen.getByText('ROI REAL ANUAL')).not.toBeNull()
    expect(screen.getByText('GANANCIA REALIZADA')).not.toBeNull()
    // Y ya no ofrece a dónde avanzar: vendida es terminal
    expect(screen.queryByText('AVANZAR A ▸')).toBeNull()
    expect(screen.queryByText('ARCHIVAR')).toBeNull()
  })

  it('la ganancia se imprime entera: monto y porcentaje son la misma cifra', async () => {
    // 4,270,000 sobre 3,730,000 en 47 meses: +114.5% en total, +22.5% al año.
    // El anualizado y el total son dos hechos distintos y cada uno lleva su
    // nombre — «ROI» solo el anualizado. Pero el monto y su porcentaje son UNO,
    // y separarlos dejaba media pareja arriba y media veinte filas abajo, las
    // dos llamadas «ganancia realizada».
    await renderPage(SOLD)

    expect(screen.getByText('ROI REAL ANUAL')).not.toBeNull()
    expect(screen.getByText('+22.5%')).not.toBeNull()
    expect(screen.getByText('GANANCIA REALIZADA')).not.toBeNull()
    expect(screen.getByText('$4,270,000 +114.5%')).not.toBeNull()
    // Y ninguna de las dos mitades anda suelta por ahí bajo otro nombre.
    expect(screen.queryByText('$4,270,000')).toBeNull()
    expect(screen.queryByText('+114.5%')).toBeNull()
    expect(screen.queryByText('GANANCIA REALIZADA %')).toBeNull()
  })

  it('el ROI dice hasta qué fecha cuenta, y no repite la ganancia sin etiqueta', async () => {
    // El caption cargaba la ganancia en pesos, que ya la dice el segundo héroe
    // con su nombre: un número sin etiqueta se escapaba de la regla de «cada
    // cifra una vez» justamente por no tener etiqueta. Ahora califica al ROI —
    // el realizado cierra su reloj en la fecha de venta —, que es lo único para
    // lo que sirve un caption.
    await renderPage(SOLD)

    expect(screen.getByText('AL JUN 2026')).not.toBeNull()
    expect(screen.queryByText('$4,270,000')).toBeNull()
  })

  it('AVANZAR A ofrece solo los destinos que la etapa permite', async () => {
    await renderPage(BASE_PROPERTY)

    fireEvent.click(screen.getByText('AVANZAR A ▸'))
    expect(screen.getByText('OFERTA')).not.toBeNull()
    for (const forbidden of ['DESARROLLO', 'EN RENTA', 'VENDIDA']) {
      expect(screen.queryByText(forbidden)).toBeNull()
    }
    // Archivar existe, pero como acción aparte: no es avanzar
    expect(screen.getByText('ARCHIVAR')).not.toBeNull()
  })

  it('la transición manda los insumos de la etapa destino, no un PATCH', async () => {
    await renderPage(BASE_PROPERTY)

    fireEvent.click(screen.getByText('AVANZAR A ▸'))
    fireEvent.click(screen.getByText('OFERTA'))
    const modal = screen.getByText('PROSPECTO ▸ OFERTA').parentElement!
    // La venta proyectada ya está capturada, así que llega prellenada
    expect((within(modal).getByLabelText('VENTA PROYECTADA') as HTMLInputElement).value).toBe('9000000')

    fireEvent.click(within(modal).getByText('OFERTA ▸'))
    await waitFor(() => expect(api.transitionProperty).toHaveBeenCalled())
    const [id, body] = vi.mocked(api.transitionProperty).mock.calls[0]
    expect(id).toBe(7)
    expect(body.to).toBe('oferta')
    expect(body).toMatchObject({ projectedSale: 9_000_000 })
    expect(api.updateProperty).not.toHaveBeenCalled()
  })

  it('un PATCH nunca lleva status ni un null: la caja vacía revierte', async () => {
    await renderPage(BASE_PROPERTY)

    fireEvent.click(screen.getByText('EDITAR'))
    fireEvent.change(screen.getByLabelText('CIUDAD'), { target: { value: 'Saltillo' } })
    fireEvent.change(screen.getByLabelText('UNIDADES'), { target: { value: '4' } })
    // Vaciar la caja no es pedir que se borre el dato: es no tocarlo
    fireEvent.change(screen.getByLabelText('UNIDADES'), { target: { value: '' } })
    fireEvent.click(screen.getByText('GUARDAR ▸'))

    await waitFor(() => expect(api.updateProperty).toHaveBeenCalled())
    const payload = vi.mocked(api.updateProperty).mock.calls[0][1] as Record<string, unknown>
    expect(payload).toEqual({ city: 'Saltillo' })
    expect('status' in payload).toBe(false)
    expect(Object.values(payload).some(v => v === null)).toBe(false)
  })

  it('los supuestos se ven siempre y dicen si alguien los eligió', async () => {
    await renderPage({
      ...BASE_PROPERTY,
      assumptions: {
        acquisitionCostPct: { value: 0.065, source: 'default' },
        holdMonths: { value: 12, source: 'captured' },
      },
    })

    // Sin entrar a edición: eran invisibles y aun así cobraban.
    expect(screen.getByText('SUPUESTOS')).not.toBeNull()
    expect(screen.getByText('COSTOS ADQ. (%)')).not.toBeNull()
    expect(screen.getAllByText('SUPUESTO POR OMISIÓN')).toHaveLength(1)
    expect(screen.getAllByText('CAPTURADO')).toHaveLength(1)
    // Y el overhead no está entre ellos: dejó de mover dinero, así que dejó de
    // ser un supuesto. Un número que se puede editar sin que cambie un peso es
    // el defecto «NO SE USA» con otro nombre.
    expect(screen.queryByText('OVERHEAD DE OBRA')).toBeNull()
  })

  it('SUPUESTOS agrupa toda apuesta sobre el futuro, no solo las que el modelo rellena por default', async () => {
    // Renta estimada y venta proyectada son apuestas igual de reales que
    // costos adq. % y plazo proyectado — la diferencia es solo que estas dos
    // no tienen un default del modelo que las sostenga si nadie las captura.
    await renderPage(BASE_PROPERTY)
    const orden = document.body.textContent!
    const supuestos = orden.indexOf('SUPUESTOS')
    const proyeccion = orden.indexOf('PROYECCIÓN')
    expect(supuestos).toBeGreaterThan(-1)
    expect(proyeccion).toBeGreaterThan(supuestos)
    for (const campo of ['COSTOS ADQ. (%)', 'PLAZO PROYECTADO (MESES)', 'RENTA/MES ESTIMADA', 'VENTA PROYECTADA']) {
      const pos = orden.indexOf(campo)
      expect(pos, campo).toBeGreaterThan(supuestos)
      expect(pos, campo).toBeLessThan(proyeccion)
    }
  })

  it('CAP RATE PROY. se mudó a PROYECCIÓN: es un resultado, no un dato de la ficha', async () => {
    // Antes vivía en DATOS junto a hechos capturados; es 100% calculado, así
    // que se muda con las demás cifras que produce el modelo.
    await renderPage(BASE_PROPERTY)
    const orden = document.body.textContent!
    expect(orden.indexOf('CAP RATE PROY. S/ INVERSIÓN')).toBeGreaterThan(orden.indexOf('PROYECCIÓN'))
  })

  it('la ficha nunca ofrece capturar un total: la inversión es el desglose', async () => {
    // Había una fila para teclearla que, con el desglose completo, se anunciaba
    // a sí misma como «NO SE USA: MANDA EL DESGLOSE» — un campo cuya razón de
    // existir era avisar que no servía. Con un solo origen la pregunta muere.
    await renderPage(BASE_PROPERTY)

    expect(screen.getByText('SUMA DEL DESGLOSE')).not.toBeNull()
    // La fila INVERSIÓN y el total del DESGLOSE son la misma cifra por
    // construcción: 3,000,000 + 195,000 + 150,000 + 50,000 + 3,900,000.
    expect(screen.getAllByText('$7,295,000')).toHaveLength(2)

    fireEvent.click(screen.getByText('EDITAR'))
    expect(screen.queryByText('INVERSIÓN CAPTURADA')).toBeNull()
    // Ni siquiera en edición hay caja: la fila sigue siendo la suma, en lectura.
    expect(screen.queryByLabelText('INVERSIÓN')).toBeNull()
    expect(screen.getByText('$7,295,000')).not.toBeNull()
    expect(screen.getByText('SUMA DEL DESGLOSE')).not.toBeNull()
  })

  it('la renta cobrada se pide vacía: confirmar sin leer ya no borra la proyección', async () => {
    const inDevelopment: Property = {
      ...BASE_PROPERTY, status: 'desarrollo', totalUnits: 3,
      acquisitionDate: '2025-01-01', score: null,
      rentMonthlyProjected: 30_000, rentMonthlyActual: null,
    }
    await renderPage(inDevelopment)

    fireEvent.click(screen.getByText('AVANZAR A ▸'))
    fireEvent.click(screen.getByText('EN RENTA'))
    const modal = screen.getByText('DESARROLLO ▸ EN RENTA').parentElement!
    const rent = within(modal).getByLabelText('RENTA MENSUAL COBRADA') as HTMLInputElement
    expect(rent.value).toBe('')
    // La estimación se dice, para poder compararla — no para arrastrarla.
    expect(within(modal).getByText(/Se estimó \$30,000 al mes/)).not.toBeNull()
  })

  it('avanzar a desarrollo ya no pide la inversión: la enseña sumada', async () => {
    // Pedía el total a mano cuando el desglose estaba incompleto. Ahora no hay
    // desglose incompleto —lo que falta vale 0— así que la cifra se muestra ya
    // computada: avanzar sigue siendo una afirmación sobre números concretos,
    // pero ninguno de ellos se teclea dos veces.
    await renderPage({ ...BASE_PROPERTY, status: 'oferta' })

    fireEvent.click(screen.getByText('AVANZAR A ▸'))
    fireEvent.click(screen.getByText('DESARROLLO'))
    const modal = screen.getByText('OFERTA ▸ DESARROLLO').parentElement!

    expect(within(modal).queryByLabelText('INVERSIÓN TOTAL')).toBeNull()
    expect(within(modal).getByText('$7,295,000')).not.toBeNull()
    expect(within(modal).getByText(/suma del desglose/)).not.toBeNull()
    expect((within(modal).getByText('DESARROLLO ▸') as HTMLButtonElement).disabled).toBe(false)
  })

  it('sin precio de compra, avanzar a desarrollo lo pide ahí mismo', async () => {
    // El gate de la etapa exige el precio de compra: sin él no hay inversión que
    // sumar. Es el tercer hecho de la compra, junto a la fecha y las unidades, y
    // se captura con ellos — mandar a la ficha y de vuelta era el viaje que este
    // modal existe para ahorrar.
    await renderPage({
      ...BASE_PROPERTY, status: 'oferta', purchasePrice: null,
      acquisitionCosts: null, acquisitionTotal: null, totalInvestment: 3_900_000,
    })

    fireEvent.click(screen.getByText('AVANZAR A ▸'))
    fireEvent.click(screen.getByText('DESARROLLO'))
    const modal = screen.getByText('OFERTA ▸ DESARROLLO').parentElement!
    const confirmar = () => within(modal).getByText('DESARROLLO ▸') as HTMLButtonElement

    // La caja está y traba el portón mientras siga vacía.
    const caja = within(modal).getByLabelText('PRECIO DE COMPRA') as HTMLInputElement
    expect(caja.value).toBe('')
    expect(confirmar().disabled).toBe(true)

    // Con el precio tecleado el portón abre: lo que trababa era el insumo que
    // falta, no la cifra derivada que falta por él. El readout se calcula sobre
    // lo guardado, así que seguiría diciendo «falta» — trabar por él dejaría el
    // botón muerto con el formulario completo.
    fireEvent.change(caja, { target: { value: '3200000' } })
    expect(confirmar().disabled).toBe(false)
  })

  it('con precio de compra capturado, avanzar a desarrollo no lo vuelve a pedir', async () => {
    // Se pregunta solo en su ausencia. Prellenarlo y dejarlo editable haría que
    // la INVERSIÓN de abajo —calculada en el servidor sobre lo ya guardado—
    // quedara vieja en pantalla mientras alguien teclea encima.
    await renderPage({ ...BASE_PROPERTY, status: 'oferta', purchasePrice: 3_000_000 })

    fireEvent.click(screen.getByText('AVANZAR A ▸'))
    fireEvent.click(screen.getByText('DESARROLLO'))
    const modal = screen.getByText('OFERTA ▸ DESARROLLO').parentElement!

    expect(within(modal).queryByLabelText('PRECIO DE COMPRA')).toBeNull()
    expect((within(modal).getByText('DESARROLLO ▸') as HTMLButtonElement).disabled).toBe(false)
  })

  it('una propiedad rentada enseña las dos rentas y los dos cap rates', async () => {
    await renderPage(RENTED)

    expect(screen.getByText('RENTA/MES ESTIMADA')).not.toBeNull()
    expect(screen.getByText('RENTA/MES COBRADA')).not.toBeNull()
    // La etiqueta lleva su denominador: la fórmula es yield-on-cost y «cap rate»
    // a secas, en el mercado, significa NOI sobre valor (docs/glosario.md §8).
    expect(screen.getByText('CAP RATE PROY. S/ INVERSIÓN')).not.toBeNull()
    expect(screen.getByText('CAP RATE REAL S/ INVERSIÓN')).not.toBeNull()
    // La anual cobrada se quedó sin fila al partir la renta en dos: antes salía
    // de `rentAnnual`, que en una rentada era lo que de verdad se cobraba.
    expect(screen.getByText('RENTA ANUAL COBRADA')).not.toBeNull()
    expect(screen.getByText('$408,000')).not.toBeNull()
  })

  // ── Fase B: métricas honestas por etapa ───────────────────────────────────

  it('el héroe promueve una cifra, no la copia: no queda dos veces en pantalla', async () => {
    // PROYECCIÓN repetía sus dos héroes como filas y RESULTADO no repetía el
    // suyo: una misma cifra dos veces se lee como dos cifras, y eso es parte de
    // lo que hacía confundir el par anualizado/total.
    await renderPage(BASE_PROPERTY)

    expect(screen.getAllByText('ROI PROY. ANUAL')).toHaveLength(1)
    expect(screen.getAllByText('GANANCIA PROYECTADA')).toHaveLength(1)
    // Lo que la sección sí conserva es todo lo que el héroe no subió
    expect(screen.getByText('VENTA PROYECTADA')).not.toBeNull()
    expect(screen.getByText('RENTA ANUAL ESTIMADA')).not.toBeNull()
  })

  it('VENTA PROYECTADA es una sola fila: no se duplica al entrar a edición', async () => {
    // Vivía dos veces: una caja en DESGLOSE DE INVERSIÓN (solo en edición) y un
    // renglón de solo lectura en PROYECCIÓN (siempre) — cada uno con su propio
    // momento de actualizarse, así que teclear en uno no movía al otro. Ahora
    // es la misma fila en los dos lugares donde antes vivía por separado.
    await renderPage(BASE_PROPERTY)
    fireEvent.click(screen.getByText('EDITAR'))

    expect(screen.getAllByText('VENTA PROYECTADA')).toHaveLength(1)
    const input = screen.getByLabelText('VENTA PROYECTADA') as HTMLInputElement
    expect(input.value).toBe('9,000,000')
  })

  it('M² DE TERRENO, M² DE CONSTRUCCIÓN y COSTO OBRA/m² no desaparecen al salir de EDITAR', async () => {
    // Vivían solo dentro del `editing ? :` del desglose —la misma mitad que
    // PRECIO DE COMPRA/PERMISOS/SUBDIVISIÓN—, pero a diferencia de esos tres no
    // tenían ninguna representación de solo lectura a la que caer: al salir de
    // edición los tres desaparecían enteros, aunque la propiedad sí tuviera los
    // tres datos. Ahora son una fila más, como cualquier otra capturable.
    await renderPage(BASE_PROPERTY)

    expect(screen.getByText('M² DE TERRENO')).not.toBeNull()
    expect(screen.getByText('M² DE CONSTRUCCIÓN')).not.toBeNull()
    expect(screen.getByText('COSTO OBRA/m²')).not.toBeNull()

    fireEvent.click(screen.getByText('EDITAR'))

    // Y no se duplican al entrar a edición, la misma regla que VENTA PROYECTADA.
    expect(screen.getAllByText('M² DE TERRENO')).toHaveLength(1)
    expect(screen.getAllByText('M² DE CONSTRUCCIÓN')).toHaveLength(1)
    expect(screen.getAllByText('COSTO OBRA/m²')).toHaveLength(1)
    const sqmLandInput = screen.getByLabelText('M² DE TERRENO') as HTMLInputElement
    expect(sqmLandInput.value).toBe('400')
  })

  it('una vendida sigue enseñando el plan contra el que se mide', async () => {
    await renderPage(SOLD)

    // 5,270,000 proyectados contra 4,270,000 realizados: el par que el modelo
    // promete, legible completo y en la misma pantalla.
    expect(screen.getByText('PROYECCIÓN')).not.toBeNull()
    expect(screen.getByText('$5,270,000 +141.3%')).not.toBeNull()
    expect(screen.getByText('$4,270,000 +114.5%')).not.toBeNull()
    // Aquí sí los ROI proyectados vuelven a ser filas: el héroe lo ocupa el
    // resultado, que es la respuesta con más realidad detrás.
    expect(screen.getByText('ROI PROY. ANUAL')).not.toBeNull()
    // Pero la marca viva sí murió: una vendida no tiene ganancia sin realizar
    expect(screen.queryByText('GANANCIA NO REALIZADA')).toBeNull()
  })

  it('en desarrollo sin avalúo el héroe es la proyección, no dos guiones', async () => {
    // Amarrado a la etapa, el elemento más grande de la pantalla decía «— / —»
    // mientras la proyección viva estaba treinta filas más abajo.
    await renderPage({
      ...BASE_PROPERTY, status: 'desarrollo', score: null, totalUnits: 2,
      acquisitionDate: '2025-01-01', currentValuation: null,
      unrealizedGain: null, unrealizedGainPct: null, roi: null, holdMonthsActual: 19,
    })

    expect(screen.getByText('ROI PROY. ANUAL')).not.toBeNull()
    expect(screen.getByText('+23.0%')).not.toBeNull()
    expect(screen.getByText('$1,705,000 +23.0%')).not.toBeNull()
    expect(screen.queryByText('ROI ANUAL')).toBeNull()
  })

  it('el ROI de la marca dice hasta qué fecha cuenta, o que cuenta a hoy', async () => {
    // El numerador es una valuación con fecha y el reloj cierra en ella, así que
    // la ficha dice cuál es esa fecha en vez de dejar leer la cifra como si fuera
    // de cualquier día. Sin fecha de corte el reloj sí corre a hoy, y entonces lo
    // dice con esas palabras.
    await renderPage(RENTED)
    expect(screen.getByText('AL ABR 2026')).not.toBeNull()

    await renderPage({ ...RENTED, valuationDate: null })
    expect(screen.getByText('AL DÍA DE HOY')).not.toBeNull()
  })

  it('una archivada conserva lo que tenía al archivarse', async () => {
    await renderPage({ ...BASE_PROPERTY, status: 'archivada', score: null })

    expect(screen.getByText('ROI PROY. ANUAL')).not.toBeNull()
    expect(screen.getByText('$1,705,000 +23.0%')).not.toBeNull()
    expect(screen.getByText('DESGLOSE DE INVERSIÓN')).not.toBeNull()
    expect(screen.getByText('PROYECCIÓN')).not.toBeNull()
  })

  it('PROYECCIÓN sí se dibuja con solo VENTA PROYECTADA: es capturable, no derivada', async () => {
    // VENTA PROYECTADA vive en esta sección pero no es una de sus cifras
    // derivadas — es la misma regla que DATOS y FECHAS: un guion en un campo
    // capturable SÍ es información, señala qué falta teclear. Ocultar la
    // sección entera porque las derivadas están vacías escondería el único
    // dato que alguien sí podría capturar aquí.
    await renderPage(ALL_IN)

    expect(screen.getByText('PROYECCIÓN')).not.toBeNull()
    expect(screen.getByText('VENTA PROYECTADA')).not.toBeNull()
    expect(screen.queryByText('GANANCIA PROYECTADA')).toBeNull()
  })

  it('un total all-in se dice como precio de compra, y explica el capital entero', async () => {
    // La propiedad cuya inversión se tecleaba a mano ahora la dice donde
    // siempre estuvo su lugar. El desglose la explica al 100%: no hay resto sin
    // clasificar porque ya no hay dos totales entre los que pueda haber hueco.
    await renderPage(ALL_IN)

    expect(screen.queryByText('SIN DESGLOSAR')).toBeNull()
    expect(screen.getByText('PRECIO DE COMPRA')).not.toBeNull()
    const pcts = screen.getAllByText(/^\d+%$/).map(n => Number(n.textContent!.replace('%', '')))
    expect(pcts).toEqual([100])
  })

  it('un 0% capturado se lee como cero, no como dato faltante', async () => {
    // La migración deja `acquisitionCostPct = 0` EXPLÍCITO en las propiedades
    // que traían el total a mano: null significaría «supón 6.5%» y le sumaría
    // costos que nadie pidió. En pantalla esa distinción se sostiene o se
    // pierde — un «—» diría que falta capturarlo, y ya se capturó.
    await renderPage(ALL_IN)

    expect(screen.getByText('COSTOS ADQ. (%)')).not.toBeNull()
    expect(screen.getByText('0.0%')).not.toBeNull()
    expect(screen.getAllByText('CAPTURADO')).toHaveLength(2)
    expect(screen.queryByText('SUPUESTO POR OMISIÓN')).toBeNull()
    // Y el 0 tampoco se cuela como barra de $0 en el desglose.
    expect(screen.queryByText('COSTOS ADQ.')).toBeNull()
  })

  // ── La barra de pestañas del centro ───────────────────────────────────────

  it('la barra del centro son seis pestañas, en su orden', async () => {
    // MediaTabs pinta la lista que le den y no sabe qué hay dentro, así que
    // quién existe y en qué orden se decide AQUÍ. Sin esta prueba, absorber una
    // pestaña ajena —o perderla en un merge— no pone nada en rojo.
    // PLANO se partió en los dos levantamientos; RENDERS sigue aquí hasta que
    // sus renders se repartan por fuente (Fase 5).
    await renderPage(BASE_PROPERTY)
    const barra = screen.getByText('MAPA').parentElement!
    expect(within(barra).getAllByRole('button').map(b => b.textContent))
      .toEqual(['MAPA', 'FOTOS', 'LEVANTAMIENTO ORIGINAL', 'LEVANTAMIENTO PLANEADO', 'RENDERS', 'PRESUPUESTO'])
  })

  it('RENDERS abre lo suyo, y no la tira de FOTOS', async () => {
    // Una foto es evidencia y un render es una propuesta. El día que RENDERS
    // caiga dentro de FOTOS, una propuesta puede terminar citada como si fuera
    // el estado real del inmueble, y eso no se ve: se ve una imagen más.
    await renderPage(BASE_PROPERTY)

    fireEvent.click(screen.getByText('RENDERS'))
    expect(await screen.findByLabelText(/preset/i)).not.toBeNull()
    expect(screen.getByLabelText(/texto del prompt/i)).not.toBeNull()
  })

  // ── El plano y su envelope v3 ─────────────────────────────────────────────

  it('un blob v2 del editor anterior entra migrado: el ORIGINAL abre con sus plantas y guarda en v3', async () => {
    // El backend es un blob store sin esquema: lo guardado antes del envelope sigue
    // siendo UN plano en la raíz. La página lo migra al cargar y lo persiste en v3
    // en su primer guardado — sin migración SQL de por medio.
    const v2 = { schemaVersion: 2, slab_m: 0.2, activeFloor: 0, floors: [emptyFloorGraph('Planta Migrada')] }
    vi.mocked(api.fetchPropertyGeometry).mockResolvedValueOnce(v2)
    vi.mocked(api.savePropertyGeometry).mockImplementationOnce(async (_id, g) => g)
    await renderPage(BASE_PROPERTY)

    fireEvent.click(screen.getByText('LEVANTAMIENTO ORIGINAL'))
    // El editor entra directo con la planta migrada, no a la pantalla de inicio.
    expect(await screen.findByText('Planta Migrada')).not.toBeNull()
    expect(screen.queryByText('Start blank')).toBeNull()

    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(api.savePropertyGeometry).toHaveBeenCalled())
    const [id, envelope] = vi.mocked(api.savePropertyGeometry).mock.calls[0]
    expect(id).toBe(7)
    expect(envelope).toEqual({
      schemaVersion: 3,
      variants: {
        original: { slab_m: 0.2, activeFloor: 0, floors: v2.floors },
        planned: null,
      },
    })
  })

  it('el editor edita el original, y guardar preserva el planeado que ya había', async () => {
    const v3: FloorPlanModel = {
      schemaVersion: 3,
      variants: {
        original: { slab_m: 0.15, activeFloor: 0, floors: [emptyFloorGraph('Planta Original')] },
        planned: { slab_m: 0.15, activeFloor: 0, floors: [emptyFloorGraph('Planta Planeada')] },
      },
    }
    vi.mocked(api.fetchPropertyGeometry).mockResolvedValueOnce(v3)
    vi.mocked(api.savePropertyGeometry).mockImplementationOnce(async (_id, g) => g)
    await renderPage(BASE_PROPERTY)

    fireEvent.click(screen.getByText('LEVANTAMIENTO ORIGINAL'))
    // La pestaña trabaja sobre el levantamiento original; el planeado no se asoma aquí.
    expect(await screen.findByText('Planta Original')).not.toBeNull()
    expect(screen.queryByText('Planta Planeada')).toBeNull()

    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(api.savePropertyGeometry).toHaveBeenCalled())
    const [, envelope] = vi.mocked(api.savePropertyGeometry).mock.calls[0]
    expect(envelope.variants.planned).toEqual(v3.variants.planned)
  })

  it('sin geometría reconocible, el ORIGINAL abre en la pantalla de inicio', async () => {
    // El mock por defecto responde {}: una propiedad que nunca dibujó su plano.
    await renderPage(BASE_PROPERTY)
    fireEvent.click(screen.getByText('LEVANTAMIENTO ORIGINAL'))
    expect(await screen.findByText('Start blank')).not.toBeNull()
  })

  it('el PLANEADO sin datos aterriza en su empty state con las dos maneras de nacer', async () => {
    const v3: FloorPlanModel = {
      schemaVersion: 3,
      variants: {
        original: { slab_m: 0.15, activeFloor: 0, floors: [emptyFloorGraph('Planta Original')] },
        planned: null,
      },
    }
    vi.mocked(api.fetchPropertyGeometry).mockResolvedValueOnce(v3)
    await renderPage(BASE_PROPERTY)

    fireEvent.click(screen.getByText('LEVANTAMIENTO PLANEADO'))
    expect(await screen.findByText('PARTIR DEL ORIGINAL')).not.toBeNull()
    expect(screen.getByText('EMPEZAR EN BLANCO')).not.toBeNull()
  })

  it('el GUARDAR de la página guarda el planeado sin pisar el original', async () => {
    // Los dos editores comparten el GUARDAR del encabezado vía la misma PlanApi;
    // sin registrar de QUÉ variante es el editor vivo, este flujo escribiría el
    // planeado encima del original.
    const v3: FloorPlanModel = {
      schemaVersion: 3,
      variants: {
        original: { slab_m: 0.15, activeFloor: 0, floors: [emptyFloorGraph('Planta Original')] },
        planned: { slab_m: 0.15, activeFloor: 0, floors: [emptyFloorGraph('Planta Planeada')] },
      },
    }
    vi.mocked(api.fetchPropertyGeometry).mockResolvedValueOnce(v3)
    vi.mocked(api.savePropertyGeometry).mockImplementationOnce(async (_id, g) => g)
    await renderPage(BASE_PROPERTY)

    fireEvent.click(screen.getByText('LEVANTAMIENTO PLANEADO'))
    expect(await screen.findByText('Planta Planeada')).not.toBeNull()

    // Dibujar un muro ensucia el editor del planeado; GUARDAR ▸ persiste por él.
    fireEvent.click(screen.getByText('wall'))
    fireEvent.click(await screen.findByText('GUARDAR ▸'))

    await waitFor(() => expect(api.savePropertyGeometry).toHaveBeenCalled())
    const [, envelope] = vi.mocked(api.savePropertyGeometry).mock.calls[0]
    expect(envelope.variants.original).toEqual(v3.variants.original)
    expect(Object.keys(envelope.variants.planned!.floors[0].edges)).toHaveLength(1)
    expect(api.updateProperty).not.toHaveBeenCalled()
  })

  // ── El presupuesto de obra ────────────────────────────────────────────────

  it('un prospecto ya tiene pestaña PRESUPUESTO: no hay compuerta de etapa', async () => {
    // A diferencia de FINANZAS o TAREAS, el presupuesto acompaña a la propiedad
    // como el desglose de costos: hay que poder presupuestar antes de ofertar, y
    // naciendo con ella no hay ningún traspaso que diseñar.
    await renderPage(BASE_PROPERTY)
    expect(screen.getByText('PRESUPUESTO')).not.toBeNull()
  })

  it('una vendida también la conserva: nada se esconde al avanzar', async () => {
    await renderPage(SOLD)
    expect(screen.getByText('PRESUPUESTO')).not.toBeNull()
  })

  it('la pestaña abre la tabla del presupuesto', async () => {
    await renderPage(BASE_PROPERTY)

    fireEvent.click(screen.getByText('PRESUPUESTO'))
    expect(await screen.findByText('PRESUPUESTO DE OBRA')).not.toBeNull()
    expect(screen.getByText('TOTAL · ES EL COSTO DE OBRA')).not.toBeNull()
    // Y el total de la tabla es la misma cifra que la obra del desglose
    expect(api.fetchBudget).toHaveBeenCalledWith(7)
  })

  it('el costo de obra por m² se prellena con el cociente derivado al entrar a edición', async () => {
    // Presupuesto ÷ metraje. Sin overhead escondido en esta ruta, ese mismo
    // cociente es exactamente lo que se reproduciría si se guardara sin
    // tocarlo, así que prellenarlo es seguro — no hay multiplicador que se
    // aplique una segunda vez. 3,900,000 ÷ 250 m² de obra = 15,600.
    await renderPage(BASE_PROPERTY)

    fireEvent.click(screen.getByText('EDITAR'))
    // El metraje sí se queda: es FÍSICO, y lo leen el analizador y el PDF.
    expect(screen.getByLabelText('M² DE CONSTRUCCIÓN')).not.toBeNull()
    const input = screen.getByLabelText('COSTO OBRA/m²') as HTMLInputElement
    expect(input.value).toBe('15,600')

    fireEvent.change(input, { target: { value: '9000' } })
    fireEvent.click(screen.getByText('GUARDAR ▸'))

    await waitFor(() => expect(api.updateProperty).toHaveBeenCalled())
    const payload = vi.mocked(api.updateProperty).mock.calls[0][1] as Record<string, unknown>
    expect(payload).toEqual({ constructionCostPerSqm: 9000 })
  })

  it('la barra de obra del desglose es la suma del presupuesto', async () => {
    await renderPage(BASE_PROPERTY)

    expect(screen.getByText('OBRA A EJECUTAR')).not.toBeNull()
    expect(screen.getByText('$3,900,000')).not.toBeNull()
  })

  it('el avance de obra no existe hasta que alguien firma o paga', async () => {
    // Cuatro guiones bajo un título no informan de nada, y un $0 ahí diría que
    // se firmó en cero — que es un hecho distinto de no haber firmado.
    await renderPage(BASE_PROPERTY)
    expect(screen.queryByText('AVANCE DE OBRA')).toBeNull()
  })

  it('en cuanto hay obra firmada o pagada, la brecha contra el plan se enseña', async () => {
    await renderPage({
      ...BASE_PROPERTY, status: 'desarrollo', score: null, totalUnits: 2,
      acquisitionDate: '2025-01-01',
      constructionCommitted: 3_700_000, constructionPaid: 4_100_000,
      constructionCommittedVariance: -200_000, constructionPaidVariance: 200_000,
    })

    expect(screen.getByText('AVANCE DE OBRA')).not.toBeNull()
    expect(screen.getByText('OBRA COMPROMETIDA')).not.toBeNull()
    expect(screen.getByText('$4,100,000')).not.toBeNull()
    // Lo pagado rebasó lo presupuestado y la brecha se enseña, no se esconde:
    // el presupuesto era un plan, el pago es un hecho, y lo útil es la resta.
    expect(screen.getByText('PAGADO VS PRESUPUESTO')).not.toBeNull()
    expect(screen.getByText('$200,000')).not.toBeNull()
    expect(screen.getByText('-$200,000')).not.toBeNull()
    // Y ninguna de las tres redefine la inversión: sigue siendo la del plan.
    expect(screen.getAllByText('$7,295,000')).toHaveLength(2)
  })

  it('vaciar un campo pasa por clear-fields, con su propio botón', async () => {
    await renderPage(BASE_PROPERTY)

    fireEvent.click(screen.getByText('EDITAR'))
    fireEvent.click(screen.getByLabelText('Vaciar RENTA/MES ESTIMADA'))

    await waitFor(() => expect(api.clearPropertyFields).toHaveBeenCalledWith(7, ['rentMonthlyProjected']))
    expect(api.updateProperty).not.toHaveBeenCalled()
  })
})
