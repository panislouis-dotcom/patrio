"""Persistencia de la biblioteca de prompts y de los renders generados."""
import json

from api.db import get_db, _row_to_dict


def variant_exists(property_id: int, variant: str) -> bool:
    """De qué variante nace un render de plano: 'original' (el levantamiento,
    siempre existe) o el ID de un plan de proyecto, que debe estar presente en el
    geometry VIVO de la propiedad. Reemplaza a la vieja tupla SOURCE_VARIANTS
    ('original'|'planned'): desde la migración 050 la variante ES el plan id, y
    una tupla fija ya no puede validarla — ni debe hacerlo el cliente, que antes
    se auto-certificaba. Membresía por containment de jsonb, sin interpretar la
    forma profunda del blob (la geometría es del frontend; aquí solo se pregunta
    si el plan id existe)."""
    if variant == "original":
        return True
    with get_db() as conn:
        row = conn.execute(
            "SELECT 1 FROM properties WHERE id = %s"
            " AND geometry->'variants'->'plans' @> %s::jsonb",
            (property_id, json.dumps([{"id": variant}])),
        ).fetchone()
    return row is not None


class PromptError(RuntimeError):
    """Regla de la biblioteca rota (nombre repetido, borrar un sembrado)."""


class NotFound(RuntimeError):
    pass


# ─── Biblioteca de prompts ────────────────────────────────────────────────────

def list_prompts(kind: str | None = None) -> list[dict]:
    """Sembrados primero, luego los propios por nombre: la biblioteca siempre
    abre con el piso conocido.

    `kind` filtra entre 'photo' y 'plan' cuando se pasa; sin filtro devuelve
    las dos bibliotecas juntas, porque no todo llamador (p.ej. una vista de
    administración) necesita separarlas."""
    query = "SELECT * FROM render_prompts WHERE archived_at IS NULL"
    params: tuple = ()
    if kind is not None:
        query += " AND kind = %s"
        params = (kind,)
    query += " ORDER BY is_default DESC, name"
    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
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


def create_prompt(name: str, body: str, kind: str = "photo") -> dict:
    """`kind` por defecto 'photo' por compatibilidad hacia atrás: un llamador
    que no sabe todavía de la biblioteca de plano sigue creando lo que siempre
    creó."""
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
            "INSERT INTO render_prompts (name, body, is_default, kind)"
            " VALUES (%s, %s, false, %s) RETURNING *",
            (name, body, kind),
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


def list_render_heads(property_id: int) -> list[dict]:
    """Las CABEZAS de cada cadena: los renders que nadie editó encima — uno por
    línea de trabajo, la versión más reciente. Es lo que la presentación muestra;
    los pasos intermedios de una edición quedan fuera."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM property_renders pr WHERE pr.property_id = %s"
            "  AND NOT EXISTS ("
            "    SELECT 1 FROM property_renders c WHERE c.parent_render_id = pr.id)"
            " ORDER BY created_at DESC, id DESC",
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


def get_render(property_id: int, render_id: int) -> dict | None:
    """El render de esta propiedad, o None. Se usa para editar ENCIMA de él: su
    imagen es la fuente del siguiente paso."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM property_renders WHERE id = %s AND property_id = %s",
            (render_id, property_id),
        ).fetchone()
    return _row_to_dict(row) if row is not None else None


def chain_is_plan(property_id: int, render_id: int) -> bool:
    """True si la raíz de la cadena de ediciones nació del PLANO (no de una foto).
    Se camina parent_render_id hasta la raíz para elegir la cláusula correcta: un
    plano editado sigue siendo un plano 2D, no se vuelve foto a mitad de camino."""
    with get_db() as conn:
        row = conn.execute(
            "WITH RECURSIVE chain AS ("
            "  SELECT id, parent_render_id, source_plan_path FROM property_renders"
            "   WHERE id = %s AND property_id = %s"
            "  UNION ALL"
            "  SELECT r.id, r.parent_render_id, r.source_plan_path"
            "   FROM property_renders r JOIN chain c ON r.id = c.parent_render_id"
            ") SELECT source_plan_path FROM chain WHERE parent_render_id IS NULL LIMIT 1",
            (render_id, property_id),
        ).fetchone()
    return bool(row and row["source_plan_path"])


