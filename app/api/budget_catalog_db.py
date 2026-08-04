"""El catálogo que aprende — y las plantillas, que son presupuestos sin propiedad.

EL CATÁLOGO ES MEMORIA, Y POR ESO NO SE BORRA. Un capítulo o una partida que se
dejan de usar se apagan (`is_active = FALSE`). Borrar físicamente un renglón del
catálogo cortaría la procedencia de los presupuestos que lo citan —incluidos los
de propiedades ya vendidas— y con ella la única forma de saber que tres obras
distintas hablaban de la misma partida. El esquema ya lo hace difícil (`item_id`
es `ON DELETE SET NULL`, y un capítulo con partidas no se puede borrar); esta
capa lo hace imposible: no existe la función.

EDITAR EL CATÁLOGO NO MUEVE UN PRESUPUESTO. Es el invariante central de la fase,
y se sostiene por construcción: instanciar COPIA el texto al renglón y nada
vuelve a leer el catálogo para armarlo. Renombrar «Piso cerámico» a «Piso
cerámico 60x60» cambia lo que se ofrecerá mañana y no toca un peso de lo que se
capturó ayer. Ver `budget_db.catalog_item_copy` para el porqué largo.

LAS TRES PIEZAS, Y EL ORDEN EN QUE SE NECESITAN

  1. `suggest` — la deduplicación al escribir. Es la única pieza que evita que el
     catálogo se pudra, y sube de prioridad porque no hay presupuestos viejos que
     importar: sin historia previa, la única fuente del catálogo es lo que se
     teclee de aquí en adelante. Un catálogo partido en «Piso cerámico»,
     «Colocación piso cerámico» y «Piso ceramico 60x60» nunca junta tres
     observaciones de nada y jamás aprende un precio.
  2. `promotion_queue` — lo que se ha venido tecleando suelto, agrupado y
     ordenado por frecuencia. La máquina ORDENA.
  3. `promote` — el humano DECIDE, con un clic, y al hacerlo religa hacia atrás
     todos los renglones del grupo: la partida nace al catálogo ya sabiendo lo
     que cuesta. Nunca automático por frecuencia — sin curador, un catálogo que
     crece solo se llena de duplicados casi iguales, y el problema no es agregar,
     es fusionar.

Las tres existen para que la cuarta pueda existir: `item_price`, el precio que la
partida aprendió de las obras cerradas. Una historia partida en tres grafías nunca
junta tres observaciones de nada, así que la deduplicación no es la antesala del
aprendizaje — es su condición.

LO QUE ESTA CAPA NO HACE, dicho aquí para que no haya que deducirlo:

  · No fusiona por similitud. La similitud propone; ligar dos grafías a la misma
    partida es `promote(..., item_id=...)`, y lo pide una persona.
  · No edita los renglones de una plantilla. Una plantilla se hace capturando una
    obra y guardándola (`create_template(from_budget_id=...)`), que es el camino
    que el diseño describe. Abrir un CRUD paralelo para los renglones de
    plantilla sería duplicar el de `budget_db` con otra llave; el día que haga
    falta, lo que corresponde es que aquellas funciones acepten `budget_id` en
    vez de `property_id`, no que existan dos.
  · No compone bloques. Es lo que hace el sistema de procesos con
    `source_template_id`, y ahí se ve el costo: expansión truncada a un solo
    nivel más un detector de ciclos completo. Arrancar desde otra obra y borrar
    tres renglones cuesta treinta segundos y cero código.
"""
# `_line_row` viaja hasta aquí porque una plantilla se lee con el mismo lector
# que un presupuesto de obra: es un presupuesto de obra sin obra, y dos lectores
# para la misma fila serían dos formas de la misma respuesta.
from api.budget_db import BudgetError, BudgetNotFound, copy_lines, _line_row
from api.db import _row_to_dict
from api.finance.quantize import frac4, money0

# La normalización entera, y es literal a propósito: minúsculas y espacios de
# orilla. No quita acentos —`unaccent()` no es IMMUTABLE y volver «ceramico» y
# «cerámico» el mismo grupo sería fusionar por máquina, que es justo lo que esta
# capa no hace. La similitud los pone uno junto al otro y decide quien mira.
# Espeja al índice parcial de la migración 030; si una cambia, la otra deja de
# usarse sin que nada se vea roto.
_NORMALIZED = "lower(btrim(%s))"


def _norm(column: str) -> str:
    return _NORMALIZED % column


# El umbral de la sugerencia, medido y no heredado del default de pg_trgm (0.6
# para `word_similarity`). Con nombres reales de partida, `word_similarity` de lo
# tecleado contra el nombre existente da:
#
#     «piso»                     → «Piso cerámico»                 1.000
#     «Pintura vinílica»         → «Pintura vinílica en muros»     1.000
#     «Piso cerámico 60x60»      → «Piso cerámico»                 0.700
#     «Piso ceramico»            → «Piso cerámico»                 0.647
#     «Colocación piso cerámico» → «Piso cerámico»                 0.583
#     ────────────────────────────────────────────── el corte va aquí
#     «piso»                     → «Pintura vinílica en muros»     0.400
#     «Piso ceramico»            → «Piso laminado»                 0.357
#
# 0.45 deja pasar los cinco duplicados y detiene los dos que no lo son.
# `word_similarity` y no `similarity` porque la pregunta es «¿lo que estoy
# escribiendo ya está dentro de algo que existe?», y con `similarity` un prefijo
# como «piso» puntúa 0.357 contra «Piso cerámico» —se perdería justo el aviso más
# útil, el que llega antes de terminar de teclear.
SUGGESTION_THRESHOLD = "0.45"


