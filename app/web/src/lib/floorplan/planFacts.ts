// El párrafo de datos duros que siembra el prompt de un render nacido del PLANO: sin él
// el modelo de imagen inventa proporciones y muebles que no coinciden con el
// levantamiento — ver docs/plans/2026-08-10-levantamientos-design.md
// §"Prompt base enriquecido". Reemplaza a `planSeed` (RendersPanel.tsx), que solo mandaba
// nombres de cuarto: sin medidas ni muebles, "amuebla y da acabados" no le decía al modelo
// NADA sobre el tamaño real del espacio.
import type { FloorGraph, Vertex } from './types'
import { FIXTURE_CATALOG } from './types'
import { roomLabels, roomAreas, roomConnections, roomPolygons, type Connection } from './rooms'
import { cornerAngles } from './dimensions'
import { edgeAxis } from './geometry'

const fmt = (n: number): string => n.toFixed(2)

/** Catálogo explícito palabra-clave → tipo de cuarto (estructura de datos, no regex
 * disperso por la lógica — convención del repo). El usuario nombra sus cuartos como
 * quiere ("HABITACION DP1", "cocina dp1", "ESTANCIA DP2" — ver el diagnóstico de
 * docs/plans/2026-08-11-renders-de-plano-mas-precisos.md), así que el prompt de
 * render necesita inferir el tipo para dar contexto de mobiliario/acabados al modelo
 * de imagen. La lista NO pretende cubrir cada nombre posible en español — nombres
 * fuera del catálogo (p.ej. "RECIBIDOR PA") simplemente no infieren tipo, lo cual es
 * aceptable: `roomType` regresa null y `planFacts` omite la anotación en vez de forzar
 * una categoría inventada. */
// El orden de las claves también actúa como desempate cuando un nombre trae palabras de
// dos categorías ("SALA COMEDOR" cae en 'sala', la primera que aparece abajo) — no hay
// nada más sofisticado que eso, y no hace falta: no es la parte que importa del catálogo.
const ROOM_TYPE_KEYWORDS: Record<string, string[]> = {
  cocina: ['cocina'],
  baño: ['baño', 'bano', 'wc'],
  recámara: ['recámara', 'recamara', 'habitación', 'habitacion', 'dormitorio'],
  sala: ['sala', 'estancia'],
  comedor: ['comedor'],
  patio: ['patio'],
  terraza: ['terraza'],
}

/** Separa un nombre en palabras completas (letras españolas incl. acentos/ñ; cualquier
 * otro carácter —espacio, dígito, guion— es separador). Usado por `roomType` para
 * comparar por PALABRA, no por subcadena: con `.includes()` plano, la clave sin acento
 * "bano" (de "baño") coincidía dentro de "urbano" — "PATIO URBANO" se etiquetaba
 * "tipo: baño" en vez de "tipo: patio", un dato falso alimentado al prompt de imagen.
 * Un solo tokenizador genérico, reusado por todas las claves — no regex por-palabra
 * disperso por el catálogo. */
const tokenize = (name: string): string[] =>
  name.toLowerCase().split(/[^a-zàáéíóúñü]+/i).filter(t => t.length > 0)

/** Infiere el tipo de cuarto por palabra clave en su nombre (insensible a mayúsculas,
 * por palabra completa — ver `tokenize`). `null` cuando ninguna categoría del catálogo
 * aparece en el nombre — no todo nombre de cuarto tiene por qué caer en una categoría
 * conocida. */
const roomType = (name: string): string | null => {
  const tokens = tokenize(name)
  for (const [type, keywords] of Object.entries(ROOM_TYPE_KEYWORDS)) {
    if (keywords.some(kw => tokens.includes(kw))) return type
  }
  return null
}

/** Nombre para mostrar de un lado de una `Connection`: 'exterior' se queda literal, un
 * nombre real se queda igual, y un nombre vacío (cara cerrada sin punto de etiqueta
 * dentro — rooms.ts::roomNameInside) cae a una frase honesta en vez de imprimirse crudo
 * como "" (que dejaría "conecta por puerta con ." en el texto). */
const roomDisplay = (name: string | 'exterior'): string =>
  name === 'exterior' ? 'exterior' : name.trim() ? name : 'un cuarto sin nombre'

