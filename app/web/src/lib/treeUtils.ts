import type { GanttNode } from './types'

export function computeDepths(nodes: GanttNode[]): Map<number, number> {
  const depths = new Map<number, number>()
  const parentMap = new Map(nodes.map(n => [n.id, n.parentId]))

  function getDepth(id: number): number {
    if (depths.has(id)) return depths.get(id)!
    const pid = parentMap.get(id)
    const d = pid == null ? 0 : 1 + getDepth(pid)
    depths.set(id, d)
    return d
  }

  nodes.forEach(n => getDepth(n.id))
  return depths
}

export function getSubtree(rootId: number, nodes: GanttNode[]): GanttNode[] {
  const result: GanttNode[] = []
  const queue = [rootId]
  while (queue.length) {
    const id = queue.shift()!
    const node = nodes.find(n => n.id === id)
    if (node) {
      result.push(node)
      nodes.filter(n => n.parentId === id).forEach(c => queue.push(c.id))
    }
  }
  return result
}

export function getDescendantIds(nodeId: number, nodes: GanttNode[]): number[] {
  const result: number[] = []
  const queue = [nodeId]
  while (queue.length) {
    const id = queue.shift()!
    nodes.filter(n => n.parentId === id).forEach(c => {
      result.push(c.id)
      queue.push(c.id)
    })
  }
  return result
}
