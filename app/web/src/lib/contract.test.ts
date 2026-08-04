import { describe, it, expect } from 'vitest'
import {
  ASSET_TYPES, ASSUMPTION_FIELDS, ANALYSIS_DEFAULTS,
  CLEARABLE_FIELDS, RAW_PROPERTY_FIELDS, STRATEGY_TYPES,
} from './types'
import { ALLOWED_TRANSITIONS } from './status'
// El propio `properties_db.py`, como texto. Mismo truco que `fields.test.ts`:
// leerlo con `?raw` en vez de con `fs` evita meter @types/node al proyecto sólo
// para una prueba.
import propertiesDbSource from '../../../api/properties_db.py?raw'
import underwritingSource from '../../../api/finance/underwriting.py?raw'
import analyzerSource from '../../../api/analyzer.py?raw'
import migration024 from '../../../../db/migrations/024_properties.sql?raw'
import statusSource from './status.ts?raw'

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
  return [...cuerpo.matchAll(/"([a-zA-Z_]+)"/g)].map(m => m[1])
}

const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

/** Los valores de un `CHECK (col IN (…))` de la migración 024. */
function sqlCheckValues(column: string): string[] {
  const re = new RegExp(`${column} +TEXT[^\\n]*CHECK \\(${column} IN\\s*\\(([^)]*)\\)`, 's')
  const m = migration024.match(re)
  if (!m) throw new Error(`No encontré el CHECK de ${column} en la migración 024`)
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1])
}

/**
 * Una de las listas de etapas de `status.ts`, leída del propio archivo. Son
 * `const` de módulo y no se exportan —solo se exportan los predicados que las
 * usan—, así que ésta es la forma de compararlas sin ensanchar su superficie
 * pública nada más para poder probarlas.
 */
function statusList(name: string): string[] {
  const re = new RegExp(`${name}: readonly PropertyStatus\\[\\] = \\[([^\\]]*)\\]`)
  const m = statusSource.match(re)
  if (!m) throw new Error(`No encontré ${name} en status.ts`)
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1])
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

  it('los campos escribibles del cliente son los que el servidor acepta escribir', () => {
    // Un campo que el servidor retira y aquí sobrevive es un PATCH que se
    // ignora o se rechaza sin que nada lo note. Pasó con `constructionCostPerSqm`
    // y `constructionOverhead` el día que el costo de obra pasó al presupuesto.
    // Los dos que el cliente manda aparte —no son filas de la ficha— se suman
    // aquí para comparar el conjunto completo.
    const cliente = new Set<string>([...RAW_PROPERTY_FIELDS, 'milestones', 'isFavorite'])
    const servidor = new Set(pythonSet(propertiesDbSource, 'WRITABLE_FIELDS'))

    expect([...cliente].sort()).toEqual([...servidor].sort())
  })

  it('los supuestos son los que el modelo resuelve, y no uno más', () => {
    // ÉSTE es el que ya mordió. `constructionOverhead` siguió aquí después de
    // que el servidor lo retirara, y la ficha leía `assumptions[...].source` de
    // un objeto que no venía: `undefined.source` tumbaba la columna izquierda
    // entera, con la suite en verde porque la fixture describía el mundo viejo.
    const bloque = underwritingSource.slice(
      underwritingSource.indexOf('ASSUMPTION_DEFAULTS'),
      underwritingSource.indexOf('ASSUMPTION_KEYS'))
    const servidor = [...bloque.matchAll(/"([a-z_]+)":/g)].map(m => snakeToCamel(m[1]))

    expect([...ASSUMPTION_FIELDS].sort()).toEqual(servidor.sort())
  })

  it('los tipos de activo y de estrategia son los que la base admite', () => {
    // La ficha los ofrece en un <select>. Uno de más es una opción que solo
    // puede terminar en un CHECK violado al guardar.
    expect([...ASSET_TYPES]).toEqual(sqlCheckValues('asset_type'))
    expect([...STRATEGY_TYPES]).toEqual(sqlCheckValues('strategy_type'))
  })

  it('AVANZAR A ofrece exactamente lo que el trigger de la base deja pasar', () => {
    // Tres capas validan la transición —UI, servidor y base— y eso está bien
    // mientras las tres digan lo mismo. Si la UI ofrece de más, el botón lleva a
    // un error; si ofrece de menos, hay un camino del negocio inalcanzable.
    const trigger = Object.fromEntries(
      [...migration024.matchAll(/WHEN '(\w+)' +THEN NEW\.status IN \(([^)]*)\)/g)]
        .map(m => [m[1], [...m[2].matchAll(/'(\w+)'/g)].map(x => x[1]).sort()]))
    const cliente = Object.fromEntries(
      Object.entries(ALLOWED_TRANSITIONS)
        .filter(([, destinos]) => destinos.length > 0)
        .map(([desde, destinos]) => [desde, [...destinos].sort()]))

    expect(Object.keys(trigger).length).toBeGreaterThan(2)
    expect(cliente).toEqual(trigger)
  })

  it('las ventanas de cada herramienta abren en las mismas etapas que en el servidor', () => {
    // Si divergen, una herramienta aparece en una etapa donde el servidor
    // responde 422, o se esconde donde sí se podía usar.
    for (const nombre of ['INVESTOR_STATUSES', 'PROFIT_STATUSES',
                          'ANALYSIS_STATUSES', 'PROCESS_STATUSES'] as const) {
      const servidor = pythonSet(propertiesDbSource, nombre).sort()
      const cliente = [...statusList(nombre)].sort()
      expect({ [nombre]: cliente }).toEqual({ [nombre]: servidor })
    }
  })

  it('los supuestos del analizador valen lo mismo de los dos lados', () => {
    // El formulario los prellena y el servidor los aplica cuando no vienen. Si
    // difieren, la pantalla promete correr un análisis con una tasa y el
    // servidor lo corre con otra — y el snapshot guarda la del servidor.
    for (const [clave, valor] of Object.entries(ANALYSIS_DEFAULTS)) {
      const constante = `DEFAULT_${clave.replace(/([A-Z])/g, '_$1').toUpperCase()}`
      const encontrado = analyzerSource.match(new RegExp(`^${constante} = ([\\d.]+)`, 'm'))
      // Se comparan como NÚMEROS y no como texto: `0.10` y `0.1` son el mismo
      // supuesto escrito de dos maneras, y el espejo es sobre el valor.
      expect({ [constante]: encontrado && Number(encontrado[1]) }).toEqual({ [constante]: valor })
    }
  })
})