/** Bounding box (ancho × fondo) de un cuarto a partir de sus vértices — el rectángulo
 * mínimo que lo envuelve, NO su silueta exacta. Para un cuarto rectangular (el caso típico
 * de un levantamiento) el bounding box ES la medida real; para uno en L u otra forma
 * irregular, la SOBRESTIMA — un cuarto en L de 4×3 con una esquina de 2×1 recortada sigue
 * reportando "4.00 m × 3.00 m", no su silueta real más chica. Describir la silueta exacta de
 * un polígono irregular queda fuera de alcance de Task 21c (docs/plans/2026-08-11-renders-
 * de-plano-mas-precisos.md): el bounding box es el nivel de detalle acordado, suficiente
 * para orientar al modelo de imagen sobre el tamaño aproximado del espacio sin la
 * complejidad de describir formas no rectangulares. */
const boundingBoxText = (vertices: { x: number; y: number }[]): string => {
  const xs = vertices.map(v => v.x), ys = vertices.map(v => v.y)
  const width = Math.max(...xs) - Math.min(...xs)
  const depth = Math.max(...ys) - Math.min(...ys)
  return `${fmt(width)} m × ${fmt(depth)} m`
}

/**
 * Etiqueta visual ("izquierdo"/"derecho"/"superior"/"inferior") del extremo `v1` de un
 * muro, TAL COMO SE VE en el PNG que de verdad recibe el modelo de imagen — nunca "v1"
 * a secas, que es un identificador interno del grafo sin ninguna marca visible en el
 * dibujo (`planImage.ts` no traza ejes, cuadrícula ni origen). El modelo no puede
 * verificar "v1" mirando la imagen; sí puede verificar "izquierda" o "arriba", porque esa
 * relación se deriva de las MISMAS fórmulas de proyección con las que `planImage.ts`
 * rasteriza el plano: `px(x) = (x - minx) * scale` crece con x (mundo más a la derecha ⇒
 * pantalla más a la derecha) y `py(y) = (maxy - y) * scale` DECRECE con y (mundo y mayor ⇒
 * pantalla más arriba) — ver planImage.ts:27-28. Ambas relaciones son monótonas
 * independientemente de pad/scale (que solo trasladan y escalan, nunca voltean el signo),
 * así que comparar v1.x contra v2.x (o v1.y contra v2.y) basta para saber, sin necesidad
 * de esos parámetros, de qué lado cae cada extremo en la imagen.
 *
 * Un muro casi horizontal (Δx domina sobre Δy) se describe por izquierda/derecha — el eje
 * visualmente más obvio para ESE muro; uno casi vertical se describe por arriba/abajo. En
 * el empate degenerado (Δx === Δy, solo posible con longitud 0, que un muro real nunca
 * tiene) se resuelve por izquierda/derecha de forma estable, sin caso especial extra.
 */
const wallEndLabel = (v1: Vertex, v2: Vertex): string => {
  const dx = Math.abs(v2.x - v1.x), dy = Math.abs(v2.y - v1.y)
  if (dx >= dy) return v1.x <= v2.x ? 'izquierdo' : 'derecho'
  return v1.y >= v2.y ? 'superior' : 'inferior'
}

/**
 * Cláusula ", a X.XX m del extremo {izquierdo|derecho|superior|inferior} del muro" para
 * una `Connection` — la posición métrica de SU abertura (puerta/ventana) a lo largo del
 * muro que la contiene. `Opening.offset` es una fracción 0..1 de la longitud del muro
 * (types.ts); aquí se resuelve la arista y la abertura reales vía `edgeId`/`openingIndex`
 * (Task 20, rooms.ts::roomConnections), se reusa `edgeAxis` (geometry.ts — ya calcula `L`
 * para el mismo propósito en `planImage.ts`/el editor, no se reimplementa aquí) para la
 * longitud real del muro, y se convierte a metros: `offset * L`.
 *
 * La distancia SIEMPRE se mide desde `edge.v1` — estable ante edición (partir el muro con
 * `splitEdgeAtVertex`, graph.ts, o mover un vértice no cambia cuál extremo de una arista
 * YA EXISTENTE es v1) — pero la ETIQUETA de ese extremo (`wallEndLabel`, arriba) nunca es
 * "v1" literal: es su posición visual real en la imagen, así que el modelo puede
 * verificarla contra lo que ve, no adivinarla a ciegas entre dos opciones.
 */
