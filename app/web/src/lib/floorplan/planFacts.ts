// El párrafo de datos duros que siembra el prompt de un render nacido del PLANO: sin él
// el modelo de imagen inventa proporciones y muebles que no coinciden con el
// levantamiento — ver docs/plans/2026-08-10-levantamientos-design.md
// §"Prompt base enriquecido". Reemplaza a `planSeed` (RendersPanel.tsx), que solo mandaba
// nombres de cuarto: sin medidas ni muebles, "amuebla y da acabados" no le decía al modelo
// NADA sobre el tamaño real del espacio.
import type { FloorGraph, Vertex, RoomType } from './types'
import { FIXTURE_CATALOG, ROOM_TYPE_CATALOG } from './types'
import { roomLabels, roomAreas, roomConnections, roomPolygons, type Connection } from './rooms'
import { cornerAngles, CORNER_ANGLE_TOL_DEG } from './dimensions'
import { edgeAxis } from './geometry'

const fmt = (n: number): string => n.toFixed(2)

/** Catálogo explícito palabra-clave → `RoomType` (estructura de datos, no regex
 * disperso por la lógica — convención del repo). Fallback de `resolveRoomType` (abajo)
 * para levantamientos que aún no traen el campo `Room.type` explícito (ver types.ts) —
 * el usuario nombra sus cuartos como quiere ("HABITACION DP1", "cocina dp1", "ESTANCIA
 * DP2" — ver el diagnóstico de docs/plans/2026-08-11-renders-de-plano-mas-precisos.md),
 * así que sin un tipo explícito el prompt de render necesita inferirlo para dar
 * contexto de mobiliario/acabados al modelo de imagen. La lista NO pretende cubrir cada
 * nombre posible en español — arreglo vacío para un `RoomType` sin evidencia real de
 * nombre todavía (nunca se inventa cobertura sin un nombre real que la necesite); un
 * nombre fuera de lo cubierto simplemente no infiere tipo, lo cual es aceptable:
 * `resolveRoomType` regresa `null` y `planFacts` omite la anotación en vez de forzar
 * una categoría inventada. `Record<RoomType, ...>` (no `Record<string, ...>`): las
 * claves son las MISMAS que `ROOM_TYPE_CATALOG` (types.ts) — un solo espacio de
 * nombres, nunca dos vocabularios que puedan divergir. */
// El orden de las claves también actúa como desempate cuando un nombre trae palabras de
// dos categorías ("SALA COMEDOR" cae en 'sala', que aparece antes que 'comedor' abajo)
// — no hay nada más sofisticado que eso, y no hace falta: no es la parte que importa
// del catálogo.
const ROOM_TYPE_KEYWORDS: Record<RoomType, string[]> = {
  recamara: ['recámara', 'recamara', 'habitación', 'habitacion', 'dormitorio'],
  bano: ['baño', 'bano', 'wc'],
  cocina: ['cocina'],
  sala: ['sala', 'estancia'],
  comedor: ['comedor'],
  // "escalera" y "vestibulo" (agregadas tras el diagnóstico de Locales Salón Escobedo):
  // "ESCALERAS ACCESO" y "RECIBIDOR PA", nombres reales de esa propiedad, no caían en
  // ninguna categoría — el prompt de render no tenía NINGÚN dato sobre su función,
  // solo sus medidas, la causa raíz más directa del error reportado.
  vestibulo: ['recibidor', 'vestíbulo', 'vestibulo'],
  escalera: ['escalera', 'escaleras'],
  patio: ['patio'],
  terraza: ['terraza'],
  // Sin evidencia real de un nombre que los necesite todavía — alcanzables solo vía
  // Room.type explícito (el dropdown del editor), no por inferencia de nombre.
  pasillo: [],
  closet: [],
  lavanderia: [],
  cuarto_servicio: [],
  cochera: [],
  jardin: [],
  azotea: [],
  otro: [], // nunca se infiere 'otro' por nombre — no tiene keywords a propósito
}

