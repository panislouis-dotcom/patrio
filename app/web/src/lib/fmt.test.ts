import { describe, it, expect } from 'vitest'
import { fmtPct, fmtPctSigned, fmtMonth, fmtM, fmtMXN } from './fmt'

/**
 * Una sola regla, y es la que el backend defiende columna por columna: vacío es
 * «—», cero es cero. Estas pruebas existen porque durante meses no hubo ninguna
 * y las tres funciones traducían 0 a guion sin que nada lo notara.
 */
describe('vacío es «—», cero es cero', () => {
  it('solo null y undefined dan guion', () => {
    for (const fmt of [fmtPct, fmtM, fmtMXN]) {
      expect(fmt(null)).toBe('—')
      expect(fmt(undefined)).toBe('—')
    }
  })

  it('un cero se imprime como cero, no como ausencia', () => {
    // Las tres preguntas que se veían idénticas: un ROI que salió parejo, una
    // venta a costo exacto y una inversión de cero son hechos, no huecos.
    expect(fmtPct(0)).toBe('0.0%')
    expect(fmtM(0)).toBe('$0')
    expect(fmtMXN(0)).toBe('$0')
  })
})

describe('fmtPct', () => {
  it('una fracción guardada se lee en porcentaje', () => {
    expect(fmtPct(0.062)).toBe('6.2%')
    expect(fmtPct(1)).toBe('100.0%')
  })

  it('un rendimiento negativo conserva su signo', () => {
    expect(fmtPct(-0.153)).toBe('-15.3%')
  })
})

describe('fmtPctSigned', () => {
  it('firma lo positivo, que es lo que fmtPct no hace', () => {
    // El mismo dato salía «+21.0%» en el héroe y «21.0%» en la fila de abajo.
    expect(fmtPctSigned(0.21)).toBe('+21.0%')
    expect(fmtPct(0.21)).toBe('21.0%')
  })

  it('un negativo trae su signo y un cero no lleva ninguno', () => {
    expect(fmtPctSigned(-0.153)).toBe('-15.3%')
    expect(fmtPctSigned(0)).toBe('0.0%')
  })

  it('vacío sigue siendo guion', () => {
    expect(fmtPctSigned(null)).toBe('—')
  })
})

describe('fmtMonth', () => {
  it('imprime el mes en letra y el año', () => {
    expect(fmtMonth('2026-01')).toBe('ene 2026')
    expect(fmtMonth('2026-12')).toBe('dic 2026')
  })

  it('tira el día: la captura es por mes y la pantalla no inventa precisión', () => {
    // Las filas guardadas traen día 1 heredado de la migración, no elegido.
    expect(fmtMonth('2025-01-01')).toBe('ene 2025')
    expect(fmtMonth('2026-04-15')).toBe('abr 2026')
  })

  it('vacío es guion', () => {
    expect(fmtMonth(null)).toBe('—')
    expect(fmtMonth('')).toBe('—')
  })

  it('lo ilegible se devuelve tal cual en vez de inventar un mes', () => {
    expect(fmtMonth('no-es-fecha')).toBe('no-es-fecha')
    expect(fmtMonth('2026-13')).toBe('2026-13')
  })
})

describe('fmtM', () => {
  it('compacta a millones y miles', () => {
    expect(fmtM(2_400_000)).toBe('$2.4M')
    expect(fmtM(850_000)).toBe('$850k')
    expect(fmtM(999)).toBe('$999')
  })

  it('un monto negativo lleva el signo delante del peso, no dentro', () => {
    // Antes caía al último caso y salía «$-2400000»: ni compactado ni legible.
    expect(fmtM(-2_400_000)).toBe('-$2.4M')
    expect(fmtM(-850_000)).toBe('-$850k')
    expect(fmtM(-999)).toBe('-$999')
  })
})

describe('fmtMXN', () => {
  it('separa los miles', () => {
    expect(fmtMXN(1_234_567)).toBe('$1,234,567')
  })

  it('redondea a pesos enteros', () => {
    expect(fmtMXN(1234.56)).toBe('$1,235')
  })

  it('un monto negativo lleva el signo delante del peso', () => {
    expect(fmtMXN(-1_234_567)).toBe('-$1,234,567')
  })
})
