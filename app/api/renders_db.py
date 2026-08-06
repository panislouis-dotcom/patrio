"""Persistencia de la biblioteca de prompts y de los renders generados."""
from api.db import get_db, _row_to_dict


class PromptError(RuntimeError):
    """Regla de la biblioteca rota (nombre repetido, borrar un sembrado)."""


class NotFound(RuntimeError):
    pass


# ─── Biblioteca de prompts ────────────────────────────────────────────────────

def list_prompts() -> list[dict]:
    """Sembrados primero, luego los propios por nombre: la biblioteca siempre
    abre con el piso conocido."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM render_prompts WHERE archived_at IS NULL"
            " ORDER BY is_default DESC, name"
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_prompt(prompt_id: int) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM render_prompts WHERE id = %s AND archived_at IS NULL",
            (prompt_id,),
        ).fetchone()
    if row is None:
        raise NotFound(f"Prompt {prompt_id} no encontrado")
    return _row_to_dict(row)


def create_prompt(name: str, body: str) -> dict:
    name, body = name.strip(), body.strip()
    if not name or not body:
        raise PromptError("El prompt necesita nombre y texto")
    with get_db() as conn:
        if conn.execute(
            "SELECT 1 FROM render_prompts WHERE lower(name) = lower(%s) AND archived_at IS NULL",
            (name,),
        ).fetchone():
            raise PromptError(f"Ya existe un prompt llamado «{name}»")
        row = conn.execute(
            "INSERT INTO render_prompts (name, body, is_default)"
            " VALUES (%s, %s, false) RETURNING *",
            (name, body),
        ).fetchone()
    return _row_to_dict(row)


def update_prompt(prompt_id: int, name: str | None, body: str | None) -> dict:
    """Editar un prompt cambia la biblioteca, nunca los renders ya hechos:
    cada render guardó su texto completo al generarse."""
    sets, values = [], []
    if name is not None:
        if not name.strip():
            raise PromptError("El nombre no puede quedar vacío")
        sets.append("name = %s")
        values.append(name.strip())
    if body is not None:
        if not body.strip():
            raise PromptError("El texto no puede quedar vacío")
        sets.append("body = %s")
        values.append(body.strip())
    if not sets:
        return get_prompt(prompt_id)

    with get_db() as conn:
        if name is not None and conn.execute(
            "SELECT 1 FROM render_prompts WHERE lower(name) = lower(%s)"
            " AND id <> %s AND archived_at IS NULL",
            (name.strip(), prompt_id),
        ).fetchone():
            raise PromptError(f"Ya existe un prompt llamado «{name.strip()}»")
        row = conn.execute(
            f"UPDATE render_prompts SET {', '.join(sets)}"
            " WHERE id = %s AND archived_at IS NULL RETURNING *",
            (*values, prompt_id),
        ).fetchone()
    if row is None:
        raise NotFound(f"Prompt {prompt_id} no encontrado")
    return _row_to_dict(row)


def archive_prompt(prompt_id: int) -> None:
    """Los sembrados no se borran. Los propios se archivan —no se destruyen—
    porque un render viejo todavía apunta a ellos."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT is_default FROM render_prompts WHERE id = %s AND archived_at IS NULL",
            (prompt_id,),
        ).fetchone()
        if row is None:
            raise NotFound(f"Prompt {prompt_id} no encontrado")
        if row["is_default"]:
            raise PromptError("Un prompt de la biblioteca base no se borra")
        conn.execute("UPDATE render_prompts SET archived_at = now() WHERE id = %s", (prompt_id,))


# ─── Renders ──────────────────────────────────────────────────────────────────

def list_renders(property_id: int) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM property_renders WHERE property_id = %s ORDER BY created_at DESC, id DESC",
            (property_id,),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def source_image(property_id: int, image_id: int) -> dict | None:
    """La foto fuente de esta propiedad, o None si no lo es.

    Valida la pertenencia y devuelve la fila en la misma consulta a propósito:
    si fueran dos, la verificación y la lectura podrían separarse con el tiempo
    y acabaríamos renderizando la foto de otra casa tras un check que pasó.
    """
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM property_images WHERE id = %s AND property_id = %s",
            (image_id, property_id),
        ).fetchone()
    return _row_to_dict(row) if row is not None else None


def add_render(property_id: int, source_image_id: int | None, file_path: str,
               content_type: str, prompt_id: int | None, prompt_text: str,
               provider: str, model: str, source_plan_path: str | None = None) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "INSERT INTO property_renders (property_id, source_image_id, file_path,"
            " content_type, prompt_id, prompt_text, provider, model, source_plan_path)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *",
            (property_id, source_image_id, file_path, content_type,
             prompt_id, prompt_text, provider, model, source_plan_path),
        ).fetchone()
    return _row_to_dict(row)


def delete_render(render_id: int, property_id: int) -> str:
    with get_db() as conn:
        row = conn.execute(
            "DELETE FROM property_renders WHERE id = %s AND property_id = %s RETURNING file_path",
            (render_id, property_id),
        ).fetchone()
    if row is None:
        raise NotFound(f"Render {render_id} no encontrado en la propiedad {property_id}")
    return row["file_path"]