def _use_word_similarity(conn) -> None:
    """Fija el umbral para el operador `<%` de esta transacción.

    Se usa el operador y no la función porque el operador es el que entra por el
    índice GIN de trigramas (la función obliga a recorrer la tabla). El umbral va
    por `set_config(..., TRUE)` — local a la transacción, así que no se le queda
    pegado a la conexión cuando vuelve al pool."""
    conn.execute("SELECT set_config('pg_trgm.word_similarity_threshold', %s, TRUE)",
                 (SUGGESTION_THRESHOLD,))


# ─── Lectura del catálogo ─────────────────────────────────────────────────────

_CHAPTERS_SQL = """
    SELECT c.*, coalesce(i.items, '[]'::json) AS items
      FROM budget_chapters c
      LEFT JOIN LATERAL (
            SELECT json_agg(json_build_object(
                       'id', i.id, 'chapterId', i.chapter_id, 'name', i.name,
                       'unit', i.unit, 'sortOrder', i.sort_order,
                       'isActive', i.is_active,
                       'usedInLines', (SELECT count(*) FROM budget_lines l
                                        WHERE l.item_id = i.id))
                       ORDER BY i.sort_order, i.name) AS items
              FROM budget_items i
             WHERE i.chapter_id = c.id AND (%(all)s OR i.is_active)) i ON TRUE
     WHERE %(all)s OR c.is_active
     ORDER BY c.sort_order, c.name
"""


def get_catalog(conn, include_inactive: bool = False) -> list[dict]:
    """El catálogo completo, capítulo por capítulo con sus partidas.

    `usedInLines` viaja con cada partida porque es lo que explica por qué el
    borrado físico no existe: ese número es la procedencia que se perdería."""
    rows = conn.execute(_CHAPTERS_SQL, {"all": include_inactive}).fetchall()
    return [_row_to_dict(row) for row in rows]


# ─── Capítulos del catálogo ───────────────────────────────────────────────────

def _clean_name(name, what: str) -> str:
    name = (name or "").strip()
    if not name:
        raise BudgetError(f"{what} necesita un nombre.")
    return name


# En estas tres un `null` no es un vaciado: es una columna NOT NULL rota. Sin el
# rechazo, el 422 legible llega como el 500 mudo del esquema — o peor, `isActive:
# null` daría de baja el renglón del catálogo sin que nadie lo haya pedido.
# (`name` y `unit` no están aquí porque `_clean_name` ya los cubre con su propia
# frase, que además distingue el null de la cadena en blanco.)
_NOT_NULLABLE = {
    "sortOrder": "El orden no se vacía; se pone en 0.",
    "isActive": "Un capítulo o una partida están activos o no: eso no se vacía.",
    "chapterId": "Toda partida vive en un capítulo: el capítulo no se puede vaciar.",
}


def _reject_null(data: dict) -> None:
    for field, message in _NOT_NULLABLE.items():
        if field in data and data[field] is None:
            raise BudgetError(message)


def _chapter(conn, chapter_id: int) -> dict:
    row = conn.execute("SELECT * FROM budget_chapters WHERE id = %s", (chapter_id,)).fetchone()
    if row is None:
        raise BudgetNotFound(f"El capítulo {chapter_id} no existe en el catálogo")
    return _row_to_dict(row)


def _reject_duplicate_chapter(conn, name: str, chapter_id: int | None = None) -> None:
    """El índice único parcial de la 028 ya lo impide; esto lo dice en español.

    Sin la revisión previa el choque llega como IntegrityError —un 500 mudo— y
    quien lo ve no sabe que el nombre ya existe, ni dónde."""
    row = conn.execute(
        f"SELECT id FROM budget_chapters WHERE is_active AND {_norm('name')} = {_norm('%s')}"
        "   AND (%s::bigint IS NULL OR id <> %s::bigint)",
        (name, chapter_id, chapter_id),
    ).fetchone()
    if row is not None:
        raise BudgetError(
            f"Ya hay un capítulo activo «{name}» (#{row['id']}). El catálogo no lleva dos: "
            "usa ése o renombra el que quieres dar de alta.")


def create_chapter(conn, name: str, sort_order: int = 0) -> dict:
    name = _clean_name(name, "El capítulo")
    _reject_duplicate_chapter(conn, name)
    row = conn.execute(
        "INSERT INTO budget_chapters (name, sort_order) VALUES (%s, %s) RETURNING *",
        (name, sort_order),
    ).fetchone()
    return _row_to_dict(row)


