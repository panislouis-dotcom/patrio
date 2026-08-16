"""El presupuesto de obra — dónde vive «cuánto va a costar la obra».

Desde la fase 2 el costo de obra de una propiedad ES la suma de su presupuesto,
en toda etapa y sin una sola rama. No hay «usa el presupuesto si existe, si no
la fórmula»: esa disyunción es dos números, y es exactamente lo que la 027
eliminó de la inversión total. Por eso la 032 sembró un presupuesto para TODA
propiedad —con el costo que la fórmula daba, al peso— y por eso `create_property`
siembra el suyo en la misma transacción que la fila.

Tres cifras coexisten y no se sustituyen entre sí:

    presupuestado = SUM(cantidad × precio unitario)   el plan
    comprometido  = SUM(committed_amount)             lo que se firmó
    pagado        = SUM(pagos)                        lo que salió del banco

Solo el PLAN alimenta la inversión total. Lo comprometido y lo pagado son
ejecución contra ese plan y generan métricas propias —el avance de obra en
dinero— pero nunca redefinen la base de capital: la inversión es lo que la obra
va a costar, no lo que ya se pagó de ella.

Ninguna cifra total se guarda. Presupuestado y pagado se derivan cada vez que
alguien pregunta, igual que `totalInvestment`, porque un total almacenado es un
segundo lugar donde vive el mismo peso y dos lugares terminan diciendo cosas
distintas.

EL OVERHEAD ESTÁ ADENTRO, UNA SOLA VEZ. El ×1.3 de indirectos se aplica cuando
se calcula el primer renglón —al sembrar, aquí abajo, o en la migración 032— y
desde ahí vive dentro del importe. Nada vuelve a multiplicarlo. Es la trampa
central de este módulo: volver a aplicarlo inflaría un 30% el costo de obra de
cada propiedad sin un test rojo, sin un error, solo con números más grandes que
parecen plausibles.
"""
from decimal import Decimal

from api.db import _row_to_dict
from api.finance.quantize import money, money0, to_decimal

# El renglón que absorbe lo que todavía no se detalla. Nace con el presupuesto y
# no se borra nunca: sin él, detallar una partida no tendría de dónde restar.
RESIDUAL_CHAPTER = "Otros"
RESIDUAL_NAME = "Otros, por detallar"
RESIDUAL_UNIT = "lote"

# El multiplicador de indirectos que la calculadora aplica al producir el primer
# renglón. Vive aquí y no entre los supuestos del underwriting porque ya no es
# un supuesto: no multiplica ninguna cifra publicada, solo participa una vez en
# la aritmética que produce un importe, y después el importe es el hecho.
CONSTRUCTION_OVERHEAD_DEFAULT = Decimal("1.3")


class BudgetError(Exception):
    """Rechazo del dominio con un mensaje escrito para quien lo va a corregir."""


class BudgetNotFound(BudgetError):
    """No existe ese presupuesto, renglón o pago — los routers lo vuelven 404."""


# ─── El oficio ────────────────────────────────────────────────────────────────
#
# Se sabe QUÉ TIPO de persona hace falta mucho antes de saber QUIÉN: al
# presupuestar ya se sabe que la partida es de plomería, y a quién se le da se
# decide semanas después. Por eso la categoría se captura directo en el
# renglón, junto con el nombre y la unidad, y ahí se puede corregir — mientras
# que `supplier_id` sigue siendo la elección concreta, que llega mucho más tarde.

def require_supplier_category(conn, category_id):
    """La categoría de proveedor que exista, o un rechazo legible.

    `None` es la respuesta NORMAL —«todavía no se sabe de qué oficio es», o «ya
    no»— y no se valida: no hay nada que buscar. Lo que se ataja es el id que no
    existe, porque la FK sola contesta un IntegrityError que llega como 500 mudo
    y quien lo ve no sabe qué le rechazaron."""
    if category_id is None:
        return None
    row = conn.execute(
        "SELECT id FROM proveedor_categories WHERE id = %s", (category_id,)
    ).fetchone()
    if row is None:
        raise BudgetNotFound(f"No existe la categoría de proveedor {category_id}")
    return category_id


# ─── La calculadora ───────────────────────────────────────────────────────────

def overhead_factor(construction_overhead) -> Decimal:
    """UN OVERHEAD NUNCA ACHICA LA OBRA. Es la regla entera, y vale para todo el
    rango: de 1 en adelante suma indirectos, el 0 no suma nada, y por debajo de 1
    no hay nada que aceptar porque no existe la lectura en la que un multiplicador
    de indirectos abarate lo que va a costar la obra.

    El overhead es un MULTIPLICADOR (1.3 = +30% de indirectos), así que un cero
    capturado significa «sin sobrecosto» —identidad 1, nunca ×0, que borraría la
    obra que alguien sí capturó. Compárese con el pct de adquisición, una fracción
    aditiva cuya identidad sí es 0. Y 0.5 no es una tercera cosa: es esa misma
    confusión a medio camino —quien lo teclea suele querer decir «50% de
    indirectos», que se captura 1.5— con la diferencia de que el 0 tiene una
    lectura correcta y el 0.5 no tiene ninguna.

    Se rechaza aquí y no en un formulario porque el MCP y las semillas también
    llaman a la calculadora sin pasar por ninguna pantalla, y porque el daño ya no
    es corregible: el overhead se aplica UNA SOLA VEZ, al sembrar, y desde ahí vive
    dentro del importe del renglón «Otros». Cuando multiplicaba en cada lectura,
    corregir el campo corregía la cifra; hoy corregir el campo no mueve un peso y
    hay que editar el presupuesto a mano — si alguien se entera.

    Un overhead ausente no se resuelve aquí: llega ya resuelto al default."""
    factor = to_decimal(construction_overhead)
    if not factor:
        return Decimal(1)
    if factor < 1:
        raise BudgetError(
            f"El overhead de obra es un multiplicador de indirectos: 1.3 son 30% de "
            f"sobrecosto, y {factor} achicaría la obra en vez de encarecerla. Para 50% "
            "de indirectos captura 1.5; para ninguno, 0. Y conviene atinarle ahora: el "
            "overhead se aplica una sola vez, al sembrar el presupuesto, así que "
            "corregir el campo después ya no mueve esa cifra.")
    return factor


