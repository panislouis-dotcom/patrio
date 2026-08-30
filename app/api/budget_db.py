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
import json
from decimal import Decimal

from api.db import _row_to_dict
from api.finance.quantize import money, money0, to_decimal

# SUMA ALZADA: «1 lote» de algo, sin una medida detrás. Es la unidad de todo
# renglón real de hoy —nadie mide en m² ni en piezas— y también la del estimado
# paramétrico, por la misma razón: lo que todavía no se detalla no se mide, se
# estima entero.
LUMP_SUM_UNIT = "lote"

# Dónde aterriza el renglón con el que nace un presupuesto. Es «Otros» y no un
# capítulo nuevo porque ahí quedaron TODOS los residuos que convirtió la 053: un
# presupuesto recién nacido y uno migrado se leen igual, que es lo que hace que
# no haya dos clases de renglón. El capítulo ya no es especial —se renombra y se
# borra como cualquier otro— y el renglón tampoco.
ESTIMATE_CHAPTER = "Otros"

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
    nada. CORRE UNA SOLA VEZ EN LA VIDA DE UNA PROPIEDAD —al nacer, desde
    `create_property`— y su resultado se guarda como el importe de un renglón
    normal, que desde ese momento es dato de quien lo tenga que corregir. No
    existe ningún otro camino de escritura de la métrica hacia el presupuesto:
    editar los m² o el $/m² de la ficha no mueve un peso (ver
    `properties_db.update_property`). Espeja al peso la aritmética de la
    migración 032, incluido que un NULL resuelve al default y un 0 capturado es
    identidad.

    Lo único que la 032 no tuvo que decidir —un factor por debajo de 1— lo rechaza
    `overhead_factor` antes de que el estimado exista: sembrar con él dejaría la
    obra encogida dentro de un renglón que nadie sabría que hay que corregir."""
    overhead = (CONSTRUCTION_OVERHEAD_DEFAULT if construction_overhead is None
                else construction_overhead)
    return (to_decimal(sqm_construction) * to_decimal(construction_cost_per_sqm)
            * overhead_factor(overhead))


def _cifra(number) -> str:
    """Un número para leerse dentro de una frase: con separador de miles y sin
    los ceros de relleno que arrastra un `Decimal` de columna. `200.00` es
    «200», y `8500.50` sigue siendo «8,500.5» — se recorta el relleno, no la
    cifra. El `.4f` siempre deja punto, así que el recorte nunca se come un
    dígito: se detiene en él."""
    return f"{to_decimal(number):,.4f}".rstrip("0").rstrip(".")


ESTIMATE_LINE_LABEL = "Estimado inicial"

# Con qué se abre la atribución que lleva un estimado copiado a otra obra —
# «… (de «Casa Edison»)», ver `_copied_name`—. Es también cómo se reconoce una
# que ya está puesta, así que vive aquí y no tecleada en dos lados.
ATTRIBUTION_OPEN = " (de «"


def estimate_line_name(sqm_construction, construction_cost_per_sqm,
                       construction_overhead=None) -> str:
    """«Estimado inicial · 200 m² × $8,000/m²» — el renglón se llama con la
    aritmética que lo produjo.

    EL NOMBRE ES LA ÚNICA MEMORIA QUE QUEDA DE ESA CUENTA. Antes los tres
    insumos vivían en columnas que seguían multiplicando en cada lectura; ahora
    corren una vez y se olvidan, así que si el renglón no dice de dónde salió su
    importe, dentro de un mes nadie puede contestar si $1,600,000 fue una
    cotización o una regla de tres. Va en el nombre y no en las notas porque el
    nombre es lo que se lee en la tabla, en el PDF y en el selector de copiado,
    y porque un renglón que hay que abrir para saber qué es no se abre.

    El overhead aparece SOLO cuando multiplica. Con 1.3 el importe no es
    `m² × $/m²` y callarlo dejaría un nombre que contradice su propia cifra —el
    lector dividiría, le daría otro $/m² y no sabría cuál de los dos creer."""
    factor = overhead_factor(CONSTRUCTION_OVERHEAD_DEFAULT
                             if construction_overhead is None else construction_overhead)
    indirectos = f" × {_cifra(factor)}" if factor != 1 else ""
    return (f"{ESTIMATE_LINE_LABEL} · {_cifra(sqm_construction)} m² × "
            f"${_cifra(construction_cost_per_sqm)}/m²{indirectos}")


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
       AND b.plan_id IS NULL
"""


def metrics(row: dict) -> dict:
    """Las cifras de obra de una propiedad, desde su fila ya enriquecida con los
    agregados del presupuesto (`construction_budgeted` y compañía).

    `budgetedCostPerSqm` es el cociente presupuesto ÷ metraje. Se publica solo
    para mostrarse —nada la vuelve a leer para calcular dinero— y es None sin
    metraje, porque dividir entre cero no da «$0/m²», no da nada.

    SE LLAMA ASÍ Y NO `constructionCostPerSqm` PORQUE SON DOS COSAS DISTINTAS, y
    compartir nombre es el olor que este módulo vino a quitar. El otro es la
    columna `properties.construction_cost_per_sqm`: el supuesto que alguien
    TECLEÓ, escribible, que viaja tal cual desde la fila (ver
    `properties_db.parse_property`). Los dos se publican y se enseñan juntos —tu
    estimado contra el presupuesto— y ninguno es el relevo del otro: la
    comparación solo es honesta mientras ninguno de los dos sea el fallback del
    que falta."""
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
        "budgetedCostPerSqm": money(budgeted / sqm) if sqm > 0 else None,
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
     ORDER BY l.chapter_name, l.sort_order, l.id
