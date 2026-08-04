import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchInstances, updateInstance } from '../../lib/api'
import type { ProcessInstance } from '../../lib/types'
import { PROCESS_INSTANCE_STATUS_COLOR } from '../../lib/status'
import { colors, fonts } from '../../lib/theme'

interface Props {
  propertyId: number
  instances: ProcessInstance[]
  onChange: (next: ProcessInstance[]) => void
}

/** Las tareas de obra ligadas a la propiedad — se crean nuevas o se ligan existentes. */
export function TasksPanel({ propertyId, instances, onChange }: Props) {
  const navigate = useNavigate()
  const [showLink, setShowLink] = useState(false)
  const [allInstances, setAllInstances] = useState<ProcessInstance[]>([])
  const [linkId, setLinkId] = useState('')
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggleLinkPicker() {
    setShowLink(v => !v)
    setLinkId('')
    setError(null)
    if (!showLink && allInstances.length === 0) setAllInstances(await fetchInstances())
  }

  /**
   * Ligar puede negarse —los procesos de obra se abren desde desarrollo, y el
   * servidor lo dice con esa frase—, así que el rechazo se atrapa y se enseña.
   * Antes solo había `finally`: la promesa quedaba sin manejar y el panel se
   * quedaba callado, como si el clic no hubiera ocurrido.
   */
  async function link() {
    if (!linkId) return
    setLinking(true)
    setError(null)
    try {
      const { instance } = await updateInstance(Number(linkId), { propertyId })
      onChange([...instances, instance])
      setShowLink(false)
      setLinkId('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo ligar la tarea')
    } finally {
      setLinking(false)
    }
  }

  async function unlink(inst: ProcessInstance) {
    if (!window.confirm(`¿Desligar "${inst.name}" de esta propiedad?`)) return
    setError(null)
    try {
      await updateInstance(inst.id, { propertyId: null })
      onChange(instances.filter(i => i.id !== inst.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo desligar la tarea')
    }
  }

  const linkedIds = new Set(instances.map(i => i.id))
  const available = allInstances.filter(i => !linkedIds.has(i.id))
  const iStyle: React.CSSProperties = { background: colors.surface, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '11px', padding: '5px 8px', outline: 'none', flex: 1 }

  return (
    <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: '24px', marginTop: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em' }}>TAREAS</span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={toggleLinkPicker}
            style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '3px 10px' }}
          >
            {showLink ? '✕' : 'LIGAR EXISTENTE'}
          </button>
          <button
            onClick={() => navigate(`/procesos/tareas?propiedad=${propertyId}&tipo=proyecto`)}
            style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '3px 10px' }}
          >
            + NUEVA TAREA
          </button>
        </div>
      </div>

      {showLink && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', padding: '10px', background: colors.surface, border: `1px solid ${colors.border}` }}>
          <select value={linkId} onChange={e => setLinkId(e.target.value)} aria-label="Tarea a ligar" style={iStyle}>
            <option value="">— seleccionar tarea —</option>
            {available.map(i => (
              <option key={i.id} value={i.id}>{i.name}{i.propertyName ? ` (${i.propertyName})` : ''}</option>
            ))}
          </select>
          <button
            onClick={link}
            disabled={!linkId || linking}
            style={{ background: linkId ? colors.primary : colors.border, border: 'none', color: colors.neutral, cursor: linkId ? 'pointer' : 'not-allowed', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '5px 14px', opacity: linking ? 0.6 : 1 }}
          >
            {linking ? '…' : 'LIGAR'}
          </button>
        </div>
      )}

      {error && (
        <div role="alert" style={{ marginBottom: '12px', fontFamily: fonts.sans, fontSize: '11px', color: colors.tertiary }}>
          {error}
        </div>
      )}

      {instances.length === 0 ? (
        <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>Sin tareas ligadas a esta propiedad.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              {['NOMBRE', 'TIPO', 'ESTADO', 'INICIO', ''].map(h => (
                <th key={h} style={{ padding: '5px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'left', letterSpacing: '0.1em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {instances.map(inst => (
              <tr key={inst.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td
                  style={{ padding: '6px 10px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, cursor: 'pointer' }}
                  onClick={() => navigate(`/procesos/tareas/${inst.id}`)}
                >
                  {inst.name}
                </td>
                <td style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.06em' }}>{inst.taskType.toUpperCase().replace('_', ' ')}</td>
                <td style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.06em', color: PROCESS_INSTANCE_STATUS_COLOR[inst.status] ?? colors.secondary }}>{inst.status.toUpperCase()}</td>
                <td style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary }}>{inst.startDate}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                  <button
                    onClick={() => unlink(inst)}
                    style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '0 4px', opacity: 0.6 }}
                    title="Desligar"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