const openingPositionClause = (floor: FloorGraph, c: Connection): string => {
  const edge = floor.edges[c.edgeId]
  const opening = edge.openings[c.openingIndex]
  const v1 = floor.vertices[edge.v1], v2 = floor.vertices[edge.v2]
  const distance = opening.offset * edgeAxis(v1, v2).L
  return `, a ${fmt(distance)} m del extremo ${wallEndLabel(v1, v2)} del muro`
}

/** Una oración por conexión. El chequeo de exterior va PRIMERO y cubre puerta Y ventana
 * por igual: 'exterior' no es un cuarto, así que "conecta por puerta con exterior"
 * (o, peor, "exterior conecta por puerta con Sala" cuando roomA es el lado exterior) es
 * gramaticalmente roto — la puerta de entrada/patio es la más común de cualquier casa, no
 * un caso raro que se pueda dejar caer en la plantilla genérica. Solo cuando NINGÚN lado es
 * exterior (dos cuartos interiores con puerta, o con ventana — ambos alcanzables, ver abajo)
 * se nombra a ambos por separado. Toda rama agrega la posición métrica de la abertura
 * (Task 26: "las puertas en el lugar correcto") ANTES del punto final, nunca después.
 */
const connectionSentence = (floor: FloorGraph, c: Connection): string => {
  const a = roomDisplay(c.roomA), b = roomDisplay(c.roomB)
  const position = openingPositionClause(floor, c)
  if (c.roomA === 'exterior' || c.roomB === 'exterior') {
    const interior = c.roomA === 'exterior' ? b : a
    const label = c.kind === 'door' ? 'puerta' : 'ventana'
    return `${interior} tiene ${label} hacia el exterior${position}.`
  }
  if (c.kind === 'door') return `${a} conecta por puerta con ${b}${position}.`
  // Ventana entre dos cuartos interiores: alcanzable (`Connection.roomA`/`roomB` no
  // restringen `kind: 'window'` a un muro exterior; nada en `roomConnections` ni en el
  // reducer/editor lo impide), así que también se frasea en vez de asumir que nunca pasa.
  return `${a} y ${b} comparten una ventana interior${position}.`
}

/**
 * Datos duros del piso ACTIVO de un levantamiento, en un párrafo listo para anteponerse
 * al prompt de estilo. Toma un `FloorGraph` (un piso ya elegido) y no un `FloorSet`
 * (la planta completa, multi-piso): quien llama —hoy `RendersPanel.tsx`, mañana
 * `LevantamientoPanel.tsx` en la Tarea 17— YA resolvió qué piso está activo para armar
 * el PNG que se manda al render (`floorToPngBlob` recibe lo mismo). Pedirle aquí el
 * FloorSet completo solo movería esa resolución de un lado a otro sin simplificar nada,
 * y es justo lo que dice el diseño: "el plano de ESA variante", no "la variante".
 *
 * Nunca lanza y nunca imprime `NaN`/`undefined`/`null`: un piso vacío (sin vértices, sin
 * cuartos, sin muebles) produce un párrafo mínimo pero válido — la altura de piso sola,
 * que siempre existe (`emptyFloorGraph` la nace en 2.60 m).
 */