"""


def get_budget(conn, property_id: int, plan_id: str | None = None) -> dict:
    """El presupuesto completo de una propiedad, con sus renglones y sus pagos.

    Un solo orden para todos los renglones —capítulo, luego el orden que se les
    dio dentro de él— porque ya no hay dos clases. El residuo salía al final por
    no ser un capítulo más; una holgura es hoy un renglón con el nombre que
    alguien le puso y se lee donde su capítulo la ponga."""
    budget_id = _require_budget(conn, property_id, plan_id)
    rows = conn.execute(_LINES_SQL, (budget_id,)).fetchall()
    lines = []
    for row in rows:
        line = _line_row(row)
        line["payments"] = row["payments"] or []
        lines.append(line)
    return {
        "id": budget_id,
        "propertyId": property_id,
        "planId": plan_id,
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


# ─── El presupuesto ───────────────────────────────────────────────────────────

def _require_budget(conn, property_id: int, plan_id: str | None = None) -> int:
    """El id del presupuesto de la propiedad (plan_id None) o del escenario de un
    plan, creándolo si le falta — SOLO en el caso de la propiedad.

    Crear al leer no es un atajo: es lo que sostiene la invariante de la que
    depende todo lo demás —toda propiedad tiene presupuesto— frente a filas que
    entraron por fuera del API (una semilla, un fixture, un INSERT a mano). Sin
    ella volvería la rama «si existe presupuesto», que es la rama que este
    diseño existe para no tener.

    NACE VACÍO, sin un renglón fantasma. La calculadora escribe una sola vez, al
    dar de alta la propiedad, y aquí no hay con qué llamarla: leer el
    presupuesto de una fila que entró por fuera no es una captura de nadie. Un
    presupuesto sin renglones suma 0, y ese 0 es un estado legítimo —«todavía no
    se ha capturado obra»— y no un síntoma: `investment_raw` y la comisión de
    obra lo suman como el número que es, sin una rama de más.

    El escenario de un plan es lo contrario a propósito: NO se auto-crea. Nace
    de una acción explícita (copiado del de la propiedad, o vacío — ver
    create_plan_budget); auto-crearlo al leer sembraría escenarios vacíos con
    solo abrir la pestaña. Sin escenario, BudgetNotFound — la UI lo convierte
    en los botones de nacimiento."""
    if plan_id is not None:
        row = conn.execute(
            "SELECT id FROM budgets WHERE property_id = %s AND plan_id = %s",
            (property_id, plan_id),
        ).fetchone()
        if row is None:
            raise BudgetNotFound(
                f"El plan {plan_id} de la propiedad {property_id} no tiene presupuesto todavía")
        return row["id"]
    row = conn.execute(
        "SELECT id FROM budgets WHERE property_id = %s AND plan_id IS NULL", (property_id,)
    ).fetchone()
    if row is not None:
        return row["id"]
    if conn.execute("SELECT 1 FROM properties WHERE id = %s", (property_id,)).fetchone() is None:
        raise BudgetNotFound(f"Propiedad {property_id} no encontrada")
    return create_budget(conn, property_id)


def create_budget(conn, property_id: int, plan_id: str | None = None) -> int:
    """Un presupuesto vacío. Los renglones los pone quien los tenga que poner.

    Ya no siembra nada por su cuenta, y ese es el cambio: el estimado
    paramétrico lo escribe `seed_estimate_line`, desde el ÚNICO lugar donde
    corre la calculadora —el alta de la propiedad—, como un renglón normal. Aquí
    quedó solo lo que siempre fue: la fila que hace que el presupuesto exista."""
    return conn.execute(
        "INSERT INTO budgets (property_id, plan_id) VALUES (%s, %s) RETURNING id",
        (property_id, plan_id),
    ).fetchone()["id"]


def seed_estimate_line(conn, budget_id: int, sqm_construction,
                       construction_cost_per_sqm, construction_overhead=None) -> Decimal:
    """El renglón con el que nace un presupuesto: el estimado grueso de la
    calculadora, entero, con el nombre que dice de dónde salió. Devuelve su
    importe.

    Es el ÚNICO lugar del código que pone `seeded = TRUE`, y lo pone en el mismo
    INSERT: la procedencia se declara al escribir, no se deduce después.

    ES UN RENGLÓN COMO CUALQUIER OTRO desde el instante en que existe: se edita,
    se renombra y se borra sin caso especial, y nada vuelve a reescribirlo. Ahí
    está la diferencia entre un DEFAULT y una LIGA VIVA — corre una vez, deja un
    dato real, y el dato es la verdad; no una fórmula que siga opinando cada vez
    que alguien corrige un metraje.

    Sin estimado no escribe nada. Un renglón de $0 llamado «Estimado inicial ·
    0 m² × $0/m²» no dice nada que el presupuesto vacío no diga ya, y obligaría
    a borrarlo a mano en toda propiedad dada de alta sin la calculadora."""
    estimate = money(calculator_estimate(
        sqm_construction, construction_cost_per_sqm, construction_overhead))
    if estimate <= 0:
        return Decimal(0)
    conn.execute(
        "INSERT INTO budget_lines"
        " (budget_id, chapter_name, name, unit, quantity, unit_price, seeded)"
        " VALUES (%s, %s, %s, %s, 1, %s, TRUE)",
        (budget_id, ESTIMATE_CHAPTER,
         estimate_line_name(sqm_construction, construction_cost_per_sqm,
                            construction_overhead),
         LUMP_SUM_UNIT, estimate),
    )
    return estimate


# ─── «Aquí no ha trabajado nadie» ─────────────────────────────────────────────
#
# UNA SOLA PREGUNTA, DOS USOS. La copia la hace para decidir si REEMPLAZA —el
# estimado paramétrico se cambia por el desglose que llega— y el borrado de la
# propiedad para decidir si RETIENE. Es la misma pregunta: si lo único que hay
# es lo que puso el sistema, no hay nada que se pueda perder. Escrita dos veces
# se despegarían, y el día que se despeguen una copia pisa trabajo capturado o
# una propiedad se vuelve indeleble.
#
# LA CONTESTA UN DATO DECLARADO: `l.seeded`, la columna que puso la 054. La
# escribe `seed_estimate_line` —el único lugar del código que la pone en TRUE— en
# el mismo INSERT que crea el renglón, y NADIE la actualiza después.
#
# Se intentó antes deducirla del reloj (`l.created_at = b.created_at`, las dos
# `DEFAULT now()` y `now()` congelado al inicio de la transacción) y la deducción
# falla en los dos sentidos, que es por lo que se retiró: `_require_budget` crea
# el presupuesto al vuelo y `create_line` mete presupuesto y renglón en la MISMA
# transacción, así que el primer renglón tecleado de una propiedad que entró
# fuera del API heredaba la marca y `apply` lo borraba; y las semillas corren en
# autocommit por sentencia, así que el renglón sembrado NO la heredaba y las 18
# propiedades sembradas quedaban indelebles. La igualdad de relojes correlaciona
# con el origen del renglón; no es el origen del renglón.
#
# NO SE PREGUNTA POR EL NOMBRE, y es deliberado. El del estimado lleva dentro
# los m² y el $/m² —«Estimado inicial · 200 m² × $8,000/m²»—, así que corregir
# el metraje de la ficha lo cambiaría y el presupuesto dejaría de reconocerse a
# sí mismo sin que nadie lo tocara. Es el mismo argumento con el que la 033
# desmontó «Otros, por detallar»: un nombre lo teclea o lo renombra cualquiera.
# La columna no se puede teclear, sobrevive a renombres y a ediciones de importe,
# y no depende de ninguna métrica.
#
# Y NO ES `is_residual` OTRA VEZ. Aquella bandera definía ARITMÉTICA —el total se
# expresaba en términos de ella, así que toda escritura tenía que mantenerla—.
# `seeded` es procedencia de escritura única: nada la suma, nada la asienta,
# ningún importe depende de ella. Que se quede vieja no descuadra un peso.
#
# Con eso la vieja rendija SE CIERRA: quien borre el estimado y teclee uno propio
# ya no cae del lado equivocado —su renglón nace con `seeded = FALSE`, así que
# retiene y no lo reemplaza una copia—. Se conservan las dos mitades que
# antes competían: la propiedad recién dada de alta se puede borrar, y el
# trabajo tecleado a mano se protege desde el primer renglón, sin ejecución
# encima. Lo que sigue contando como «nada que perder» es exactamente: ningún
# renglón, o uno solo escrito en el mismo acto que el presupuesto y sin
# ejecución —proveedor, comprometido, cantidad real, cierre o pago—.
#
# Va como fragmento CORRELACIONADO con `b` porque la pregunta es POR
# PRESUPUESTO: «el sistema siembra a lo más un renglón» es invariante de cada
# presupuesto, no de la propiedad entera. Contarlos todos juntos volvía indeleble
# a una propiedad con un escenario de plan recién copiado —un renglón aquí más
# uno allá son dos, y nadie había capturado nada—.
_UNTOUCHED_BUDGET = (
    "(SELECT count(l.id) <= 1"
    "    AND NOT coalesce(bool_or("
    "          NOT l.seeded"
    "       OR l.supplier_id      IS NOT NULL"
    "       OR l.committed_amount IS NOT NULL"
    "       OR l.actual_quantity  IS NOT NULL"
    "       OR l.closed_at        IS NOT NULL"
    "       OR EXISTS (SELECT 1 FROM budget_line_payments p WHERE p.line_id = l.id)"
    "        ), FALSE)"
    "   FROM budget_lines l WHERE l.budget_id = b.id)"
)


def budget_holds_only_initial_estimate(conn, budget_id: int) -> bool:
    """Este presupuesto no tiene más que lo que el sistema sembró en el mismo
    acto en que lo creó —o no tiene nada—. Ver `_UNTOUCHED_BUDGET`."""
    return bool(conn.execute(
        f"SELECT {_UNTOUCHED_BUDGET} AS intacto FROM budgets b WHERE b.id = %s",
        (budget_id,),
    ).fetchone()["intacto"])


def _totals(conn, budget_id: int) -> Decimal:
    """El total del presupuesto —la suma de sus renglones— al centavo.

    UNA SOLA CIFRA, y esa es la entrega entera. Devolvía dos —el total y «lo
    detallado»— porque el residuo era un renglón que no contaba como detalle, y
    la diferencia entre las dos era de dónde salía el importe que lo absorbía
    todo. Sin residuo no hay dos sumas que distinguir: cada renglón cuenta
    exactamente una vez y el total es lo que dan sumados.

    El redondeo sí se queda. `cantidad × precio` puede traer cinco decimales —la
    cantidad lleva tres y el precio dos— y quien lea el total tiene que leer
    pesos y centavos, no el residuo binario de una multiplicación."""
    row = conn.execute(
        "SELECT coalesce(sum(l.quantity * l.unit_price), 0) AS total"
        "  FROM budget_lines l WHERE l.budget_id = %s",
        (budget_id,),
    ).fetchone()
    return money(row["total"])


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
#
# `is_proportional` SÍ viaja, por lo mismo que el oficio: «los permisos no crecen
# con la obra» es verdad de la PARTIDA, no de una copia. Al viajar, un
# presupuesto copiado nace sabiendo cuáles no escalan — aprender sin catálogo.
# `seeded` VIAJA con la copia, y tiene que hacerlo: un escenario de plan nace
# copiando el presupuesto de la obra (`create_plan_budget`), así que si la
# procedencia no viajara, el renglón sembrado llegaría al escenario como si
# alguien lo hubiera tecleado y la propiedad entera volvería a ser indeleble —el
# defecto que la 054 vino a quitar—. Viajar es lo correcto además de lo cómodo:
# la columna dice «esto lo escribió el sistema, nadie lo tecleó», y copiar no
# convierte en tecleado lo que no lo era. Un renglón capturado a mano viaja con
# su FALSE por la misma regla.
_COPIED_LINE_COLUMNS = ("chapter_name", "name", "unit",
                        "quantity", "unit_price", "supplier_category_id",
                        "sort_order", "notes", "is_proportional", "seeded")


# Qué renglones del origen entran a la copia. `NULL` es «todos los capítulos»,
# que es el caso de siempre; una lista los recorta a los que se pidieron.
#
# La comparación de capítulo es EXACTA, no normalizada, al revés que la dedup de
# nombres: un capítulo se elige de la lista que el propio origen publica
# (`get_budget` → `chapters`), no se teclea, igual que en `rename_chapter` y
# `delete_chapter`. Normalizar aquí no arreglaría ningún error real y volvería
# «Acabados» y «acabados» —dos capítulos que el origen sí distingue— uno solo.
#
# Va como fragmento porque el factor de la copia proporcional se calcula sobre
# EXACTAMENTE este conjunto de renglones y no sobre otro parecido: dos WHERE
# tecleados por separado se despegan un carácter y el factor deja de cuadrar con
# lo que se copió, que es un descuadre sin nada roto a la vista.
_CANDIDATES = (
    "  FROM budget_lines l"
    " WHERE l.budget_id = %s"
    "   AND (%s::text[] IS NULL OR l.chapter_name = ANY(%s::text[]))"
)


# QUÉ MUEVE EL FACTOR, SEGÚN LA UNIDAD — el único condicional del escalado.
#
# En «lote» —suma alzada, sin medida detrás— escala el PRECIO: el renglón se
# sigue leyendo «1 lote», solo más caro. Escalar la cantidad daría «1.5 lote»,
# que no significa nada, y dejaría sin sentido el precio unitario que
# `budget_price_observations` publica como historia de precios.
#
# En cualquier otra unidad (m², ml, pza) escala la CANTIDAD: el precio por m² es
# un hecho de mercado que no cambia porque la casa sea más grande; lo que cambia
# son los metros. Hoy todos los renglones reales son «lote», pero el día que
# alguien mida, esta rama es la que evita que la copia corrompa un precio unitario.
#
# Las dos condiciones se escriben ENTERAS y ninguna es la negación de la otra,
# porque el renglón fijo no está en ninguna de las dos: si una fuera el `ELSE` de
# la otra, la partida fija en m² se llevaría el factor en la cantidad — sin error
# y sin pista, solo dos licencias donde había una.
_ES_SUMA_ALZADA = f"{_norm('l.unit')} = '{LUMP_SUM_UNIT}'"
_SCALES_ITS_PRICE = f"l.is_proportional AND {_ES_SUMA_ALZADA}"
_SCALES_ITS_QUANTITY = f"l.is_proportional AND NOT {_ES_SUMA_ALZADA}"

# El escalado, en las mismas dos columnas y con el redondeo de cada una: pesos
# enteros en el precio (`money0`) y las tres decimales de la columna en la
# cantidad. Redondear a más decimales de los que la columna guarda sería
# redondear dos veces —una aquí y otra al asignar— y las dos rondas no siempre
# dan lo mismo.
#
# LO QUE EL REDONDEO MUEVA SE QUEDA EN EL TOTAL, y ahí está toda la diferencia
# con antes. El residuo absorbía el resto —se recalculaba como `objetivo −
# detallado` y la suma daba el objetivo al peso— así que estas dos rondas eran
# invisibles. Hoy el total es la suma de los renglones y de nadie más: lo
# copiado aterriza en «el objetivo, ± lo que se acumuló redondeando», que a
# pesos enteros por renglón es del orden de unos pesos en un presupuesto de
# millones. Se prefiere ese error visible a un renglón que lo esconda.
_SCALED_COLUMN = {
    "quantity": f"CASE WHEN {_SCALES_ITS_QUANTITY} THEN round(l.quantity * %s, 3)"
                "      ELSE l.quantity END AS quantity",
    "unit_price": f"CASE WHEN {_SCALES_ITS_PRICE} THEN round(l.unit_price * %s, 0)"
                  "      ELSE l.unit_price END AS unit_price",
}


def _copied_name(misma_propiedad: bool) -> str:
    """Cómo se llama el renglón al otro lado de la copia.

    EL NOMBRE DEL SEMBRADO LLEVA SU CUENTA ADENTRO —«Estimado inicial · 200 m² ×
    $8,000/m²»— y esa cuenta habla de UNA propiedad. Copiado a otra obra, el
    nombre afirma metros que no son los del destino: alguien abre su presupuesto
    y lee un cálculo sobre un edificio que no es el suyo, divide por SUS 200 m² y
    saca un $/m² que no existe. Se le agrega de quién es:

        Estimado inicial · 150 m² × $10,000/m² (de «Casa Edison»)

    SE ATRIBUYE, NO SE RECORTA. Quitarle la cuenta escondería la contradicción en
    vez de resolverla: el importe seguiría siendo el del origen y quedaría un
    «Estimado inicial» de $1,500,000 sin manera de contestar de dónde salió ese
    número. El nombre es la única memoria que queda de esa cuenta
    (`estimate_line_name`); truncarlo la borra, atribuirlo la completa.

    Copiado al ESCENARIO DE PLAN de la misma propiedad se conserva entero: ahí
    los metros sí son los suyos, y el escenario existe justamente para
    espejearla. Lo que separa los dos casos es `budgets.property_id` y no que el
    destino sea un plan: `create_plan_budget` acepta como origen el escenario de
    OTRA obra, así que ser-plan y ser-de-la-misma-obra son preguntas distintas.

    ES IDEMPOTENTE PORQUE EL NOMBRE ES LA LLAVE DE LA DEDUP: una copia de una
    copia tiene que producir el mismo texto o el segundo `apply` deja de
    deduplicar. Si el nombre ya trae atribución se deja como está, y A→B→C
    conserva «(de «A»)», que además es la respuesta verdadera — la aritmética de
    ese nombre son los metros de A, nunca los de B.

    No se recalcula contra las métricas del destino, que sería el arreglo
    aparente: el importe que viaja es el del ORIGEN —escalado, incluso— así que
    un nombre recalculado contradiría su propia cifra, que es exactamente el
    defecto del que venimos."""
    if misma_propiedad:
        return "l.name"
    # Sin parámetros a propósito: el nombre de la obra sale de un subquery y no
    # de una interpolación, que con un nombre que traiga comilla sería inyección.
    return (f"CASE WHEN l.seeded AND strpos(l.name, '{ATTRIBUTION_OPEN}') = 0"
            f"     THEN l.name || '{ATTRIBUTION_OPEN}'"
            "            || (SELECT p.name FROM properties p JOIN budgets o"
            "                  ON o.property_id = p.id WHERE o.id = l.budget_id)"
            "            || '»)'"
            "     ELSE l.name END AS name")


def _candidate_columns(factor, misma_propiedad: bool) -> tuple[str, list]:
    """Las columnas del origen TAL COMO SE VAN A INSERTAR, con sus parámetros.

    Sin factor no se toca ni una: la copia directa es literalmente el SELECT de
    siempre, sin un `round()` de más que le mueva un centavo a un precio que
    nadie pidió escalar. Con factor, el mismo valor entra tantas veces como
    `%s` haya en las columnas escaladas —el conteo sale del SQL y no de una
    constante que haya que acordarse de mover."""
    columnas = {"name": _copied_name(misma_propiedad)}
    if factor is not None:
        columnas |= _SCALED_COLUMN
    sql = ", ".join(columnas.get(c, f"l.{c}") for c in _COPIED_LINE_COLUMNS)
    return sql, [factor] * sql.count("%s")


def _same_property(conn, source_budget_id: int, target_budget_id: int) -> bool:
    """Si los dos presupuestos son de la misma obra. Separa copiar ENTRE obras de
    copiar a un escenario de plan, que es la misma operación con otro alcance."""
    return bool(conn.execute(
        "SELECT (SELECT o.property_id FROM budgets o WHERE o.id = %s)"
        "        IS NOT DISTINCT FROM"
        "       (SELECT d.property_id FROM budgets d WHERE d.id = %s) AS misma",
        (source_budget_id, target_budget_id)).fetchone()["misma"])


def copy_lines(conn, source_budget_id: int, target_budget_id: int,
               chapters: list[str] | None = None, factor=None) -> tuple[int, int]:
    """Copia los renglones de un presupuesto a otro, sin repetir los que el
    destino ya tiene. Devuelve `(copiados, saltados)`.

    ESTA es la única forma de arrancar un presupuesto que no es la captura
    manual, y copiar no distingue de dónde a dónde va: son dos presupuestos de
    obra y nada más. TAMPOCO DISTINGUE RENGLONES: se copian todos, porque todos
    son la misma cosa. El remanente quedaba fuera por ser un importe que el
    sistema recalculaba; una holgura con nombre propio —«Por detallar», lo que
    sea— es alcance que alguien decidió cargar, y la obra que copia la forma de
    otra quiere heredar también cuánto le falta por detallar.

    DEDUPLICAR ES SALTAR, NUNCA ACTUALIZAR, y es la garantía central de esta
    operación. Un renglón que ya existe en el destino puede traer proveedor,
    monto comprometido, pagos o `closed_at`; pisarle el `unit_price` o la
    `quantity` con los del origen reescribiría dinero YA CAPTURADO, en silencio y
    sin nada que se vea roto —la misma falla que la doctrina de «copiar al
    instanciar, nunca liga viva» existe para impedir—. Se deja intacto y se
    reporta; si hay que cambiarlo, lo cambia un humano renglón por renglón.

    Dos renglones son EL MISMO cuando coinciden su `(capítulo, nombre)`
    normalizados con `_norm` —el nombre YA reescrito, si la copia cruzó de
    propiedad, porque es el que va a quedar guardado—.

    LO ÚNICO QUE LA COPIA REESCRIBE ES EL NOMBRE DEL SEMBRADO, y sólo al cruzar
    de propiedad: se le agrega de qué obra viene, porque su cuenta habla de
    metros que no son los del destino. Ver `_copied_name`.

    `chapters` recorta el origen a esos capítulos; `None` los copia todos, que es
    el comportamiento de siempre.

    `factor` dimensiona lo copiado al costo que se espera de la obra destino;
    `None` copia los importes tal cual, que es la copia de siempre. Los renglones
    con `is_proportional = FALSE` pasan intactos aunque haya factor: su monto es
    propio. Y EL FACTOR NO TOCA LA DEDUP — un renglón que el destino ya tiene se
    salta igual, ni escalado ni actualizado, porque el de acá puede traer dinero
    ya capturado y escalarlo sería reescribirlo."""
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
    #
    # El escalado vive en `cand` y no en el INSERT: así `cand` produce las filas
    # EXACTAMENTE como van a quedar, el INSERT sigue siendo el mismo `SELECT
    # l.<columna>` de siempre para las dos copias, y la lista de columnas
    # insertadas no puede despegarse de la lista de valores.
    columns = ", ".join(_COPIED_LINE_COLUMNS)
    source = ", ".join(f"l.{c}" for c in _COPIED_LINE_COLUMNS)
    candidatas, escalado = _candidate_columns(factor, _same_property(
        conn, source_budget_id, target_budget_id))
    row = conn.execute(
        # `l.id` viaja en `cand` sin copiarse: solo desempata el ORDER BY, para
        # que el orden de inserción —y por lo tanto los `id` nuevos— sea el mismo
        # que el del origen y no el que le toque al planeador.
        f"WITH cand AS ("
        f"     SELECT l.id, {candidatas}"
        f"     {_CANDIDATES}"
        "), ins AS ("
        f"     INSERT INTO budget_lines (budget_id, {columns})"
        f"     SELECT %s, {source} FROM cand l"
        "       WHERE NOT EXISTS (SELECT 1 FROM budget_lines d"
        "                          WHERE d.budget_id = %s"
        f"                           AND {_norm('d.chapter_name')} = {_norm('l.chapter_name')}"
        f"                           AND {_norm('d.name')} = {_norm('l.name')})"
        "       ORDER BY l.chapter_name, l.sort_order, l.id"
        "     RETURNING 1"
        ") SELECT (SELECT count(*) FROM cand) AS candidatos,"
        "         (SELECT count(*) FROM ins) AS copiados",
        escalado + [source_budget_id, chapters, chapters,
                    target_budget_id, target_budget_id],
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
        "  WHERE budget_id = %s ORDER BY chapter_name",
        (source_budget_id,)).fetchall()]
    pedidos = "«" + "», «".join(chapters) + "»"
    if not disponibles:
        return (f"El presupuesto de origen no tiene ningún renglón que copiar, así que "
                f"tampoco los capítulos {pedidos}.")
    return (f"Ninguno de esos capítulos existe en el presupuesto de origen: {pedidos}. "
            f"Los suyos son: «" + "», «".join(disponibles) + "».")


# ─── Copiar proporcional ──────────────────────────────────────────────────────
#
# COPIAR PROPORCIONAL ES COPIAR LA FORMA DEL PRESUPUESTO, DIMENSIONADA AL COSTO
# DE OBRA QUE ESTA PROPIEDAD YA TIENE. El desglose de la obra de al lado sirve;
# su tamaño no.
#
# El costo objetivo es `T = el total del presupuesto del DESTINO`, y no una razón
# de metrajes: dos obras del mismo tamaño pueden construirse a niveles de costo
# distintos, y el metraje solo no lo captura. Tampoco es un $/m² que llegue en el
# cuerpo: toda propiedad YA trae su costo de obra —el total de su presupuesto,
# que por construcción ES `m² × $/m²`, porque de ahí lo sembró la ficha—, así que
# pedirlo otra vez sería capturar por segunda vez un número que ya existe, con la
# única consecuencia posible de que las dos capturas discrepen.
#
#     T = el total actual del presupuesto del destino
#     F = las partidas FIJAS del origen  no escalan
#     todo lo demás del origen           sí escala
#
#     factor = (T − F) / (total del origen − F)
#
# El denominador es TODO LO DEMÁS del origen —sus partidas proporcionales y los
# capítulos que esta copia no se lleva—, y eso es lo que hace que el destino
# herede también CUÁNTO LE FALTA POR DETALLAR: si el origen cargaba una holgura,
# viene escalada como todo lo demás, sin un solo caso especial.
#
# Y la suma de lo copiado cierra exacta en T sin que nadie la fuerce:
#
#     F + factor·(todo lo demás)  =  F + (T − F)  =  T
#
# LO COPIADO SE SUMA A LO QUE YA HABÍA, y desde que el total es la suma de sus
# renglones eso se ve: el presupuesto del destino queda en `T + T`. Antes el
# residuo absorbía la diferencia y el total no se movía — que era precisamente
# la absorción que este diseño retiró, porque un total que no puede moverse no
# puede enseñar nada. El renglón que sobra (el estimado con el que nació la
# propiedad, casi siempre) se borra con un clic, como cualquier otro, y ahí T es
# lo que queda: el desglose real en vez del estimado paramétrico.
#
# T NO SE GUARDA EN NINGÚN LADO NUEVO: es el total de siempre, la suma de los
# renglones. Lo que cambia entre las dos copias es a qué TAMAÑO entran los
# renglones copiados: tal cual los del origen, o dimensionados a lo que esta
# obra tenía presupuestado.

def _property_name(conn, property_id: int) -> str:
    """El nombre de la obra, para que un rechazo diga de cuál habla."""
    return conn.execute(
        "SELECT name FROM properties WHERE id = %s", (property_id,)
    ).fetchone()["name"]


def _require_replaceable(conn, property_id: int, entero: bool, reemplaza: bool) -> None:
    """La copia PROPORCIONAL solo existe donde la copia reemplaza, y aquí se
    exige.

    El factor dimensiona lo copiado para que sume «lo que esta obra ya tenía
    presupuestado». Si ese lugar sigue ocupado —porque hay renglones propios que
    no se van a borrar, o porque se pidió un capítulo suelto que no puede
    sustituir a un presupuesto entero— la copia aterriza ENCIMA y el total queda
    en algo que el propio objetivo desmiente: ≈2×.

    Se rechaza en vez de aproximar. Una operación que no puede cumplir su
    garantía tiene dos salidas honestas —declinar, o borrar de más para hacerse
    lugar— y la segunda no está disponible: identificar cuál renglón vino a
    sustituir exige reconocer el estimado por su nombre, y un nombre lo teclea o
    lo renombra cualquiera (el mismo argumento con el que la 033 desmontó «Otros,
    por detallar»). La copia DIRECTA sigue funcionando en los dos casos: trae los
    importes del origen y no promete nada sobre el total."""
    if reemplaza:
        return
    nombre = _property_name(conn, property_id)
    if not entero:
        raise BudgetError(
            f"La copia proporcional dimensiona lo copiado al costo de obra de "
            f"«{nombre}», y un capítulo suelto no puede sumar el presupuesto "
            f"completo. Copia ese capítulo tal cual, o pide el presupuesto "
            f"entero en proporcional.")
    raise BudgetError(
        f"«{nombre}» ya tiene renglones capturados en su presupuesto de obra, y "
        f"la copia proporcional dimensiona lo copiado a ese costo —el lugar ya "
        f"está ocupado, así que lo copiado se sumaría encima y el total quedaría "
        f"al doble—. Copia el presupuesto tal cual, o borra esos renglones y "
        f"vuelve a intentar.")


def _require_cost_of_works(conn, property_id: int, objetivo: Decimal) -> None:
    """El objetivo de la copia proporcional SE LEE, NO SE RECIBE: es el costo de
    obra que la propiedad ya tiene. Lo único que hay que exigirle es existir.

    En cero no hay nada a qué escalar —el factor daría 0 y la copia entera
    aterrizaría en importes en cero—, y el arreglo es capturar obra: un renglón,
    el que sea. Ahí manda el rechazo, nombrando la obra."""
    if objetivo > 0:
        return
    raise BudgetError(
        f"«{_property_name(conn, property_id)}» tiene el presupuesto de obra en $0, y la copia proporcional "
        f"dimensiona lo copiado a ese costo. Captura al menos un renglón —aunque "
        f"sea el estimado grueso, m² × $/m²— y vuelve a intentar, o copia el "
        f"presupuesto tal cual.")


def _proportional_factor(conn, source_budget_id: int,
                         chapters: list[str] | None, objetivo: Decimal) -> Decimal:
    """Por cuánto se multiplica lo que sí escala del origen para que la copia
    quepa en `objetivo`.

    Las fijas se apartan de las dos puntas de la razón: entran al destino con su
    monto original, así que ni consumen factor ni lo reciben. Se suman sobre los
    MISMOS candidatos que se van a copiar (`_CANDIDATES`), no sobre el origen
    entero, porque una fija de un capítulo que esta copia no se lleva no va a
    cobrarle nada al destino."""
    fijas = money(conn.execute(
        "SELECT coalesce(sum(l.quantity * l.unit_price)"
        "         FILTER (WHERE NOT l.is_proportional), 0) AS fijas"
        + _CANDIDATES, (source_budget_id, chapters, chapters)).fetchone()["fijas"])
    if objetivo <= fijas:
        raise BudgetError(
            f"No se puede copiar proporcional: las partidas fijas del presupuesto "
            f"de origen suman ${fijas:,.0f} y el objetivo de esta obra es "
            f"${objetivo:,.0f}. Una partida fija cuesta lo que cuesta —no encoge "
            f"con la obra— así que ya no cabe. Sube el costo de obra de esta "
            f"propiedad, o desmarca las partidas que sí deban escalar.")
    escalable = _totals(conn, source_budget_id) - fijas
    # Sin nada que escalar el factor no multiplica nada: todo el origen es fijo.
    # Devolver 1 evita una división entre cero para dejar exactamente el mismo
    # resultado —las fijas entran tal cual, con su monto propio—.
    if escalable <= 0:
        return Decimal(1)
    return (objetivo - fijas) / escalable


def _has_candidates(conn, source_budget_id: int, chapters: list[str] | None) -> bool:
    """¿Esta copia va a traer aunque sea un renglón?

    Sobre los MISMOS candidatos que se van a copiar (`_CANDIDATES`), por la
    misma razón que el factor: dos WHERE tecleados por separado se despegan. La
    pregunta la hace el reemplazo, y solo él: cambiar el estimado por lo que
    llega no puede significar cambiarlo por nada."""
    return conn.execute("SELECT 1" + _CANDIDATES + " LIMIT 1",
                        (source_budget_id, chapters, chapters)).fetchone() is not None


def apply_budget(conn, property_id: int, source_budget_id: int,
                 chapters: list[str] | None = None, *,
                 proportional: bool = False,
                 plan_id: str | None = None) -> tuple[int, int]:
    """Arranca esta obra desde el presupuesto de otra.

    DOS CASOS, Y LOS SEPARA QUÉ HABÍA EN EL DESTINO:

    - Si el destino no tiene NADA MÁS QUE LO QUE EL SISTEMA SEMBRÓ —ningún
      renglón, o uno solo marcado `seeded` y sin ejecución encima, que es
      exactamente lo que pregunta
      `budget_holds_only_initial_estimate`— Y se copia el presupuesto ENTERO,
      ese renglón SE REEMPLAZA por lo que llega. Es el movimiento que esta operación
      existe para hacer —la cifra paramétrica se vuelve el desglose que la
      sustenta, Clase 5 → Clase 3 (ver el diseño)— y sumarlos contaría dos veces
      la misma obra: el desglose no se agrega al estimado, ES el estimado, ahora
      dicho por partidas. En la proporcional se ve solo: el factor dimensiona lo
      copiado para que sume exactamente el total que el destino ya tenía, así
      que sumarlo encima daría 2×, un número que la propia aritmética del modo
      desmiente. Un capítulo suelto NO reemplaza: no sustituye a un presupuesto
      entero, y cambiar un estimado de $2,340,000 por los $150,000 de una sección
      sería pérdida de datos con cara de función.
    - Si hay algo más —un segundo renglón, uno tecleado (nace con
      `seeded = FALSE`), cualquier captura de ejecución— o si se pidieron capítulos sueltos, los renglones se
      SUMAN a lo que ya hubiera y el total sube con ellos. Nada de lo que alguien
      tecleó se toca, ni siquiera para hacerle lugar a una copia.

    ESTA RAMA BORRA, y por eso la pregunta se contesta con un hecho estructural
    y no con un parecido: `apply` no se lee como destructiva y no tiene paso de
    confirmación.

    Y BORRA EN SILENCIO: lo devuelto son `(copiados, saltados)` y no hay un
    tercer número para lo quitado. Es deliberado. Lo único que esta rama puede
    quitar es un renglón sembrado —lo dice el predicado que la abre, no una
    convención—, o sea una cifra que este mismo sistema escribió y que vuelve a
    escribirse sola si la propiedad se recaptura. Reportarlo obligaría a la
    pantalla a explicar una pérdida que no lo es.

    Con una salvedad que hay que decir: `seeded` sobrevive a las EDICIONES, así
    que quien habló con su contratista y corrigió el estimado de $2,340,000 a
    $2,800,000 sigue teniendo un renglón sembrado, y esta rama lo borra con su
    cifra adentro. Se acepta —una sola cifra global la sustituye el desglose que
    viene a sustentarla, que es la operación entera— pero no es cierto que no
    haya nada suyo en juego.

    De lo mismo se sigue que la rama es RE-ENTRANTE: copiar una fuente que sólo
    trae su estimado deja aquí un renglón sembrado —la marca viaja con la copia—
    así que el siguiente `apply` vuelve a entrar por el reemplazo y sustituye lo
    recién copiado en vez de sumarle. Encadenar copias no acumula estimados. En
    cuanto entra un renglón tecleado o un segundo renglón, la rama se cierra y no
    se vuelve a abrir.

    Y LA PROPORCIONAL SOLO EXISTE EN LA PRIMERA RAMA: fuera de ella rechaza
    (`_require_replaceable`) en vez de aterrizar encima. La directa funciona en
    las dos, porque no promete nada sobre el total.

    La pregunta que separa los dos casos es la MISMA que decide si una propiedad
    se puede borrar (`budget_holds_only_initial_estimate`). El reemplazo va antes
    de copiar, no después, para que la dedup no compare contra un renglón que ya
    está sentenciado.

    No hay composición de bloques ni expansión recursiva —eso es lo que hacen
    las plantillas de proceso con `source_template_id`, y ahí se ve el costo: la
    expansión quedó truncada a un nivel más un detector de ciclos completo.
    Arrancar desde otra obra y borrar tres renglones cuesta treinta segundos y
    cero código.

    Devuelve `(copiados, saltados)`. Los saltados son los renglones que el
    destino YA tenía y que por eso quedaron intactos —ver `copy_lines`—, y
    viajan de vuelta porque aplicar sin decir cuánto no se aplicó es un «listo»
    que esconde la mitad del resultado. `chapters` recorta el origen a esos
    capítulos; `None` copia el presupuesto entero.

    LAS DOS COPIAS SON LA MISMA OPERACIÓN CON OTRO TAMAÑO. Lo que cambia es a
    qué tamaño entran los renglones: la directa los trae con los importes del
    origen, la PROPORCIONAL los dimensiona para que LO COPIADO sume exactamente
    el total que esta obra ya tenía. De ahí en adelante las dos son el mismo
    INSERT.

    Y ahí hay que ser preciso, porque la frase se presta: el factor garantiza lo
    que suma LO COPIADO, no en qué queda el total. Las dos coinciden únicamente
    en la rama del reemplazo —lo que había se fue, así que el total ES lo
    copiado— y por eso la proporcional no se ofrece en ninguna otra: donde no
    coinciden, la garantía enunciada y el resultado se contradicen, y una
    operación que no puede cumplir lo que promete declina.

    EL FACTOR LO CALCULA ESTE SERVIDOR, siempre, contra el costo de obra que el
    destino ya tiene capturado. Un factor mandado por el cliente volvería la
    garantía —«lo copiado suma exactamente el objetivo»— imposible de verificar
    aquí."""
    budget_id = _require_budget(conn, property_id, plan_id)
    if source_budget_id == budget_id:
        raise BudgetError("Un presupuesto no se copia sobre sí mismo.")
    if conn.execute("SELECT 1 FROM budgets WHERE id = %s",
                    (source_budget_id,)).fetchone() is None:
        raise BudgetNotFound(f"No existe el presupuesto {source_budget_id} que se quiere copiar")
    # Las dos lecturas van ANTES de tocar nada: sobre los renglones de ahora,
    # incluido el estimado que quizá no sobreviva a esta misma llamada. Y el
    # reemplazo exige copia ENTERA: un capítulo suelto no sustituye a un
    # presupuesto, así que sumarlo es lo único honesto que puede hacer.
    entero = chapters is None
    reemplaza = entero and budget_holds_only_initial_estimate(conn, budget_id)
    factor = None
    if proportional:
        _require_replaceable(conn, property_id, entero, reemplaza)
        # El objetivo es el costo de obra que esta propiedad ya tiene: se lee,
        # no se recibe.
        objetivo = _totals(conn, budget_id)
        _require_cost_of_works(conn, property_id, objetivo)
        factor = _proportional_factor(conn, source_budget_id, chapters, objetivo)
    if reemplaza and _has_candidates(conn, source_budget_id, chapters):
        conn.execute("DELETE FROM budget_lines WHERE budget_id = %s", (budget_id,))
    return copy_lines(conn, source_budget_id, budget_id, chapters, factor)


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
# `line_count` cuenta lo COPIABLE, que desde que no hay renglón especial es todo
# lo que hay: el número es exactamente cuántos renglones van a aparecer. Y por
# eso se filtran los presupuestos sin nada que copiar — uno del que no sale nada
# no es una respuesta a «de dónde puedo copiar». Ese filtro ya no esconde a las
# obras apenas capturadas: su renglón de estimado SÍ se copia, así que aparecen
# con el 1 que traen, que es la verdad de lo que ofrecen.

# Desde el addendum 2026-08-24 la lista es de PRESUPUESTOS, no de propiedades:
# los escenarios de plan también aparecen (etiquetados con el nombre VIVO de su
# plan, leído del geometry — sobrevive a renombres), y la exclusión es por id de
# presupuesto — así el menú de una obra ofrece los escenarios de ESA MISMA obra,
# que era imposible cuando se excluía la propiedad entera. copy_lines siempre lo
# dijo: "copiar no distingue de dónde a dónde va: son dos presupuestos de obra".
#
# `full_total` (todo el presupuesto) y `total` (lo copiable) ERAN DOS NÚMEROS
# porque el residuo entraba en uno y no en el otro. Hoy son el mismo: todo
# renglón se copia. Se sigue publicando el par para no romper el cliente en este
# despliegue —`fullTotal` se retira con la pantalla que lo lee— pero sale de una
# sola suma, que es lo que impide que vuelvan a decir cosas distintas.
# `fullTotal` queda DEPRECADO por lo mismo y se va en PR 2 · Contract, junto con
# `budgetIncrease` y la columna: la sesión en vuelo durante el rollout es la que
# lo sigue leyendo.
_SOURCES_SQL = """
    SELECT b.id, p.name, b.property_id, b.plan_id, pl.plan_name,
           p.sqm_construction, p.construction_cost_per_sqm,
           t.line_count, t.total
      FROM budgets b
      JOIN properties p ON p.id = b.property_id
      LEFT JOIN LATERAL (
            SELECT e->>'name' AS plan_name
              FROM jsonb_array_elements(p.geometry->'variants'->'plans') e
             WHERE e->>'id' = b.plan_id) pl ON b.plan_id IS NOT NULL
      JOIN LATERAL (
            SELECT count(*) AS line_count,
                   coalesce(sum(l.quantity * l.unit_price), 0) AS total
              FROM budget_lines l
             WHERE l.budget_id = b.id) t ON TRUE
     WHERE (%(include_empty)s OR t.line_count > 0)
       AND (%(exclude_budget_id)s::bigint IS NULL OR b.id <> %(exclude_budget_id)s::bigint)
     ORDER BY lower(p.name), b.plan_id NULLS FIRST, lower(coalesce(pl.plan_name, ''))
