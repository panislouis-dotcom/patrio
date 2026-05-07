from typing import Optional

from api.db import get_db, DB_PATH, _row_to_dict, _camel_to_snake

TEMPLATE_RAW_FIELDS = {"name", "description"}
NODE_RAW_FIELDS = {"name", "description", "sortOrder", "dependsOnId", "durationDays", "parentId"}
INSTANCE_RAW_FIELDS = {"name", "startDate", "status", "notes", "templateId", "projectId"}
STATE_RAW_FIELDS = {"status", "assigneeId", "actualStart", "actualEnd", "notes", "durationOverrideDays"}


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

_INSTANCE_SELECT = """
    SELECT
        pi.*,
        pt.name  AS template_name,
        pr.name  AS project_name
    FROM process_instances pi
    JOIN process_templates pt ON pt.id = pi.template_id
    LEFT JOIN projects pr     ON pr.id = pi.project_id
"""


def get_instances(project_id: Optional[int] = None) -> list[dict]:
    query = _INSTANCE_SELECT
    params: list = []
    if project_id is not None:
        query += " WHERE pi.project_id = ?"
        params.append(project_id)
    query += " ORDER BY pi.created_at DESC"
    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_instance(iid: int) -> Optional[dict]:
    with get_db() as conn:
        row = conn.execute(
            f"{_INSTANCE_SELECT} WHERE pi.id = ?", (iid,)
        ).fetchone()
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


# ─── Node files ───────────────────────────────────────────────────────────────

from pathlib import Path as _Path

_NODE_FILES_DIR = _Path(__file__).parent.parent.parent / "data" / "files"


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
    full_path = _NODE_FILES_DIR / rel_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(content)
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO node_files
               (template_node_id, instance_id, file_path, file_name, content_type, type)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (template_node_id, instance_id, rel_path, file_name, content_type, file_type),
        )
        fid = cur.lastrowid
    return get_node_file(fid)


def get_node_file(fid: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM node_files WHERE id = ?", (fid,)).fetchone()
    return _row_to_dict(row) if row else None


def get_node_files(template_node_id: int, instance_id: int | None = None) -> list[dict]:
    with get_db() as conn:
        if instance_id is not None:
            rows = conn.execute(
                """SELECT * FROM node_files
                   WHERE template_node_id = ?
                     AND (instance_id IS NULL OR instance_id = ?)
                   ORDER BY uploaded_at""",
                (template_node_id, instance_id),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM node_files
                   WHERE template_node_id = ? AND instance_id IS NULL
                   ORDER BY uploaded_at""",
                (template_node_id,),
            ).fetchall()
    return [_row_to_dict(r) for r in rows]


def delete_node_file(fid: int) -> None:
    record = get_node_file(fid)
    if record:
        full_path = _NODE_FILES_DIR / record["filePath"]
        if full_path.exists():
            full_path.unlink()
    with get_db() as conn:
        conn.execute("DELETE FROM node_files WHERE id = ?", (fid,))


# ─── Node comments ────────────────────────────────────────────────────────────


def get_node_comments(instance_id: int, template_node_id: int) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """SELECT * FROM node_comments
               WHERE instance_id = ? AND template_node_id = ?
               ORDER BY created_at""",
            (instance_id, template_node_id),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def create_node_comment(
    instance_id: int, template_node_id: int, body: str, author: str
) -> dict:
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO node_comments (instance_id, template_node_id, body, author) VALUES (?, ?, ?, ?)",
            (instance_id, template_node_id, body, author),
        )
        cid = cur.lastrowid
    with get_db() as conn:
        row = conn.execute("SELECT * FROM node_comments WHERE id = ?", (cid,)).fetchone()
    return _row_to_dict(row)


def delete_node_comment(cid: int) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM node_comments WHERE id = ?", (cid,))