export function planFacts(floor: FloorGraph): string {
  const parts: string[] = []

  // Cuartos: cerrados (con área y, si tiene polígono, dimensiones) más los libres — el
  // nombre puesto sobre un espacio abierto sin cerrar (área null, el caso "Terraza" de
  // rooms.ts). Omitir esos cuartos callaría justo la información que el usuario sí capturó
  // (el nombre); en vez de eso el párrafo dice que el área no se pudo medir, la verdad del
  // dato.
  //
  // Vértices por cuarto CERRADO, emparejados por POSICIÓN — nunca por nombre. roomAreas(f)
  // y roomPolygons(f) recorren interiorPolygons(f) en el MISMO orden (mismo trazo de caras,
  // ver rooms.ts), así que el i-ésimo elemento de cada arreglo es siempre el mismo cuarto.
  // Emparejar por nombre en cambio sería un bug real y silencioso: nada en el reducer exige
  // nombres de cuarto únicos ("Recámara" repetida es plausible en una casa con varias
  // recámaras sin numerar), y un Map keyed by name mezclaría el área de un cuarto con el
  // bounding box de otro homónimo — justo el tipo de dato fabricado que este párrafo existe
  // para evitarle al modelo de imagen (un prompt pagado cuyo propósito es no inventar).
  const enclosedAreas = roomAreas(floor)
  const enclosedPolys = roomPolygons(floor)
  const enclosedRooms = enclosedAreas.map((r, i) => ({
    name: r.name,
    area: r.area as number | null,
    vertices: enclosedPolys[i].vertices as { x: number; y: number }[] | undefined,
  }))
  // Cuartos libres (nombre puesto sobre un espacio abierto sin cara cerrada — el caso
  // "Terraza" de rooms.ts): roomLabels ya los identifica por `area: null`; no tienen
  // polígono que darles, así que se quedan sin `vertices`.
  const freeRooms = roomLabels(floor)
    .filter(r => r.area === null)
    .map(r => ({ name: r.name, area: null as number | null, vertices: undefined as { x: number; y: number }[] | undefined }))
  const rooms = [...enclosedRooms, ...freeRooms].filter(r => r.name.trim())
  if (rooms.length > 0) {
    const roomTexts = rooms.map(r => {
      const measure = r.area != null ? `${fmt(r.area)} m²` : 'área sin medir'
      const dims = r.vertices ? `, ${boundingBoxText(r.vertices)}` : ''
      const type = roomType(r.name)
      // Sin tipo inferido, el paréntesis se queda solo con medida+dimensiones — nunca
      // "(tipo: )" ni "tipo: null" colgando cuando el nombre no cae en el catálogo.
      const detail = type != null ? `${measure}${dims}, tipo: ${type}` : `${measure}${dims}`
      return `${r.name} (${detail})`
    })
    parts.push(`Cuartos: ${roomTexts.join(', ')}.`)
  }

  // Conectividad por puerta/ventana: sin esto el modelo de imagen no tiene forma de saber
  // qué cuartos comunican entre sí ni cuáles dan al exterior — ver el diagnóstico de
  // docs/plans/2026-08-11-renders-de-plano-mas-precisos.md (Task 20/21a). Reusa
  // `roomConnections` (rooms.ts) en vez de reimplementar el trazo de caras aquí.
  const connections = roomConnections(floor)
  if (connections.length > 0) parts.push(...connections.map(c => connectionSentence(floor, c)))

  // Dimensiones generales: bounding box de los vértices dibujados. Sin vértices no hay
  // plano que describir — se omite la frase entera en vez de fabricar un 0×0 o 1×1 falso
  // (que sí tendría sentido para dibujar un canvas, pero no como un hecho del inmueble).
  const vs = Object.values(floor.vertices)
  if (vs.length > 0) {
    parts.push(`Dimensiones generales del piso: ${boundingBoxText(vs)}.`)
  }

  // Ángulos de esquina NO rectos: una esquina a 90° es el caso esperado de una
  // construcción rectangular y no le aporta nada nuevo al modelo de imagen; solo las
  // irregulares (un corte en L, un muro en diagonal) importan — omitirlas evita ruido en
  // el 90%+ de los planos, que sí son rectangulares. Reusa `cornerAngles` (dimensions.ts)
  // sin reimplementar el trazo de esquinas, y reusa también SU criterio de "es recta"
  // (`isRight`, tolerancia ±1°) en vez de inventar una tolerancia nueva aquí: la misma
  // pregunta ("¿esta esquina es recta?") ya tiene una respuesta en el código base (la que
  // colorea la etiqueta de ángulo en FloorPlanCanvas.tsx) — un segundo umbral distinto
  // para la misma pregunta solo podría divergir de esa respuesta, no mejorarla.
  const irregularCorners = cornerAngles(floor).filter(c => !c.isRight)
  if (irregularCorners.length > 0) {
    parts.push(...irregularCorners.map(c =>
      `Esquina en (${fmt(c.x)}, ${fmt(c.y)}) con ángulo de ${Math.round(c.deg)}°.`))
  }

  parts.push(`Altura de piso: ${fmt(floor.height_m)} m.`)

  // Muebles: la medida REAL guardada en el fixture (w_m/h_m), nunca el default del
  // catálogo — un mueble se puede redimensionar después de colocarse (types.ts,
  // Fixture.w_m/h_m son "editables; el catálogo solo da el default").
  const fixtures = floor.fixtures ?? []
  if (fixtures.length > 0) {
    const fixtureTexts = fixtures.map(fx =>
      `${FIXTURE_CATALOG[fx.kind].label} (${fmt(fx.w_m)} × ${fmt(fx.h_m)} m)`)
    parts.push(`Muebles colocados: ${fixtureTexts.join(', ')}.`)
  }

  return parts.join(' ')
}