def calculator_estimate(sqm_construction, construction_cost_per_sqm,
                        construction_overhead=None) -> Decimal:
    """`m² × $/m² × overhead` — el estimado grueso con el que nace un presupuesto.

    Esto es todo lo que queda de la fórmula que antes era el costo de obra: una
    CALCULADORA para llegar al primer número, no un campo que siga alimentando
    nada. Su resultado se guarda como el importe del renglón residual y desde
    ahí manda el presupuesto. Espeja al peso la aritmética de la migración 032,
    incluido que un NULL resuelve al default y un 0 capturado es identidad.

    Lo único que la 032 no tuvo que decidir —un factor por debajo de 1— lo rechaza
    `overhead_factor` antes de que el estimado exista: sembrar con él dejaría la
    obra encogida dentro del renglón «Otros», donde ya no se corrige sola."""
    overhead = (CONSTRUCTION_OVERHEAD_DEFAULT if construction_overhead is None
                else construction_overhead)
    return (to_decimal(sqm_construction) * to_decimal(construction_cost_per_sqm)
            * overhead_factor(overhead))


# ─── Lectura ──────────────────────────────────────────────────────────────────

# Las tres cifras de una obra, por propiedad. Va como fragmento y no como vista
# porque `properties_db._fetch` lo cuelga de su propio SELECT: la suma
# presupuestada es un insumo del costo stack, y traerla en el mismo viaje es lo
# que permite que el costo de obra no tenga una consulta aparte que pueda
# quedarse atrás.
#
# Cada agregado dice algo distinto sobre el vacío, y la diferencia importa:
#   · presupuestado cae a 0 — «nada capturado», que es lo que decían las
#     columnas que reemplaza, y lo que deja que la suma alimente la inversión
#     sin preguntar si el presupuesto existe.
#   · comprometido y pagado se quedan en NULL. Nadie firmó nada todavía no es
#     «$0 comprometido»: un cero ahí se leería como un hecho.
#
# Los pagos se suman en su propio LATERAL: unirlos al mismo nivel que los
# renglones multiplicaría cada `cantidad × precio` por su número de pagos.
#
# CADA VARIACIÓN COMPARA CONTRA EL PLAN DE LOS RENGLONES QUE YA TIENEN ESA CIFRA,
# no contra el presupuesto entero, y ahí está la única sutileza de este fragmento.
# Restar el presupuesto completo era aritméticamente correcto y engañoso igual:
# firmar en cero UNA partida de $200,000 publicaba «comprometido vs presupuesto
# −$4,095,000», que no es la brecha contra el plan sino cuánto FALTA por
# comprometer. Ese número se enciende en cuanto cualquier renglón tiene
# compromiso, arranca en «casi todo el presupuesto» por definición y domina la
# pantalla durante toda la obra diciendo algo que su etiqueta no promete.
#
# Con el FILTER la pregunta se vuelve estable y contestable: «en lo que ya firmé,
# ¿voy arriba o abajo del plan?», y no se mueve porque falte firmar cosas. De paso
# el total vuelve a ser la SUMA DE SUS RENGLONES —cada uno ya publicaba su propia
# variación contra su propio importe (ver `_line_row`)— y una tabla cuyo total no
# es la suma de lo que enseña es una tabla que nadie puede cuadrar.
#
# Lo que falta por comprometer o por pagar es otra pregunta, y si algún día se
# publica será con otro nombre: es `presupuestado − comprometido`, y un número
# cuyo nombre tiene que alargarse para ser honesto casi siempre son dos números.
def totals_sql(property_ref: str) -> str:
    """El subselect de las cifras de obra para la propiedad que `property_ref`
    nombre — una columna del query de afuera (`p.id`) o un parámetro (`%s`)."""
    return f"""
    SELECT coalesce(sum(l.quantity * l.unit_price), 0) AS construction_budgeted,
           sum(l.committed_amount)                     AS construction_committed,
           sum(pagos.paid)                             AS construction_paid,
           sum(l.committed_amount)
             - sum(l.quantity * l.unit_price) FILTER (WHERE l.committed_amount IS NOT NULL)
                                                       AS construction_committed_variance,
           sum(pagos.paid)
             - sum(l.quantity * l.unit_price) FILTER (WHERE pagos.paid IS NOT NULL)
                                                       AS construction_paid_variance
      FROM budgets b
      JOIN budget_lines l ON l.budget_id = b.id
      LEFT JOIN LATERAL (SELECT sum(p.amount) AS paid
                           FROM budget_line_payments p
                          WHERE p.line_id = l.id) pagos ON TRUE
     WHERE b.property_id = {property_ref}
"""


def metrics(row: dict) -> dict:
    """Las cifras de obra de una propiedad, desde su fila ya enriquecida con los
    agregados del presupuesto (`construction_budgeted` y compañía).

    `constructionCostPerSqm` es la única que cambió de naturaleza: era un insumo
    que alguien tecleaba y ahora es el cociente presupuesto ÷ metraje. Se publica
    solo para mostrarse — nada la vuelve a leer para calcular dinero — y es None
    sin metraje, porque dividir entre cero no da «$0/m²», no da nada."""
    budgeted = to_decimal(row.get("construction_budgeted"))
    committed = row.get("construction_committed")
    paid = row.get("construction_paid")
    committed_variance = row.get("construction_committed_variance")
    paid_variance = row.get("construction_paid_variance")
    sqm = to_decimal(row.get("sqm_construction"))

    return {
        "constructionBudgeted": money0(budgeted),
        "constructionCommitted": money0(committed) if committed is not None else None,
        "constructionPaid": money0(paid) if paid is not None else None,
        # La brecha contra el plan EN LO QUE YA TIENE ESA CIFRA —no contra el
        # presupuesto entero— así que contesta «en lo que ya firmé (o ya pagué),
        # ¿voy arriba o abajo?» y no «cuánto me falta». Las dos son la misma
        # resta alimentada con dos hechos distintos, por eso comparten familia de
        # nombre y se distinguen por la etapa. Ninguna corrige el presupuestado
        # para que empate: el presupuesto era un plan, el pago es un hecho, y la
        # información útil es justamente la diferencia. La resta la hace el SQL,
        # que es donde vive el recorte; aquí solo se redondea y se decide el
        # vacío, que es el mismo de siempre: sin nada firmado no hay brecha, y un
        # 0 ahí se leería como «va justo al plan».
        "constructionCommittedVariance":
            money0(committed_variance) if committed_variance is not None else None,
        "constructionPaidVariance":
            money0(paid_variance) if paid_variance is not None else None,
        "constructionCostPerSqm": money(budgeted / sqm) if sqm > 0 else None,
    }


