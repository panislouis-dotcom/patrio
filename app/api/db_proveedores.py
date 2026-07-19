import json as _json

from .db import get_db, _snake_to_camel, _camel_to_snake

CATEGORY_RAW_FIELDS = {"name", "description"}

PROVEEDOR_RAW_FIELDS = {
    "name", "phone", "email", "website", "zona", "status",
    "vetoReason", "ratingCalidad", "ratingPuntualidad", "ratingPrecio", "notes",
}

COTIZACION_RAW_FIELDS = {
    "proveedorId", "proveedorNameOverride", "monto", "moneda",
    "descripcion", "notes", "fechaCotizacion", "validezDias",
}

# ─── SQL constants ────────────────────────────────────────────────────────────

_COTIZACION_SELECT_ONE = (
    "SELECT c.*, p.name AS proveedor_name "
    "FROM cotizaciones c LEFT JOIN proveedores p ON p.id = c.proveedor_id "
    "WHERE c.id = %s"
)

_PROVEEDOR_SELECT = """
SELECT p.*,
       COALESCE(
           JSON_AGG(JSON_BUILD_OBJECT(
               'id', pc.id,
               'name', pc.name,
               'description', pc.description,
               'created_at', pc.created_at
           )) FILTER (WHERE pc.id IS NOT NULL),
           '[]'::json
       ) AS categories,
       COALESCE(
           (SELECT JSON_AGG(JSON_BUILD_OBJECT(
               'id', ph.id,
               'proveedor_id', ph.proveedor_id,
               'file_path', ph.file_path,
               'file_name', ph.file_name,
               'content_type', ph.content_type,
               'uploaded_at', ph.uploaded_at
           ) ORDER BY ph.uploaded_at)
            FROM proveedor_photos ph WHERE ph.proveedor_id = p.id),
           '[]'::json
       ) AS photos
FROM proveedores p
LEFT JOIN proveedor_category_links l ON l.proveedor_id = p.id
LEFT JOIN proveedor_categories pc ON pc.id = l.category_id
"""

_PROVEEDOR_SELECT_LIST = _PROVEEDOR_SELECT + "GROUP BY p.id ORDER BY p.name"
_PROVEEDOR_SELECT_ONE = _PROVEEDOR_SELECT + "WHERE p.id = %s GROUP BY p.id"


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _parse_categories(d: dict) -> dict:
    """Ensure the 'categories' field is a camelCased Python list."""
    cats = d.get("categories")
    if isinstance(cats, str):
        d["categories"] = _json.loads(cats)
    elif cats is None:
        d["categories"] = []
    d["categories"] = [
        {_snake_to_camel(k): v for k, v in c.items()} if isinstance(c, dict) else c
        for c in d["categories"]
    ]
    return d


def _parse_photos(d: dict) -> dict:
    """Ensure the 'photos' field is a camelCased Python list."""
    photos = d.get("photos")
    if isinstance(photos, str):
        d["photos"] = _json.loads(photos)
    elif photos is None:
        d["photos"] = []
    d["photos"] = [
        {_snake_to_camel(k): v for k, v in p.items()} if isinstance(p, dict) else p
        for p in d["photos"]
    ]
    return d


def _parse_proveedor(d: dict) -> dict:
    return _parse_photos(_parse_categories(d))


# ─── Category CRUD ────────────────────────────────────────────────────────────

def get_categories() -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM proveedor_categories ORDER BY name"
        ).fetchall()
    return [{_snake_to_camel(k): v for k, v in dict(r).items()} for r in rows]


def get_category(category_id: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM proveedor_categories WHERE id = %s", (category_id,)
        ).fetchone()
    if row is None:
        return None
    return {_snake_to_camel(k): v for k, v in dict(row).items()}


def create_category(data: dict) -> dict:
    filtered = {k: v for k, v in data.items() if k in CATEGORY_RAW_FIELDS}
    if not filtered:
        raise ValueError("No valid fields provided for create_category")
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(snake.keys())
    placeholders = ", ".join(["%s"] * len(snake))
    values = list(snake.values())
    with get_db() as conn:
        cur = conn.execute(
            f"INSERT INTO proveedor_categories ({columns}) VALUES ({placeholders}) RETURNING id",
            values,
        )
        category_id = cur.fetchone()["id"]
    return get_category(category_id)


def update_category(category_id: int, data: dict) -> dict | None:
    filtered = {k: v for k, v in data.items() if k in CATEGORY_RAW_FIELDS}
    if not filtered:
        return get_category(category_id)
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(f"{col} = %s" for col in snake.keys())
    values = list(snake.values()) + [category_id]
    with get_db() as conn:
        conn.execute(
            f"UPDATE proveedor_categories SET {columns} WHERE id = %s", values
        )
    return get_category(category_id)


