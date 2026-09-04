import { useEffect, useMemo, useRef, useState } from 'react'
import type { Property } from '../lib/types'
import type { PropertyStatus } from '../lib/status'
import type { ProspectusOptions } from '../lib/api'
import { colors, fonts } from '../lib/theme'
import { migrateGeometry, type ProjectPlan } from '../lib/floorplan/types'

/**
 * Las páginas que no cuelgan de ninguna propiedad y los bloques que se repiten
 * dentro de cada oportunidad. Las claves son las del contrato del API, no un
 * alias local: el menú es la única pantalla que las escribe, y traducirlas dos
 * veces (aquí y en el `fetch`) es la forma más barata de que se desincronicen.
 */
type PageKey = Exclude<keyof ProspectusOptions, 'propertyIds' | 'planIds'>

const STANDALONE_PAGES: Array<[PageKey, string]> = [
  ['cover', 'Portada'],
  ['portfolioSummary', 'Resumen de portafolio'],
  ['closing', 'Cierre'],
]

const OPPORTUNITY_BLOCKS: Array<[PageKey, string]> = [
  ['opportunityFees', 'Comisiones del fondo'],
  ['opportunityGallery', 'Galería de fotos'],
  ['opportunityPlans', 'Plano y propuesta'],
  ['opportunityRenders', 'Fotos y propuesta'],
  ['opportunityBudget', 'Presupuesto de obra'],
  ['opportunityScenarioVenta', 'Escenario venta'],
  ['opportunityScenarioRenta', 'Escenario renta'],
]

/**
 * Las secciones del prospecto, con las etapas que las llenan. Es el mismo corte
 * que hace el documento —lo que ya rindió, lo que está en obra, lo que sigue
 * abierto a inversión— y por eso `vendida` y `en_renta` caen juntas: las dos son
 * track record, una con su precio de venta y la otra con su marca de hoy.
 */
const SECTIONS: Array<{ key: string; label: string; statuses: PropertyStatus[] }> = [
  { key: 'track', label: 'Track Record', statuses: ['vendida', 'en_renta'] },
  { key: 'desarrollo', label: 'En Desarrollo', statuses: ['desarrollo'] },
  { key: 'oportunidades', label: 'Oportunidades', statuses: ['oferta', 'prospecto'] },
]

const OPPORTUNITY_SECTION = 'oportunidades'

const STORAGE_KEY = 'prospectoExclusiones'

interface StoredExclusions {
  propertyIds: number[]
  pages: PageKey[]
  /** Plan ids EXCLUIDOS por propiedad — misma filosofía que propertyIds: un plan
   * nuevo entra por omisión; el peor caso es visible («sobró una sección»), no
   * invisible. */
  plans: Record<number, string[]>
}

const EMPTY: StoredExclusions = { propertyIds: [], pages: [], plans: {} }

/**
 * SE GUARDA LO QUE EL USUARIO APAGÓ, NUNCA LO QUE DEJÓ PRENDIDO.
 *
 * Parece un rodeo —la lista de incluidas es la que se manda al API, guardar esa
 * sería más directo— y es exactamente al revés. Una lista de INCLUIDAS es una
 * foto del inventario del día que se guardó: la propiedad que alguien marque con
 * ★ mañana no aparece en ella, así que se quedaría fuera del prospecto sin que
 * nadie la haya sacado y sin nada en pantalla que lo delate. Guardando las
 * EXCLUIDAS, lo que no se conoce entra por omisión: el peor caso pasa de «faltó
 * una propiedad y nadie se enteró» a «sobró una página», que se ve y se corrige.
 *
 * Por lo mismo el menú PODA al abrirse (ver `pruneToFavorites`): una exclusión
 * de una propiedad que ya no es favorita es basura que sobrevive a que la
 * quiten y la vuelvan a marcar con ★, y la escondería para siempre.
 */
function readExclusions(): StoredExclusions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<StoredExclusions> | null
    return {
      propertyIds: Array.isArray(parsed?.propertyIds)
        ? parsed.propertyIds.filter((n): n is number => typeof n === 'number')
        : [],
      pages: Array.isArray(parsed?.pages)
        ? parsed.pages.filter((p): p is PageKey => typeof p === 'string')
        : [],
      plans: parsed?.plans && typeof parsed.plans === 'object' && !Array.isArray(parsed.plans)
        ? Object.fromEntries(Object.entries(parsed.plans)
            .map(([k, v]) => [Number(k), Array.isArray(v) ? v.filter(x => typeof x === 'string') : []])
            .filter(([k]) => Number.isFinite(k as number)))
        : {},
    }
  } catch {
    // Un `localStorage` corrupto o inaccesible no puede tumbar la tabla entera:
    // sin preferencias guardadas, el prospecto lleva todo, que es el default.
    return EMPTY
  }
}

