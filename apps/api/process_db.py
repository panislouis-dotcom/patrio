from typing import Optional

from api.db import get_db, _row_to_dict, _camel_to_snake

TEMPLATE_RAW_FIELDS = {"name", "description"}
NODE_RAW_FIELDS = {"name", "description", "sortOrder", "dependsOnId", "durationDays", "parentId", "sourceTemplateId", "supplierCategoryId"}
INSTANCE_RAW_FIELDS = {
    "name", "startDate", "status", "notes",
    "templateId", "projectId", "ownerId",
    "frequencyDays", "dueDate", "completedAt",
    "originInstanceId", "durationLockedAt",
}


def _derive_task_type(row: dict) -> str:
    if row.get('projectId'): return 'proyecto'
    if row.get('frequencyDays'): return 'periodica'
    return 'one_time'
STATE_RAW_FIELDS = {"status", "assigneeId", "actualStart", "actualEnd", "notes", "durationOverrideDays", "supplierId"}


# ─── Templates ────────────────────────────────────

def get_templates() -> list[dict]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM process_templates ORDER BY id").fetchall()
    return [_row_to_dict(r) for r in rows]


def get_template(tid: int) -> Optional[dict]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM process_templates WHERE id = %s", (tid,)).fetchone()
    return _row_to_dict(row) if row else None


def create_template(data: dict) -> Optional[dict]:
    filtered = {k: v for k, v in data.items() if k in TEMPLATE_RAW_FIELDS}
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(snake.keys())
    placeholders = ", ".join(["%s"] * len(snake))
    with get_db() as conn:
        cur = conn.execute(
            f"INSERT INTO process_templates ({columns}) VALUES ({placeholders}) RETURNING id",
            list(snake.values()),
        )
        tid = cur.fetchone()["id"]
    return get_template(tid)


def update_template(tid: int, data: dict) -> Optional[dict]:
    filtered = {k: v for k, v in data.items() if k in TEMPLATE_RAW_FIELDS}
    if not filtered:
        return get_template(tid)
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(f"{col} = %s" for col in snake.keys())
    with get_db() as conn:
        conn.execute(
            f"UPDATE process_templates SET {columns} WHERE id = %s",
            list(snake.values()) + [tid],
        )
    return get_template(tid)


def delete_template(tid: int) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM process_templates WHERE id = %s", (tid,))


# ─── Template nodes ───────────────────────────────

def _template_references(tid: int, visited: set | None = None) -> set:
    """Return set of all template IDs reachable from tid via source_template_id references.

    Uses a single DB connection for the entire traversal to avoid exhausting the pool
    on deep template trees.
    """
    if visited is None:
        visited = set()
    with get_db() as conn:
        _template_references_rec(tid, conn, visited)
    return visited


def _template_references_rec(tid: int, conn, visited: set) -> None:
    if tid in visited:
        return
    visited.add(tid)
    rows = conn.execute(
        "SELECT DISTINCT source_template_id FROM template_nodes "
        "WHERE template_id = %s AND source_template_id IS NOT NULL",
        (tid,),
    ).fetchall()
    for r in rows:
        _template_references_rec(r["source_template_id"], conn, visited)


def get_template_nodes(tid: int) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM template_nodes WHERE template_id = %s ORDER BY sort_order, id",
            (tid,),
        ).fetchall()
    nodes = [_row_to_dict(r) for r in rows]

    # Expand source_template_id references (one level only)
    expanded = []
    for node in nodes:
        expanded.append(node)
        src_tid = node.get('sourceTemplateId')
        if src_tid and src_tid != tid:
            with get_db() as conn:
                sub_rows = conn.execute(
                    "SELECT * FROM template_nodes WHERE template_id = %s ORDER BY sort_order, id",
                    (src_tid,)
                ).fetchall()
            for sub_row in sub_rows:
                sub = dict(_row_to_dict(sub_row))
                # Re-parent top-level sub-nodes under the reference node
                if sub['parentId'] is None:
                    sub['parentId'] = node['id']
                expanded.append(sub)

    # Return in DFS order so tree rendering is correct (parent immediately before its children)
    from collections import defaultdict
    by_parent: dict = defaultdict(list)
    for n in expanded:
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
        row = conn.execute("SELECT * FROM template_nodes WHERE id = %s", (nid,)).fetchone()
    return _row_to_dict(row) if row else None


def create_node(data: dict) -> Optional[dict]:
    allowed = NODE_RAW_FIELDS | {"templateId"}
    filtered = {k: v for k, v in data.items() if k in allowed}
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(snake.keys())
    placeholders = ", ".join(["%s"] * len(snake))
    with get_db() as conn:
        cur = conn.execute(
            f"INSERT INTO template_nodes ({columns}) VALUES ({placeholders}) RETURNING id",
            list(snake.values()),
        )
        nid = cur.fetchone()["id"]
    return get_node(nid)