def add_render(property_id: int, source_image_id: int | None, file_path: str,
               content_type: str, prompt_id: int | None, prompt_text: str,
               provider: str, model: str, source_plan_path: str | None = None,
               parent_render_id: int | None = None,
               source_variant: str | None = None,
               floor_id: str | None = None, floor_name: str | None = None) -> dict:
    """`source_variant` dice de qué levantamiento nació un render de plano
    ('original' | 'planned'); NULL para uno nacido de una foto. Al editar, el
    llamador (el endpoint de edición) lo resuelve del padre y lo pasa aquí
    explícito — no se recalcula caminando la cadena, porque cada edición ya
    copia la variante de su padre inmediato y eso basta por inducción.

    `floor_id`/`floor_name` dicen de qué piso del levantamiento nació un render
    de plano: identidad + nombre congelado, mismo patrón dual que
    prompt_id/prompt_text. NULL para uno nacido de una foto (un piso no aplica
    ahí) y para cualquier render anterior a esta identidad — no hay backfill
    honesto posible. Igual que source_variant, se hereda del padre inmediato al
    editar, no se recalcula."""
    with get_db() as conn:
        row = conn.execute(
            "INSERT INTO property_renders (property_id, source_image_id, file_path,"
            " content_type, prompt_id, prompt_text, provider, model, source_plan_path,"
            " parent_render_id, source_variant, floor_id, floor_name)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *",
            (property_id, source_image_id, file_path, content_type,
             prompt_id, prompt_text, provider, model, source_plan_path, parent_render_id,
             source_variant, floor_id, floor_name),
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


def delete_plan(property_id: int, plan_id: str) -> tuple[int, list[str], int]:
    """Quita un plan de proyecto del blob de geometría Y borra sus renders, en
    UNA transacción — la mitad peligrosa es la cascada de renders, por eso vive
    aquí y no en properties_db. Un plan borrado no deja ningún tab donde sus
    renders vuelvan a verse jamás (a diferencia de un piso borrado, cuyos renders
    siguen visibles con el nombre congelado): conservarlos sería peso muerto
    invisible, no honestidad — decisión de diseño 2026-08-24, con confirmación de
    dos pasos en la UI mostrando el conteo real.

    Devuelve (renders borrados, rutas de storage a borrar DESPUÉS del commit,
    nueva geometry_revision) — mismo orden que delete_render: primero la verdad
    de la BD, luego los archivos. Muta el blob, así que sube la revisión del
    candado optimista (052) igual que el PUT de geometría: las demás sesiones
    con el blob viejo en memoria reciben 409 en su siguiente guardado en vez de
    resucitar el plan borrado; y devuelve la nueva para que ESTA sesión siga
    guardando sin recargar. El filtro del plan en el jsonb no interpreta la
    forma profunda: solo compara el `id` de cada elemento de `plans`."""
    with get_db() as conn:
        removed = conn.execute(
            "UPDATE properties SET geometry = jsonb_set(geometry, '{variants,plans}',"
            " COALESCE((SELECT jsonb_agg(p ORDER BY ord)"
            "   FROM jsonb_array_elements(geometry->'variants'->'plans')"
            "   WITH ORDINALITY AS t(p, ord) WHERE p->>'id' <> %(plan_id)s), '[]'::jsonb)),"
            " geometry_revision = geometry_revision + 1"
            " WHERE id = %(property_id)s"
            "   AND geometry->'variants'->'plans' @> %(needle)s::jsonb"
            " RETURNING id, geometry_revision",
            {"property_id": property_id, "plan_id": plan_id,
             "needle": json.dumps([{"id": plan_id}])},
        ).fetchone()
        if removed is None:
            raise NotFound(f"Plan {plan_id} no encontrado en la propiedad {property_id}")
        rows = conn.execute(
            "DELETE FROM property_renders WHERE property_id = %s AND source_variant = %s"
            " RETURNING file_path, source_plan_path",
            (property_id, plan_id),
        ).fetchall()
        # Su presupuesto-escenario (addendum 2026-08-24) cae con él: los
        # renglones y pagos cascadean por FK. El de la propiedad (plan_id NULL)
        # ni se mira.
        conn.execute(
            "DELETE FROM budgets WHERE property_id = %s AND plan_id = %s",
            (property_id, plan_id),
        )
    # source_plan_path (el PNG de referencia que vio la IA) también se limpia:
    # sin el plan ni sus renders, nada vuelve a direccionarlo. Set: una cadena de
    # ediciones comparte la referencia de su raíz.
    paths = {r["file_path"] for r in rows} | {
        r["source_plan_path"] for r in rows if r["source_plan_path"]}
    return len(rows), sorted(paths), removed["geometry_revision"]


class NoGroup(RuntimeError):
    """El render no tiene piso NI foto — su piso o su foto se borraron. No hay
    grupo dentro del cual «elegirlo» tenga sentido."""


def choose_render(property_id: int, render_id: int) -> dict:
    """Marca este render y apaga cualquier otro del MISMO grupo (piso+variante, o
    foto fuente) en un solo bloque de conexión — mismo patrón que
    `select_cotizacion` (db_proveedores.py). El índice único parcial es la red de
    seguridad si algo se cuela entre las dos sentencias; esta transacción es la
    primera línea."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT floor_id, source_variant, source_image_id FROM property_renders"
            " WHERE id = %s AND property_id = %s", (render_id, property_id)).fetchone()
        if row is None:
            raise NotFound(f"Render {render_id} no encontrado en la propiedad {property_id}")
        if row["floor_id"] is not None:
            conn.execute(
                "UPDATE property_renders SET is_chosen = FALSE"
                " WHERE property_id = %s AND floor_id = %s AND source_variant = %s",
                (property_id, row["floor_id"], row["source_variant"]))
        elif row["source_image_id"] is not None:
            conn.execute(
                "UPDATE property_renders SET is_chosen = FALSE"
                " WHERE property_id = %s AND source_image_id = %s",
                (property_id, row["source_image_id"]))
        else:
            raise NoGroup(f"Render {render_id} no tiene piso ni foto — no se puede elegir")
        chosen = conn.execute(
            "UPDATE property_renders SET is_chosen = TRUE WHERE id = %s RETURNING *",
            (render_id,)).fetchone()
    return _row_to_dict(chosen)


def unchoose_render(property_id: int, render_id: int) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "UPDATE property_renders SET is_chosen = FALSE"
            " WHERE id = %s AND property_id = %s RETURNING *",
            (render_id, property_id)).fetchone()
    if row is None:
        raise NotFound(f"Render {render_id} no encontrado en la propiedad {property_id}")
    return _row_to_dict(row)
