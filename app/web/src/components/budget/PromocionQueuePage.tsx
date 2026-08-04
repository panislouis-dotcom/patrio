import { useCallback, useEffect, useState } from 'react'
import type React from 'react'
import {
  fetchPromotionQueue, fetchBudgetCatalog, createCatalogChapter, promoteBudgetLine,
} from '../../lib/api'
import type { BudgetCatalogChapter, BudgetPromotionGroup } from '../../lib/types'
import { colors, fonts } from '../../lib/theme'
import { fmtMXN } from '../../lib/fmt'

/**
 * La cola de promoción: los renglones sueltos que ya se escribieron varias
 * veces, esperando a que alguien diga que son una partida.
 *
 * **La máquina ordena, el humano decide.** Promover no es automático a
 * propósito: un catálogo que crece solo se llena de duplicados casi iguales, y
 * el problema nunca fue agregar — fue fusionar. Lo que la pantalla aporta es el
 * orden, que contesta la única pregunta que importa aquí: cuál de los nombres
 * sueltos vale la pena fichar primero.
 *
 * Ordena por OBRAS antes que por renglones, y ése es el juicio del servidor que
 * esta pantalla no repite: cinco renglones en la misma obra son cinco veces un
 * mismo criterio, mientras que tres obras son tres observaciones independientes
 * — que es lo que hace que el catálogo llegue a aprender un precio.
 *
 * **Promover no mueve un peso.** Religa hacia atrás los renglones equivalentes
 * escribiendo su procedencia y nada más: ni el nombre, ni la unidad, ni el
 * precio, ni el importe de un presupuesto ya capturado cambian. La partida nace
 * al catálogo ya sabiendo lo que cuesta porque hereda observaciones, no porque
 * reescriba historia.
 *
 * Las dos medianas se enseñan con su nombre. La PAGADA sale de renglones
 * cerrados y es la única que es historia; la PRESUPUESTADA sirve para decidir si
 * promover, y su valor está en la diferencia contra la otra, nunca en hacer de
 * precio. Enseñar una sola cifra llamada «mediana» las volvería intercambiables,
 * y la de arriba es la que se autoconfirma.
 */

/**
 * A dónde va la partida. Las tres son la misma petición con distinto destino, y
 * **fusionar es la que de verdad hacía falta**: el catálogo se pudre por tener
 * tres variantes de un nombre, no por que le falte una.
 */
type Destino =
  | { kind: 'chapter'; chapterId: number }
  | { kind: 'newChapter'; name: string }
  | { kind: 'item'; itemId: number }

const normalize = (s: string) => s.trim().toLowerCase()

/**
 * Dónde ficharla, propuesto solo. Si el capítulo donde el renglón ya vive existe
 * en el catálogo, ése; si no, se ofrece crearlo con ese mismo nombre — que es el
 * caso del día uno, cuando el catálogo está vacío y sin esto la cola sería una
 * lista de cosas que no se pueden promover a ningún lado.
 */
function propose(group: BudgetPromotionGroup, catalog: BudgetCatalogChapter[]): Destino | null {
  const preferido = group.chapters[0] ?? group.chapterName
  if (!preferido) return null
  const existente = catalog.find(c => normalize(c.name) === normalize(preferido))
  return existente
    ? { kind: 'chapter', chapterId: existente.id }
    : { kind: 'newChapter', name: preferido }
}

function encode(d: Destino): string {
  if (d.kind === 'chapter') return `cap:${d.chapterId}`
  if (d.kind === 'item') return `item:${d.itemId}`
  return `nueva:${d.name}`
}

function decode(value: string): Destino | null {
  if (value.startsWith('cap:')) return { kind: 'chapter', chapterId: Number(value.slice(4)) }
  if (value.startsWith('item:')) return { kind: 'item', itemId: Number(value.slice(5)) }
  if (value.startsWith('nueva:')) return { kind: 'newChapter', name: value.slice(6) }
  return null
}