def _line_row(row) -> dict:
    """Un renglón como lo lee el cliente: sus columnas, más las tres cifras que
    nunca se guardan."""
    line = _row_to_dict(row)
    budgeted = to_decimal(row["quantity"]) * to_decimal(row["unit_price"])
    paid = line.pop("paid", None)
    committed = row["committed_amount"]
    line.pop("payments", None)
    line["budgetedAmount"] = money0(budgeted)
    line["paidAmount"] = money0(paid) if paid is not None else None
    line["paidVariance"] = money0(to_decimal(paid) - budgeted) if paid is not None else None
    line["committedVariance"] = (
        money0(to_decimal(committed) - budgeted) if committed is not None else None)
    return line


_LINES_SQL = """
    SELECT l.*, pagos.paid, pagos.payments
      FROM budget_lines l
      LEFT JOIN LATERAL (
            SELECT sum(p.amount) AS paid,
                   json_agg(json_build_object(
                       'id', p.id, 'amount', p.amount, 'paidOn', p.paid_on,
                       'notes', p.notes, 'createdAt', p.created_at)
                       ORDER BY p.paid_on, p.id) AS payments
              FROM budget_line_payments p
             WHERE p.line_id = l.id) pagos ON TRUE
     WHERE l.budget_id = %s
     ORDER BY l.is_residual, l.chapter_name, l.sort_order, l.id
"""


def get_budget(conn, property_id: int) -> dict:
    """El presupuesto completo de una propiedad, con sus renglones y sus pagos.

    El residuo va al final del orden a propósito: es lo que queda por detallar,
    no un capítulo más, y leerlo al final es leerlo como se lee un remanente."""
    budget_id = _require_budget(conn, property_id)
    rows = conn.execute(_LINES_SQL, (budget_id,)).fetchall()
    lines = []
    for row in rows:
        line = _line_row(row)
        line["payments"] = row["payments"] or []
        lines.append(line)
    return {
        "id": budget_id,
        "propertyId": property_id,
        "lines": lines,
        # Los capítulos son los que los renglones nombran: `chapter_name` es una
        # COPIA en la fila, no una referencia, así que un capítulo no existe sin
        # al menos un renglón que lo nombre. Se publican en su orden de lectura
        # para que la pestaña no tenga que deducirlos.
        "chapters": _chapters(lines),
    }


def _chapters(lines: list[dict]) -> list[str]:
    seen: list[str] = []
    for line in lines:
        if line["chapterName"] not in seen:
            seen.append(line["chapterName"])
    return seen


# ─── El presupuesto y su residuo ──────────────────────────────────────────────

def _require_budget(conn, property_id: int) -> int:
    """El id del presupuesto de la propiedad, creándolo si le falta.

    Crear al leer no es un atajo: es lo que sostiene la invariante de la que
    depende todo lo demás —toda propiedad tiene presupuesto— frente a filas que
    entraron por fuera del API (una semilla, un fixture, un INSERT a mano). Sin
    ella volvería la rama «si existe presupuesto», que es la rama que este
    diseño existe para no tener."""
    row = conn.execute(
        "SELECT id FROM budgets WHERE property_id = %s", (property_id,)
    ).fetchone()
    if row is not None:
        return row["id"]
    if conn.execute("SELECT 1 FROM properties WHERE id = %s", (property_id,)).fetchone() is None:
        raise BudgetNotFound(f"Propiedad {property_id} no encontrada")
    return create_budget(conn, property_id, Decimal(0))


def create_budget(conn, property_id: int, estimate) -> int:
    """El presupuesto de una propiedad recién capturada: una sola fila, «Otros,
    por detallar», con el estimado grueso entero.

    Esa fila YA es el presupuesto. No hay traspaso que diseñar más adelante —
    ningún momento en que el costo de obra cambie de fuente— porque nace aquí,
    en `prospecto`, y de aquí en adelante detallar solo lo reparte."""
    budget_id = conn.execute(
        "INSERT INTO budgets (property_id) VALUES (%s) RETURNING id", (property_id,)
    ).fetchone()["id"]
    conn.execute(
        "INSERT INTO budget_lines"
        " (budget_id, chapter_name, name, unit, quantity, unit_price, is_residual)"
        " VALUES (%s, %s, %s, %s, 1, %s, TRUE)",
        (budget_id, RESIDUAL_CHAPTER, RESIDUAL_NAME, RESIDUAL_UNIT, money(estimate)),
    )
    return budget_id


def _totals(conn, budget_id: int) -> tuple[Decimal, Decimal]:
    """(total del presupuesto, suma de los detallados), los dos al centavo.

    El redondeo aquí no es cosmético, es lo que hace EXACTA la promesa de que
    detallar no mueve el total. `cantidad × precio` puede traer cinco decimales
    —la cantidad lleva tres y el precio dos— mientras que el importe del residuo
    se guarda en una columna de dos. Restando en crudo, cada partida detallada
    dejaba hasta medio centavo tirado, y cincuenta partidas movían el total un
    cuarto de peso sin que nadie lo hubiera pedido.

    Redondeando las dos puntas al centavo, el residuo queda exacto a dos
    decimales y el total redondeado se conserva al centavo, operación tras
    operación, sin acumular nada."""
    row = conn.execute(
        "SELECT coalesce(sum(l.quantity * l.unit_price), 0) AS total,"
        "       coalesce(sum(l.quantity * l.unit_price) FILTER (WHERE NOT l.is_residual), 0)"
        "           AS detallado"
        "  FROM budget_lines l WHERE l.budget_id = %s",
        (budget_id,),
    ).fetchone()
    return money(row["total"]), money(row["detallado"])


