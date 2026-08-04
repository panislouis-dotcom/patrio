import { describe, it, expect } from 'vitest'
import { CLEARABLE_FIELDS } from './types'
// El propio `properties_db.py`, como texto. Mismo truco que `fields.test.ts`:
// leerlo con `?raw` en vez de con `fs` evita meter @types/node al proyecto sólo
// para una prueba.
import propertiesDbSource from '../../../api/properties_db.py?raw'

/**
 * `CLEARABLE_FIELDS` del cliente dice ser un espejo de `properties_db.py`, y un
 * espejo escrito a mano se desincroniza en cuanto alguien retire un campo del
 * servidor. Pasó dos veces en un solo día al mover el costo de obra al
 * presupuesto: primero `constructionCostPerSqm`, luego `constructionOverhead`.
 *
 * El síntoma es feo y silencioso — la ficha ofrece un botón ✕ que dispara un
 * 422 «Campos no vaciables», o deja de ofrecer uno que sí existe — y ninguna de
 * las dos cosas la nota nadie hasta que un usuario la pisa. Así que en vez de
 * recordar la lista, se lee de la fuente.
 */
function pythonSet(name: string): string[] {
  const start = propertiesDbSource.indexOf(`${name} = frozenset({`)
  if (start < 0) throw new Error(`No encontré ${name} en properties_db.py`)
  const end = propertiesDbSource.indexOf('})', start)
  return [...propertiesDbSource.slice(start, end).matchAll(/"([a-zA-Z]+)"/g)].map(m => m[1])
}

describe('el espejo del contrato no se desincroniza en silencio', () => {
  it('CLEARABLE_FIELDS dice exactamente lo que properties_db permite vaciar', () => {
    const servidor = pythonSet('CLEARABLE_FIELDS')

    expect(servidor.length).toBeGreaterThan(10)  // si el recorte falla, esto avisa
    expect([...CLEARABLE_FIELDS].sort()).toEqual([...servidor].sort())
  })

  it('nada que el servidor no acepte escribir se ofrece como vaciable', () => {
    // Vaciar solo tiene sentido sobre algo que se captura. Cuando el costo de
    // obra pasó a ser la suma del presupuesto, sus dos insumos dejaron de ser
    // escribibles — y un campo vaciable que no es escribible es una fila de la
    // ficha que solo puede producir un 422.
    const escribibles = new Set(pythonSet('WRITABLE_FIELDS'))

    expect([...CLEARABLE_FIELDS].filter(f => !escribibles.has(f))).toEqual([])
  })
})
