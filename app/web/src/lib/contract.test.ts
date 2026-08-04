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
 * ═══ EL ARNÉS CONTRA LOS ESPEJOS ESCRITOS A MANO ═══
 *
 * El cliente lleva una decena de listas que dicen «espeja X del servidor»: qué
 * se puede escribir, qué se puede vaciar, qué supuestos existen, qué tipos de
 * activo admite la base, a qué etapas se puede avanzar, cuándo abre cada
 * herramienta, con qué supuestos corre el analizador. Cada una es una copia
 * hecha a mano de algo que vive en Python o en SQL, y ninguna tenía forma de
 * enterarse cuando el original cambiaba.
 *
 * Este archivo las lee de la fuente con `?raw` en vez de recordarlas. Es el
 * mismo truco que `fields.test.ts` ya usaba con `checks.py`, y evita meter
 * @types/node al proyecto sólo para una prueba.
 *
 * ─── POR QUÉ APUNTAN AL TIPO Y NO A LAS FIXTURES ───
 *
 * Ésta es la parte que no es obvia y que costó un bug caro, así que va escrita:
 *
 *   **Las fixtures no pueden desincronizarse estructuralmente — `tsc` las
 *   obliga. Lo que se desincroniza es `types.ts`. Y entonces las fixtures se
 *   acomodan al tipo equivocado, y la suite certifica el mundo viejo.**
 *
 * Cómo se vio: el servidor retiró `constructionOverhead` del contrato. El tipo
 * `Property` siguió declarándolo, así que las fixtures siguieron poniéndolo y
 * `tsc` siguió contento. La ficha leía `p.assumptions.constructionOverhead.source`
 * sobre un objeto que ya no venía —`undefined.source`— y la columna izquierda se
 * caía ENTERA contra el servidor real, con la suite en verde.
 *
 * Por eso no sirve de nada auditar fixtures: hay que atar el TIPO a su fuente.
 * Y por eso `ASSUMPTION_FIELDS` y `RAW_PROPERTY_FIELDS` son listas `as const` con
 * el tipo derivado de ellas en vez de uniones sueltas — un tipo no se puede
 * comparar contra nada en tiempo de ejecución; una lista sí, y para el
 * compilador es exactamente lo mismo.
 *
 * ─── QUÉ VIGILA CADA UNA, Y CONTRA QUÉ ───
 *
 *   CLEARABLE_FIELDS       ← properties_db.CLEARABLE_FIELDS
 *   RAW_PROPERTY_FIELDS    ← properties_db.WRITABLE_FIELDS
 *   ASSUMPTION_FIELDS      ← underwriting.ASSUMPTION_DEFAULTS
 *   ASSET/STRATEGY_TYPES   ← los CHECK de la migración 024
 *   ALLOWED_TRANSITIONS    ← el trigger de la migración 024
 *   las 4 ventanas de etapa ← los frozensets de properties_db
 *   ANALYSIS_DEFAULTS      ← los DEFAULT_* de analyzer.py
 *
 * Lo que cuesta cada desincronización está dicho en cada `it`, porque no es el
 * mismo daño: un vaciable de más es un botón que solo puede dar 422; un
 * escribible de más es un PATCH que se ignora en silencio; un tipo de activo de
 * más es un CHECK violado al guardar; una transición de más es un botón que
 * lleva a un error, y una de menos, un camino del negocio inalcanzable.
 *
 * ─── CÓMO SE MANTIENE HONESTO ───
 *
 * Estas pruebas se verifican POR MUTACIÓN, no por leerlas: cambiar cada lista
 * del cliente tiene que poner en rojo exactamente una. Una prueba de espejo que
 * no puede fallar es la enfermedad que este archivo cura, no la cura.
 *
 * Lo que NO vive aquí: la invariante «nada vaciable puede ser no escribible».
 * Es una relación entre dos frozensets de Python y su casa es
 * `test_property_routes.py::test_nothing_clearable_is_unwritable`, donde rompe
 * antes y en el idioma de quien la puede violar. Duplicarla daría dos rojos por
 * una sola causa. Desde este lado solo se puede ver una cosa —que la lista esté
 * copiada igual en los dos lenguajes— y eso es lo único que se prueba.
 */

/**
 * Los campos de un `frozenset({…})` de Python, leídos del archivo fuente.
 *
 * El recorte busca la línea literal `NOMBRE = frozenset({` y lee hasta el primer
 * `})`. Está anotado también del lado de `properties_db.py`, encima de las dos
 * listas: renombrarlas o cambiar esa forma rompe esta prueba, y romper está bien.
 */
function pythonSet(source: string, name: string): string[] {
  const start = source.indexOf(`${name} = frozenset({`)
  if (start < 0) throw new Error(`No encontré ${name} en properties_db.py`)
  const end = source.indexOf('})', start)
  // Los comentarios se quitan ANTES de buscar lo entrecomillado. Sin esto, una
  // palabra entre comillas dobles dentro de un `#` agrega un campo fantasma y la
  // comparación pasa o falla por la razón equivocada — que es peor que no tener
  // la prueba, porque una prueba que truena se arregla y una que miente se cree.
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
    // Éste se desincronizó DOS VECES en un solo día al mover el costo de obra al
    // presupuesto: primero `constructionCostPerSqm`, luego `constructionOverhead`.
    // Uno de más es un botón ✕ en la ficha que solo puede producir un 422
    // «Campos no vaciables»; uno de menos es un campo que sí se puede vaciar y
    // que la ficha deja de ofrecer. Ninguna de las dos la nota nadie hasta que un
    // usuario la pisa.
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
