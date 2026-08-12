// El párrafo de datos duros que siembra el prompt de un render nacido del PLANO: sin él
// el modelo de imagen inventa proporciones y muebles que no coinciden con el
// levantamiento — ver docs/plans/2026-08-10-levantamientos-design.md
// §"Prompt base enriquecido". Reemplaza a `planSeed` (RendersPanel.tsx), que solo mandaba
// nombres de cuarto: sin medidas ni muebles, "amuebla y da acabados" no le decía al modelo
// NADA sobre el tamaño real del espacio.
import type { FloorGraph } from './types'
import { FIXTURE_CATALOG } from './types'
import { roomLabels, roomConnections, type Connection } from './rooms'

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
const ROOM_TYPE_KEYWORDS: Record<string, string[]> = {
  cocina: ['cocina'],
  baño: ['baño', 'bano', 'wc'],
  recámara: ['recámara', 'recamara', 'habitación', 'habitacion', 'dormitorio'],
  sala: ['sala', 'estancia'],
  comedor: ['comedor'],
  patio: ['patio'],
  terraza: ['terraza'],
}

/** Infiere el tipo de cuarto por palabra clave en su nombre (insensible a mayúsculas).
 * `null` cuando ninguna categoría del catálogo aparece en el nombre — no todo nombre
 * de cuarto tiene por qué caer en una categoría conocida. */
const roomType = (name: string): string | null => {
  const lower = name.toLowerCase()
  for (const [type, keywords] of Object.entries(ROOM_TYPE_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return type
  }
  return null
}

/** Nombre para mostrar de un lado de una `Connection`: 'exterior' se queda literal, un
 * nombre real se queda igual, y un nombre vacío (cara cerrada sin punto de etiqueta
 * dentro — rooms.ts::roomNameInside) cae a una frase honesta en vez de imprimirse crudo
 * como "" (que dejaría "conecta por puerta con ." en el texto). */
const roomDisplay = (name: string | 'exterior'): string =>
  name === 'exterior' ? 'exterior' : name.trim() ? name : 'un cuarto sin nombre'

/** Una oración por conexión: puerta siempre nombra ambos lados; ventana hacia el
 * exterior nombra solo el cuarto interior. El tercer caso —ventana entre dos cuartos
 * interiores— es alcanzable (`Connection.roomA`/`roomB` no restringen `kind: 'window'`
 * a un muro exterior; nada en `roomConnections` lo impide), así que también se frasea
 * en vez de asumir que nunca pasa. */
const connectionSentence = (c: Connection): string => {
  const a = roomDisplay(c.roomA), b = roomDisplay(c.roomB)
  if (c.kind === 'door') return `${a} conecta por puerta con ${b}.`
  if (c.roomA === 'exterior' || c.roomB === 'exterior') {
    const interior = c.roomA === 'exterior' ? b : a
    return `${interior} tiene ventana hacia el exterior.`
  }
  return `${a} y ${b} comparten una ventana interior.`
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

  // Cuartos: `roomLabels`, no `roomAreas` — incluye también el nombre puesto sobre un
  // espacio abierto sin cerrar (área null, el caso "Terraza" de rooms.ts). Omitir esos
  // cuartos callaría justo la información que el usuario sí capturó (el nombre); en vez
  // de eso el párrafo dice que el área no se pudo medir, que es la verdad del dato.
  const rooms = roomLabels(floor).filter(r => r.name.trim())
  if (rooms.length > 0) {
    const roomTexts = rooms.map(r => {
      const measure = r.area != null ? `${fmt(r.area)} m²` : 'área sin medir'
      const type = roomType(r.name)
      // Sin tipo inferido, el paréntesis se queda solo con la medida — nunca
      // "(tipo: )" ni "tipo: null" colgando cuando el nombre no cae en el catálogo.
      const detail = type != null ? `${measure}, tipo: ${type}` : measure
      return `${r.name} (${detail})`
    })
    parts.push(`Cuartos: ${roomTexts.join(', ')}.`)
  }

  // Conectividad por puerta/ventana: sin esto el modelo de imagen no tiene forma de saber
  // qué cuartos comunican entre sí ni cuáles dan al exterior — ver el diagnóstico de
  // docs/plans/2026-08-11-renders-de-plano-mas-precisos.md (Task 20/21a). Reusa
  // `roomConnections` (rooms.ts) en vez de reimplementar el trazo de caras aquí.
  const connections = roomConnections(floor)
  if (connections.length > 0) parts.push(...connections.map(connectionSentence))

  // Dimensiones generales: bounding box de los vértices dibujados. Sin vértices no hay
  // plano que describir — se omite la frase entera en vez de fabricar un 0×0 o 1×1 falso
  // (que sí tendría sentido para dibujar un canvas, pero no como un hecho del inmueble).
  const vs = Object.values(floor.vertices)
  if (vs.length > 0) {
    const xs = vs.map(v => v.x), ys = vs.map(v => v.y)
    const width = Math.max(...xs) - Math.min(...xs)
    const depth = Math.max(...ys) - Math.min(...ys)
    parts.push(`Dimensiones generales del piso: ${fmt(width)} m × ${fmt(depth)} m.`)
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
