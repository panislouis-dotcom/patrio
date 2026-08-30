"""El presupuesto de obra, en la capa de datos.

Lo que fija esta suite son las decisiones que, si se rompen, no se ven rotas:

  · ninguna cifra total se guarda — presupuestado y pagado siempre se derivan;
  · `closed_at` es lo único que separa un anticipo de un precio, y la vista de
    historia solo lee cierres de obra real que de verdad se pagaron.

La aritmética de la siembra no se re-teclea aquí a propósito: la guarda de la
propia migración 032 la compara contra la fórmula propiedad por propiedad, y esa
prueba corre en todos los entornos, incluido prod. Duplicarla en pytest sería
copiar el número que se quiere vigilar.
"""
from decimal import Decimal

import pytest
from psycopg2 import IntegrityError

from api.db import get_db


PROPERTY = dict(name="[TEST] Presupuesto", address="Calle Test 1", city="Monterrey",
                status="prospecto", url="http://x", latitude=25.67, longitude=-100.31)


@pytest.fixture
def obra():
    """Una propiedad con su presupuesto y un renglón — el mínimo con el que se
    pueden probar la capa de dato y la vista de historia de precios."""
    with get_db() as conn:
        pid = conn.execute(
            "INSERT INTO properties (name, address, city, status, url, latitude, longitude)"
            " VALUES (%(name)s, %(address)s, %(city)s, %(status)s, %(url)s,"
            "         %(latitude)s, %(longitude)s) RETURNING id", PROPERTY).fetchone()["id"]
        budget_id = conn.execute(
            "INSERT INTO budgets (property_id) VALUES (%s) RETURNING id", (pid,)).fetchone()["id"]
        line_id = conn.execute(
            "INSERT INTO budget_lines (budget_id, chapter_name, name, unit,"
            "                          quantity, unit_price)"
            " VALUES (%s, '[TEST] Acabados', '[TEST] Piso cerámico', 'm²', 40, 1200)"
            " RETURNING id", (budget_id,)).fetchone()["id"]
    yield {"property_id": pid, "budget_id": budget_id, "line_id": line_id}
    with get_db() as conn:
        conn.execute("DELETE FROM budgets WHERE property_id = %s", (pid,))
        conn.execute("DELETE FROM properties WHERE id = %s", (pid,))


def _columns(table: str) -> set[str]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT column_name FROM information_schema.columns"
            " WHERE table_schema = 'public' AND table_name = %s", (table,)).fetchall()
    return {r["column_name"] for r in rows}


def test_no_total_is_stored():
    """La regla dura del módulo, dicha como candado: `budget_lines` guarda las
    partes —cantidad y precio— y `budget_line_payments` guarda los pagos uno por
    uno. Un `paid_amount` o un `budgeted_amount` almacenados serían el antipatrón
    que el glosario declaró muerto: un total que puede contradecir a sus partes.
    El conjunto va enumerado entero para que agregar una columna a estas tablas
    sea una decisión, no un descuido."""
    assert _columns("budget_lines") == {
        "id", "budget_id", "chapter_name", "name", "unit",
        "quantity", "unit_price", "supplier_id", "committed_amount", "committed_on",
        "actual_quantity", "closed_at", "sort_order", "notes", "created_at", "updated_at",
        # `is_residual` está MUERTA desde la 053 y sigue enumerada aquí a
        # propósito: la columna sobrevive en FALSE un despliegue más para que los
        # pods viejos no truenen durante el rollout (las migraciones corren como
        # hook PreSync, antes de que entren los nuevos). Nada la lee ni la
        # escribe. Se va en la 054, y este renglón se va con ella.
        "is_residual",
        # `supplier_category_id` tampoco es un total: es el OFICIO, y es lo que
        # se sabe mucho antes que el proveedor. Captura manual, como el nombre y
        # la unidad — no hay catálogo del que heredarlo.
        "supplier_category_id",
        # `is_proportional` es qué CLASE de partida es: una que crece con el
        # tamaño de la obra o una que cuesta lo que cuesta. Es lo que la copia
        # proporcional necesita saber para dimensionar sin inflar los permisos, y
        # vive en el renglón —no en la copia— porque es verdad de la partida.
        "is_proportional",
    }
    assert _columns("budget_line_payments") == {
        "id", "line_id", "amount", "paid_on", "notes", "created_at",
    }