def current_total(conn, property_id: int) -> Decimal:
    """El total presupuestado ahora mismo, sin pasar por la lectura completa
    de la propiedad. Lo usa properties_db para saber contra qué tasa está
    multiplicando cuando el m² cambia solo, sin $/m² nuevo en el mismo PATCH."""
    return _totals(conn, _require_budget(conn, property_id))[0]


def _settle_residual(conn, budget_id: int, total_objetivo: Decimal) -> Decimal:
    """Deja el residuo en `total_objetivo − detallado` y contesta cuánto CRECIÓ
    el presupuesto, que es lo único que esta operación no puede decidir sola.

    Detallar distribuye costo, no lo crea: por eso el residuo se recalcula en vez
    de capturarse. Dejarlo editable a mano convertiría una resta determinista en
    una segunda captura, y ahí es donde nace el descuadre.

    Cuando el detalle SUPERA el objetivo el residuo llega a 0 y el total sí
    crece. Eso ya no es detallar, es aumentar el presupuesto, y son dos cosas
    distintas: se devuelve el excedente para que la respuesta lo diga en vez de
    que el total suba en silencio."""
    _, detallado = _totals(conn, budget_id)
    # Las dos puntas llegan al centavo, así que la resta ya cabe exacta en la
    # columna del residuo y no vuelve a redondearse.
    residuo = max(Decimal(0), money(total_objetivo) - detallado)
    conn.execute(
        "UPDATE budget_lines SET quantity = 1, unit_price = %s"
        " WHERE budget_id = %s AND is_residual",
        (residuo, budget_id),
    )
    return max(Decimal(0), detallado - total_objetivo)


# La normalización entera, y es literal a propósito: minúsculas y espacios de
# orilla. No quita acentos —`unaccent()` no es IMMUTABLE— y volver «ceramico» y
# «cerámico» el mismo grupo sería fusionar por máquina, algo que esta capa no
# hace: aquí solo protege un nombre contra un duplicado por espacios o mayúsculas
# de más. La usa la dedup de `copy_lines`, para contestar por `(capítulo,
# nombre)` la única pregunta que hay que contestar antes de copiar: «¿esto ya
# está?».
def _norm(column: str) -> str:
    return f"lower(btrim({column}))"


# ─── Copiar un presupuesto a otro ──────────────────────────────────────────────
#
# «Copiar de otra obra» es la única forma de arrancar un presupuesto que no es
# la captura manual. Copiar no es leer en vivo: el renglón lleva su propio texto
# y su propio importe desde que nace, y editar la obra de origen después no
# mueve un peso de la que copió — el mismo principio que regía la instanciación
# desde el catálogo, que ya no existe.

# Lo que se copia de un presupuesto a otro. Enumerado y no `SELECT *` porque lo
# que NO está es la decisión: proveedor, monto comprometido, fecha de firma,
# cantidad real, cierre y pagos se quedan en su obra. Lo que viaja es la forma
# del plan, no la ejecución de nadie; copiar el proveedor de la obra anterior
# sería afirmar un contrato que no existe.
#
# `supplier_category_id` SÍ viaja: el OFICIO es parte de la forma del plan
# —«esta partida la hace un plomero» vale para cualquier obra que la copie—
# mientras que el PROVEEDOR es a quién se le dio ésta.
_COPIED_LINE_COLUMNS = ("chapter_name", "name", "unit",
                        "quantity", "unit_price", "supplier_category_id",
                        "sort_order", "notes")


# Qué renglones del origen entran a la copia. `NULL` es «todos los capítulos»,
# que es el caso de siempre; una lista los recorta a los que se pidieron.
#
# La comparación de capítulo es EXACTA, no normalizada, al revés que la dedup de
# nombres: un capítulo se elige de la lista que el propio origen publica
# (`get_budget` → `chapters`), no se teclea, igual que en `rename_chapter` y
# `delete_chapter`. Normalizar aquí no arreglaría ningún error real y volvería
# «Acabados» y «acabados» —dos capítulos que el origen sí distingue— uno solo.
def copy_lines(conn, source_budget_id: int, target_budget_id: int,
               chapters: list[str] | None = None) -> tuple[int, int]:
    """Copia los renglones de un presupuesto a otro, sin repetir los que el
    destino ya tiene. Devuelve `(copiados, saltados)`.

    ESTA es la única forma de arrancar un presupuesto que no es la captura
    manual, y copiar no distingue de dónde a dónde va: son dos presupuestos de
    obra y nada más.

    El residuo NO se copia, ni del origen ni contra el del destino. Es el
    remanente de SU presupuesto —lo que a esa obra le falta por detallar— y
    llevárselo a la obra que copia lo convertiría en una partida de $2.3M que
    después le come el residuo a ésa. Por lo mismo tampoco cuenta como un
    renglón ya existente: es un remanente contable, no una partida.

    DEDUPLICAR ES SALTAR, NUNCA ACTUALIZAR, y es la garantía central de esta
    operación. Un renglón que ya existe en el destino puede traer proveedor,
    monto comprometido, pagos o `closed_at`; pisarle el `unit_price` o la
    `quantity` con los del origen reescribiría dinero YA CAPTURADO, en silencio y
    sin nada que se vea roto —la misma falla que la doctrina de «copiar al
    instanciar, nunca liga viva» existe para impedir—. Se deja intacto y se
    reporta; si hay que cambiarlo, lo cambia un humano renglón por renglón.

    Dos renglones son EL MISMO cuando coinciden su `(capítulo, nombre)`
    normalizados con `_norm`.

    `chapters` recorta el origen a esos capítulos; `None` los copia todos, que es
    el comportamiento de siempre."""
    if chapters is not None and not chapters:
        raise BudgetError(
            "Copiar «solo estos capítulos» necesita al menos uno. Para copiar el "
            "presupuesto completo, no mandes la lista.")

    # Una sola sentencia, y ésa es la razón de la CTE: los saltados son la RESTA
    # de candidatos menos copiados, así que los dos números tienen que salir del
    # MISMO conjunto de filas. Escrito como dos queries, el filtro del origen
    # quedaba tecleado dos veces y bastaba con que se despegaran un carácter para
    # que un hecho se volviera una estimación. Aquí se escribe una vez, en `cand`,
    # y el INSERT no puede leer nada más.
    columns = ", ".join(_COPIED_LINE_COLUMNS)
    source = ", ".join(f"l.{c}" for c in _COPIED_LINE_COLUMNS)
    row = conn.execute(
        # `l.id` viaja en `cand` sin copiarse: solo desempata el ORDER BY, para
        # que el orden de inserción —y por lo tanto los `id` nuevos— sea el mismo
        # que el del origen y no el que le toque al planeador.
        f"WITH cand AS ("
        f"     SELECT l.id, {source} FROM budget_lines l"
        "       WHERE l.budget_id = %s AND NOT l.is_residual"
        "         AND (%s::text[] IS NULL OR l.chapter_name = ANY(%s::text[]))"
        "), ins AS ("
        f"     INSERT INTO budget_lines (budget_id, {columns})"
        f"     SELECT %s, {source} FROM cand l"
        "       WHERE NOT EXISTS (SELECT 1 FROM budget_lines d"
        "                          WHERE d.budget_id = %s AND NOT d.is_residual"
        f"                           AND {_norm('d.chapter_name')} = {_norm('l.chapter_name')}"
        f"                           AND {_norm('d.name')} = {_norm('l.name')})"
        "       ORDER BY l.chapter_name, l.sort_order, l.id"
        "     RETURNING 1"
        ") SELECT (SELECT count(*) FROM cand) AS candidatos,"
        "         (SELECT count(*) FROM ins) AS copiados",
        (source_budget_id, chapters, chapters, target_budget_id, target_budget_id),
    ).fetchone()
    candidatos, copied = row["candidatos"], row["copiados"]
    # El rechazo va DESPUÉS de insertar y sigue siendo el mismo rechazo: sin
    # candidatos el INSERT no metió una sola fila, y de todos modos `get_db()`
    # hace rollback de la transacción entera cuando algo sube.
    if chapters is not None and candidatos == 0:
        raise BudgetError(_no_such_chapters(conn, source_budget_id, chapters))
    return copied, candidatos - copied


