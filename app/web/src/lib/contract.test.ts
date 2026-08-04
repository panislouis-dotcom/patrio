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
 *
 * Y esto es lo ÚNICO que se prueba desde aquí. La invariante «nada vaciable
 * puede ser no escribible» es una relación entre dos frozensets de Python y vive
 * donde le toca — `test_property_routes.py::test_nothing_clearable_is_unwritable`
 * —, porque ahí rompe antes y en el idioma de quien la puede violar. Duplicarla
 * aquí daría dos rojos por una sola causa. Lo que sí solo se puede ver desde
 * este lado es que la lista esté copiada igual en los dos lenguajes.
 */
function pythonSet(source: string, name: string): string[] {
  const start = source.indexOf(`${name} = frozenset({`)
  if (start < 0) throw new Error(`No encontré ${name} en properties_db.py`)
  const end = source.indexOf('})', start)
  // Los comentarios se quitan ANTES de buscar lo entrecomillado. Sin esto, una
  // palabra entre comillas dobles dentro de un `#` agrega un campo fantasma y la
  // comparación pasa o falla por la razón equivocada — que es peor que no tener
  // la prueba, porque una prueba que miente se cree.
  const cuerpo = source.slice(start, end).replace(/#.*$/gm, '')
  return [...cuerpo.matchAll(/"([a-zA-Z]+)"/g)].map(m => m[1])
}

describe('el espejo del contrato no se desincroniza en silencio', () => {
  it('CLEARABLE_FIELDS dice exactamente lo que properties_db permite vaciar', () => {
    const servidor = pythonSet(propertiesDbSource, 'CLEARABLE_FIELDS')

    expect(servidor.length).toBeGreaterThan(10)  // si el recorte falla, esto avisa
    expect([...CLEARABLE_FIELDS].sort()).toEqual([...servidor].sort())
  })

  it('un comentario dentro de las llaves no inventa un campo', () => {
    // El modo de falla que hay que evitar no es que la prueba truene —eso está
    // bien— sino que MIENTA. Se fija contra una fuente sintética porque el
    // archivo real hoy no tiene comentarios ahí dentro, y la prueba tiene que
    // seguir siendo cierta el día que alguien meta uno.
    const fuente = [
      'CLEARABLE_FIELDS = frozenset({',
      '    "assetType",',
      '    # ojo: "purchasePrice" se retiró en la 028',
      '    "sqmLand",  # y "permitsCost" también',
      '})',
    ].join('\n')

    expect(pythonSet(fuente, 'CLEARABLE_FIELDS')).toEqual(['assetType', 'sqmLand'])
  })
})