def delete_category(category_id: int) -> None:
    with get_db() as conn:
        conn.execute(
            "DELETE FROM proveedor_categories WHERE id = %s", (category_id,)
        )


# ─── Proveedor CRUD ───────────────────────────────────────────────────────────

def get_proveedores(category_id: int | None = None) -> list[dict]:
    if category_id is not None:
        query = (
            _PROVEEDOR_SELECT
            + "WHERE p.id IN (SELECT proveedor_id FROM proveedor_category_links WHERE category_id = %s) "
            "GROUP BY p.id ORDER BY p.name"
        )
        params = (category_id,)
    else:
        query = _PROVEEDOR_SELECT_LIST
        params = ()
    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    result = []
    for r in rows:
        d = {_snake_to_camel(k): v for k, v in dict(r).items()}
        result.append(_parse_proveedor(d))
    return result


def get_proveedor(proveedor_id: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute(_PROVEEDOR_SELECT_ONE, (proveedor_id,)).fetchone()
    if row is None:
        return None
    d = {_snake_to_camel(k): v for k, v in dict(row).items()}
    return _parse_proveedor(d)


def create_proveedor(data: dict) -> dict:
    filtered = {k: v for k, v in data.items() if k in PROVEEDOR_RAW_FIELDS}
    if "name" not in filtered:
        raise ValueError("'name' is required for create_proveedor")
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(snake.keys())
    placeholders = ", ".join(["%s"] * len(snake))
    values = list(snake.values())
    with get_db() as conn:
        cur = conn.execute(
            f"INSERT INTO proveedores ({columns}) VALUES ({placeholders}) RETURNING id",
            values,
        )
        proveedor_id = cur.fetchone()["id"]
    return get_proveedor(proveedor_id)


def update_proveedor(proveedor_id: int, data: dict) -> dict | None:
    filtered = {k: v for k, v in data.items() if k in PROVEEDOR_RAW_FIELDS}
    if filtered:
        snake = {_camel_to_snake(k): v for k, v in filtered.items()}
        columns = ", ".join(f"{col} = %s" for col in snake.keys())
        values = list(snake.values()) + [proveedor_id]
        with get_db() as conn:
            conn.execute(
                f"UPDATE proveedores SET {columns} WHERE id = %s", values
            )
    result = get_proveedor(proveedor_id)
    if result is None:
        raise ValueError(f"Proveedor {proveedor_id} not found")
    return result


def delete_proveedor(proveedor_id: int) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM proveedores WHERE id = %s", (proveedor_id,))


def set_proveedor_categories(proveedor_id: int, category_ids: list[int]) -> None:
    """Atomically replace all category links for a proveedor."""
    with get_db() as conn:
        conn.execute(
            "DELETE FROM proveedor_category_links WHERE proveedor_id = %s",
            (proveedor_id,),
        )
        for cid in category_ids:
            conn.execute(
                "INSERT INTO proveedor_category_links (proveedor_id, category_id) "
                "VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (proveedor_id, cid),
            )


# ─── Photo functions ──────────────────────────────────────────────────────────

def add_proveedor_photo(
    proveedor_id: int, file_path: str, file_name: str, content_type: str
) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "INSERT INTO proveedor_photos (proveedor_id, file_path, file_name, content_type) "
            "VALUES (%s, %s, %s, %s) RETURNING *",
            (proveedor_id, file_path, file_name, content_type),
        ).fetchone()
    return {_snake_to_camel(k): v for k, v in dict(row).items()}


def get_proveedor_photos(proveedor_id: int) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM proveedor_photos WHERE proveedor_id = %s ORDER BY uploaded_at",
            (proveedor_id,),
        ).fetchall()
    return [{_snake_to_camel(k): v for k, v in dict(r).items()} for r in rows]


def delete_proveedor_photo(photo_id: int, proveedor_id: int) -> str:
    with get_db() as conn:
        row = conn.execute(
            "DELETE FROM proveedor_photos WHERE id = %s AND proveedor_id = %s RETURNING file_path",
            (photo_id, proveedor_id),
        ).fetchone()
        if row is None:
            raise ValueError(f"Photo {photo_id} not found for proveedor {proveedor_id}")
    return row["file_path"]


# ─── Cotizacion functions ─────────────────────────────────────────────────────