def _no_such_chapters(conn, source_budget_id: int, chapters: list[str]) -> str:
    """El rechazo de «copia estos capítulos» cuando NINGUNO aporta un renglón.

    Que un capítulo pedido no exista no es un error —se pueden mandar varios y
    que solo algunos apliquen, y el conteo ya dice qué entró—, pero que no exista
    ninguno sí lo es: el 201 que quedaría diría «copiados 0, saltados 0», que es
    indistinguible de «ya lo tenías todo». Un copiado que contesta «listo» sin
    haber podido hacer nada es exactamente lo que esta entrega existe para no
    hacer, así que se rechaza con los capítulos que el origen SÍ tiene, que es lo
    que hace falta para corregirlo.

    Va como 422 y no como el 404 de `rename_chapter`: ahí el capítulo es el
    recurso de la URL, aquí el recurso —el presupuesto de origen— sí existe y lo
    que está mal es lo que se capturó en el cuerpo."""
    disponibles = [row["chapter_name"] for row in conn.execute(
        "SELECT DISTINCT chapter_name FROM budget_lines"
        "  WHERE budget_id = %s AND NOT is_residual ORDER BY chapter_name",
        (source_budget_id,)).fetchall()]
    pedidos = "«" + "», «".join(chapters) + "»"
    if not disponibles:
        return (f"El presupuesto de origen no tiene ningún renglón que copiar, así que "
                f"tampoco los capítulos {pedidos}.")
    return (f"Ninguno de esos capítulos existe en el presupuesto de origen: {pedidos}. "
            f"Los suyos son: «" + "», «".join(disponibles) + "».")


def apply_budget(conn, property_id: int, source_budget_id: int,
                 chapters: list[str] | None = None) -> tuple[int, int, Decimal]:
    """Arranca esta obra desde el presupuesto de otra.

    Los renglones se SUMAN a lo que ya hubiera: el residuo baja lo que ellos
    suben y el total no se mueve, igual que al detallar a mano. No hay
    composición de bloques ni expansión recursiva —eso es lo que hacen las
    plantillas de proceso con `source_template_id`, y ahí se ve el costo: la
    expansión quedó truncada a un nivel más un detector de ciclos completo.
    Arrancar desde otra obra y borrar tres renglones cuesta treinta segundos y
    cero código.

    Devuelve `(copiados, saltados, cuánto creció el presupuesto)`. Los saltados
    son los renglones que el destino YA tenía y que por eso quedaron intactos —
    ver `copy_lines`—, y viajan de vuelta porque aplicar sin decir cuánto no se
    aplicó es un «listo» que esconde la mitad del resultado. `chapters` recorta
    el origen a esos capítulos; `None` copia el presupuesto entero."""
    budget_id = _require_budget(conn, property_id)
    if source_budget_id == budget_id:
        raise BudgetError("Un presupuesto no se copia sobre sí mismo.")
    if conn.execute("SELECT 1 FROM budgets WHERE id = %s",
                    (source_budget_id,)).fetchone() is None:
        raise BudgetNotFound(f"No existe el presupuesto {source_budget_id} que se quiere copiar")
    total_antes, _ = _totals(conn, budget_id)
    copied, skipped = copy_lines(conn, source_budget_id, budget_id, chapters)
    return copied, skipped, _settle_residual(conn, budget_id, total_antes)