def test_a_budget_belongs_to_exactly_one_job_and_a_job_has_exactly_one(obra):
    """La invariante entera del módulo, en sus dos mitades, y las dos las sostiene
    la base desde la 044.

    Que un presupuesto no pueda existir sin obra es lo que retiró a las
    plantillas: eran filas con `property_id NULL`, y mientras la columna lo
    permitiera «todo presupuesto es de una obra» sería una convención que
    cualquier INSERT por fuera del API podía romper en silencio. Que una obra no
    pueda tener dos es lo que le permite a `_require_budget` leer el suyo sin
    preguntarse cuál."""
    with pytest.raises(IntegrityError):
        with get_db() as conn:
            conn.execute("INSERT INTO budgets (property_id) VALUES (NULL)")
    with pytest.raises(IntegrityError):
        with get_db() as conn:
            conn.execute("INSERT INTO budgets (property_id) VALUES (%s)", (obra["property_id"],))


def test_a_budget_is_not_named_apart_from_its_job(obra):
    """`name` y `notes` murieron con las plantillas: eran su única razón de ser.
    Un presupuesto hereda el nombre de su propiedad y no lleva otro que pueda
    contradecirlo — el enumerado entero, para que devolverle una columna a esta
    tabla sea una decisión y no un descuido."""
    # `plan_id` entró con la 051 (addendum 2026-08-24): NULL = el presupuesto de
    # la propiedad — el único que alimenta finanzas —, con valor = el escenario
    # de ese plan de proyecto. Decisión documentada, no descuido.
    assert _columns("budgets") == {"id", "property_id", "plan_id", "created_at", "updated_at"}


def test_closing_a_line_demands_the_real_quantity(obra):
    """Un cierre sin cantidad real no produce precio unitario, y un renglón
    cerrado que no enseña precio es un hueco en la historia, no un cierre."""
    with pytest.raises(IntegrityError):
        with get_db() as conn:
            conn.execute("UPDATE budget_lines SET closed_at = now() WHERE id = %s",
                         (obra["line_id"],))


def _observations(line_id: int) -> list[dict]:
    with get_db() as conn:
        return conn.execute(
            "SELECT * FROM budget_price_observations WHERE line_id = %s", (line_id,)).fetchall()


def test_price_history_reads_only_closed_paid_lines_of_real_work(obra):
    """Los dos filtros de la vista, cada uno probado por lo que deja fuera: un
    renglón abierto (podría ser un anticipo) y un cierre sin un peso pagado (no
    observó ningún precio). El tercero —«solo obra real»— dejó de ser un filtro
    al morir las plantillas: ya no hay presupuesto que no sea de una obra."""
    line_id = obra["line_id"]
    assert _observations(line_id) == []          # abierto: todavía no es historia

    with get_db() as conn:
        conn.execute("UPDATE budget_lines SET actual_quantity = 42, closed_at = now()"
                     " WHERE id = %s", (line_id,))
    assert _observations(line_id) == []          # cerrado sin pago: tampoco

    with get_db() as conn:
        conn.execute("INSERT INTO budget_line_payments (line_id, amount, paid_on)"
                     " VALUES (%s, 30000, '2026-07-01'), (%s, 25200, '2026-08-01')",
                     (line_id, line_id))
    observed = _observations(line_id)
    assert len(observed) == 1
    row = observed[0]
    # Pagado 55,200 entre 42 m² reales = 1,314.29 contra los 1,200 presupuestados:
    # las dos caras juntas son las que dejan medir el sesgo, que es el hallazgo.
    assert row["paid_amount"] == Decimal("55200.00")
    assert row["actual_unit_price"] == Decimal("1314.29")
    assert row["budgeted_unit_price"] == Decimal("1200.00")
    assert row["budgeted_amount"] == Decimal("48000.000")


def test_deleting_a_budget_takes_its_lines_and_payments(obra):
    """Dentro del presupuesto sí hay cascada: un renglón sin presupuesto y un pago
    sin renglón no significan nada. Lo que no cae en cascada es el presupuesto
    con la propiedad — eso se rechaza con un 422 (test_property_routes)."""
    line_id = obra["line_id"]
    with get_db() as conn:
        conn.execute("UPDATE budget_lines SET actual_quantity = 40 WHERE id = %s", (line_id,))
        conn.execute("INSERT INTO budget_line_payments (line_id, amount) VALUES (%s, 48000)",
                     (line_id,))
        conn.execute("DELETE FROM budgets WHERE id = %s", (obra["budget_id"],))
        assert conn.execute("SELECT count(*) AS n FROM budget_lines WHERE id = %s",
                            (line_id,)).fetchone()["n"] == 0
        assert conn.execute("SELECT count(*) AS n FROM budget_line_payments WHERE line_id = %s",
                            (line_id,)).fetchone()["n"] == 0
