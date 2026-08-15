import { describe, it, expect, vi } from 'vitest'
import { generateAllFloors, formatBatchSummary, type FloorBatchSummary } from './generateAllFloors'
import { emptyFloorGraph, type FloorGraph } from './types'

function floors(...names: string[]): FloorGraph[] {
  return names.map(n => emptyFloorGraph(n))
}

describe('generateAllFloors', () => {
  it('llama a generate UNA vez por piso, en el mismo orden que la lista', async () => {
    const fs = floors('Planta Baja', 'Planta Alta', 'Azotea')
    const generate = vi.fn(async (f: FloorGraph) => `render-de-${f.name}`)

    await generateAllFloors(fs, generate)

    expect(generate).toHaveBeenCalledTimes(3)
    expect(generate.mock.calls.map(([f]) => f.name)).toEqual(['Planta Baja', 'Planta Alta', 'Azotea'])
  })

  it('es SECUENCIAL: nunca hay dos llamadas a generate en vuelo al mismo tiempo', async () => {
    const fs = floors('Planta Baja', 'Planta Alta', 'Azotea')
    let enVuelo = 0
    let maxEnVuelo = 0
    const generate = vi.fn(async () => {
      enVuelo++
      maxEnVuelo = Math.max(maxEnVuelo, enVuelo)
      await new Promise(r => setTimeout(r, 5))
      enVuelo--
      return 'ok'
    })

    await generateAllFloors(fs, generate)

    expect(maxEnVuelo).toBe(1)
  })

  it('un fallo en el piso 2 no cancela ni descarta el éxito de los pisos 1 y 3', async () => {
    const fs = floors('Planta Baja', 'Planta Alta', 'Azotea')
    const generate = vi.fn(async (f: FloorGraph) => {
      if (f.name === 'Planta Alta') throw new Error('OPENAI_API_KEY no está configurada')
      return `render-de-${f.name}`
    })

    const summary = await generateAllFloors(fs, generate)

    // Los 3 pisos se intentaron — el fallo de uno no detuvo la corrida.
    expect(generate).toHaveBeenCalledTimes(3)
    expect(summary.total).toBe(3)
    expect(summary.succeeded).toBe(2)
    expect(summary.failed).toBe(1)
  })

  it('el resumen final refleja el estado real de CADA piso, con el motivo del fallo', async () => {
    const fs = floors('Planta Baja', 'Planta Alta', 'Azotea')
    const generate = vi.fn(async (f: FloorGraph) => {
      if (f.name === 'Planta Alta') throw new Error('OPENAI_API_KEY no está configurada')
      return 'ok'
    })

    const { results } = await generateAllFloors(fs, generate)

    expect(results).toEqual([
      { floorId: fs[0].id, floorName: 'Planta Baja', status: 'ok' },
      { floorId: fs[1].id, floorName: 'Planta Alta', status: 'error', error: 'OPENAI_API_KEY no está configurada' },
      { floorId: fs[2].id, floorName: 'Azotea', status: 'ok' },
    ])
  })

  it('un fallo sin Error (p.ej. un throw de string) cae a un mensaje genérico, no truena', async () => {
    const fs = floors('Planta Baja')
    const generate = vi.fn(async () => { throw 'boom' })

    const { results } = await generateAllFloors(fs, generate)

    expect(results[0].status).toBe('error')
    expect(results[0].error).toBeTruthy()
  })

  it('reporta progreso ANTES de cada llamada, con el índice y el total correctos', async () => {
    const fs = floors('Planta Baja', 'Planta Alta')
    const onProgress = vi.fn()
    const generate = vi.fn(async () => 'ok')

    await generateAllFloors(fs, generate, onProgress)

    expect(onProgress).toHaveBeenNthCalledWith(1, { floorId: fs[0].id, floorName: 'Planta Baja', index: 0, total: 2 })
    expect(onProgress).toHaveBeenNthCalledWith(2, { floorId: fs[1].id, floorName: 'Planta Alta', index: 1, total: 2 })
  })

  it('con cero pisos no llama a generate y regresa un resumen vacío', async () => {
    const generate = vi.fn(async () => 'ok')
    const summary = await generateAllFloors([], generate)

    expect(generate).not.toHaveBeenCalled()
    expect(summary).toEqual({ total: 0, succeeded: 0, failed: 0, results: [] })
  })
})

describe('formatBatchSummary', () => {
  it('sin fallos: solo el tally', () => {
    const summary: FloorBatchSummary = {
      total: 3, succeeded: 3, failed: 0,
      results: [
        { floorId: '1', floorName: 'Planta Baja', status: 'ok' },
        { floorId: '2', floorName: 'Planta Alta', status: 'ok' },
        { floorId: '3', floorName: 'Azotea', status: 'ok' },
      ],
    }
    expect(formatBatchSummary(summary)).toBe('3 de 3 generados.')
  })

  it('un solo fallo: singular "Falló" con el nombre del piso y el motivo', () => {
    const summary: FloorBatchSummary = {
      total: 3, succeeded: 2, failed: 1,
      results: [
        { floorId: '1', floorName: 'Planta Baja', status: 'ok' },
        { floorId: '2', floorName: 'Nivel 3', status: 'error', error: 'OPENAI_API_KEY no está configurada' },
        { floorId: '3', floorName: 'Azotea', status: 'ok' },
      ],
    }
    expect(formatBatchSummary(summary)).toBe(
      '2 de 3 generados. Falló: Nivel 3 — OPENAI_API_KEY no está configurada.',
    )
  })

  it('varios fallos: plural "Fallaron" y los junta todos', () => {
    const summary: FloorBatchSummary = {
      total: 3, succeeded: 1, failed: 2,
      results: [
        { floorId: '1', floorName: 'Planta Baja', status: 'ok' },
        { floorId: '2', floorName: 'Planta Alta', status: 'error', error: 'boom' },
        { floorId: '3', floorName: 'Azotea', status: 'error', error: 'crash' },
      ],
    }
    expect(formatBatchSummary(summary)).toBe(
      '1 de 3 generados. Fallaron: Planta Alta — boom; Azotea — crash.',
    )
  })
})
