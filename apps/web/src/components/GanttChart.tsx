import type { GanttNode, NodeState } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { computeDepths } from '../lib/treeUtils'

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
  instanceStartDate?: string
}

function buildChildrenMap(nodes: GanttNode[]): Map<number, number[]> {
  const map = new Map<number, number[]>()
  nodes.forEach(n => {
    if (n.parentId !== null) {
      const arr = map.get(n.parentId) ?? []
      arr.push(n.id)
      map.set(n.parentId, arr)
    }
  })
  return map
}

function getDescendantIds(nid: number, childrenOf: Map<number, number[]>): number[] {
  const result: number[] = []
  const queue = [...(childrenOf.get(nid) ?? [])]
  while (queue.length) {
    const curr = queue.shift()!
    result.push(curr)
    queue.push(...(childrenOf.get(curr) ?? []))
  }
  return result
}

export function GanttChart({ nodes, totalDays, states = [], instanceStartDate }: GanttChartProps) {
  if (nodes.length === 0) return null
  const total = Math.max(1, totalDays)
  const stateByNode = Object.fromEntries(states.map(s => [s.templateNodeId, s]))
  const depths = computeDepths(nodes)
  const childrenOf = buildChildrenMap(nodes)

  const nodeEndPct = new Map<number, number>()
  const nodeStartPct = new Map<number, number>()
  nodes.forEach(n => {
    nodeEndPct.set(n.id, ((n.ganttStart + n.ganttDuration) / total) * 100)
    nodeStartPct.set(n.id, (n.ganttStart / total) * 100)
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {nodes.map(n => {
        const leftPct = (n.ganttStart / total) * 100
        const widthPct = Math.max(0.3, (n.ganttDuration / total) * 100)
        const isRoot = n.parentId === null
        const depth = depths.get(n.id) ?? 0
        const indent = depth * 12
        const state = stateByNode[n.id]
        const status = state?.status
        const barColor = n.isDefinir
          ? 'transparent'
          : status
            ? STATUS_BAR_COLOR[status] ?? colors.secondary
            : isRoot ? colors.primary : colors.secondary

        // Derive actual dates: for parent nodes, aggregate from all descendants
        const descendants = getDescendantIds(n.id, childrenOf)
        const isParent = descendants.length > 0
        let effectiveActualStart: string | null = null
        let effectiveActualEnd: string | null = null
        if (isParent) {
          const leafDescendants = descendants.filter(did => !childrenOf.has(did))
          const allLeavesComplete = leafDescendants.length > 0 && leafDescendants.every(did => stateByNode[did]?.actualEnd)
          if (allLeavesComplete) {
            const starts = leafDescendants.map(did => stateByNode[did]?.actualStart).filter(Boolean) as string[]
            const ends = leafDescendants.map(did => stateByNode[did]?.actualEnd).filter(Boolean) as string[]
            effectiveActualStart = starts.length ? [...starts].sort()[0] : null
            effectiveActualEnd = ends.length ? [...ends].sort().slice(-1)[0] : null
          }
        } else {
          effectiveActualStart = state?.actualStart ?? null
          effectiveActualEnd = state?.actualEnd ?? null
        }

        let actualLeftPct: number | null = null
        let actualWidthPct: number | null = null

        if (effectiveActualStart && instanceStartDate) {
          const anchor = new Date(instanceStartDate)
          const aStart = new Date(effectiveActualStart)
          const aEnd = effectiveActualEnd ? new Date(effectiveActualEnd) : aStart
          const startOffset = Math.max(0, (aStart.getTime() - anchor.getTime()) / 86400000)
          const duration = Math.max(1, (aEnd.getTime() - aStart.getTime()) / 86400000)
          actualLeftPct = (startOffset / total) * 100
          actualWidthPct = Math.max(0.5, (duration / total) * 100)
        }

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
              paddingLeft: `${indent}px`,
            }}>
              {n.name}
            </div>
            <div style={{ flex: 1, position: 'relative', height: '14px', background: colors.surfaceAlt, border: `1px solid ${colors.border}` }}>
              {/* Planned bar */}
              <div style={{
                position: 'absolute',
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                top: 0,
                height: actualLeftPct !== null ? '50%' : '100%',
                background: barColor,
                border: n.isDefinir ? `1px dashed ${colors.tertiary}` : 'none',
                opacity: status === 'skipped' ? 0.4 : 0.55,
                transition: 'background 0.2s',
              }} />
              {/* Actual bar */}
              {actualLeftPct !== null && (
                <div style={{
                  position: 'absolute',
                  left: `${actualLeftPct}%`,
                  width: `${actualWidthPct}%`,
                  top: '50%',
                  height: '50%',
                  background: colors.tertiary,
                  opacity: 0.85,
                }} />
              )}
              {n.dependsOnId != null && nodeEndPct.has(n.dependsOnId) && (() => {
                const predEnd = nodeEndPct.get(n.dependsOnId)!
                const curStart = nodeStartPct.get(n.id)!
                const connWidth = Math.max(0, curStart - predEnd)
                if (connWidth <= 0) return null
                return (
                  <div style={{
                    position: 'absolute',
                    left: `${predEnd}%`,
                    width: `${connWidth}%`,
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    pointerEvents: 'none',
                  }}>
                    <div style={{
                      width: '100%',
                      height: '1px',
                      background: colors.border,
                      position: 'relative',
                    }}>
                      <div style={{
                        position: 'absolute',
                        right: 0,
                        top: -3,
                        width: 0,
                        height: 0,
                        borderTop: '3px solid transparent',
                        borderBottom: '3px solid transparent',
                        borderLeft: `4px solid ${colors.border}`,
                      }} />
                    </div>
                  </div>
                )
              })()}
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