def update_node(nid: int, data: dict) -> Optional[dict]:
    filtered = {k: v for k, v in data.items() if k in NODE_RAW_FIELDS}
    if not filtered:
        return get_node(nid)
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(f"{col} = %s" for col in snake.keys())
    with get_db() as conn:
        conn.execute(
            f"UPDATE template_nodes SET {columns} WHERE id = %s",
            list(snake.values()) + [nid],
        )
    return get_node(nid)


def delete_node(nid: int) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM template_nodes WHERE id = %s", (nid,))


# ─── Instances ────────────────────────────────────

_INSTANCE_SELECT = """
    SELECT
        pi.*,
        pt.name  AS template_name,
        pr.name  AS project_name,
        tm.name  AS owner_name
    FROM process_instances pi
    LEFT JOIN process_templates pt ON pt.id = pi.template_id
    LEFT JOIN projects pr          ON pr.id = pi.project_id
    LEFT JOIN team_members tm      ON tm.id = pi.owner_id
"""


def sync_periodic_series():
    from datetime import date, timedelta
    today = date.today()
    with get_db() as conn:
        origins = conn.execute(
            "SELECT * FROM process_instances WHERE frequency_days IS NOT NULL AND origin_instance_id IS NULL"
        ).fetchall()
    for row in origins:
        origin = _row_to_dict(row)
        freq = origin.get('frequencyDays')
        if not freq or freq <= 0:
            continue
        try:
            anchor = date.fromisoformat(origin['startDate'][:10])
        except (ValueError, TypeError):
            continue
        if anchor > today:
            continue
        delta = (today - anchor).days
        n = delta // freq
        current_start = anchor + timedelta(days=n * freq)
        if current_start == anchor:
            continue
        with get_db() as conn:
            existing = conn.execute(
                "SELECT id FROM process_instances WHERE origin_instance_id = %s AND start_date = %s",
                (origin['id'], current_start.isoformat())
            ).fetchone()
        if existing:
            continue
        create_instance({
            'name': origin['name'],
            'templateId': origin.get('templateId'),
            'projectId': origin.get('projectId'),
            'ownerId': origin.get('ownerId'),
            'frequencyDays': freq,
            'startDate': current_start.isoformat(),
            'originInstanceId': origin['id'],
            'status': 'active',
            'notes': '',
        })


def get_instances(project_id: Optional[int] = None) -> list[dict]:
    query = _INSTANCE_SELECT
    params: list = []
    if project_id is not None:
        query += " WHERE pi.project_id = %s"
        params.append(project_id)
    query += " ORDER BY pi.created_at DESC"
    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    result = [_row_to_dict(r) for r in rows]
    for row in result:
        row['taskType'] = _derive_task_type(row)
    return result


def get_instance(iid: int) -> Optional[dict]:
    with get_db() as conn:
        row = conn.execute(
            f"{_INSTANCE_SELECT} WHERE pi.id = %s", (iid,)
        ).fetchone()
    if row is None:
        return None
    result = _row_to_dict(row)
    result['taskType'] = _derive_task_type(result)
    return result


def create_instance(data: dict) -> Optional[dict]:
    filtered = {k: v for k, v in data.items() if k in INSTANCE_RAW_FIELDS}
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(snake.keys())
    placeholders = ", ".join(["%s"] * len(snake))
    with get_db() as conn:
        cur = conn.execute(
            f"INSERT INTO process_instances ({columns}) VALUES ({placeholders}) RETURNING id",
            list(snake.values()),
        )
        iid = cur.fetchone()["id"]
    return get_instance(iid)


def update_instance(iid: int, data: dict) -> Optional[dict]:
    filtered = {k: v for k, v in data.items() if k in INSTANCE_RAW_FIELDS}
    if not filtered:
        return get_instance(iid)
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(f"{col} = %s" for col in snake.keys())
    with get_db() as conn:
        conn.execute(
            f"UPDATE process_instances SET {columns} WHERE id = %s",
            list(snake.values()) + [iid],
        )
    return get_instance(iid)


# ─── Instance node states ─────────────────────────

def upsert_node_state(instance_id: int, template_node_id: int, data: dict) -> dict:
    filtered = {k: v for k, v in data.items() if k in STATE_RAW_FIELDS}
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}

    col_names = ", ".join(snake.keys())
    col_placeholders = ", ".join(["%s"] * len(snake))
    set_parts = [f"{col} = %s" for col in snake.keys()]
    set_parts.append("updated_at = NOW()")
    set_clause = ", ".join(set_parts)
    values = list(snake.values())

    with get_db() as conn:
        conn.execute(
            f"""INSERT INTO instance_node_states
                    (instance_id, template_node_id, {col_names})
                VALUES (%s, %s, {col_placeholders})
                ON CONFLICT(instance_id, template_node_id) DO UPDATE SET {set_clause}""",
            [instance_id, template_node_id] + values + values,
        )

    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM instance_node_states WHERE instance_id = %s AND template_node_id = %s",
            (instance_id, template_node_id),
        ).fetchone()
    return _row_to_dict(row)


