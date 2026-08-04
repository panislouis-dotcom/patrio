import { useEffect, useState } from 'react'
import { fetchBudgetTemplates } from '../../lib/api'
import type { BudgetTemplate } from '../../lib/types'
import { colors, fonts } from '../../lib/theme'
import { fmtMXN } from '../../lib/fmt'

/**
 * Las plantillas de obra. **Una plantilla es un presupuesto sin propiedad**, así
 * que su `id` es un id de presupuesto y se pasa tal cual a «arrancar desde»: el
 * mismo campo por el que viaja el presupuesto de otra obra.
 *
 * No hay «crear plantilla» aquí, y es la consecuencia honesta del modelo. Una
 * plantilla nace COPIANDO un presupuesto que ya existe —desde la pestaña
 * PRESUPUESTO de la obra que se quiere reusar— porque copiar es una sola
 * operación usada en tres direcciones. Un formulario de plantilla en blanco
 * sería un cuarto camino para llegar a lo mismo, y el cuarto es el que se queda
 * sin arreglar.
 *
 * Se edita como cualquier presupuesto: abriéndola. Lo que no tiene es propiedad.
 */
export function PlantillasObraPage() {
  const [templates, setTemplates] = useState<BudgetTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchBudgetTemplates()
      .then(setTemplates)
      .catch(e => setError(e instanceof Error ? e.message : 'No se pudieron cargar las plantillas'))
      .finally(() => setLoading(false))
  }, [])

  const micro: React.CSSProperties = {
    fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, whiteSpace: 'nowrap',
  }

  if (loading) {
    return (
      <div style={{ padding: '24px', fontFamily: fonts.label, fontSize: '11px', color: colors.secondary }}>
        Cargando…
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '20px 24px' }}>
      <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em', marginBottom: '4px' }}>
        PLANTILLAS DE OBRA
      </div>
      <div style={{ ...micro, whiteSpace: 'normal', maxWidth: '620px', marginBottom: '14px', lineHeight: 1.5 }}>
        Una plantilla es un presupuesto sin propiedad. Se crea desde la pestaña PRESUPUESTO
        de la obra que quieras reusar, con GUARDAR PLANTILLA; desde ahí cualquier otra obra
        puede arrancar de ella.
      </div>

      {error && (
        <div style={{ color: '#c0392b', fontFamily: fonts.sans, fontSize: '11px', marginBottom: '8px' }}>
          {error}
        </div>
      )}

      {templates.length === 0 && !error && (
        <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary }}>
          Todavía no hay plantillas. Guarda como plantilla el presupuesto de una obra que se
          vaya a parecer a las siguientes.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '620px' }}>
        {templates.map(t => (
          <div
            key={t.id}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
              borderBottom: `1px solid ${colors.border}`, padding: '8px 6px',
            }}
          >
            <span style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral }}>
              {t.name}
            </span>
            <span style={micro}>
              {t.lines} RENGLONES · {fmtMXN(t.total)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
