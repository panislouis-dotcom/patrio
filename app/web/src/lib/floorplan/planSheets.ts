import { migrateGeometry, type FloorGraph, type PlanKey } from './types'
import { floorToSvg } from './exportSvg'

/** Una hoja dibujada: un piso de una variante ('original' o el id de un plan), ya en SVG.
 * `variant` es la LLAVE de pareo (la misma que source_variant en los renders);
 * `planName` es la etiqueta humana que el prospecto imprime por sección — null en el
 * original, que no es un plan. */
export interface PlanSheet {
  variant: PlanKey
  planName: string | null
  floorId: string
  floorName: string
  svg: string
}

// Lado largo objetivo de una hoja, en px. El SVG se escala al 100% del ancho de su columna
// en el PDF, así que este número solo fija la resolución del dibujo y la proporción entre
// las dos variantes de un mismo piso.
const SHEET_MAX_PX = 900

const drawn = (f: FloorGraph) => Object.keys(f.vertices).length > 0

function span(f: FloorGraph): number {
  const vs = Object.values(f.vertices)
  const xs = vs.map(v => v.x), ys = vs.map(v => v.y)
  // El piso degenerado (un vértice) tiene extensión cero: el mínimo evita dividir entre cero.
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0.01)
}

/**
 * El blob persistido de una propiedad → las hojas que el prospecto debe imprimir.
 *
 * Es la ÚNICA función que el bundle del servidor expone, y no tiene geometría propia:
 * compone `migrateGeometry` (que ya entiende v2 en la raíz, v3 en `variants`, y rechaza
 * lo malformado) con `floorToSvg` (que ya dibuja m², largos, cotas y batientes). Por eso
 * el plano del PDF y el del botón `↓ SVG` no pueden divergir: son la misma función.
 *
 * Un piso sin vértices se omite — "EMPEZAR EN BLANCO" persiste un planeado con una planta
 * vacía, y ese lienzo no es propuesta todavía.
 *
 * La escala se fija por LINAJE, no por hoja: las dos variantes de un mismo piso comparten
 * `floorId` (`LevantamientoPanel.tsx:231`) y tienen que leerse comparables, o el
 * Antes/Después miente sobre cuánto cambió.
 */
export function planSheets(raw: unknown): PlanSheet[] {
  const model = migrateGeometry(raw)
  if (!model) return []

  // La variante de un plan ES su id (el legado migrado conserva 'planned', así que
  // el documento de una propiedad con un solo plan no cambia ni un byte de pareo).
  const pairs: [PlanKey, string | null, FloorGraph][] = []
  for (const f of model.variants.original?.floors ?? []) if (drawn(f)) pairs.push(['original', null, f])
  for (const p of model.variants.plans) for (const f of p.fs.floors ?? []) if (drawn(f)) pairs.push([p.id, p.name, f])

  // Máximo del linaje ENTERO (original + todos los planes que comparten el floorId),
  // no por pareja: la hoja del original se dibuja UNA vez, y con el máximo global
  // toda sección "Antes / Propuesta" queda en la misma escala — por-pareja habría
  // que dibujar el original N veces, o mentir en alguna sección.
  const lineage = new Map<string, number>()
  for (const [, , f] of pairs) lineage.set(f.id, Math.max(lineage.get(f.id) ?? 0, span(f)))

  return pairs.map(([variant, planName, f]) => ({
    variant, planName, floorId: f.id, floorName: f.name,
    svg: floorToSvg(f, { scale: SHEET_MAX_PX / lineage.get(f.id)! }),
  }))
}