def get_cotizaciones(instance_node_state_id: int) -> list[dict]:
    query = """
    SELECT c.*, p.name AS proveedor_name
    FROM cotizaciones c
    LEFT JOIN proveedores p ON p.id = c.proveedor_id
    WHERE c.instance_node_state_id = %s
    ORDER BY c.created_at DESC
    """
    with get_db() as conn:
        rows = conn.execute(query, (instance_node_state_id,)).fetchall()
    return [{_snake_to_camel(k): v for k, v in dict(r).items()} for r in rows]


def create_cotizacion(instance_node_state_id: int, data: dict) -> dict:
    filtered = {k: v for k, v in data.items() if k in COTIZACION_RAW_FIELDS}
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    snake["instance_node_state_id"] = instance_node_state_id
    columns = ", ".join(snake.keys())
    placeholders = ", ".join(["%s"] * len(snake))
    values = list(snake.values())
    with get_db() as conn:
        cur = conn.execute(
            f"INSERT INTO cotizaciones ({columns}) VALUES ({placeholders}) RETURNING id",
            values,
        )
        cotizacion_id = cur.fetchone()["id"]
        row = conn.execute(_COTIZACION_SELECT_ONE, (cotizacion_id,)).fetchone()
    return {_snake_to_camel(k): v for k, v in dict(row).items()}


def update_cotizacion(cotizacion_id: int, data: dict) -> dict | None:
    filtered = {k: v for k, v in data.items() if k in COTIZACION_RAW_FIELDS}
    if filtered:
        snake = {_camel_to_snake(k): v for k, v in filtered.items()}
        columns = ", ".join(f"{col} = %s" for col in snake.keys())
        values = list(snake.values()) + [cotizacion_id]
        with get_db() as conn:
            conn.execute(
                f"UPDATE cotizaciones SET {columns} WHERE id = %s", values
            )
    with get_db() as conn:
        row = conn.execute(_COTIZACION_SELECT_ONE, (cotizacion_id,)).fetchone()
    if row is None:
        raise ValueError(f"Cotizacion {cotizacion_id} not found")
    return {_snake_to_camel(k): v for k, v in dict(row).items()}


def delete_cotizacion(cotizacion_id: int) -> None:
    with get_db() as conn:
        row = conn.execute(
            "DELETE FROM cotizaciones WHERE id = %s RETURNING instance_node_state_id, is_selected",
            (cotizacion_id,),
        ).fetchone()
        if row is None:
            raise ValueError(f"Cotizacion {cotizacion_id} not found")
        if row["is_selected"]:
            conn.execute(
                "UPDATE instance_node_states SET supplier_id = NULL WHERE id = %s",
                (row["instance_node_state_id"],),
            )


def get_proveedor_assignments(proveedor_id: int) -> list[dict]:
    """Return all process tasks where this supplier is currently assigned."""
    query = """
    SELECT
        ins.id        AS state_id,
        pi.id         AS instance_id,
        pi.name       AS instance_name,
        tn.id         AS node_id,
        tn.name       AS node_name,
        ins.status    AS status
    FROM instance_node_states ins
    JOIN process_instances pi ON pi.id = ins.instance_id
    JOIN template_nodes tn ON tn.id = ins.template_node_id
    WHERE ins.supplier_id = %s
    ORDER BY pi.name, tn.sort_order
    """
    with get_db() as conn:
        rows = conn.execute(query, (proveedor_id,)).fetchall()
    return [{_snake_to_camel(k): v for k, v in dict(r).items()} for r in rows]


def select_cotizacion(cotizacion_id: int, instance_node_state_id: int) -> dict | None:
    """Atomically select a cotizacion and auto-assign its supplier to the node state."""
    with get_db() as conn:
        # Clear all selections for this node state
        conn.execute(
            "UPDATE cotizaciones SET is_selected = FALSE WHERE instance_node_state_id = %s",
            (instance_node_state_id,),
        )
        # Select this one
        row = conn.execute(
            "UPDATE cotizaciones SET is_selected = TRUE WHERE id = %s AND instance_node_state_id = %s RETURNING *",
            (cotizacion_id, instance_node_state_id),
        ).fetchone()
        if row is None:
            return None
        proveedor_id = dict(row).get("proveedor_id")
        # Auto-assign the supplier to the node state (only when cotizacion has a proveedor)
        if proveedor_id is not None:
            conn.execute(
                "UPDATE instance_node_states SET supplier_id = %s WHERE id = %s",
                (proveedor_id, instance_node_state_id),
            )
    return {_snake_to_camel(k): v for k, v in dict(row).items()}
