from collections import defaultdict


def compute_gantt(nodes: list[dict]) -> list[dict]:
    """
    Annotates each node in-place with ganttStart, ganttDuration, isDefinir.
    Returns the same list.

    Input: flat list of template_node dicts with camelCase keys:
      {id, templateId, parentId, name, description, sortOrder, dependsOnId, durationDays, ...}

    Output: same list augmented with:
      ganttStart: int   — days offset from instance start (0 = start of instance)
      ganttDuration: int — effective duration in days
      isDefinir: bool   — True if leaf node with durationDays = None
    """
    if not nodes:
        return nodes

    children: dict = defaultdict(list)
    for n in nodes:
        children[n['parentId']].append(n)
    for pid in children:
        children[pid].sort(key=lambda n: n['sortOrder'])

    def process_group(sibling_nodes: list, parent_start: int) -> None:
        if not sibling_nodes:
            return

        # Topological sort (Kahn's) within sibling group
        sibling_ids = {n['id'] for n in sibling_nodes}
        in_degree = {n['id']: 0 for n in sibling_nodes}
        dependents: dict = defaultdict(list)
        for n in sibling_nodes:
            dep = n.get('dependsOnId')
            if dep is not None and dep in sibling_ids:
                in_degree[n['id']] += 1
                dependents[dep].append(n['id'])

        id_to_node = {n['id']: n for n in sibling_nodes}
        queue = [n for n in sibling_nodes if in_degree[n['id']] == 0]
        topo: list = []
        while queue:
            node = queue.pop(0)
            topo.append(node)
            for dep_id in dependents[node['id']]:
                in_degree[dep_id] -= 1
                if in_degree[dep_id] == 0:
                    queue.append(id_to_node[dep_id])

        # Fallback: if cycle detected (shouldn't happen), process remaining nodes
        processed_ids = {n['id'] for n in topo}
        for n in sibling_nodes:
            if n['id'] not in processed_ids:
                topo.append(n)

        node_end: dict = {}
        for node in topo:
            dep_id = node.get('dependsOnId')
            if dep_id is not None and dep_id in node_end:
                node['ganttStart'] = node_end[dep_id]
            else:
                node['ganttStart'] = parent_start

            node_children = children.get(node['id'], [])
            if node_children:
                process_group(node_children, node['ganttStart'])
                child_max_end = max(c['ganttStart'] + c['ganttDuration'] for c in node_children)
                node['ganttDuration'] = max(0, child_max_end - node['ganttStart'])
                node['isDefinir'] = False
            else:
                node['isDefinir'] = node.get('durationDays') is None
                node['ganttDuration'] = 0 if node['isDefinir'] else (node.get('durationDays') or 0)

            node_end[node['id']] = node['ganttStart'] + node['ganttDuration']

    process_group(children.get(None, []), 0)
    return nodes
