import type { GanttNode, NodeState } from '../lib/types'
import { colors, fonts } from '../lib/theme'

const STATUS_BAR_COLOR: Record<string, string> = {
  pending: colors.secondary,
  in_progress: colors.tertiary,
  done: colors.primary,
  skipped: '#3a3a3a',
}

interface GanttChartProps {
  nodes: GanttNode[]
  totalDays: number
  states?: NodeState[]
}

export function GanttChart({ nodes, totalDays, states = [] }: GanttChartProps) {
  if (nodes.length === 0) return null
  const total = Math.max(1, totalDays)
  const stateByNode = Object.fromEntries(states.map(s => [s.templateNodeId, s]))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {nodes.map(n => {
        const leftPct = (n.ganttStart / total) * 100
        const widthPct = Math.max(0.3, (n.ganttDuration / total) * 100)
        const isRoot = n.parentId === null
        const status = stateByNode[n.id]?.status
        const barColor = n.isDefinir
          ? 'transparent'
          : status
            ? STATUS_BAR_COLOR[status] ?? colors.secondary
            : isRoot ? colors.primary : colors.secondary

        return (
          <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '160px',
              flexShrink: 0,
              fontFamily: fonts.sans,
              fontSize: '10px',
              color: n.isDefinir ? colors.tertiary : (isRoot ? colors.neutral : colors.secondary),
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              paddingLeft: isRoot ? '0' : '12px',
            }}>
              {n.name}
            </div>
            <div style={{ flex: 1, position: 'relative', height: '14px', background: colors.surfaceAlt, border: `1px solid ${colors.border}` }}>
              <div style={{
                position: 'absolute',
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                height: '100%',
                background: barColor,
                border: n.isDefinir ? `1px dashed ${colors.tertiary}` : 'none',
                opacity: status === 'skipped' ? 0.4 : 0.75,
                transition: 'background 0.2s',
              }} />
            </div>
            <div style={{ width: '36px', flexShrink: 0, fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>
              {n.isDefinir ? '?' : `${n.ganttDuration}d`}
            </div>
          </div>
        )
      })}
    </div>
  )
}