# ─── De dónde se puede copiar ─────────────────────────────────────────────────
#
# La lista que llena «arrancar desde»: las obras de cuyo presupuesto hay algo
# que copiar. Existe porque `apply` acepta el id de cualquier presupuesto pero no
# había forma de enumerarlos, así que «arrancar desde otra obra» era una
# capacidad que nadie podía encontrar.
#
# Todo presupuesto es el de una obra —desde la 044 la base lo exige— así que el
# JOIN con `properties` es total y el nombre que se enseña es el de la propiedad,
# el único que hay. Ya no quedan dos clases de fuente que ordenar por separado.
#
# DOS DETALLES QUE LA HACEN ÚTIL EN VEZ DE MERAMENTE CORRECTA:
#
#   · `line_count` cuenta lo COPIABLE, no lo que hay. El residuo no se copia, así
#     que incluirlo prometería un renglón que nunca llega — y en toda obra apenas
#     capturada el residuo es lo único que hay. Aquí el número es exactamente
#     cuántos renglones van a aparecer.
#   · Por eso mismo se filtran los presupuestos sin nada que copiar. Hoy casi
#     toda propiedad tiene solo su residuo: sin el filtro, el selector serían
#     dieciocho renglones en cero y las dos obras que sí sirven, perdidas entre
#     ellos. Un presupuesto del que no sale nada no es una respuesta a «de dónde
#     puedo copiar».

_SOURCES_SQL = """
    SELECT b.id, p.name, b.property_id, t.line_count, t.total
      FROM budgets b
      JOIN properties p ON p.id = b.property_id
      JOIN LATERAL (
            SELECT count(*) AS line_count,
                   coalesce(sum(l.quantity * l.unit_price), 0) AS total
              FROM budget_lines l
             WHERE l.budget_id = b.id AND NOT l.is_residual) t ON TRUE
     WHERE t.line_count > 0
       AND (%s::bigint IS NULL OR b.property_id <> %s::bigint)
     ORDER BY lower(p.name)
"""


# `line_count` y no `lines`: aquí es un NÚMERO, y en `get_budget` ese mismo
# nombre carga el ARREGLO de renglones. Un campo que es un número en la lista y
# una lista en el detalle es la clase de trampa que se paga en el cliente.


def list_sources(conn, exclude_property_id: int | None = None) -> list[dict]:
    """Las obras de cuyo presupuesto se puede copiar, cada una con el nombre de
    su propiedad y cuántos renglones traería.

    `exclude_property_id` saca el presupuesto de la obra que está preguntando.
    `apply` ya rechaza copiarse sobre sí mismo con un 422, y ofrecer en un
    selector una opción que solo puede dar error es hacer que el usuario
    descubra la regla chocando con ella."""
    return [_row_to_dict(row) | {"total": money0(row["total"])}
            for row in conn.execute(
                _SOURCES_SQL, (exclude_property_id, exclude_property_id)).fetchall()]


# ─── Renglones ────────────────────────────────────────────────────────────────

# Lo que un cliente puede escribir en un renglón. `is_residual` no está: el
# residuo lo nombra el sistema. `quantity`/`unit_price` tampoco se aceptan en el
# residuo — ver `_reject_residual_capture`.
LINE_FIELDS = frozenset({
    "chapterName", "name", "unit", "quantity", "unitPrice",
    "supplierCategoryId", "supplierId", "committedAmount", "committedOn",
    "actualQuantity", "notes",
})

_LINE_COLUMNS = {
    "chapterName": "chapter_name", "name": "name", "unit": "unit",
    "quantity": "quantity", "unitPrice": "unit_price",
    "supplierCategoryId": "supplier_category_id",
    "supplierId": "supplier_id", "committedAmount": "committed_amount",
    "committedOn": "committed_on", "actualQuantity": "actual_quantity",
    "notes": "notes",
}

# Los campos donde un `null` es un MENSAJE —«quítalo»— y no una omisión.
#
# Es la diferencia con la ficha, donde vaciar es su propia operación
# (`clear-fields`) porque ahí un null nunca viaja. Aquí la captura es celda por
# celda: el selector de proveedor tiene «— Sin proveedor», y elegirlo tiene que
# quitar el proveedor. Descartar ese null dejaba el dato anterior en la base con
# la pantalla diciendo que ya no estaba — sin error y sin pista, hasta que
# alguien recarga y el proveedor viejo reaparece.
#
# Y no se resuelve con un centinela: `committed_amount = 0` es un valor
# legítimo —se firmó en cero— y confundirlo con «no se ha firmado» es
# exactamente la distinción que esta capa cuida en todas partes.
#
# `supplierCategoryId` está aquí por la razón más directa de todas: el selector
# de oficio tiene «— Sin oficio», y elegirlo tiene que quitarlo.
NULLABLE_LINE_FIELDS = frozenset({
    "supplierCategoryId", "supplierId", "committedAmount",
    "committedOn", "actualQuantity",
})

# En los demás un vacío no es un vaciado: es un renglón roto.
#
# Los tres de TEXTO llevan `NOT NULL` y además `CHECK (<> '')` desde la 032, así
# que hay dos formas de vaciarlos y las dos tienen que rebotar aquí: `null` y
# `""`. La cadena vacía es la que se cuela sin querer —seleccionar el nombre de
# una partida, borrarlo y hacer clic en otro lado, que es lo que hace cualquiera
# antes de reescribirlo— y sin esta guarda llegaba hasta el CHECK, donde el 422
# legible se convierte en el 500 mudo que la guarda existe para evitar.
_REQUIRED_TEXT = {
    "chapterName": "Toda partida vive en un capítulo: el capítulo no se puede vaciar.",
    "name": "La partida necesita un nombre: no se puede vaciar.",
    "unit": "La partida necesita una unidad: no se puede vaciar.",
}

# Aquí solo el `null` es rechazable. `quantity` y `unitPrice` son numéricos y
# una cadena no les llega nunca; en `notes` el blanco SÍ es legítimo —lo dice su
# propia frase— así que queda fuera del recorte de espacios.
_REQUIRED_VALUE = {
    "quantity": "La cantidad no se vacía; se pone en 0.",
    "unitPrice": "El precio unitario no se vacía; se pone en 0.",
    "notes": "Las notas se dejan en blanco, no se vacían.",
}


def _reject_empty(data: dict, *, required: tuple[str, ...] = ()) -> None:
    """Una sola guarda para el alta y para la edición.

    Estaba duplicada a medias —el alta validaba dos campos y la edición
    ninguno— y esa asimetría era el defecto: nada obligaba a las dos a decir lo
    mismo, así que `unit` quedó sin revisar de un lado y los tres del otro.
    `required` nombra lo que además tiene que VENIR, no solo llegar con algo."""
    for field, message in _REQUIRED_TEXT.items():
        if (field in data or field in required) and not str(data.get(field) or "").strip():
            raise BudgetError(message)
    for field, message in _REQUIRED_VALUE.items():
        if field in data and data[field] is None:
            raise BudgetError(message)


