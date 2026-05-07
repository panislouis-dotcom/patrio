from typing import Optional

from api.db import get_db, DB_PATH, _row_to_dict, _camel_to_snake

TEMPLATE_RAW_FIELDS = {"name", "description"}
NODE_RAW_FIELDS = {"name", "description", "sortOrder", "dependsOnId", "durationDays", "parentId"}
INSTANCE_RAW_FIELDS = {"name", "startDate", "status", "notes", "templateId", "projectId"}
STATE_RAW_FIELDS = {"status", "assigneeId", "actualStart", "actualEnd", "notes"}


# ─── Templates ────────────────────────────────────

def get_templates() -> list[dict]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM process_templates ORDER BY id").fetchall()
    return [_row_to_dict(r) for r in rows]


def get_template(tid: int) -> Optional[dict]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM process_templates WHERE id = ?", (tid,)).fetchone()
    return _row_to_dict(row) if row else None


def create_template(data: dict) -> Optional[dict]:
    filtered = {k: v for k, v in data.items() if k in TEMPLATE_RAW_FIELDS}
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(snake.keys())
    placeholders = ", ".join("?" * len(snake))
    with get_db() as conn:
        cur = conn.execute(
            f"INSERT INTO process_templates ({columns}) VALUES ({placeholders})",
            list(snake.values()),
        )
        tid = cur.lastrowid
    return get_template(tid)


def update_template(tid: int, data: dict) -> Optional[dict]:
    filtered = {k: v for k, v in data.items() if k in TEMPLATE_RAW_FIELDS}
    if not filtered:
        return get_template(tid)
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(f"{col} = ?" for col in snake.keys())
    with get_db() as conn:
        conn.execute(
            f"UPDATE process_templates SET {columns} WHERE id = ?",
            list(snake.values()) + [tid],
        )
    return get_template(tid)


def delete_template(tid: int) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM process_templates WHERE id = ?", (tid,))


# ─── Template nodes ───────────────────────────────

def get_template_nodes(tid: int) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM template_nodes WHERE template_id = ? ORDER BY sort_order, id",
            (tid,),
        ).fetchall()
    nodes = [_row_to_dict(r) for r in rows]
    # Return in DFS order so tree rendering is correct (parent immediately before its children)
    from collections import defaultdict
    by_parent: dict = defaultdict(list)
    for n in nodes:
        by_parent[n["parentId"]].append(n)
    result: list = []
    def dfs(pid):
        for n in by_parent[pid]:
            result.append(n)
            dfs(n["id"])
    dfs(None)
    return result


def get_node(nid: int) -> Optional[dict]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM template_nodes WHERE id = ?", (nid,)).fetchone()
    return _row_to_dict(row) if row else None


def create_node(data: dict) -> Optional[dict]:
    allowed = NODE_RAW_FIELDS | {"templateId"}
    filtered = {k: v for k, v in data.items() if k in allowed}
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(snake.keys())
    placeholders = ", ".join("?" * len(snake))
    with get_db() as conn:
        cur = conn.execute(
            f"INSERT INTO template_nodes ({columns}) VALUES ({placeholders})",
            list(snake.values()),
        )
        nid = cur.lastrowid
    return get_node(nid)


def update_node(nid: int, data: dict) -> Optional[dict]:
    filtered = {k: v for k, v in data.items() if k in NODE_RAW_FIELDS}
    if not filtered:
        return get_node(nid)
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(f"{col} = ?" for col in snake.keys())
    with get_db() as conn:
        conn.execute(
            f"UPDATE template_nodes SET {columns} WHERE id = ?",
            list(snake.values()) + [nid],
        )
    return get_node(nid)


def delete_node(nid: int) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM template_nodes WHERE id = ?", (nid,))


# ─── Instances ────────────────────────────────────

def get_instances(project_id: Optional[int] = None) -> list[dict]:
    query = "SELECT * FROM process_instances"
    params: list = []
    if project_id is not None:
        query += " WHERE project_id = ?"
        params.append(project_id)
    query += " ORDER BY created_at DESC"
    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_instance(iid: int) -> Optional[dict]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM process_instances WHERE id = ?", (iid,)).fetchone()
    return _row_to_dict(row) if row else None


def create_instance(data: dict) -> Optional[dict]:
    filtered = {k: v for k, v in data.items() if k in INSTANCE_RAW_FIELDS}
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(snake.keys())
    placeholders = ", ".join("?" * len(snake))
    with get_db() as conn:
        cur = conn.execute(
            f"INSERT INTO process_instances ({columns}) VALUES ({placeholders})",
            list(snake.values()),
        )
        iid = cur.lastrowid
    return get_instance(iid)


def update_instance(iid: int, data: dict) -> Optional[dict]:
    filtered = {k: v for k, v in data.items() if k in INSTANCE_RAW_FIELDS}
    if not filtered:
        return get_instance(iid)
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(f"{col} = ?" for col in snake.keys())
    with get_db() as conn:
        conn.execute(
            f"UPDATE process_instances SET {columns} WHERE id = ?",
            list(snake.values()) + [iid],
        )
    return get_instance(iid)


# ─── Instance node states ─────────────────────────

def upsert_node_state(instance_id: int, template_node_id: int, data: dict) -> dict:
    filtered = {k: v for k, v in data.items() if k in STATE_RAW_FIELDS}
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}

    col_names = ", ".join(snake.keys())
    col_placeholders = ", ".join("?" * len(snake))
    set_parts = [f"{col} = ?" for col in snake.keys()]
    set_parts.append("updated_at = datetime('now')")
    set_clause = ", ".join(set_parts)
    values = list(snake.values())

    with get_db() as conn:
        conn.execute(
            f"""INSERT INTO instance_node_states
                    (instance_id, template_node_id, {col_names})
                VALUES (?, ?, {col_placeholders})
                ON CONFLICT(instance_id, template_node_id) DO UPDATE SET {set_clause}""",
            [instance_id, template_node_id] + values + values,
        )

    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM instance_node_states WHERE instance_id = ? AND template_node_id = ?",
            (instance_id, template_node_id),
        ).fetchone()
    return _row_to_dict(row)


def get_instance_states(iid: int) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM instance_node_states WHERE instance_id = ? ORDER BY id",
            (iid,),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]