function writeExclusions(propertyIds: Set<number>, pages: Set<PageKey>,
                         plans: Record<number, string[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      propertyIds: [...propertyIds],
      pages: [...pages],
      plans,
    }))
  } catch { /* modo privado, cuota llena: la sesión sigue, solo no se recuerda */ }
}

const toggled = <T,>(set: Set<T>, key: T): Set<T> => {
  const next = new Set(set)
  next.has(key) ? next.delete(key) : next.add(key)
  return next
}

interface ProspectusMenuProps {
  /** El inventario completo; el menú se queda con las favoritas. */
  properties: Property[]
  generating: boolean
  onGenerate: (options: ProspectusOptions) => void
}

export function ProspectusMenu({ properties, generating, onGenerate }: ProspectusMenuProps) {
  const [open, setOpen] = useState(false)
  const [excludedIds, setExcludedIds] = useState<Set<number>>(() => new Set(readExclusions().propertyIds))
  const [excludedPages, setExcludedPages] = useState<Set<PageKey>>(() => new Set(readExclusions().pages))
  const [excludedPlans, setExcludedPlans] = useState<Record<number, string[]>>(() => readExclusions().plans)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  /**
   * El prospecto se arma con las favoritas: marcarlas con ★ ES la selección, y
   * el menú solo decide qué se le quita a esa lista.
   *
   * Las archivadas quedan fuera aunque tengan ★, porque archivar es sacar del
   * inventario y ninguna sección del documento las recibe. Sin este filtro, la
   * lista del menú cambiaría al prender «VER ARCHIVADAS» en la tabla —la misma
   * propiedad apareciendo o no según un botón que no tiene nada que ver— y las
   * que no caben en ninguna sección se contarían para el total sin dibujarse.
   */
  const favorites = useMemo(
    () => properties.filter(p => p.isFavorite && SECTIONS.some(s => s.statuses.includes(p.status))),
    [properties],
  )

  // Los planes de cada oportunidad, resueltos del blob crudo con el MISMO
  // migrador del editor — una sola lectura del modelo, nunca una segunda forma.
  // Solo oportunidades: son las únicas cuyas propuestas imprime el documento.
  const plansByProperty = useMemo(() => {
    const out = new Map<number, ProjectPlan[]>()
    for (const p of favorites) {
      if (!SECTIONS.find(s => s.key === OPPORTUNITY_SECTION)!.statuses.includes(p.status)) continue
      const model = migrateGeometry(p.geometry)
      if (model && model.variants.plans.length > 0) out.set(p.id, model.variants.plans)
    }
    return out
  }, [favorites])

  useEffect(() => { writeExclusions(excludedIds, excludedPages, excludedPlans) },
            [excludedIds, excludedPages, excludedPlans])

  // Podar al abrir, no al montar: es el momento en que el usuario va a leer la
  // lista, y una exclusión de algo que ya no es favorito no tiene renglón donde
  // enseñarse. Si sobreviviera, quitar la ★ y volver a ponerla dejaría a esa
  // propiedad fuera del PDF sin casilla que lo explique.
  useEffect(() => {
    if (!open) return
    const alive = new Set(favorites.map(p => p.id))
    setExcludedIds(prev => {
      const pruned = new Set([...prev].filter(id => alive.has(id)))
      return pruned.size === prev.size ? prev : pruned
    })
    // Misma poda para planes: una exclusión de un plan borrado/renombrado de id
    // no tiene casilla donde enseñarse y escondería sus sucesores para siempre.
    setExcludedPlans(prev => {
      const next: Record<number, string[]> = {}
      for (const [pidRaw, planIds] of Object.entries(prev)) {
        const pid = Number(pidRaw)
        const livePlans = plansByProperty.get(pid)
        if (!livePlans) continue
        const liveIds = new Set(livePlans.map(pl => pl.id))
        const kept = planIds.filter(id => liveIds.has(id))
        if (kept.length > 0) next[pid] = kept
      }
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next
    })
  }, [open, favorites, plansByProperty])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const groups = SECTIONS
    .map(s => ({ ...s, rows: favorites.filter(p => s.statuses.includes(p.status)) }))
    .filter(g => g.rows.length > 0)

  const includedIds = favorites.filter(p => !excludedIds.has(p.id)).map(p => p.id)
  const pageOn = (key: PageKey) => !excludedPages.has(key)

  /**
   * Con TODAS las favoritas adentro no se manda la lista: se omite el campo y el
   * servidor las resuelve él. No es un ahorro de bytes — es que la lista se
   * arma con lo que esta pantalla tiene cargado, y omitirla deja que el PDF
   * incluya lo que se haya marcado con ★ mientras tanto.
   */
  // Mismo contrato que propertyIds, por propiedad: solo se manda la entrada de
  // una propiedad CON exclusiones — ausente significa "todos sus planes", así un
  // plan creado mañana entra sin tocar el menú.
  const planSelections: Record<number, string[]> = {}
  for (const [pid, excluded] of Object.entries(excludedPlans)) {
    const live = plansByProperty.get(Number(pid))
    if (!live || excluded.length === 0) continue
    const excludedSet = new Set(excluded)
    planSelections[Number(pid)] = live.filter(pl => !excludedSet.has(pl.id)).map(pl => pl.id)
  }

  const options: ProspectusOptions = {
    ...(includedIds.length === favorites.length ? {} : { propertyIds: includedIds }),
    ...(Object.keys(planSelections).length > 0 ? { planIds: planSelections } : {}),
    cover: pageOn('cover'),
    portfolioSummary: pageOn('portfolioSummary'),
    closing: pageOn('closing'),
    opportunityFees: pageOn('opportunityFees'),
    opportunityGallery: pageOn('opportunityGallery'),
    opportunityPlans: pageOn('opportunityPlans'),
    opportunityRenders: pageOn('opportunityRenders'),
    opportunityBudget: pageOn('opportunityBudget'),
    opportunityScenarioVenta: pageOn('opportunityScenarioVenta'),
    opportunityScenarioRenta: pageOn('opportunityScenarioRenta'),
  }

  /**
   * Sin propiedades y sin portada ni cierre no queda documento que generar.
   *
   * Ni el resumen de portafolio ni los siete bloques de contenido cuentan como
   * página propia, y por el mismo motivo: los siete son el interior de una
   * oportunidad y el resumen resume el track record, así que los ocho imprimen
   * en blanco cuando no hay propiedades detrás. Dejarlos contar habilitaría el
   * botón para un PDF vacío — y el servidor lo rechazaría de todos modos con un
   * 400 (`generate_prospectus` en routes/documents.py), que es la peor versión:
   * la pantalla prometiendo algo que el API ya sabe que no existe.
   */
  const empty = includedIds.length === 0 && !options.cover && !options.closing

  function toggleSection(rows: Property[], turnOn: boolean) {
    setExcludedIds(prev => {
      const next = new Set(prev)
      for (const p of rows) turnOn ? next.delete(p.id) : next.add(p.id)
      return next
    })
  }

  function togglePlan(propertyId: number, planId: string) {
    setExcludedPlans(prev => {
      const current = new Set(prev[propertyId] ?? [])
      current.has(planId) ? current.delete(planId) : current.add(planId)
      const next = { ...prev }
      if (current.size === 0) delete next[propertyId]
      else next[propertyId] = [...current]
      return next
    })
  }

  function restoreAll() {
    setExcludedIds(new Set())
    setExcludedPages(new Set())
    setExcludedPlans({})
  }

  const rect = buttonRef.current?.getBoundingClientRect()

  return (
    <div ref={panelRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <button
        ref={buttonRef}
        onClick={() => setOpen(o => !o)}
        disabled={generating}
        style={{
          background: 'transparent', border: `1px solid ${colors.primary}`, color: colors.tertiary,
          cursor: generating ? 'wait' : 'pointer', fontFamily: fonts.label, fontSize: '10px',
          letterSpacing: '0.1em', padding: '5px 12px', opacity: generating ? 0.7 : 1,
        }}
      >
        {generating ? '⏳ GENERANDO…' : '📄 PROSPECTO'}
      </button>

      {/* Panel FIJO y anclado al botón por su rect, igual que el del engrane en
          TabBar: la toolbar de la tabla envuelve y scrollea, y un hijo absoluto
          colgado de ella se recorta contra el borde en vez de flotar encima. */}
      {open && (
        <div
          data-testid="prospectus-menu"
          style={{
            position: 'fixed',
            top: (rect?.bottom ?? 52) + 4,
            right: Math.max(8, window.innerWidth - (rect?.right ?? window.innerWidth)),
            background: colors.dark,
            border: `1px solid ${colors.border}`,
            padding: '12px',
            width: '300px',
            // La lista de favoritas no tiene techo: el panel se lleva su propio
            // scroll en vez de crecer fuera de la pantalla.
            maxHeight: 'calc(100vh - 120px)',
            overflowY: 'auto',
            zIndex: 200,
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            textAlign: 'left',
          }}
        >
          <div style={sectionTitle}>QUÉ INCLUYE</div>

          <div style={list}>
            {STANDALONE_PAGES.map(([key, label]) => (
              <Check
                key={key}
                label={label}
                checked={pageOn(key)}
                onChange={() => setExcludedPages(prev => toggled(prev, key))}
              />
            ))}
          </div>

          {favorites.length === 0 && (
            <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>
              Ninguna propiedad marcada con ★. El prospecto sale sin inventario.
            </div>
          )}

          {groups.map(g => {
            const on = g.rows.filter(p => !excludedIds.has(p.id)).length
            return (
              <div key={g.key} data-testid={`grupo-${g.key}`} style={list}>
                <Check
                  label={g.label}
                  strong
                  checked={on > 0}
                  indeterminate={on > 0 && on < g.rows.length}
                  onChange={() => toggleSection(g.rows, on < g.rows.length)}
                />
                <div style={{ ...list, paddingLeft: '18px' }}>
                  {g.rows.map(p => {
                    const plans = g.key === OPPORTUNITY_SECTION ? plansByProperty.get(p.id) : undefined
                    return (
                      <div key={p.id} style={list}>
                        <Check
                          label={p.name}
                          checked={!excludedIds.has(p.id)}
                          onChange={() => setExcludedIds(prev => toggled(prev, p.id))}
                        />
                        {/* Propuestas de ESTA propiedad — solo con 2+ (con una,
                            no hay nada que elegir y el menú queda como siempre).
                            Es selección por-propiedad, a diferencia de los
                            bloques de contenido de abajo, que son de sección. */}
                        {plans && plans.length >= 2 && !excludedIds.has(p.id) && (
                          <div style={{ ...list, paddingLeft: '18px' }} data-testid={`planes-${p.id}`}>
                            {plans.map(pl => (
                              <Check
                                key={pl.id}
                                label={pl.name}
                                checked={!(excludedPlans[p.id] ?? []).includes(pl.id)}
                                onChange={() => togglePlan(p.id, pl.id)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Los bloques de contenido son de la sección, no de una
                    propiedad: se prenden o apagan para las tres oportunidades a
                    la vez. Por eso NO cuelgan de la casilla «Oportunidades»,
                    que manda sobre qué propiedades entran, no sobre qué trae
                    cada una adentro. */}
                {g.key === OPPORTUNITY_SECTION && (
                  <div style={{ ...list, paddingLeft: '18px', marginTop: '4px' }}>
                    <div style={{ ...sectionTitle, fontSize: '8px' }}>CONTENIDO DE CADA UNA</div>
                    {OPPORTUNITY_BLOCKS.map(([key, label]) => (
                      <Check
                        key={key}
                        label={label}
                        checked={pageOn(key)}
                        onChange={() => setExcludedPages(prev => toggled(prev, key))}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderTop: `1px solid ${colors.border}`, paddingTop: '10px' }}>
            <button
              onClick={restoreAll}
              style={{
                background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary,
                cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em',
                padding: '5px 10px',
              }}
            >
              RESTAURAR TODO
            </button>
            <button
              onClick={() => { setOpen(false); onGenerate(options) }}
              disabled={empty || generating}
              style={{
                marginLeft: 'auto',
                background: empty || generating ? colors.border : colors.primary,
                border: 'none', color: colors.neutral,
                cursor: empty || generating ? 'not-allowed' : 'pointer',
                fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em',
                padding: '6px 12px',
              }}
            >
              {generating ? '⏳ GENERANDO…' : 'GENERAR PDF'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const sectionTitle: React.CSSProperties = {
  fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.15em', color: colors.secondary,
}

const list: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '4px',
}

const checkLabel: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
}

interface CheckProps {
  label: string
  checked: boolean
  indeterminate?: boolean
  strong?: boolean
  onChange: () => void
}

function Check({ label, checked, indeterminate = false, strong = false, onChange }: CheckProps) {
  const ref = useRef<HTMLInputElement>(null)

  // `indeterminate` NO es atributo de HTML: solo existe como propiedad del nodo,
  // así que React no lo escribe nunca al pintar y hay que ponerlo a mano en cada
  // render. Sin esto, una sección a medias se ve idéntica a una completa.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate, checked])

  return (
    <label style={checkLabel}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={onChange}
        style={{ accentColor: colors.primary, cursor: 'pointer' }}
      />
      <span style={{
        fontFamily: fonts.sans, fontSize: '11px',
        color: strong ? colors.neutral : colors.secondary,
        letterSpacing: strong ? '0.04em' : undefined,
      }}>
        {label}
      </span>
    </label>
  )
}