def update_chapter(conn, chapter_id: int, data: dict) -> dict:
    """Renombra, reordena o prende/apaga un capítulo.

    APAGARLO NO BORRA NADA y no toca los renglones que lo nombran: el capítulo de
    un renglón es una COPIA de texto en su fila, no una referencia. Lo único que
    cambia es que deja de ofrecerse para obra nueva."""
    chapter = _chapter(conn, chapter_id)
    _reject_null(data)
    columns = {}
    if "name" in data:
        columns["name"] = _clean_name(data["name"], "El capítulo")
    if "sortOrder" in data:
        columns["sort_order"] = data["sortOrder"]
    if "isActive" in data:
        columns["is_active"] = bool(data["isActive"])
    # Solo los vivos compiten por el nombre. Reactivar es una de las dos puertas
    # por las que se llega a un choque, y la que se olvida.
    if columns.get("is_active", chapter["isActive"]):
        _reject_duplicate_chapter(conn, columns.get("name", chapter["name"]), chapter_id)
    if not columns:
        return chapter
    assignments = ", ".join(f"{col} = %s" for col in columns)
    row = conn.execute(
        f"UPDATE budget_chapters SET {assignments} WHERE id = %s RETURNING *",
        list(columns.values()) + [chapter_id],
    ).fetchone()
    return _row_to_dict(row)


def deactivate_chapter(conn, chapter_id: int) -> dict:
    """La baja del catálogo es lógica y no hay otra.

    Sus partidas conservan su propio `is_active`: apagar un capítulo lo esconde
    entero, y prenderlo de nuevo lo devuelve tal como estaba. Cascadear el apagón
    a las partidas obligaría a recordar cuáles ya estaban apagadas para poder
    revivir bien, y esa memoria no existe en ningún lado."""
    return update_chapter(conn, chapter_id, {"isActive": False})


# ─── Partidas del catálogo ────────────────────────────────────────────────────

# `usedInLines` viaja en TODA respuesta de partida —lectura y escritura— para que
# el cliente tenga un solo tipo y no releer el catálogo entero después de crear
# una. Es la cifra que explica por qué el borrado físico no existe, así que es
# parte de lo que una partida ES, no un extra de la lista.
#
# El capítulo no recibe el mismo trato y la asimetría es a propósito: lo que le
# falta a su fila de escritura es `items`, que es una COLECCIÓN —otro payload,
# que el cliente ya modela aparte— y no un escalar que haga falta para pintar la
# fila del capítulo mismo.
_ITEM_SQL = """
    SELECT i.*, (SELECT count(*) FROM budget_lines l WHERE l.item_id = i.id) AS used_in_lines
      FROM budget_items i WHERE i.id = %s
"""


def _item(conn, item_id: int) -> dict:
    row = conn.execute(_ITEM_SQL, (item_id,)).fetchone()
    if row is None:
        raise BudgetNotFound(f"La partida {item_id} no existe en el catálogo")
    return _row_to_dict(row)


def _reject_duplicate_item(conn, chapter_id: int, name: str, item_id: int | None = None) -> None:
    row = conn.execute(
        f"SELECT id FROM budget_items WHERE is_active AND chapter_id = %s"
        f"   AND {_norm('name')} = {_norm('%s')}"
        "   AND (%s::bigint IS NULL OR id <> %s::bigint)",
        (chapter_id, name, item_id, item_id),
    ).fetchone()
    if row is not None:
        raise BudgetError(
            f"«{name}» ya está en ese capítulo del catálogo (#{row['id']}). Dos veces la "
            "misma partida es la historia de precios partida en dos: usa la que ya está, "
            "o promueve el renglón hacia ella para religar lo que se capturó suelto.")


def create_item(conn, chapter_id: int, name: str, unit: str, sort_order: int = 0) -> dict:
    chapter = _chapter(conn, chapter_id)
    if not chapter["isActive"]:
        raise BudgetError(
            f"«{chapter['name']}» está dado de baja: reactívalo antes de colgarle partidas.")
    name = _clean_name(name, "La partida")
    unit = _clean_name(unit, "La partida")
    _reject_duplicate_item(conn, chapter_id, name)
    row = conn.execute(
        "INSERT INTO budget_items (chapter_id, name, unit, sort_order)"
        " VALUES (%s, %s, %s, %s) RETURNING *",
        (chapter_id, name, unit, sort_order),
    ).fetchone()
    return _row_to_dict(row)


def update_item(conn, item_id: int, data: dict) -> dict:
    """Corrige una partida del catálogo — y NO toca ningún presupuesto.

    Es el invariante que esta fase existe para sostener, y aquí no hay nada que
    hacer para sostenerlo: los renglones copiaron su texto al nacer y no vuelven
    a leer esta fila. Un `UPDATE` aquí cambia lo que se ofrecerá mañana; lo que
    se capturó ayer no tiene por dónde enterarse."""
    item = _item(conn, item_id)
    _reject_null(data)
    columns = {}
    if "name" in data:
        columns["name"] = _clean_name(data["name"], "La partida")
    if "unit" in data:
        columns["unit"] = _clean_name(data["unit"], "La partida")
    if "sortOrder" in data:
        columns["sort_order"] = data["sortOrder"]
    if "isActive" in data:
        columns["is_active"] = bool(data["isActive"])
    if "chapterId" in data:
        columns["chapter_id"] = _chapter(conn, data["chapterId"])["id"]
    if columns.get("is_active", item["isActive"]):
        _reject_duplicate_item(conn, columns.get("chapter_id", item["chapterId"]),
                               columns.get("name", item["name"]), item_id)
    if not columns:
        return item
    assignments = ", ".join(f"{col} = %s" for col in columns)
    row = conn.execute(
        f"UPDATE budget_items SET {assignments} WHERE id = %s RETURNING *",
        list(columns.values()) + [item_id],
    ).fetchone()
    return _row_to_dict(row)


