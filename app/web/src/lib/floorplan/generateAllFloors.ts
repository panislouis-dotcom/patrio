import type { FloorGraph } from './types'

/** Cómo terminó UN piso del lote: 'ok' si `generate` resolvió, 'error' con su
 * motivo si `generate` lanzó — nunca se descarta, el resumen final lo carga tal
 * cual (Task 31: tolerancia a fallo parcial). */
export interface FloorBatchResult {
  floorId: string
  floorName: string
  status: 'ok' | 'error'
  error?: string
}

/** El resumen final del lote: cuántos de cuántos, y el detalle por piso — lo
 * bastante para escribir "2 de 3 generados. Falló: Nivel 3 — [motivo]." sin
 * volver a recorrer nada. */
export interface FloorBatchSummary {
  total: number
  succeeded: number
  failed: number
  results: FloorBatchResult[]
}

/**
 * Genera un render para CADA piso de `floors`, uno a la vez — nunca en paralelo:
 * saturar la API de imágenes en paralelo dispara picos de costo y de latencia, y
 * el progreso por piso ("generando 2 de 3") solo tiene sentido si de verdad hay
 * un piso corriendo a la vez (Task 31, diseño en
 * docs/plans/2026-08-13-renders-multi-piso-design.md).
 *
 * Un piso que falla NO cancela ni descarta a los demás: el lote completo se
 * intenta siempre, piso por piso, y el resumen final refleja el estado real de
 * cada uno — nunca revierte los éxitos ya logrados para "limpiar" un fallo
 * parcial.
 *
 * `generate` es quien de verdad sabe cómo generar UN render (rasterizar el PNG
 * de ESE piso vía `floorToPngBlob`, armar su prompt de `planFacts`, y llamar al
 * endpoint existente de un solo piso) — este módulo no conoce nada de eso, solo
 * orquesta la secuencia y el tally. Así se prueba la orquestación con un mock,
 * sin canvas ni red de por medio.
 */
export async function generateAllFloors(
  floors: FloorGraph[],
  generate: (floor: FloorGraph) => Promise<unknown>,
  onProgress?: (current: { floorId: string; floorName: string; index: number; total: number }) => void,
): Promise<FloorBatchSummary> {
  const results: FloorBatchResult[] = []
  for (let index = 0; index < floors.length; index++) {
    const floor = floors[index]
    onProgress?.({ floorId: floor.id, floorName: floor.name, index, total: floors.length })
    try {
      await generate(floor)
      results.push({ floorId: floor.id, floorName: floor.name, status: 'ok' })
    } catch (e) {
      results.push({
        floorId: floor.id, floorName: floor.name, status: 'error',
        error: e instanceof Error ? e.message : 'No se pudo generar el render',
      })
    }
  }
  return {
    total: floors.length,
    succeeded: results.filter(r => r.status === 'ok').length,
    failed: results.filter(r => r.status === 'error').length,
    results,
  }
}

/**
 * El resumen final en una sola línea, listo para mostrarse tal cual — la forma
 * exacta que pidió el diseño: "2 de 3 generados. Falló: Nivel 3 — [motivo]." Sin
 * fallos, se queda solo con el tally; con más de uno, "Fallaron" (plural) y los
 * junta con `;` en vez de fingir que solo hubo uno.
 */
export function formatBatchSummary(summary: FloorBatchSummary): string {
  const base = `${summary.succeeded} de ${summary.total} generados.`
  const failures = summary.results.filter((r): r is FloorBatchResult & { error: string } => r.status === 'error')
  if (failures.length === 0) return base
  const verb = failures.length === 1 ? 'Falló' : 'Fallaron'
  const detail = failures.map(f => `${f.floorName} — ${f.error}`).join('; ')
  return `${base} ${verb}: ${detail}.`
}