def _get_line(conn, budget_id: int, line_id: int) -> dict:
    row = conn.execute(
        "SELECT l.*, pagos.paid FROM budget_lines l"
        " LEFT JOIN LATERAL (SELECT sum(p.amount) AS paid FROM budget_line_payments p"
        "                     WHERE p.line_id = l.id) pagos ON TRUE"
        " WHERE l.id = %s AND l.budget_id = %s",
        (line_id, budget_id),
    ).fetchone()
    if row is None:
        raise BudgetNotFound(f"Renglón {line_id} no encontrado en este presupuesto")
    return _line_row(row)


# El importe del residuo no se teclea. Es la resta que mantiene cuadrado el
# presupuesto, y una resta que alguien puede sobrescribir deja de cuadrar nada.
# Para mover el total está `set_total`, que es otra operación precisamente
# porque significa otra cosa.
_RESIDUAL_IS_NOT_TYPED = (
    f"«{RESIDUAL_NAME}» es el remanente del presupuesto y se calcula solo: baja "
    "cuando detallas partidas y sube cuando las quitas. Para cambiar el total de "
    "la obra, ajusta el presupuesto.")


def create_line(conn, property_id: int, data: dict) -> tuple[int, Decimal]:
    """Un renglón detallado. El residuo baja lo mismo que este renglón sube, así
    que el costo de obra —y con él la inversión total— no se mueve.

    Devuelve (id del renglón, cuánto creció el presupuesto). Lo segundo es 0 en
    el caso normal; solo deja de serlo cuando el detalle rebasa el total, que es
    aumentar el presupuesto y tiene que poder distinguirse de detallar.

    Un renglón nace suelto, siempre: captura manual —capítulo, nombre, unidad,
    cantidad y precio tecleados— y nada más. Es el caso barato a propósito."""
    budget_id = _require_budget(conn, property_id)
    total_antes, _ = _totals(conn, budget_id)

    columns = {_LINE_COLUMNS[k]: v for k, v in data.items() if k in LINE_FIELDS}
    require_supplier_category(conn, data.get("supplierCategoryId"))
    _reject_empty(data, required=("chapterName", "name"))
    # Una partida puede nacer sin cantidad ni precio: la captura es celda por
    # celda con autoguardado, y exigir la fila completa de golpe convertiría un
    # estado intermedio normal en un error.
    columns.setdefault("unit", RESIDUAL_UNIT)
    columns.setdefault("quantity", 0)
    columns.setdefault("unit_price", 0)
    columns["budget_id"] = budget_id

    names = ", ".join(columns)
    placeholders = ", ".join(["%s"] * len(columns))
    line_id = conn.execute(
        f"INSERT INTO budget_lines ({names}) VALUES ({placeholders}) RETURNING id",
        list(columns.values()),
    ).fetchone()["id"]

    return line_id, _settle_residual(conn, budget_id, total_antes)


def update_line(conn, property_id: int, line_id: int, data: dict) -> Decimal:
    """Cambia un renglón detallado y vuelve a cuadrar el residuo contra el total
    que el presupuesto tenía antes.

    `data` trae SOLO lo que el cliente mandó, y un `None` ahí significa «quítalo»
    —no «no lo toques»—: los campos de NULLABLE_LINE_FIELDS se vacían así y no
    hay otra puerta para hacerlo."""
    budget_id = _require_budget(conn, property_id)
    row = conn.execute(
        "SELECT is_residual FROM budget_lines WHERE id = %s AND budget_id = %s",
        (line_id, budget_id),
    ).fetchone()
    if row is None:
        raise BudgetNotFound(f"Renglón {line_id} no encontrado en este presupuesto")
    # Del residuo solo se anota: su importe lo pone la resta, y su capítulo,
    # nombre y unidad los pone el sistema. Un residuo renombrado seguiría
    # restando bien, pero dejaría de leerse como lo que es.
    if row["is_residual"] and (set(data) - {"notes"}):
        raise BudgetError(_RESIDUAL_IS_NOT_TYPED)
    _reject_empty(data)
    if "supplierCategoryId" in data:
        require_supplier_category(conn, data["supplierCategoryId"])

    columns = {_LINE_COLUMNS[k]: v for k, v in data.items() if k in LINE_FIELDS}
    total_antes, _ = _totals(conn, budget_id)
    if columns:
        assignments = ", ".join(f"{col} = %s" for col in columns)
        conn.execute(
            f"UPDATE budget_lines SET {assignments} WHERE id = %s",
            list(columns.values()) + [line_id],
        )
    return _settle_residual(conn, budget_id, total_antes)


def delete_line(conn, property_id: int, line_id: int) -> dict:
    """Quita un renglón detallado y le devuelve su importe al residuo: dejar de
    detallar es lo contrario de detallar, así que tampoco mueve el total."""
    budget_id = _require_budget(conn, property_id)
    line = _get_line(conn, budget_id, line_id)
    if line["isResidual"]:
        raise BudgetError(
            f"«{RESIDUAL_NAME}» no se borra: es el remanente del presupuesto y "
            "todo presupuesto tiene uno. Para dejar la obra en cero, ajusta el "
            "presupuesto a 0.")
    total_antes, _ = _totals(conn, budget_id)
    conn.execute("DELETE FROM budget_lines WHERE id = %s", (line_id,))
    _settle_residual(conn, budget_id, total_antes)
    return line