def deactivate_item(conn, item_id: int) -> dict:
    """Baja lógica, la única que hay.

    Los renglones que la citan siguen citándola: conservan `item_id`, su texto y
    su importe, y la historia de precios los sigue agrupando por ella. Lo único
    que se pierde es la posibilidad de estrenarla en obra nueva."""
    return update_item(conn, item_id, {"isActive": False})


# ─── La deduplicación al escribir ─────────────────────────────────────────────

_SUGGEST_SQL = f"""
    SELECT 'catalog'                                        AS source,
           i.id                                             AS item_id,
           c.id                                             AS chapter_id,
           c.name                                           AS chapter_name,
           i.name                                           AS name,
           i.unit                                           AS unit,
           round(word_similarity(%(q)s, i.name)::numeric, 3) AS similarity,
           (SELECT count(*) FROM budget_lines l WHERE l.item_id = i.id) AS used_in_lines
      FROM budget_items i
      JOIN budget_chapters c ON c.id = i.chapter_id
     WHERE i.is_active AND c.is_active
       AND %(q)s <%% i.name
     UNION ALL
    SELECT 'lines', NULL, NULL,
           (array_agg(l.chapter_name ORDER BY l.id DESC))[1],
           (array_agg(l.name         ORDER BY l.id DESC))[1],
           (array_agg(l.unit         ORDER BY l.id DESC))[1],
           round(max(word_similarity(%(q)s, l.name))::numeric, 3),
           count(*)
      FROM budget_lines l
     WHERE l.item_id IS NULL AND NOT l.is_residual
       AND %(q)s <%% l.name
       AND (%(exclude)s::bigint IS NULL OR l.id <> %(exclude)s::bigint)
     GROUP BY {_norm('l.name')}
     ORDER BY similarity DESC, used_in_lines DESC, name
     LIMIT %(limit)s
"""


def suggest(conn, name: str, limit: int = 5, exclude_line_id: int | None = None) -> list[dict]:
    """«¿Es la misma que ésta?», mientras alguien escribe.

    Busca en las DOS memorias, y las dos hacen falta:

      · el CATÁLOGO, que es lo curado — lo que alguien ya decidió que es una
        partida;
      · los RENGLONES SUELTOS ya tecleados en cualquier presupuesto, agrupados
        por nombre normalizado. Mientras el catálogo esté vacío son la única
        memoria que hay, y buscar solo en el catálogo dejaría la deduplicación
        muda exactamente en los meses en que se está formando — que es cuando el
        daño se hace y no se ve.

    Cada resultado dice de dónde salió (`source`) y en cuántos renglones aparece,
    para que la interfaz pueda decir «está en el catálogo» o «ya lo tecleaste en
    3 obras» en vez de una lista de nombres sin peso."""
    name = (name or "").strip()
    if not name:
        return []
    _use_word_similarity(conn)
    rows = conn.execute(_SUGGEST_SQL, {
        "q": name, "limit": limit, "exclude": exclude_line_id}).fetchall()
    return [_row_to_dict(row) for row in rows]


# ─── La cola de promoción ─────────────────────────────────────────────────────

_QUEUE_SQL = f"""
    WITH libres AS (
        SELECT l.id, l.name, l.unit, l.chapter_name, l.unit_price, b.property_id,
               {_norm('l.name')} AS normalized
          FROM budget_lines l
          JOIN budgets b ON b.id = l.budget_id
         WHERE l.item_id IS NULL AND NOT l.is_residual
    ),
    grupos AS (
        SELECT normalized,
               count(*)                     AS used_in_lines,
               count(DISTINCT property_id)  AS properties,
               array_agg(DISTINCT chapter_name) AS chapters,
               round(percentile_cont(0.5) WITHIN GROUP (ORDER BY unit_price)::numeric, 2)
                                            AS median_budgeted_unit_price
          FROM libres GROUP BY normalized
    ),
    representante AS (
        SELECT DISTINCT ON (normalized)
               normalized, id AS line_id, name, unit, chapter_name
          FROM libres ORDER BY normalized, id DESC
    ),
    pagados AS (
        SELECT {_norm('o.name')} AS normalized,
               round(percentile_cont(0.5) WITHIN GROUP (ORDER BY o.actual_unit_price)::numeric, 2)
                   AS median_paid_unit_price,
               count(*) AS paid_observations
          FROM budget_price_observations o
         GROUP BY 1
    )
    SELECT r.line_id, r.name, r.unit, r.chapter_name,
           g.normalized, g.used_in_lines, g.properties, g.chapters,
           g.median_budgeted_unit_price,
           p.median_paid_unit_price,
           coalesce(p.paid_observations, 0) AS paid_observations
      FROM grupos g
      JOIN representante r ON r.normalized = g.normalized
      LEFT JOIN pagados p  ON p.normalized = g.normalized
     ORDER BY g.properties DESC, g.used_in_lines DESC, r.name
     LIMIT %s
"""


