import { useCallback, useEffect, useState } from 'react'
import type React from 'react'
import {
  fetchBudgetCatalog, createCatalogChapter, updateCatalogChapter, deactivateCatalogChapter,
  createCatalogItem, updateCatalogItem, deactivateCatalogItem,
} from '../../lib/api'
import type { BudgetCatalogChapter } from '../../lib/types'
import { colors, fonts } from '../../lib/theme'
import { plural } from '../../lib/fmt'

/**
 * El catálogo de obra: capítulos y partidas, para verlo y curarlo.
 *
 * **Aquí no se borra nada, y no es un descuido.** Una partida se APAGA: deja de
 * ofrecerse en obra nueva y los renglones que ya la citan conservan su
 * procedencia intacta. Borrarla de verdad es la única operación capaz de cortar
 * la trazabilidad de un presupuesto ya cerrado —el del inversionista que ya vio
 * esos números— así que el servidor no la ofrece: su `DELETE` ES esta baja
 * lógica y contesta la fila apagada. Reactivar es un PATCH, no una resurrección.
 *
 * Por eso cada partida enseña EN CUÁNTOS RENGLONES se usó. Ese número es
 * exactamente la procedencia que un borrado destruiría, y enseñarlo convierte
 * «confía en que no borramos» en algo que se puede leer.
 *
 * Por eso lo apagado se puede VER: una baja que no se puede deshacer sin entrar
 * a la base es una baja que nadie se atreve a usar, y entonces se borra de otra
 * forma —renombrando encima— que sí destruye historia.
 *
 * Las celdas están siempre activas y guardan al soltarse, como en la tabla del
 * presupuesto. Un toggle EDITAR/GUARDAR aquí sería un segundo idioma de captura
 * para el mismo módulo.
 */

/** El catálogo no guarda precio (migración 028), y la pantalla lo dice. */
const SIN_PRECIO =
  'El catálogo guarda el NOMBRE y la UNIDAD, nunca el precio: sugerir desde un precio '
  + 'guardado es repetir para siempre una suposición. El precio se aprende de lo pagado.'

/**
 * Qué alcanza lo que se edita aquí. **Dicho en afirmativo**, porque «no cambia
 * los presupuestos viejos» describe lo que el sistema NO hace y eso se lee como
 * una limitación o como que el rename falló.
 *
 * La segunda oración es la que hace el trabajo: da el MECANISMO, y con el
 * mecanismo la regla deja de parecer arbitraria.
 */
const ALCANCE =
  'Lo que edites aquí aplica a lo que se agregue de ahora en adelante. Los presupuestos '
  + 'ya capturados no se mueven: cada renglón se llevó su nombre y su precio el día que '
  + 'se agregó.'