def set_total(conn, property_id: int, amount) -> Decimal:
    """Ajusta el TOTAL de la obra presupuestada, moviendo el residuo.

    Es la otra operación —la que sí cambia cuánto va a costar la obra— y existe
    aparte justamente para que se distinga de detallar. Detallar reparte un
    total que no se mueve; esto mueve el total sin tocar una sola partida
    detallada. Mezclarlas las volvería indistinguibles, y entonces nadie podría
    contestar si el presupuesto creció o solo se abrió.

    Devuelve el nuevo residuo."""
    budget_id = _require_budget(conn, property_id)
    objetivo = to_decimal(amount)
    if objetivo < 0:
        raise BudgetError("El presupuesto de obra no puede ser negativo.")
    _, detallado = _totals(conn, budget_id)
    if objetivo < detallado:
        raise BudgetError(
            f"El presupuesto no puede quedar en ${objetivo:,.0f} porque ya hay "
            f"${detallado:,.0f} detallados en partidas. Quita o baja partidas primero.")
    _settle_residual(conn, budget_id, objetivo)
    return objetivo - detallado


# ─── Capítulos ────────────────────────────────────────────────────────────────
#
# Un capítulo no es una fila: es el `chapter_name` que copian sus renglones, y
# por eso no se crea vacío. Nace cuando el primer renglón lo nombra. Lo que sí
# necesita operaciones propias es renombrarlo y quitarlo, porque las dos tocan
# varios renglones a la vez y hacerlas renglón por renglón dejaría el
# presupuesto medio renombrado si algo falla en medio.

def rename_chapter(conn, property_id: int, chapter: str, new_name: str) -> int:
    budget_id = _require_budget(conn, property_id)
    new_name = (new_name or "").strip()
    if not new_name:
        raise BudgetError("El capítulo necesita un nombre.")
    if chapter == RESIDUAL_CHAPTER:
        raise BudgetError(
            f"«{RESIDUAL_CHAPTER}» es donde vive el remanente del presupuesto y no se renombra.")
    changed = conn.execute(
        "UPDATE budget_lines SET chapter_name = %s WHERE budget_id = %s AND chapter_name = %s",
        (new_name, budget_id, chapter),
    ).rowcount
    if changed == 0:
        raise BudgetNotFound(f"El presupuesto no tiene un capítulo «{chapter}»")
    return changed


def delete_chapter(conn, property_id: int, chapter: str) -> int:
    """Borra el capítulo con sus renglones. Lo detallado vuelve al residuo, así
    que el total sigue sin moverse: quitar el detalle es lo contrario de
    ponerlo, no una rebaja del presupuesto."""
    budget_id = _require_budget(conn, property_id)
    if chapter == RESIDUAL_CHAPTER:
        raise BudgetError(
            f"«{RESIDUAL_CHAPTER}» no se borra: ahí vive el remanente del presupuesto.")
    total_antes, _ = _totals(conn, budget_id)
    deleted = conn.execute(
        "DELETE FROM budget_lines WHERE budget_id = %s AND chapter_name = %s AND NOT is_residual",
        (budget_id, chapter),
    ).rowcount
    if deleted == 0:
        raise BudgetNotFound(f"El presupuesto no tiene un capítulo «{chapter}»")
    _settle_residual(conn, budget_id, total_antes)
    return deleted


# ─── Pagos ────────────────────────────────────────────────────────────────────
#
# Lo único intrínsecamente múltiple de un renglón: anticipo, avances, finiquito.
# Append-only, como los eventos de etapa — un pago mal capturado se borra, no se
# reescribe, porque corregirlo en su lugar borraría que alguna vez se dijo otra
# cosa. Un pago no toca el residuo ni el total: pagar no cambia lo que la obra
# estaba planeada a costar, y esa brecha es justamente lo que se quiere ver.

def add_payment(conn, property_id: int, line_id: int, amount, paid_on=None,
                notes: str = "") -> int:
    budget_id = _require_budget(conn, property_id)
    _get_line(conn, budget_id, line_id)
    if to_decimal(amount) <= 0:
        raise BudgetError("Un pago se captura positivo.")
    return conn.execute(
        "INSERT INTO budget_line_payments (line_id, amount, paid_on, notes)"
        " VALUES (%s, %s, COALESCE(%s, CURRENT_DATE), %s) RETURNING id",
        (line_id, money(amount), paid_on, notes),
    ).fetchone()["id"]


def delete_payment(conn, property_id: int, line_id: int, payment_id: int) -> None:
    budget_id = _require_budget(conn, property_id)
    _get_line(conn, budget_id, line_id)
    deleted = conn.execute(
        "DELETE FROM budget_line_payments WHERE id = %s AND line_id = %s",
        (payment_id, line_id),
    ).rowcount
    if deleted == 0:
        raise BudgetNotFound(f"Pago {payment_id} no encontrado en el renglón {line_id}")


# ─── Lo que retiene a una propiedad ───────────────────────────────────────────

def holds_captured_work(conn, property_id: int) -> bool:
    """¿El presupuesto lleva captura manual que un borrado se llevaría?

    El presupuesto está en la familia de RESTRICT y no en la de CASCADE porque
    lleva cantidades medidas, precios negociados y pagos hechos. Pero desde que
    TODA propiedad nace con presupuesto, retener por su sola existencia haría
    que ninguna propiedad se pudiera borrar jamás — y el presupuesto recién
    sembrado no es trabajo de nadie, es la fila que el sistema puso.

    Retiene lo que alguien capturó: una partida detallada, un proveedor, un
    monto comprometido, una cantidad real, un cierre o un pago."""
    row = conn.execute(
        "SELECT EXISTS ("
        "  SELECT 1 FROM budget_lines l"
        "   WHERE l.budget_id IN (SELECT id FROM budgets WHERE property_id = %s)"
        "     AND (NOT l.is_residual"
        "          OR l.supplier_id      IS NOT NULL"
        "          OR l.committed_amount IS NOT NULL"
        "          OR l.actual_quantity  IS NOT NULL"
        "          OR l.closed_at        IS NOT NULL"
        "          OR EXISTS (SELECT 1 FROM budget_line_payments p WHERE p.line_id = l.id))"
        ") AS capturado",
        (property_id,),
    ).fetchone()
    return bool(row["capturado"])


def drop_budget(conn, property_id: int) -> None:
    """Se lleva el presupuesto sembrado junto con su propiedad. Solo lo llama el
    borrado, y solo después de que `holds_captured_work` dijo que no hay nada
    que perder."""
    conn.execute("DELETE FROM budgets WHERE property_id = %s", (property_id,))
