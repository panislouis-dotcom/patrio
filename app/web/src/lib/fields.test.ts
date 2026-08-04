import { describe, it, expect } from 'vitest'
import { FIELD_LABEL, fieldLabel } from './fields'
import { validateRaw } from './validateRaw'
// El propio `checks.py`, como texto. Leerlo con `?raw` en vez de con `fs` evita
// meter @types/node al proyecto sólo para una prueba.
import checksSource from '../../../api/checks.py?raw'

/**
 * `FIELD_LABEL` es un espejo del contrato: la lista de `field` que un issue
 * puede traer la deciden `checks.py` (servidor) y `validateRaw.ts` (cliente).
 * Un espejo escrito a mano se desincroniza en cuanto alguien agregue una regla,
 * y el síntoma es que la ficha vuelve a publicar `VALUATIONDATE`. Así que en vez
 * de recordar la lista, se lee de la fuente.
 */
describe('toda etiqueta que la ficha puede necesitar existe', () => {
  it('cubre cada campo que checks.py puede emitir', () => {
    const emitted = new Set(
      [...checksSource.matchAll(/Issue\("([a-zA-Z]+)"|missing\["([a-zA-Z]+)"\]/g)]
        .map(m => m[1] ?? m[2]),
    )

    expect(emitted.size).toBeGreaterThan(10)   // si el regex deja de casar, esto avisa
    expect([...emitted].filter(f => !(f in FIELD_LABEL))).toEqual([])
  })

  it('cubre cada campo que validateRaw levanta en el cliente', () => {
    // Una captura vacía dispara los errores; una a medias, las advertencias.
    const issues = [
      ...validateRaw({}),
      ...validateRaw({ latitude: 1, longitude: 1, purchasePrice: 1, sqmLand: 1, constructionOverhead: 0.5 }),
    ]
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.map(i => i.field).filter(f => !(f in FIELD_LABEL))).toEqual([])
  })

  it('ninguna etiqueta se queda en inglés ni en camelCase', () => {
    for (const [field, label] of Object.entries(FIELD_LABEL)) {
      expect(label).not.toBe(field)
      expect(label).not.toMatch(/[a-z][A-Z]/)
    }
  })

  it('un campo sin etiqueta cae a su identificador en vez de romper la pantalla', () => {
    expect(fieldLabel('unCampoQueNadieRegistro')).toBe('unCampoQueNadieRegistro')
  })
})