def promotion_queue(conn, limit: int = 20) -> list[dict]:
    """Lo que se ha tecleado suelto, agrupado y ordenado por frecuencia.

    La máquina ordena; el humano decide. Esta lista no promueve nada — solo dice
    qué se repite lo suficiente como para que valga la pena curarlo.

    Ordena por NÚMERO DE OBRAS antes que por número de renglones: una partida
    escrita cinco veces en la misma obra son cinco renglones de un mismo criterio,
    mientras que la misma partida en tres obras son tres observaciones
    independientes — que es lo que hace que el catálogo aprenda. Los renglones de
    plantilla cuentan como renglones y no como obras, porque una plantilla es una
    intención, no una observación.

    LAS DOS MEDIANAS SE LLAMAN DISTINTO PORQUE SON DISTINTAS, y confundirlas es el
    defecto que este módulo tiene que no cometer:

      · `medianBudgetedUnitPrice` es a cuánto se ha venido PRESUPUESTANDO. Sirve
        para decidir si promover; NO es un precio aprendido. Sugerir desde ella
        sería un bucle de autoconfirmación —presupuestas $1,000, el catálogo
        aprende $1,000, la próxima vez sugiere $1,000— que nunca toca la realidad.
      · `medianPaidUnitPrice` sale de `budget_price_observations`: renglones
        CERRADOS de obra real que de verdad se pagaron. Ésa sí es historia, y es
        la que la fase 5 puede convertir en sugerencia. Viene en `null` mientras
        no haya un solo cierre pagado, que es lo honesto: todavía no se sabe.

    El residuo queda fuera. «Otros, por detallar» existe en TODOS los
    presupuestos, así que sin excluirlo encabezaría esta cola para siempre
    proponiendo meter al catálogo el remanente."""
    rows = conn.execute(_QUEUE_SQL, (limit,)).fetchall()
    return [_row_to_dict(row) for row in rows]


# ─── La promoción ─────────────────────────────────────────────────────────────

def promote(conn, line_id: int, chapter_id: int | None = None,
            item_id: int | None = None) -> dict:
    """Lleva un renglón suelto al catálogo y RELIGA HACIA ATRÁS su grupo entero.

    El religado es lo que hace que la promoción valga: la partida no nace al
    catálogo en blanco, nace sabiendo lo que cuesta, porque todos los renglones
    equivalentes que ya existían pasan a apuntarle. Sin eso, promover sería
    empezar a contar desde cero justo cuando ya había con qué.

    Y RELIGAR NO REESCRIBE NADA. Los renglones conservan su nombre, su unidad,
    su cantidad y su precio exactamente como se capturaron —«Piso ceramico»
    sigue diciendo «Piso ceramico»— y lo único que cambia es a dónde apuntan.
    Ése es el pago completo de la fase: tres grafías se vuelven una sola historia
    de precios sin tocar un carácter de lo que alguien escribió, y sin mover un
    peso de ningún presupuesto.

    Con `item_id` no crea nada: liga el grupo a una partida que ya existe. Es la
    fusión, y es la operación que de verdad hacía falta — agregar al catálogo
    nunca fue el problema; juntar lo que se partió, sí. La pide una persona
    porque una máquina que fusiona sola se equivoca en silencio.

    Sin `item_id` crea la partida en el capítulo que el renglón ya traía, o en el
    que diga `chapter_id` si quien cura decide otro. Si ese capítulo no existe en
    el catálogo, nace: no es una decisión nueva, es la que el renglón ya tenía
    escrita."""
    line = conn.execute(
        "SELECT id, name, unit, chapter_name, item_id, is_residual"
        "  FROM budget_lines WHERE id = %s", (line_id,)).fetchone()
    if line is None:
        raise BudgetNotFound(f"El renglón {line_id} no existe")
    if line["is_residual"]:
        raise BudgetError(
            "«Otros, por detallar» es el remanente del presupuesto, no una partida: "
            "no hay nada que promover al catálogo.")
    if line["item_id"] is not None:
        raise BudgetError(
            "Ese renglón ya viene del catálogo. Para corregir a qué partida apunta, "
            "cambia su procedencia en el renglón.")

    if item_id is not None:
        target = _item(conn, item_id)
        if not target["isActive"]:
            raise BudgetError(
                f"«{target['name']}» está dada de baja en el catálogo: reactívala antes "
                "de ligarle renglones.")
        created = False
    else:
        chapter = (_chapter(conn, chapter_id) if chapter_id is not None
                   else _chapter_by_name(conn, line["chapter_name"]))
        if not chapter["isActive"]:
            raise BudgetError(
                f"«{chapter['name']}» está dado de baja: reactívalo antes de colgarle partidas.")
        existing = conn.execute(
            f"SELECT * FROM budget_items WHERE chapter_id = %s AND is_active"
            f"   AND {_norm('name')} = {_norm('%s')}",
            (chapter["id"], line["name"]),
        ).fetchone()
        # Que ya exista no es un error: quien promueve está diciendo «esto es esa
        # partida», y eso es exactamente lo que hay que hacer con ella. Crear una
        # segunda con el mismo nombre sería el duplicado que todo esto evita.
        created = existing is None
        target = (_row_to_dict(existing) if existing is not None
                  else _row_to_dict(conn.execute(
                      "INSERT INTO budget_items (chapter_id, name, unit) VALUES (%s, %s, %s)"
                      " RETURNING *", (chapter["id"], line["name"], line["unit"])).fetchone()))

    relinked = conn.execute(
        f"UPDATE budget_lines SET item_id = %s"
        f" WHERE item_id IS NULL AND NOT is_residual"
        f"   AND {_norm('name')} = {_norm('%s')}",
        (target["id"], line["name"]),
    ).rowcount
    return {"item": target, "created": created, "relinked": relinked}