"""


# `line_count` y no `lines`: aquí es un NÚMERO, y en `get_budget` ese mismo
# nombre carga el ARREGLO de renglones. Un campo que es un número en la lista y
# una lista en el detalle es la clase de trampa que se paga en el cliente.


def list_sources(conn, exclude_budget_id: int | None = None, *,
                 include_empty: bool = False) -> list[dict]:
    """Los PRESUPUESTOS entre los que se puede copiar — el de cada obra y los
    escenarios de plan, etiquetados — cada uno con cuántos renglones traería.

    `exclude_budget_id` saca el presupuesto que está preguntando (por id de
    presupuesto, no de propiedad: los escenarios de la MISMA obra sí se
    ofrecen). `apply` ya rechaza copiarse sobre sí mismo con un 422, y ofrecer
    en un selector una opción que solo puede dar error es hacer que el usuario
    descubra la regla chocando con ella.

    `include_empty` es para la lista de DESTINOS de empuje: a un presupuesto
    vacío sí se le puede copiar; como FUENTE no dice nada (default)."""
    return [_row_to_dict(row)
            | {"total": money0(row["total"]), "fullTotal": money0(row["total"])}
            for row in conn.execute(_SOURCES_SQL, {
                "exclude_budget_id": exclude_budget_id,
                "include_empty": include_empty,
            }).fetchall()]


# ─── Renglones ────────────────────────────────────────────────────────────────

# Lo que un cliente puede escribir en un renglón — TODO renglón, sin excepción.
# Hubo una: el remanente sólo aceptaba `notes`, porque su importe lo ponía una
# resta y dejarlo teclear habría convertido esa resta en una segunda captura.
# Ya no hay resta que proteger, así que tampoco hay dos clases de renglón.
LINE_FIELDS = frozenset({
    "chapterName", "name", "unit", "quantity", "unitPrice",
    "supplierCategoryId", "supplierId", "committedAmount", "committedOn",
    "actualQuantity", "notes", "isProportional",
})

_LINE_COLUMNS = {
    "chapterName": "chapter_name", "name": "name", "unit": "unit",
    "quantity": "quantity", "unitPrice": "unit_price",
    "supplierCategoryId": "supplier_category_id",
    "supplierId": "supplier_id", "committedAmount": "committed_amount",
    "committedOn": "committed_on", "actualQuantity": "actual_quantity",
    "notes": "notes", "isProportional": "is_proportional",
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
    # Toda partida contesta si crece con la obra, y por eso la columna es NOT
    # NULL con default TRUE: no hay «todavía no se sabe». Un null aquí llegaría
    # hasta la base y volvería como un 500 mudo.
    "isProportional": "Una partida crece con la obra o no: la marca no se vacía.",
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


def create_line(conn, property_id: int, data: dict, plan_id: str | None = None) -> int:
    """Un renglón. El presupuesto sube exactamente su importe: es la suma de sus
    renglones y hay uno más.

    Que el total se mueva ES la entrega. Antes el residuo bajaba lo mismo que el
    renglón subía, y detallar no cambiaba el costo de obra: cuando la cotización
    real de la instalación eléctrica llegaba $45,000 arriba del hueco que se le
    había apartado, esos $45,000 —el número más valioso del sistema, el que dice
    que el supuesto de $/m² iba corto— se los comía el remanente y nadie se
    enteraba. Ahora se ven.

    Un renglón nace suelto, siempre: captura manual —capítulo, nombre, unidad,
    cantidad y precio tecleados— y nada más. Es el caso barato a propósito."""
    budget_id = _require_budget(conn, property_id, plan_id)

    columns = {_LINE_COLUMNS[k]: v for k, v in data.items() if k in LINE_FIELDS}
    require_supplier_category(conn, data.get("supplierCategoryId"))
    _reject_empty(data, required=("chapterName", "name"))
    # Una partida puede nacer sin cantidad ni precio: la captura es celda por
    # celda con autoguardado, y exigir la fila completa de golpe convertiría un
    # estado intermedio normal en un error.
    columns.setdefault("unit", LUMP_SUM_UNIT)
    columns.setdefault("quantity", 0)
    columns.setdefault("unit_price", 0)
    columns["budget_id"] = budget_id

    names = ", ".join(columns)
    placeholders = ", ".join(["%s"] * len(columns))
    return conn.execute(
        f"INSERT INTO budget_lines ({names}) VALUES ({placeholders}) RETURNING id",
        list(columns.values()),
    ).fetchone()["id"]


def update_line(conn, property_id: int, line_id: int, data: dict,
                plan_id: str | None = None) -> None:
    """Cambia un renglón. Cualquier renglón, y cualquiera de sus celdas.

    `data` trae SOLO lo que el cliente mandó, y un `None` ahí significa «quítalo»
    —no «no lo toques»—: los campos de NULLABLE_LINE_FIELDS se vacían así y no
    hay otra puerta para hacerlo."""
    budget_id = _require_budget(conn, property_id, plan_id)
    if conn.execute(
        "SELECT 1 FROM budget_lines WHERE id = %s AND budget_id = %s",
        (line_id, budget_id),
    ).fetchone() is None:
        raise BudgetNotFound(f"Renglón {line_id} no encontrado en este presupuesto")
    _reject_empty(data)
    if "supplierCategoryId" in data:
        require_supplier_category(conn, data["supplierCategoryId"])

    columns = {_LINE_COLUMNS[k]: v for k, v in data.items() if k in LINE_FIELDS}
    if columns:
        assignments = ", ".join(f"{col} = %s" for col in columns)
        conn.execute(
            f"UPDATE budget_lines SET {assignments} WHERE id = %s",
            list(columns.values()) + [line_id],
        )


def delete_line(conn, property_id: int, line_id: int, plan_id: str | None = None) -> dict:
    """Quita un renglón y baja el presupuesto exactamente su importe. Devuelve el
    renglón como estaba: un borrado también es una escritura, y quien la pidió
    tiene que poder decir qué fila quitar de la tabla.

    NINGÚN RENGLÓN ESTÁ EXENTO, y eso incluye al último. Un presupuesto puede
    quedarse en cero renglones y sumar $0 sin que nada se rompa: 0 es un número.
    El remanente sí estaba exento —«no se borra», porque el mecanismo lo
    necesitaba vivo para tener de dónde restar— y esa era la parte de la regla
    que sobraba, no el dinero que cargaba."""
    budget_id = _require_budget(conn, property_id, plan_id)
    line = _get_line(conn, budget_id, line_id)
    conn.execute("DELETE FROM budget_lines WHERE id = %s", (line_id,))
    return line


# ─── Capítulos ────────────────────────────────────────────────────────────────
#
# Un capítulo no es una fila: es el `chapter_name` que copian sus renglones, y
# por eso no se crea vacío. Nace cuando el primer renglón lo nombra. Lo que sí
# necesita operaciones propias es renombrarlo y quitarlo, porque las dos tocan
# varios renglones a la vez y hacerlas renglón por renglón dejaría el
# presupuesto medio renombrado si algo falla en medio.

def rename_chapter(conn, property_id: int, chapter: str, new_name: str, plan_id: str | None = None) -> int:
    budget_id = _require_budget(conn, property_id, plan_id)
    new_name = (new_name or "").strip()
    if not new_name:
        raise BudgetError("El capítulo necesita un nombre.")
    changed = conn.execute(
        "UPDATE budget_lines SET chapter_name = %s WHERE budget_id = %s AND chapter_name = %s",
        (new_name, budget_id, chapter),
    ).rowcount
    if changed == 0:
        raise BudgetNotFound(f"El presupuesto no tiene un capítulo «{chapter}»")
    return changed


def delete_chapter(conn, property_id: int, chapter: str, plan_id: str | None = None) -> int:
    """Borra el capítulo con todos sus renglones, y el presupuesto baja lo que
    sumaban. Es `delete_line` en bloque y significa lo mismo."""
    budget_id = _require_budget(conn, property_id, plan_id)
    deleted = conn.execute(
        "DELETE FROM budget_lines WHERE budget_id = %s AND chapter_name = %s",
        (budget_id, chapter),
    ).rowcount
    if deleted == 0:
        raise BudgetNotFound(f"El presupuesto no tiene un capítulo «{chapter}»")
    return deleted


# ─── Pagos ────────────────────────────────────────────────────────────────────
#
# Lo único intrínsecamente múltiple de un renglón: anticipo, avances, finiquito.
# Append-only, como los eventos de etapa — un pago mal capturado se borra, no se
# reescribe, porque corregirlo en su lugar borraría que alguna vez se dijo otra
# cosa. Un pago no toca el total: pagar no cambia lo que la obra
# estaba planeada a costar, y esa brecha es justamente lo que se quiere ver.

def add_payment(conn, property_id: int, line_id: int, amount, paid_on=None, plan_id: str | None = None,
                notes: str = "") -> int:
    budget_id = _require_budget(conn, property_id, plan_id)
    _get_line(conn, budget_id, line_id)
    if to_decimal(amount) <= 0:
        raise BudgetError("Un pago se captura positivo.")
    return conn.execute(
        "INSERT INTO budget_line_payments (line_id, amount, paid_on, notes)"
        " VALUES (%s, %s, COALESCE(%s, CURRENT_DATE), %s) RETURNING id",
        (line_id, money(amount), paid_on, notes),
    ).fetchone()["id"]


def delete_payment(conn, property_id: int, line_id: int, payment_id: int, plan_id: str | None = None) -> None:
    budget_id = _require_budget(conn, property_id, plan_id)
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

    Es `_UNTOUCHED_BUDGET` al derecho —la MISMA pregunta que decide si una copia
    reemplaza el estimado— exigida a CADA presupuesto de la propiedad por
    separado: el de la obra y los escenarios de plan, porque el borrado se los
    lleva todos. Basta con que UNO traiga trabajo para que retenga.

    Por separado y no en un solo conteo, que es donde estaba el error: «el
    sistema siembra a lo más un renglón» vale por presupuesto, no por propiedad.
    Sumándolos, una obra recién capturada con un escenario de plan copiado daba
    dos renglones —uno suyo, uno del escenario— y quedaba retenida para siempre
    sin que nadie hubiera capturado nada, con la única salida de borrar los
    renglones del escenario a mano. Antes la pregunta la contestaba la bandera
    del remanente; hoy la contesta cada presupuesto por su cuenta."""
    return not bool(conn.execute(
        f"SELECT NOT EXISTS (SELECT 1 FROM budgets b"
        f"                    WHERE b.property_id = %s AND NOT {_UNTOUCHED_BUDGET})"
        f"    AS intacto",
        (property_id,),
    ).fetchone()["intacto"])