export function PromocionQueuePage() {
  const [groups, setGroups] = useState<BudgetPromotionGroup[]>([])
  const [catalog, setCatalog] = useState<BudgetCatalogChapter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** Lo que se eligió a mano, por grupo. Sin entrada = vale la propuesta. */
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [q, c] = await Promise.all([fetchPromotionQueue(), fetchBudgetCatalog()])
    setGroups(q)
    setCatalog(c)
  }, [])

  useEffect(() => {
    setLoading(true)
    load()
      .catch(e => setError(e instanceof Error ? e.message : 'No se pudo cargar la cola'))
      .finally(() => setLoading(false))
  }, [load])

  async function promote(group: BudgetPromotionGroup, destino: Destino) {
    setError(null)
    setNotice(null)
    setBusy(group.normalized)
    try {
      // Crear el capítulo antes de promover es lo que hace que la cola sirva con
      // el catálogo vacío, que es exactamente como arranca este proyecto.
      const target = destino.kind === 'newChapter'
        ? { chapterId: (await createCatalogChapter(destino.name)).id }
        : destino.kind === 'chapter'
          ? { chapterId: destino.chapterId }
          : { itemId: destino.itemId }
      const { item, created, relinked } = await promoteBudgetLine(group.lineId, target)
      setNotice(
        `«${item.name}» ${created ? 'entró al catálogo' : 'se fusionó con la del catálogo'}`
        + ` y quedaron ${relinked} renglones religados. Ningún importe se movió.`,
      )
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo promover')
    } finally {
      setBusy(null)
    }
  }

  const micro: React.CSSProperties = {
    fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, whiteSpace: 'nowrap',
  }
  const ghost: React.CSSProperties = {
    background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary,
    cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.06em',
    padding: '3px 10px',
  }
  const select: React.CSSProperties = {
    background: colors.surface, border: `1px solid ${colors.border}`, color: colors.neutral,
    fontFamily: fonts.sans, fontSize: '11px', padding: '3px 5px', outline: 'none',
  }

  if (loading) {
    return (
      <div style={{ padding: '24px', fontFamily: fonts.label, fontSize: '11px', color: colors.secondary }}>
        Cargando…
      </div>
    )
  }

  const items = catalog.flatMap(c => c.items.map(i => ({ ...i, chapterName: c.name })))

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '20px 24px' }}>
      <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em', marginBottom: '4px' }}>
        POR PROMOVER AL CATÁLOGO
      </div>
      <div style={{ ...micro, whiteSpace: 'normal', maxWidth: '640px', marginBottom: '14px', lineHeight: 1.5 }}>
        Renglones sueltos que ya se escribieron varias veces, los que aparecen en más obras
        primero. Promover los religa hacia atrás: la partida entra al catálogo con sus
        observaciones de precio y ningún presupuesto capturado cambia de importe.
      </div>

      {error && (
        <div style={{ color: '#c0392b', fontFamily: fonts.sans, fontSize: '11px', marginBottom: '8px' }}>
          {error}
        </div>
      )}
      {notice && (
        <div style={{ color: colors.primary, fontFamily: fonts.sans, fontSize: '11px', marginBottom: '8px' }}>
          {notice}
        </div>
      )}

      {groups.length === 0 && (
        <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary }}>
          No hay nada por promover. Se llena sola conforme se capturan presupuestos.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxWidth: '900px' }}>
        {groups.map(group => {
          const propuesta = propose(group, catalog)
          const valor = chosen[group.normalized] ?? (propuesta ? encode(propuesta) : '')
          const destino = decode(valor)
          const trabajando = busy === group.normalized
          return (
            <div
              key={group.normalized}
              style={{
                display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
                borderBottom: `1px solid ${colors.border}`, padding: '8px 6px',
              }}
            >
              <div style={{ flex: 1, minWidth: '260px' }}>
                <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral }}>
                  {group.name} <span style={micro}>· {group.unit}</span>
                </div>
                <div style={{ ...micro, marginTop: '2px' }}>
                  {group.properties} {group.properties === 1 ? 'OBRA' : 'OBRAS'}
                  {` · ${group.usedInLines} RENGLONES`}
                  {/* La pagada primero porque es la única que es historia. */}
                  {' · PAGADO '}{fmtMXN(group.medianPaidUnitPrice)}
                  {group.paidObservations > 0 && ` (${group.paidObservations})`}
                  {' · PRESUPUESTADO '}{fmtMXN(group.medianBudgetedUnitPrice)}
                  {group.chapters.length > 0 && ` · EN ${group.chapters.join(', ').toUpperCase()}`}
                </div>
              </div>

              <select
                value={valor}
                aria-label={`Destino de ${group.name}`}
                onChange={e => setChosen(prev => ({ ...prev, [group.normalized]: e.target.value }))}
                style={select}
              >
                <option value="">— Elegir destino</option>
                {propuesta?.kind === 'newChapter' && (
                  <option value={encode(propuesta)}>+ Crear capítulo «{propuesta.name}»</option>
                )}
                {catalog.length > 0 && (
                  <optgroup label="Crear en el capítulo">
                    {catalog.map(c => (
                      <option key={c.id} value={`cap:${c.id}`}>{c.name}</option>
                    ))}
                  </optgroup>
                )}
                {/* Fusionar es la operación que de verdad hacía falta: el
                    catálogo se pudre por tener tres variantes de un nombre, no
                    por que le falte una. */}
                {items.length > 0 && (
                  <optgroup label="Fusionar con">
                    {items.map(i => (
                      <option key={i.id} value={`item:${i.id}`}>{i.chapterName} · {i.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>

              <button
                disabled={!destino || trabajando}
                onClick={() => { if (destino) void promote(group, destino) }}
                style={{
                  ...ghost,
                  borderColor: destino ? colors.primary : colors.border,
                  color: destino ? colors.primary : colors.secondary,
                  cursor: destino && !trabajando ? 'pointer' : 'not-allowed',
                }}
              >
                {trabajando ? 'AGREGANDO…' : 'AGREGAR AL CATÁLOGO ▸'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
