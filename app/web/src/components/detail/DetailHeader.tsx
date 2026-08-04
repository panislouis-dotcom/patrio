import { useState } from 'react'
import type React from 'react'
import { colors, fonts } from '../../lib/theme'
import { fieldInput } from '../../lib/styles'

const btn: React.CSSProperties = {
  cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px',
  letterSpacing: '0.1em', flexShrink: 0,
}
const outlined: React.CSSProperties = { ...btn, background: 'none', border: `1px solid ${colors.border}`, color: colors.secondary, padding: '5px 12px' }
const outlinedPrimary: React.CSSProperties = { ...btn, background: 'none', border: `1px solid ${colors.primary}`, color: colors.primary, padding: '5px 12px' }

interface Props {
  backLabel: string
  onBack: () => void
  title: string
  /** When present, edit mode swaps the title for an input. */
  editingTitle?: { value: string; onChange: (value: string) => void }
  statusLabel: string
  statusColor: string
  editing: boolean
  onToggleEdit: () => void
  hasChanges: boolean
  saving: boolean
  onSave: () => void
  onCancel: () => void
  onDelete: () => void | Promise<void>
  /**
   * Por qué falló el borrado, para que la página lo muestre donde ya muestra
   * los demás errores. Sin esto el fallo sería mudo — y un borrado mudo se lee
   * como un borrado que funcionó.
   */
  onDeleteError?: (message: string) => void
  /** Extra buttons between the status chip and EDITAR, e.g. AVANZAR A ▸. */
  actions?: React.ReactNode
  style?: React.CSSProperties
}

export function DetailHeader({
  backLabel, onBack, title, editingTitle, statusLabel, statusColor,
  editing, onToggleEdit, hasChanges, saving, onSave, onCancel, onDelete, onDeleteError, actions, style,
}: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function runDelete() {
    setDeleting(true)
    try {
      await onDelete()
    } catch (e) {
      // El fallo se cuenta antes de volver: la fila regresa a ELIMINAR, que es
      // el estado de "no pasó nada", y el motivo queda a la vista arriba.
      onDeleteError?.(e instanceof Error ? e.message : 'No se pudo eliminar')
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  // El encabezado ENVUELVE en vez de estirar la página. Con el volver, el
  // título, la etapa y hasta cinco acciones mide ~594px, y en un teléfono
  // empujaba el documento entero a scrollear en horizontal. Aquí envolver gana
  // al scroll local que usan la barra de navegación y la tabla del presupuesto:
  // los botones son el destino, no algo que se hojea, y escondidos tras un
  // arrastre lateral dejarían de encontrarse. Por eso la altura es MÍNIMA y no
  // fija — con dos renglones, la de 52px recortaba el segundo.
  return (
    <div style={{
      flexShrink: 0,
      minHeight: '52px',
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '16px',
      padding: '6px 24px',
      borderBottom: `1px solid ${colors.border}`,
      background: colors.dark,
      ...style,
    }}>
      <button onClick={onBack} style={{ ...btn, background: 'transparent', border: 'none', padding: 0, color: colors.secondary }}>
        ← {backLabel}
      </button>
      <span style={{ color: colors.border }}>·</span>
      {editing && editingTitle ? (
        <input
          value={editingTitle.value}
          onChange={e => editingTitle.onChange(e.target.value)}
          aria-label="Nombre"
          style={{ ...fieldInput, flex: 1, minWidth: 0, fontFamily: fonts.serif, fontSize: '18px' }}
        />
      ) : (
        <span style={{ fontFamily: fonts.serif, fontSize: '20px', color: colors.neutral, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </span>
      )}
      <span style={{
        fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.12em',
        padding: '3px 10px', flexShrink: 0,
        background: statusColor,
        color: colors.neutral,
      }}>
        {statusLabel}
      </span>
      {actions}
      <button onClick={onToggleEdit} style={editing ? outlinedPrimary : outlined}>
        {editing ? 'VER' : 'EDITAR'}
      </button>
      {confirmDelete ? (
        <>
          <button onClick={() => setConfirmDelete(false)} style={outlined}>
            CANCELAR
          </button>
          <button
            onClick={runDelete}
            disabled={deleting}
            style={{ ...btn, background: '#c0392b', border: 'none', color: '#fff', cursor: deleting ? 'not-allowed' : 'pointer', padding: '6px 16px', opacity: deleting ? 0.7 : 1 }}
          >
            {deleting ? 'BORRANDO…' : '¿CONFIRMAR BORRADO?'}
          </button>
        </>
      ) : (
        <button onClick={() => setConfirmDelete(true)} style={outlined}>
          ELIMINAR
        </button>
      )}
      {/* Hidden while confirming a delete so two CANCELAR buttons never collide. */}
      {hasChanges && !confirmDelete && (
        <button onClick={onCancel} style={outlined}>
          CANCELAR
        </button>
      )}
      {hasChanges && (
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            ...btn,
            background: colors.primary, border: 'none', color: colors.neutral,
            cursor: saving ? 'not-allowed' : 'pointer',
            padding: '6px 16px', opacity: saving ? 0.7 : 1,
            transition: 'opacity 0.2s',
          }}
        >
          {saving ? 'GUARDANDO…' : 'GUARDAR ▸'}
        </button>
      )}
    </div>
  )
}