def _chapter_by_name(conn, name: str) -> dict:
    """El capítulo del catálogo que se llama así, o uno recién nacido con ese
    nombre. El renglón ya traía el capítulo escrito; esto solo lo hace existir
    donde el catálogo lo pueda ver."""
    name = _clean_name(name, "El capítulo")
    row = conn.execute(
        f"SELECT * FROM budget_chapters WHERE is_active AND {_norm('name')} = {_norm('%s')}",
        (name,),
    ).fetchone()
    if row is not None:
        return _row_to_dict(row)
    return create_chapter(conn, name)


# ─── El precio que se aprendió ────────────────────────────────────────────────
#
# LA SUGERENCIA SALE SIEMPRE DE LO PAGADO, JAMÁS DE LO PRESUPUESTADO. Es la regla
# de la que depende que este módulo sirva de algo: sugerir desde el presupuestado
# histórico es un bucle de autoconfirmación —presupuestas $1,000, el catálogo
# aprende $1,000, la próxima vez sugiere $1,000— en el que el catálogo repetiría
# para siempre una suposición que alguien hizo una vez sin tocar nunca la
# realidad. Aquí `budgeted_unit_price` se lee EXCLUSIVAMENTE para calcular el
# sesgo; ninguna cifra que se publique como precio viene de él.
#
# Y todo esto lee la VISTA, que ya dejó fuera lo que envenena la historia: los
# renglones abiertos (un pago sin cierre es un anticipo, no un precio), las
# plantillas (una intención, no una obra) y los cierres sin un peso pagado.

# Las obras distintas que hacen que la sugerencia valga. Tres, y son OBRAS, no
# renglones: la misma partida escrita cinco veces en un presupuesto son cinco
# copias de un mismo criterio, mientras que tres obras son tres negociaciones
# independientes. El número no bloquea nada —el precio se publica desde la
# primera observación, porque es lo que de verdad se pagó y callarlo no lo hace
# más cierto— pero viaja en la respuesta para que la interfaz pueda decir
# «faltan dos obras» en vez de presentar un caso aislado como si fuera una regla.
MIN_PROPERTIES = 3

# El sesgo solo puede medirse donde hay las DOS cifras de verdad. Un renglón que
# nadie presupuestó llega con `unit_price = 0` —la captura es celda por celda y
# nacer sin precio es normal— y contarlo diría «el presupuesto quedó 100% abajo»,
# que es exactamente la clase de número que parece plausible y no lo es. El piso
# de lo pagado es además la guarda de la división: la vista redondea a dos
# decimales, así que un precio unitario minúsculo puede llegar en 0.00.
_COMPARABLE = "o.budgeted_unit_price > 0 AND o.actual_unit_price > 0"

_PRICE_STATS_SQL = f"""
    SELECT count(*)                                  AS observations,
           count(DISTINCT o.property_id)             AS properties,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY o.actual_unit_price)::numeric, 2)
                                                     AS median_unit_price,
           round(min(o.actual_unit_price), 2)        AS min_unit_price,
           round(max(o.actual_unit_price), 2)        AS max_unit_price,
           count(*) FILTER (WHERE {_COMPARABLE})     AS bias_observations,
           round((percentile_cont(0.5) WITHIN GROUP (
                      ORDER BY (o.budgeted_unit_price - o.actual_unit_price)
                               / o.actual_unit_price)
                  FILTER (WHERE {_COMPARABLE}))::numeric, 4)  AS bias_delta,
           count(*) FILTER (WHERE {_COMPARABLE}
                              AND o.budgeted_unit_price < o.actual_unit_price) AS bias_below,
           count(*) FILTER (WHERE {_COMPARABLE}
                              AND o.budgeted_unit_price > o.actual_unit_price) AS bias_above,
           count(*) FILTER (WHERE {_COMPARABLE}
                              AND o.budgeted_unit_price = o.actual_unit_price) AS bias_exact
      FROM budget_price_observations o
     WHERE o.item_id = %s
"""

_LAST_OBSERVATION_SQL = """
    SELECT o.closed_at, o.property_id, p.name AS property_name,
           o.supplier_id, s.name AS supplier_name,
           o.actual_unit_price AS unit_price, o.budgeted_unit_price,
           o.actual_quantity, o.paid_amount
      FROM budget_price_observations o
      JOIN properties p       ON p.id = o.property_id
      LEFT JOIN proveedores s ON s.id = o.supplier_id
     WHERE o.item_id = %s
     ORDER BY o.closed_at DESC, o.line_id DESC
     LIMIT 1
"""

# El corte por proveedor con `rating_calidad` al lado, que es la pregunta de
# negociación completa: quién cobra menos ENTRE LOS QUE TRABAJAN BIEN. El precio
# solo no la contesta —el más barato puede ser el que hay que volver a llamar— y
# la calificación sola tampoco.
#
# El JOIN es cerrado a propósito: una observación sin proveedor cuenta para la
# mediana general (se pagó de verdad) pero no puede aparecer aquí, porque «sin
# proveedor» no es alguien con quien se pueda negociar la próxima.
_BY_SUPPLIER_SQL = """
    SELECT o.supplier_id, s.name AS supplier_name, s.rating_calidad, s.status,
           count(*)                      AS observations,
           count(DISTINCT o.property_id) AS properties,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY o.actual_unit_price)::numeric, 2)
                                         AS median_unit_price,
           max(o.closed_at)              AS last_closed_at
      FROM budget_price_observations o
      JOIN proveedores s ON s.id = o.supplier_id
     WHERE o.item_id = %s
     GROUP BY o.supplier_id, s.name, s.rating_calidad, s.status
     ORDER BY median_unit_price, s.name
"""

