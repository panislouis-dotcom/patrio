// El párrafo de datos duros que siembra el prompt de un render nacido del PLANO: sin él
// el modelo de imagen inventa proporciones y muebles que no coinciden con el
// levantamiento — ver docs/plans/2026-08-10-levantamientos-design.md
// §"Prompt base enriquecido". Reemplaza a `planSeed` (RendersPanel.tsx), que solo mandaba
// nombres de cuarto: sin medidas ni muebles, "amuebla y da acabados" no le decía al modelo
// NADA sobre el tamaño real del espacio.
import type { FloorGraph } from './types'
import { FIXTURE_CATALOG } from './types'
import { roomLabels } from './rooms'

const fmt = (n: number): string => n.toFixed(2)

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
    const roomTexts = rooms.map(r =>
      r.area != null ? `${r.name} (${fmt(r.area)} m²)` : `${r.name} (área sin medir)`)
    parts.push(`Cuartos: ${roomTexts.join(', ')}.`)
  }

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
