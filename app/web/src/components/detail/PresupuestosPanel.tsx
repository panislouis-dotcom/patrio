import { useEffect, useState } from 'react'
import type React from 'react'
import { colors, fonts } from '../../lib/theme'
import { BudgetPanel } from './BudgetPanel'
import { createPlanBudget, fetchBudget, usePlanBudget } from '../../lib/api'
import type { Budget, Property } from '../../lib/types'
import type { FloorPlanModel } from '../../lib/floorplan/types'

const chip = (active: boolean): React.CSSProperties => ({
  cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em',
  padding: '4px 10px', border: `1px solid ${active ? colors.primary : colors.border}`,
  background: active ? colors.surfaceAlt : 'transparent',
  color: active ? colors.neutral : colors.secondary,
})
const label: React.CSSProperties = {
  fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em', color: colors.secondary,
}
const outlined: React.CSSProperties = {
  cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em',
  padding: '5px 12px', background: 'none', border: `1px solid ${colors.border}`, color: colors.secondary,
}
const primary: React.CSSProperties = { ...outlined, border: `1px solid ${colors.primary}`, color: colors.primary }

interface Props {
  property: Property
  geometry: FloorPlanModel | null
  onPropertyChange: (property: Property) => void
}

/**
 * PRESUPUESTO con ámbitos: el de la PROPIEDAD (el compromiso vigente — el único
 * que alimenta totalInvestment/ROI) y el ESCENARIO de cada plan de proyecto
 * (addendum 2026-08-24). El panel de adentro es el mismo `BudgetPanel` de
 * siempre, remontado por `key` de ámbito con `planId`; este wrapper solo decide
 * cuál, hace nacer escenarios (copiado de la propiedad o vacío — nunca al
 * leer), y ofrece «USAR EN LA PROPIEDAD» (copy_lines del servidor: deduplicar
 * es saltar, lo capturado no se pisa).
 *
 * En ámbito de escenario, las cifras del pie (presupuestado/comprometido/
 * pagado) se calculan DE SUS RENGLONES y viajan en una Property "disfrazada":
 * las reales de la propiedad describen su compromiso, no esta propuesta. La
 * advertencia de redondeo del BudgetPanel no aplica aquí — un escenario no
 * tiene cifra de ficha contra la cual desentonar.
 */