def get_instance_states(iid: int) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM instance_node_states WHERE instance_id = %s ORDER BY id",
            (iid,),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


# ─── Node files ───────────────────────────────────────────────────────────────

from pathlib import Path as _Path
from api import storage as _storage


def create_node_file(
    template_node_id: int,
    instance_id: int | None,
    file_name: str,
    content_type: str,
    file_type: str,
    content: bytes,
) -> dict:
    if instance_id is not None:
        rel_path = f"nodes/{template_node_id}/instances/{instance_id}/{file_name}"
    else:
        rel_path = f"nodes/{template_node_id}/reference/{file_name}"
    # Commit DB row first — prevents orphaned files if FK or other constraint fails
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO node_files
               (template_node_id, instance_id, file_path, file_name, content_type)
               VALUES (%s, %s, %s, %s, %s) RETURNING id""",
            (template_node_id, instance_id, rel_path, file_name, content_type),
        )
        fid = cur.fetchone()["id"]

    _storage.upload(rel_path, content, content_type)
    return get_node_file(fid)


def get_node_file(fid: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM node_files WHERE id = %s", (fid,)).fetchone()
    return _row_to_dict(row) if row else None


def get_node_files(template_node_id: int, instance_id: int | None = None) -> list[dict]:
    with get_db() as conn:
        if instance_id is not None:
            rows = conn.execute(
                """SELECT *, CASE WHEN instance_id IS NULL THEN 'reference' ELSE 'evidence' END as type
                   FROM node_files
                   WHERE template_node_id = %s
                     AND (instance_id IS NULL OR instance_id = %s)
                   ORDER BY uploaded_at""",
                (template_node_id, instance_id),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT *, CASE WHEN instance_id IS NULL THEN 'reference' ELSE 'evidence' END as type
                   FROM node_files
                   WHERE template_node_id = %s AND instance_id IS NULL
                   ORDER BY uploaded_at""",
                (template_node_id,),
            ).fetchall()
    return [_row_to_dict(r) for r in rows]


def delete_node_file(fid: int) -> None:
    record = get_node_file(fid)
    if record:
        _storage.delete(record["filePath"])
    with get_db() as conn:
        conn.execute("DELETE FROM node_files WHERE id = %s", (fid,))


# ─── Instance files ───────────────────────────────────────────────────────────

def get_instance_files(instance_id: int) -> list:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM instance_files WHERE instance_id = %s ORDER BY uploaded_at",
            (instance_id,),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def create_instance_file(
    instance_id: int,
    file_name: str,
    content_type: str,
    content: bytes,
) -> dict:
    from uuid import uuid4
    import mimetypes
    ext = _Path(file_name).suffix or (mimetypes.guess_extension(content_type) or "")
    rel_path = f"instance/{instance_id}/{uuid4().hex}{ext}"
    with get_db() as conn:
        row = conn.execute(
            """INSERT INTO instance_files
               (instance_id, file_path, file_name, content_type)
               VALUES (%s, %s, %s, %s) RETURNING *""",
            (instance_id, rel_path, file_name, content_type),
        ).fetchone()
    _storage.upload(rel_path, content, content_type)
    return _row_to_dict(row)


def delete_instance_file(fid: int) -> None:
    with get_db() as conn:
        row = conn.execute("SELECT file_path FROM instance_files WHERE id = %s", (fid,)).fetchone()
    if row:
        _storage.delete(row["file_path"])
    with get_db() as conn:
        conn.execute("DELETE FROM instance_files WHERE id = %s", (fid,))


# ─── Node comments ────────────────────────────────────────────────────────────


def get_node_comments(instance_id: int, template_node_id: int) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """SELECT * FROM node_comments
               WHERE instance_id = %s AND template_node_id = %s
               ORDER BY created_at""",
            (instance_id, template_node_id),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def create_node_comment(
    instance_id: int, template_node_id: int, body: str, author: str
) -> dict:
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO node_comments (instance_id, template_node_id, body, author) VALUES (%s, %s, %s, %s) RETURNING id",
            (instance_id, template_node_id, body, author),
        )
        cid = cur.fetchone()["id"]
    with get_db() as conn:
        row = conn.execute("SELECT * FROM node_comments WHERE id = %s", (cid,)).fetchone()
    return _row_to_dict(row)


def delete_node_comment(cid: int) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM node_comments WHERE id = %s", (cid,))