# Lo que le falta a esta partida para tener historia, contado sobre los renglones
# de obra real que ya la citan. Es la mitad de la respuesta que sirve durante los
# primeros meses —cuando no hay una sola observación de nada— y sin ella la
# pantalla vacía no tendría cómo decir qué capturar para llenarse.
_PENDING_SQL = """
    SELECT count(*)                                      AS lines,
           count(*) FILTER (WHERE l.closed_at IS NULL)   AS open_lines,
           count(*) FILTER (WHERE l.closed_at IS NULL
                              AND coalesce(pagos.paid, 0) > 0)  AS paid_but_open,
           count(*) FILTER (WHERE l.closed_at IS NOT NULL
                              AND coalesce(pagos.paid, 0) = 0)  AS closed_without_payment
      FROM budget_lines l
      JOIN budgets b ON b.id = l.budget_id
      LEFT JOIN LATERAL (SELECT sum(p.amount) AS paid
                           FROM budget_line_payments p
                          WHERE p.line_id = l.id) pagos ON TRUE
     WHERE l.item_id = %s AND b.property_id IS NOT NULL
"""


def _bias(stats: dict) -> dict | None:
    """Cuánto se desvió SISTEMÁTICAMENTE lo presupuestado de lo pagado, y en
    cuántas de cuántas observaciones el desvío fue en la misma dirección.

    Es el hallazgo de más valor de toda la fase, y no un adorno del precio: un
    precio unitario dice cuánto cuesta algo, mientras que el sesgo dice cómo se
    equivoca quien presupuesta — «lo presupuestado quedó 12% abajo de lo pagado,
    en 4 de 4». Eso se corrige una vez y mejora todos los presupuestos futuros.

    `medianDeltaPct` es la MEDIANA de las desviaciones relativas de cada
    observación, no la resta de las dos medianas: la resta compararía el renglón
    de en medio de una lista contra el de en medio de otra, que pueden ser
    renglones distintos. Se publica como fracción con signo —negativa cuando lo
    presupuestado quedó por debajo de lo pagado, que es el caso normal en obra—
    igual que el resto de los porcentajes del repo.

    `sameDirection` cuenta contra la dirección de esa mediana, y es lo que separa
    un sesgo de un promedio de errores que se cancelan: 4 de 4 es una costumbre
    que se corrige, 2 de 4 es ruido."""
    comparable = stats["bias_observations"]
    if not comparable:
        return None
    delta = stats["bias_delta"]
    same = (stats["bias_below"] if delta < 0 else
            stats["bias_above"] if delta > 0 else stats["bias_exact"])
    return {
        "medianDeltaPct": frac4(delta),
        "observations": comparable,
        "sameDirection": same,
    }


def item_price(conn, item_id: int) -> dict:
    """El precio que la partida aprendió de las obras cerradas — con su rango, su
    respaldo, la última vez y el sesgo.

    Todo sale de lo PAGADO. La única cifra presupuestada que se lee es la que
    entra al sesgo, y el sesgo es una comparación, no una sugerencia.

    LA RESPUESTA VACÍA ES EL CASO PRINCIPAL, no un borde. El catálogo arranca sin
    una sola observación y así va a estar durante meses —aprende desde la tercera
    obra cerrada— así que la respuesta sin historia tiene que decir qué falta para
    que empiece a haberla: cuántas obras faltan (`propertiesNeeded`) y cuántos
    renglones ya citan la partida sin haberse vuelto observación (`pending`), que
    es lo único accionable que hay en ese momento. Un `null` mudo dejaría a quien
    captura sin saber que lo que falta es cerrar renglones con su cantidad real y
    sus pagos, y entonces la pantalla llena no llega nunca."""
    item = _item(conn, item_id)
    stats = conn.execute(_PRICE_STATS_SQL, (item_id,)).fetchone()
    last = conn.execute(_LAST_OBSERVATION_SQL, (item_id,)).fetchone()
    suppliers = conn.execute(_BY_SUPPLIER_SQL, (item_id,)).fetchall()
    pending = conn.execute(_PENDING_SQL, (item_id,)).fetchone()
    return {
        "itemId": item["id"],
        "name": item["name"],
        "unit": item["unit"],
        "observations": stats["observations"],
        "properties": stats["properties"],
        "propertiesNeeded": max(0, MIN_PROPERTIES - stats["properties"]),
        # La mediana y no el promedio: con tres observaciones un renglón atípico
        # —el m² de piso que se contrató con material incluido— destruye un
        # promedio, y la mediana lo aguanta sin enterarse.
        "suggestedUnitPrice": stats["median_unit_price"],
        "minUnitPrice": stats["min_unit_price"],
        "maxUnitPrice": stats["max_unit_price"],
        "lastObservation": _row_to_dict(last),
        "bias": _bias(stats),
        "bySupplier": [_row_to_dict(row) for row in suppliers],
        "pending": _row_to_dict(pending),
    }