def drop_budget(conn, property_id: int) -> None:
    """Se lleva el presupuesto sembrado junto con su propiedad. Solo lo llama el
    borrado, y solo después de que `holds_captured_work` dijo que no hay nada
    que perder."""
    conn.execute("DELETE FROM budgets WHERE property_id = %s", (property_id,))


# ─── Presupuesto-escenario por plan de proyecto (addendum 2026-08-24) ─────────

def _plan_exists(conn, property_id: int, plan_id: str) -> bool:
    """Membresía del plan en el geometry vivo — misma pregunta (y misma query de
    containment) que renders_db.variant_exists, aquí con la conexión del
    llamador porque el nacimiento del escenario es parte de UNA transacción."""
    return conn.execute(
        "SELECT 1 FROM properties WHERE id = %s"
        " AND geometry->'variants'->'plans' @> %s::jsonb",
        (property_id, json.dumps([{"id": plan_id}])),
    ).fetchone() is not None


def create_plan_budget(conn, property_id: int, plan_id: str,
                       source_budget_id: int | None) -> tuple[int, int, int]:
    """Nace el escenario de un plan: copiado de CUALQUIER presupuesto origen
    (el de la propiedad, el escenario de otro plan — el flujo real muchas veces
    va de plan a plan, y el de la propiedad se llena al final —, o el de otra
    obra; misma maquinaria de siempre: copy_lines, el flujo de apply_budget con
    otro destino) o vacío con `source_budget_id` None. Devuelve (budget_id,
    copiados, saltados).

    El escenario nace con el MISMO total que su origen, y ahora eso sale gratis:
    viajan todos los renglones, así que las dos sumas son la misma suma. Antes
    hacía falta leer el total del origen, sembrarlo como residuo y volver a
    asentarlo, porque el remanente no se copiaba y había que reponerlo. Vacío =
    cero renglones = $0. NUNCA se auto-crea al leer (ver _require_budget)."""
    if not _plan_exists(conn, property_id, plan_id):
        raise BudgetNotFound(
            f"El plan {plan_id} no existe en la propiedad {property_id}")
    if conn.execute(
        "SELECT 1 FROM budgets WHERE property_id = %s AND plan_id = %s",
        (property_id, plan_id),
    ).fetchone() is not None:
        raise BudgetError(f"El plan {plan_id} ya tiene presupuesto")
    if source_budget_id is None:
        return create_budget(conn, property_id, plan_id=plan_id), 0, 0
    if conn.execute("SELECT 1 FROM budgets WHERE id = %s",
                    (source_budget_id,)).fetchone() is None:
        raise BudgetNotFound(
            f"No existe el presupuesto {source_budget_id} que se quiere copiar")
    budget_id = create_budget(conn, property_id, plan_id=plan_id)
    copied, skipped = copy_lines(conn, source_budget_id, budget_id)
    return budget_id, copied, skipped


def use_plan_budget(conn, property_id: int, plan_id: str) -> tuple[int, int]:
    """«Usar este plan»: los renglones del escenario entran al presupuesto de la
    propiedad por la MISMA puerta que copiar de otra obra (apply_budget →
    copy_lines): deduplicar es saltar —el dinero ya capturado en la propiedad no
    se pisa— y se reporta (copiados, saltados). El escenario queda intacto: es
    la propuesta, y la propuesta se califica.

    Y por la misma puerta llega el reemplazo: si la obra no tiene más que su
    estimado inicial, el plan que se adopta lo sustituye en vez de sumársele.
    Adoptar un plan es exactamente el movimiento que el reemplazo describe."""
    source_id = _require_budget(conn, property_id, plan_id)
    return apply_budget(conn, property_id, source_id)