/** Separa un nombre en palabras completas (letras españolas incl. acentos/ñ; cualquier
 * otro carácter —espacio, dígito, guion— es separador). Usado por `roomTypeFromName`
 * para comparar por PALABRA, no por subcadena: con `.includes()` plano, la clave sin
 * acento "bano" (de "baño") coincidía dentro de "urbano" — "PATIO URBANO" se etiquetaba
 * "tipo: baño" en vez de "tipo: patio", un dato falso alimentado al prompt de imagen.
 * Un solo tokenizador genérico, reusado por todas las claves — no regex por-palabra
 * disperso por el catálogo. */
const tokenize = (name: string): string[] =>
  name.toLowerCase().split(/[^a-zàáéíóúñü]+/i).filter(t => t.length > 0)

/** Infiere el `RoomType` por palabra clave en el nombre (insensible a mayúsculas, por
 * palabra completa — ver `tokenize`). `null` cuando ninguna categoría del catálogo
 * aparece en el nombre — no todo nombre de cuarto tiene por qué caer en una categoría
 * conocida. Fallback de `resolveRoomType` (abajo) cuando el cuarto no trae un
 * `RoomType` explícito — ya NO es el mecanismo primario, ver ese comentario. */
const roomTypeFromName = (name: string): RoomType | null => {
  const tokens = tokenize(name)
  for (const [type, keywords] of Object.entries(ROOM_TYPE_KEYWORDS) as [RoomType, string[]][]) {
    if (keywords.some(kw => tokens.includes(kw))) return type
  }
  return null
}

/** El `RoomType` EFECTIVO de un cuarto: prefiere el campo explícito (`Room.type`,
 * elegido por el usuario en un dropdown al nivel del plano — ver `ROOM_TYPE_CATALOG`,
 * types.ts) y solo cae al inferido por palabra clave (`roomTypeFromName`, arriba)
 * cuando no hay campo explícito o el usuario marcó 'otro'. 'otro' es una decisión
 * positiva ("miré la lista, ninguna aplica"), no una señal útil para el modelo de
 * imagen — no debe apagar el mejor esfuerzo por nombre, así que cae al mismo fallback
 * que "sin tipo capturado todavía".
 *
 * Único punto de verdad de "cuál es el tipo de este cuarto", reusado tanto por el
 * párrafo de texto de aquí abajo como por el relleno de color de la imagen de
 * referencia (planImage.ts) — así texto e imagen NUNCA pueden describir un tipo
 * distinto para el mismo cuarto. */
export const resolveRoomType = (name: string, explicitType: RoomType | undefined): RoomType | null => {
  if (explicitType && explicitType !== 'otro') return explicitType
  return roomTypeFromName(name)
}