export function CatalogoObraPage() {
  const [chapters, setChapters] = useState<BudgetCatalogChapter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  /** `null` = nadie ha tocado nada, y entonces todos abiertos: el catálogo se viene a leer. */
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  /** El renglón nuevo que se está escribiendo, por capítulo. */
  const [draft, setDraft] = useState<{ chapterId: number; name: string; unit: string } | null>(null)
  const [newChapter, setNewChapter] = useState('')

  const load = useCallback(async () => {
    const next = await fetchBudgetCatalog({ includeInactive: true })
    setChapters(next)
  }, [])

  useEffect(() => {
    setLoading(true)
    load()
      .catch(e => setError(e instanceof Error ? e.message : 'No se pudo cargar el catálogo'))
      .finally(() => setLoading(false))
  }, [load])

  /**
   * Toda escritura se lee igual y termina releyendo el catálogo. Parchear el
   * estado local con lo que devuelve cada endpoint sería una segunda definición
   * del catálogo viviendo en el cliente; releerlo cuesta una consulta a una
   * tabla que cabe en una pantalla.
   */
  async function run(op: () => Promise<unknown>) {
    setError(null)
    try {
      await op()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    }
  }

  function toggle(id: number) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  /** Renombrar solo cuando de verdad cambió y no quedó vacío. */
  function rename(current: string, value: string, save: (name: string) => Promise<unknown>) {
    const name = value.trim()
    if (!name || name === current) return
    void run(() => save(name))
  }

  // ── Estilos ─────────────────────────────────────────────────────────────────

  const cellInput: React.CSSProperties = {
    background: 'transparent', border: `1px solid transparent`, color: colors.neutral,
    fontFamily: fonts.sans, fontSize: '12px', padding: '3px 5px', outline: 'none',
    boxSizing: 'border-box', width: '100%',
  }
  const boxed: React.CSSProperties = {
    ...cellInput, background: colors.surface, border: `1px solid ${colors.border}`,
  }
  const micro: React.CSSProperties = {
    fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, whiteSpace: 'nowrap',
  }
  const ghost: React.CSSProperties = {
    background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary,
    cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.06em',
    padding: '2px 8px',
  }
  const chevron: React.CSSProperties = {
    background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer',
    fontFamily: fonts.label, fontSize: '10px', padding: '0 2px',
  }

  if (loading) {
    return (
      <div style={{ padding: '24px', fontFamily: fonts.label, fontSize: '11px', color: colors.secondary }}>
        Cargando…
      </div>
    )
  }

  const visible = chapters.filter(c => showInactive || c.isActive)

  /**
   * Una fila de baja lógica. La misma para capítulos y partidas porque es la
   * misma operación: lo que cambia es a qué endpoint le habla, y eso lo trae
   * quien la usa.
   */
  const bajaButton = (
    isActive: boolean, label: string, usedInLines: number | null,
    apagar: () => Promise<unknown>, revivir: () => Promise<unknown>,
  ) => (
    <button
      onClick={() => {
        if (isActive && !window.confirm(
          `¿Dar de baja «${label}»?`
          + (usedInLines ? ` Los ${usedInLines} renglones que ya la usan la conservan;` : '')
          + ' deja de ofrecerse para obra nueva.',
        )) return
        void run(isActive ? apagar : revivir)
      }}
      style={{ ...ghost, color: isActive ? colors.secondary : colors.primary }}
    >
      {isActive ? 'DESACTIVAR' : 'REACTIVAR'}
    </button>
  )

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
        <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em' }}>
          CATÁLOGO DE OBRA
        </span>
        <label style={{ ...micro, display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
          />
          VER LAS DADAS DE BAJA
        </label>
      </div>
      <div style={{ ...micro, whiteSpace: 'normal', maxWidth: '620px', marginBottom: '6px', lineHeight: 1.5 }}>
        {ALCANCE}
      </div>
      <div style={{ ...micro, whiteSpace: 'normal', maxWidth: '620px', marginBottom: '14px', lineHeight: 1.5 }}>
        {SIN_PRECIO}
      </div>

      {error && (
        <div style={{ color: '#c0392b', fontFamily: fonts.sans, fontSize: '11px', marginBottom: '8px' }}>
          {error}
        </div>
      )}

      {visible.length === 0 && (
        <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary, marginBottom: '14px' }}>
          El catálogo está vacío. Se llena solo: captura renglones en los presupuestos y
          la cola de promoción irá proponiendo los que se repiten.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxWidth: '760px' }}>
        {visible.map(chapter => {
          const items = chapter.items.filter(i => showInactive || i.isActive)
          const open = !collapsed.has(chapter.id)
          return (
            <div key={chapter.id} style={{ opacity: chapter.isActive ? 1 : 0.55 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                background: colors.surfaceAlt, borderLeft: `2px solid ${colors.primary}`,
                borderBottom: `1px solid ${colors.border}`, padding: '5px 8px',
              }}>
                <button
                  onClick={() => toggle(chapter.id)}
                  aria-label={`${open ? 'Cerrar' : 'Abrir'} ${chapter.name}`}
                  style={chevron}
                >
                  {open ? '▼' : '▶'}
                </button>
                <input
                  key={chapter.name}
                  defaultValue={chapter.name}
                  aria-label={`Capítulo ${chapter.name}`}
                  onBlur={e => rename(chapter.name, e.target.value,
                    name => updateCatalogChapter(chapter.id, { name }))}
                  style={{ ...cellInput, flex: 1 }}
                />
                <span style={micro}>({items.length})</span>
                {!chapter.isActive && <span style={{ ...micro, color: colors.tertiary }}>DE BAJA</span>}
                {chapter.isActive && (
                  <button
                    onClick={() => setDraft({ chapterId: chapter.id, name: '', unit: '' })}
                    style={ghost}
                  >
                    + PARTIDA
                  </button>
                )}
                {bajaButton(
                  chapter.isActive, chapter.name, null,
                  () => deactivateCatalogChapter(chapter.id),
                  () => updateCatalogChapter(chapter.id, { isActive: true }),
                )}
              </div>

              {open && items.map(item => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    borderBottom: `1px solid ${colors.border}`, padding: '4px 8px 4px 26px',
                    opacity: item.isActive ? 1 : 0.55,
                  }}
                >
                  <input
                    key={item.name}
                    defaultValue={item.name}
                    aria-label={`Partida ${item.name}`}
                    onBlur={e => rename(item.name, e.target.value,
                      name => updateCatalogItem(item.id, { name }))}
                    style={{ ...cellInput, flex: 1 }}
                  />
                  <input
                    key={`u${item.unit}`}
                    defaultValue={item.unit}
                    aria-label={`Unidad de ${item.name}`}
                    onBlur={e => rename(item.unit, e.target.value,
                      unit => updateCatalogItem(item.id, { unit }))}
                    style={{ ...cellInput, width: '70px', flexShrink: 0 }}
                  />
                  {/* La procedencia que un borrado físico destruiría, dicha en
                      número. Cero renglones no se imprime: no hay nada que decir. */}
                  {item.usedInLines > 0 && (
                    <span style={micro}>EN {plural(item.usedInLines, 'RENGLÓN', 'RENGLONES')}</span>
                  )}
                  {!item.isActive && <span style={{ ...micro, color: colors.tertiary }}>DE BAJA</span>}
                  {bajaButton(
                    item.isActive, item.name, item.usedInLines,
                    () => deactivateCatalogItem(item.id),
                    () => updateCatalogItem(item.id, { isActive: true }),
                  )}
                </div>
              ))}

              {open && draft?.chapterId === chapter.id && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px 6px 26px' }}>
                  <input
                    autoFocus
                    value={draft.name}
                    placeholder="Nombre de la partida"
                    aria-label="Nombre de la partida nueva"
                    onChange={e => setDraft({ ...draft, name: e.target.value })}
                    style={{ ...boxed, flex: 1 }}
                  />
                  <input
                    value={draft.unit}
                    placeholder="Unidad"
                    aria-label="Unidad de la partida nueva"
                    onChange={e => setDraft({ ...draft, unit: e.target.value })}
                    style={{ ...boxed, width: '80px', flexShrink: 0 }}
                  />
                  <button
                    disabled={!draft.name.trim() || !draft.unit.trim()}
                    onClick={() => {
                      const name = draft.name.trim()
                      const unit = draft.unit.trim()
                      if (!name || !unit) return
                      void run(() => createCatalogItem({ chapterId: chapter.id, name, unit }))
                      setDraft(null)
                    }}
                    style={{
                      ...ghost,
                      borderColor: draft.name.trim() && draft.unit.trim() ? colors.primary : colors.border,
                      color: draft.name.trim() && draft.unit.trim() ? colors.primary : colors.secondary,
                    }}
                  >
                    AGREGAR
                  </button>
                  <button onClick={() => setDraft(null)} style={ghost}>CANCELAR</button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '14px' }}>
        <input
          value={newChapter}
          placeholder="Nombre del capítulo"
          aria-label="Nombre del capítulo nuevo"
          onChange={e => setNewChapter(e.target.value)}
          style={{ ...boxed, width: '240px' }}
        />
        <button
          disabled={!newChapter.trim()}
          onClick={() => {
            const name = newChapter.trim()
            if (!name) return
            void run(() => createCatalogChapter(name))
            setNewChapter('')
          }}
          style={{
            ...ghost,
            borderColor: newChapter.trim() ? colors.primary : colors.border,
            color: newChapter.trim() ? colors.primary : colors.secondary,
          }}
        >
          + CAPÍTULO
        </button>
      </div>
    </div>
  )
}