# ─── Plantillas ───────────────────────────────────────────────────────────────
#
# Una plantilla es un presupuesto sin propiedad. No hay una tabla `templates`, ni
# una relación «plantilla → obras», ni un momento en que instanciar una plantilla
# signifique algo distinto de copiar un presupuesto: por eso se pueden tener
# «Remodelación casa antigua», «Obra nueva» y «Adecuación de local» sin una línea
# extra de esquema.

# `line_count` y no `lines`: en `get_template` el mismo nombre carga el ARREGLO de
# renglones, y un campo que es un número en la lista y una lista en el detalle es
# la clase de trampa que se paga en el cliente, no aquí.
_TEMPLATES_SQL = """
    SELECT b.id, b.name, b.notes, b.created_at, b.updated_at,
           coalesce(t.line_count, 0) AS line_count, coalesce(t.total, 0) AS total
      FROM budgets b
      LEFT JOIN LATERAL (
            SELECT count(*) AS line_count, sum(l.quantity * l.unit_price) AS total
              FROM budget_lines l WHERE l.budget_id = b.id) t ON TRUE
     WHERE b.property_id IS NULL
     ORDER BY lower(b.name)
"""


def _template_row(row) -> dict:
    template = _row_to_dict(row)
    template["total"] = money0(template["total"])
    return template


def list_templates(conn) -> list[dict]:
    return [_template_row(row) for row in conn.execute(_TEMPLATES_SQL).fetchall()]


def _require_template(conn, template_id: int) -> dict:
    row = conn.execute("SELECT * FROM budgets WHERE id = %s", (template_id,)).fetchone()
    if row is None:
        raise BudgetNotFound(f"No existe la plantilla {template_id}")
    if row["property_id"] is not None:
        raise BudgetError(
            f"El presupuesto {template_id} es el de una propiedad, no una plantilla. "
            "Se edita desde su obra.")
    return _row_to_dict(row)


def get_template(conn, template_id: int) -> dict:
    """Una plantilla con sus renglones."""
    template = _require_template(conn, template_id)
    rows = conn.execute(
        "SELECT * FROM budget_lines WHERE budget_id = %s"
        " ORDER BY chapter_name, sort_order, id", (template_id,)).fetchall()
    template["lines"] = [_line_row(row) for row in rows]
    return template


def create_template(conn, name: str, from_budget_id: int | None = None) -> dict:
    """«Guarda ésta como plantilla» — el tercer uso de la única copia que hay.

    `from_budget_id` puede ser el presupuesto de una obra o el de otra plantilla:
    copiar no distingue, y ahí está la economía. Lo que no se copia es el residuo
    (es el remanente de esa obra, no una partida) ni nada de la ejecución —
    proveedor, comprometido, pagos, cierre—: una plantilla es la forma de un
    plan, no el contrato de nadie."""
    name = _clean_name(name, "La plantilla")
    duplicate = conn.execute(
        f"SELECT id FROM budgets WHERE property_id IS NULL AND {_norm('name')} = {_norm('%s')}",
        (name,),
    ).fetchone()
    if duplicate is not None:
        raise BudgetError(
            f"Ya hay una plantilla «{name}» (#{duplicate['id']}). Ponle otro nombre o "
            "bórrala si la vas a reemplazar.")
    template_id = conn.execute(
        "INSERT INTO budgets (name) VALUES (%s) RETURNING id", (name,)).fetchone()["id"]
    if from_budget_id is not None:
        if conn.execute("SELECT 1 FROM budgets WHERE id = %s",
                        (from_budget_id,)).fetchone() is None:
            raise BudgetNotFound(f"No existe el presupuesto {from_budget_id} que se quiere copiar")
        copy_lines(conn, from_budget_id, template_id)
    return get_template(conn, template_id)


def update_template(conn, template_id: int, data: dict) -> dict:
    _require_template(conn, template_id)
    columns = {}
    if "name" in data:
        name = _clean_name(data["name"], "La plantilla")
        duplicate = conn.execute(
            f"SELECT id FROM budgets WHERE property_id IS NULL AND id <> %s"
            f"   AND {_norm('name')} = {_norm('%s')}", (template_id, name)).fetchone()
        if duplicate is not None:
            raise BudgetError(f"Ya hay una plantilla «{name}» (#{duplicate['id']}).")
        columns["name"] = name
    if "notes" in data:
        columns["notes"] = data["notes"] or ""
    if columns:
        assignments = ", ".join(f"{col} = %s" for col in columns)
        conn.execute(f"UPDATE budgets SET {assignments} WHERE id = %s",
                     list(columns.values()) + [template_id])
    return get_template(conn, template_id)


def delete_template(conn, template_id: int) -> dict:
    """Una plantilla SÍ se borra, y no es una excepción a la baja lógica del
    catálogo: es que no son lo mismo. El catálogo es memoria —quitarlo cortaría
    la procedencia de presupuestos ya capturados— mientras que una plantilla es
    una intención de la que, después de copiar, no queda ni una referencia: los
    renglones que salieron de ella se llevaron el texto y no la citan."""
    template = get_template(conn, template_id)
    conn.execute("DELETE FROM budgets WHERE id = %s", (template_id,))
    return template