export function PresupuestosPanel({ property, geometry, onPropertyChange }: Props) {
  const plans = geometry?.variants.plans ?? []
  const [scope, setScope] = useState<string | null>(null)   // null = propiedad
  const active = scope != null ? plans.find(p => p.id === scope) ?? null : null

  const [scenario, setScenario] = useState<Budget | null>(null)
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmUse, setConfirmUse] = useState(false)

  // El ámbito de un plan borrado cae de vuelta a la propiedad.
  useEffect(() => {
    if (scope != null && !plans.some(p => p.id === scope)) setScope(null)
  }, [scope, plans])

  useEffect(() => {
    if (active == null) { setScenario(null); setMissing(false); return }
    let alive = true
    setScenario(null); setMissing(false); setError(null); setNotice(null); setConfirmUse(false)
    fetchBudget(property.id, active.id)
      .then(b => { if (alive) setScenario(b) })
      .catch(e => {
        if (!alive) return
        const msg = e instanceof Error ? e.message : ''
        // El 404 esperado (sin escenario todavía) abre el nacimiento; cualquier
        // otra cosa es un error real y se dice.
        if (msg.includes('no tiene presupuesto')) setMissing(true)
        else setError(msg || 'No se pudo leer el presupuesto del plan')
      })
    return () => { alive = false }
  }, [property.id, active?.id])   // eslint-disable-line react-hooks/exhaustive-deps

  async function birth(copyFromProperty: boolean) {
    if (!active) return
    setBusy(true); setError(null)
    try {
      const { budget, linesAdded, linesSkipped } = await createPlanBudget(
        property.id, active.id, copyFromProperty)
      setScenario(budget); setMissing(false)
      setNotice(copyFromProperty
        ? `Nació copiado: ${linesAdded} renglones${linesSkipped ? `, ${linesSkipped} saltados` : ''}.`
        : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el presupuesto del plan')
    } finally { setBusy(false) }
  }

  async function usePlan() {
    if (!active) return
    setBusy(true); setError(null)
    try {
      const { property: updated, linesAdded, linesSkipped } = await usePlanBudget(property.id, active.id)
      onPropertyChange(updated)
      setConfirmUse(false)
      setNotice([
        (linesAdded ?? 0) > 0 ? `${linesAdded} renglones entraron al presupuesto de la propiedad.` : null,
        linesSkipped ? `${linesSkipped} ya estaban: no se sobrescribe nada.` : null,
      ].filter(Boolean).join(' ') || 'No había nada nuevo que copiar.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo usar este plan')
    } finally { setBusy(false) }
  }

  /** La Property disfrazada del escenario: mismas claves, cifras de SUS
   * renglones. `committed`/`paid` con la semántica de suma SQL (null si ningún
   * renglón trae el dato — null sobre cero fabricado). */
  function scenarioProperty(b: Budget): Property {
    const nums = (vals: (number | null | undefined)[]) => {
      const real = vals.filter((v): v is number => v != null)
      return real.length ? real.reduce((a, v) => a + v, 0) : null
    }
    const budgeted = b.lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0)
    const paid = nums(b.lines.map(l => l.payments?.length
      ? l.payments.reduce((a, p) => a + p.amount, 0) : null))
    return {
      ...property,
      constructionBudgeted: budgeted,
      constructionCommitted: nums(b.lines.map(l => l.committedAmount)),
      constructionPaid: paid,
      constructionPaidVariance: null,
    }
  }

  /** El BudgetPanel de adentro reporta la Property REAL tras cada escritura (el
   * servidor la relee; un escenario no le mueve un peso — eso es lo que la
   * batería del backend garantiza). Se reenvía tal cual a la página, y el
   * escenario se relee para que el pie disfrazado no se quede viejo. */
  function onScenarioWrite(updated: Property) {
    onPropertyChange(updated)
    if (active) fetchBudget(property.id, active.id).then(setScenario).catch(() => {})
  }

  const scopeBar = (
    <div style={{ flexShrink: 0, display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap',
      padding: '6px 16px', borderBottom: `1px solid ${colors.border}`, background: colors.dark }}>
      <span style={label}>PRESUPUESTO DE</span>
      <button style={chip(scope == null)} onClick={() => setScope(null)}>PROPIEDAD</button>
      {plans.map(p => (
        <button key={p.id} style={chip(scope === p.id)} onClick={() => setScope(p.id)}>
          {p.name}
        </button>
      ))}
      <div style={{ flex: 1 }} />
      {notice && <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>{notice}</span>}
      {error && <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.tertiary }}>{error}</span>}
      {active && scenario && (confirmUse ? (
        <>
          <span style={label}>ENTRA AL PRESUPUESTO DE LA PROPIEDAD — LO YA CAPTURADO NO SE PISA</span>
          <button onClick={() => setConfirmUse(false)} disabled={busy} style={outlined}>CANCELAR</button>
          <button onClick={usePlan} disabled={busy} style={primary}>
            {busy ? 'COPIANDO…' : '¿CONFIRMAR USAR?'}
          </button>
        </>
      ) : (
        <button onClick={() => setConfirmUse(true)} style={primary}>USAR EN LA PROPIEDAD</button>
      ))}
    </div>
  )

  let body: React.ReactNode
  if (active == null) {
    body = <BudgetPanel key="propiedad" property={property} onPropertyChange={onPropertyChange} />
  } else if (missing) {
    body = (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: '12px', background: colors.dark, padding: '32px' }}>
        <div style={label}>ESTE PLAN NO TIENE PRESUPUESTO TODAVÍA</div>
        <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary,
          textAlign: 'center', maxWidth: '380px' }}>
          El escenario de un plan responde «¿cuánto costaría esta propuesta?» — nunca
          mueve la inversión de la propiedad. Nace copiado del presupuesto actual o vacío.
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => birth(true)} disabled={busy} style={primary}>
            {busy ? 'CREANDO…' : 'COPIADO DE LA PROPIEDAD'}
          </button>
          <button onClick={() => birth(false)} disabled={busy} style={outlined}>EMPEZAR VACÍO</button>
        </div>
      </div>
    )
  } else if (scenario) {
    body = (
      <BudgetPanel
        key={`plan-${active.id}`}
        property={scenarioProperty(scenario)}
        onPropertyChange={onScenarioWrite}
        planId={active.id}
      />
    )
  } else {
    body = <div style={{ ...label, padding: '24px' }}>CARGANDO…</div>
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {plans.length > 0 && scopeBar}
      {body}
    </div>
  )
}