const roomTypeText = (name: string, explicitType: RoomType | undefined): string | null => {
  const type = resolveRoomType(name, explicitType)
  return type != null ? ROOM_TYPE_CATALOG[type].label.toLowerCase() : null
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
 * Lado del muro DENTRO DEL INMUEBLE COMPLETO: 'izquierdo'/'derecho'/'superior'/'inferior'
 * cuando el muro cae claramente cerca de ese borde del plano; 'central' cuando no (el caso
 * típico de una partición interior, que por construcción no toca el perímetro). Bug real:
 * dos ventanas de un mismo cuarto en dos muros exteriores PERPENDICULARES (una esquina) se
 * describían con la frase idéntica salvo el extremo — "del muro." x2, sin decir CUÁL muro —
 * porque nada identificaba al muro en sí, solo la posición de la abertura sobre él.
 *
 * Distinto de `wallEndLabel`: ese compara los DOS EXTREMOS de UN muro entre sí (v1 contra
 * v2) para decir cuál punta es cuál; este compara el PUNTO MEDIO del muro contra el
 * bounding box de TODO EL PISO (el mismo bbox que ya imprime "Dimensiones generales del
 * piso" — ningún sistema de coordenadas nuevo que la imagen no muestre) para decir en qué
 * posición del PLANO COMPLETO cae el muro — lo que hace falta para diferenciar dos muros
 * DISTINTOS del mismo cuarto. Misma proyección mundo→pantalla que wallEndLabel ya
 * documenta (px crece con x, py decrece con y) y el mismo criterio dx-vs-dy para elegir el
 * eje relevante (un muro casi horizontal se ubica por su Y — ¿cerca de arriba o de abajo?
 * —; uno casi vertical, por su X).
 *
 * Umbral: solo se asigna un lado cuando el punto medio cae en el TERCIO exterior de ese eje
 * (fracción ≤ 1/3 o ≥ 2/3 del rango); el tercio central se marca 'central' EXPLÍCITAMENTE
 * en el texto (nunca se omite el calificador ni se le asigna un lado que no le
 * corresponde) — una partición interior real (que corre por el medio del piso) cae aquí
 * por construcción, y decir "izquierdo" o "derecho" ahí sería fabricar una posición que el
 * modelo no puede verificar contra la imagen — el mismo pecado que este párrafo entero
 * existe para evitar.
 */
const WALL_SIDE_NEAR_FRACTION = 1 / 3
const wallSideLabel = (floor: FloorGraph, v1: Vertex, v2: Vertex): string => {
  const vs = Object.values(floor.vertices)
  const xs = vs.map(v => v.x), ys = vs.map(v => v.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const dx = Math.abs(v2.x - v1.x), dy = Math.abs(v2.y - v1.y)
  if (dx >= dy) {
    const rangeY = maxY - minY || 1
    const fracFromTop = (maxY - (v1.y + v2.y) / 2) / rangeY
    if (fracFromTop <= WALL_SIDE_NEAR_FRACTION) return 'superior'
    if (fracFromTop >= 1 - WALL_SIDE_NEAR_FRACTION) return 'inferior'
    return 'central'
  }
  const rangeX = maxX - minX || 1
  const fracFromLeft = ((v1.x + v2.x) / 2 - minX) / rangeX
  if (fracFromLeft <= WALL_SIDE_NEAR_FRACTION) return 'izquierdo'
  if (fracFromLeft >= 1 - WALL_SIDE_NEAR_FRACTION) return 'derecho'
  return 'central'
}

/**
 * Cláusula ", a X.XX m del extremo {izquierdo|derecho|superior|inferior} del muro
 * {lado} (L.LL m)" para una `Connection` — la posición métrica de SU abertura
 * (puerta/ventana) a lo largo del muro que la contiene, MÁS un identificador del muro en sí
 * (lado dentro del inmueble + largo real, `wallSideLabel` arriba) para que dos aberturas en
 * muros distintos del mismo cuarto nunca produzcan la misma frase. `Opening.offset` es una
 * fracción 0..1 de la longitud del muro (types.ts); aquí se resuelve la arista y la
 * abertura reales vía `edgeId`/`openingIndex` (Task 20, rooms.ts::roomConnections), se
 * reusa `edgeAxis` (geometry.ts — ya calcula `L` para el mismo propósito en
 * `planImage.ts`/el editor, no se reimplementa aquí) para la longitud real del muro, y se
 * convierte a metros: `offset * L`.
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
  const { L } = edgeAxis(v1, v2)
  const distance = opening.offset * L
  const side = wallSideLabel(floor, v1, v2)
  return `, a ${fmt(distance)} m del extremo ${wallEndLabel(v1, v2)} del muro ${side} (${fmt(L)} m)`
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
export function planFacts(floor: FloorGraph, opts: { includeColorLegend?: boolean } = {}): string {
  const parts: string[] = []

  // Cuartos: cerrados (con área y, si tiene polígono, dimensiones) más los libres — el
  // nombre puesto sobre un espacio abierto sin cerrar (área null, el caso "Terraza" de
  // rooms.ts). Omitir esos cuartos callaría justo la información que el usuario sí capturó
  // (el nombre); en vez de eso el párrafo dice, EXPLÍCITAMENTE, que es espacio abierto sin
  // muros — nunca "área sin medir" a secas, que un lector (humano o el modelo de imagen
  // obedeciendo _PLAN_CLAUSE de app/api/renders.py, "no agregues ni quites cuartos ni
  // paredes") puede confundir con "cuarto real, solo que no capturamos su medida". Un
  // cuarto sin muros no es un cuarto sin medir: es un nombre sobre aire, y decirlo así evita
  // que la instrucción de "no quites paredes" se lea como "dibújale paredes a esto".
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
    type: r.type,
    area: r.area as number | null,
    vertices: enclosedPolys[i].vertices as { x: number; y: number }[] | undefined,
    enclosed: true as const,
  }))
  // Cuartos libres (nombre puesto sobre un espacio abierto sin cara cerrada — el caso
  // "Terraza" de rooms.ts): roomLabels ya los identifica por `area: null`; no tienen
  // polígono que darles, así que se quedan sin `vertices`, y `enclosed: false` los separa de
  // los cerrados más abajo en vez de mezclarse por coincidencia de `area == null`.
  const freeRooms = roomLabels(floor)
    .filter(r => r.area === null)
    .map(r => ({
      name: r.name,
      type: r.type,
      area: null as number | null,
      vertices: undefined as { x: number; y: number }[] | undefined,
      enclosed: false as const,
    }))
  const rooms = [...enclosedRooms, ...freeRooms].filter(r => r.name.trim())
  if (rooms.length > 0) {
    const roomTexts = rooms.map(r => {
      const type = roomTypeText(r.name, r.type)
      // Sin tipo inferido, el paréntesis se queda solo con medida+dimensiones — nunca
      // "(tipo: )" ni "tipo: null" colgando cuando el nombre no cae en el catálogo.
      const typeSuffix = type != null ? `, tipo: ${type}` : ''
      if (!r.enclosed) {
        return `${r.name} (espacio abierto, sin muros que lo cierren${typeSuffix})`
      }
      const measure = r.area != null ? `${fmt(r.area)} m²` : 'área sin medir'
      const dims = r.vertices ? `, ${boundingBoxText(r.vertices)}` : ''
      return `${r.name} (${measure}${dims}${typeSuffix})`
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
  // `cornerAngles` también reporta 180° en cada vértice donde un muro exterior recto
  // queda partido por una T interior (`splitEdgeAtVertex` — el caso normal de un
  // levantamiento con más de un cuarto): un punto COLINEAL, no una esquina real (en la
  // imagen ese punto está sobre una línea recta). `isRight` (dimensions.ts) ya excluye
  // "casi 90°" con tolerancia ±1°; el filtro de "casi 180°" no vive en dimensions.ts (Task
  // 33b, ya cerrada — CornerAngle no gana un campo nuevo por esto) sino aquí, importando
  // `CORNER_ANGLE_TOL_DEG` (dimensions.ts) en vez de duplicar el literal: dos constantes
  // `= 1` independientes se probó que pueden divergir en silencio (prueba de mutación,
  // Task 33c review) sin que ningún test lo note — una sola fuente de verdad lo hace
  // imposible.
  const irregularCorners = cornerAngles(floor)
    .filter(c => !c.isRight && Math.abs(c.deg - 180) > CORNER_ANGLE_TOL_DEG)
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

  // Leyenda del relleno de color por tipo de cuarto (Fase 2 del diagnóstico de Locales
  // Salón Escobedo) — SOLO cuando el llamador también pintó ese relleno en la imagen de
  // referencia (planImage.ts, floorToSvgString con roomTypeFill:true): un párrafo sin
  // imagen que lo respalde sería una instrucción sin referente. `resolveRoomType` es el
  // MISMO resolutor que ya decidió el `tipo:` de cada cuarto arriba — texto e imagen no
  // pueden describir un color/tipo distinto para el mismo cuarto. Lista solo los colores
  // REALMENTE usados en este piso (no las 16 entradas completas del catálogo): un piso
  // con 3 tipos no necesita que el modelo lea 13 colores que no aparecen en su imagen.
  if (opts.includeColorLegend) {
    const usedTypes = new Set<RoomType>()
    for (const r of rooms) {
      const t = resolveRoomType(r.name, r.type)
      if (t != null) usedTypes.add(t)
    }
    const legendItems = [...usedTypes]
      .filter(t => ROOM_TYPE_CATALOG[t].color)
      .map(t => `${ROOM_TYPE_CATALOG[t].color} = ${ROOM_TYPE_CATALOG[t].label.toLowerCase()}`)
    if (legendItems.length > 0) {
      parts.push(
        `Colores de referencia en la imagen (SOLO indican qué tipo de cuarto va en cada `
        + `zona — NO son el acabado final, ignóralos al elegir materiales o colores de `
        + `pintura): ${legendItems.join(', ')}.`,
      )
    }
  }

  return parts.join(' ')
}
