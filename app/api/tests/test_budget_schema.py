"""El presupuesto de obra, en la capa de datos.

Lo que fija esta suite son las decisiones que, si se rompen, no se ven rotas:

  · ninguna cifra total se guarda — presupuestado y pagado siempre se derivan;
  · el catálogo es procedencia, no dependencia, y se da de baja lógicamente;
  · `closed_at` es lo único que separa un anticipo de un precio, y la vista de
    historia solo lee cierres de obra real que de verdad se pagaron.

La aritmética de la siembra no se re-teclea aquí a propósito: la guarda de la
propia migración 028 la compara contra la fórmula propiedad por propiedad, y esa
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
    """Una propiedad con su presupuesto y un renglón, más una plantilla y un
    capítulo del catálogo — el mínimo con el que se pueden probar las tres capas."""
    with get_db() as conn:
        pid = conn.execute(
            "INSERT INTO properties (name, address, city, status, url, latitude, longitude)"
            " VALUES (%(name)s, %(address)s, %(city)s, %(status)s, %(url)s,"
            "         %(latitude)s, %(longitude)s) RETURNING id", PROPERTY).fetchone()["id"]
        budget_id = conn.execute(
            "INSERT INTO budgets (property_id) VALUES (%s) RETURNING id", (pid,)).fetchone()["id"]
        chapter_id = conn.execute(
            "INSERT INTO budget_chapters (name) VALUES ('[TEST] Acabados') RETURNING id"
        ).fetchone()["id"]
        item_id = conn.execute(
            "INSERT INTO budget_items (chapter_id, name, unit)"
            " VALUES (%s, '[TEST] Piso cerámico', 'm²') RETURNING id", (chapter_id,)).fetchone()["id"]
        line_id = conn.execute(
            "INSERT INTO budget_lines (budget_id, item_id, chapter_name, name, unit,"
            "                          quantity, unit_price)"
            " VALUES (%s, %s, '[TEST] Acabados', '[TEST] Piso cerámico', 'm²', 40, 1200)"
            " RETURNING id", (budget_id, item_id)).fetchone()["id"]
    yield {"property_id": pid, "budget_id": budget_id, "chapter_id": chapter_id,
           "item_id": item_id, "line_id": line_id}
    with get_db() as conn:
        conn.execute("DELETE FROM budgets WHERE property_id = %s OR name LIKE '[TEST]%%'", (pid,))
        conn.execute("DELETE FROM properties WHERE id = %s", (pid,))
        conn.execute("DELETE FROM budget_items WHERE name LIKE '[TEST]%%'")
        conn.execute("DELETE FROM budget_chapters WHERE name LIKE '[TEST]%%'")


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
        "id", "budget_id", "item_id", "chapter_name", "name", "unit",
        "quantity", "unit_price", "supplier_id", "committed_amount", "committed_on",
        "actual_quantity", "closed_at", "sort_order", "notes", "created_at", "updated_at",
        # `is_residual` NO es un total: es qué ES el renglón. Marca el que
        # absorbe lo que falta por detallar, y sin él la regla del remanente
        # dependería de que nadie renombre la cadena «Otros, por detallar».
        "is_residual",
        # `supplier_category_id` tampoco es un total: es el OFICIO, y es lo que
        # se sabe mucho antes que el proveedor. Se copia del catálogo al
        # instanciar como el nombre y la unidad, y por eso vive en la fila en vez
        # de resolverse en vivo contra el capítulo.
        "supplier_category_id",
    }
    assert _columns("budget_line_payments") == {
        "id", "line_id", "amount", "paid_on", "notes", "created_at",
    }


def test_one_budget_per_property_and_many_templates(obra):
    """Un presupuesto por obra; plantillas, las que hagan falta. Y una plantilla
    sin nombre no existe: es lo único que la distingue de las demás."""
    with pytest.raises(IntegrityError):
        with get_db() as conn:
            conn.execute("INSERT INTO budgets (property_id) VALUES (%s)", (obra["property_id"],))
    with pytest.raises(IntegrityError):
        with get_db() as conn:
            conn.execute("INSERT INTO budgets (property_id, name) VALUES (NULL, '')")
    with get_db() as conn:
        for name in ("[TEST] Obra nueva", "[TEST] Reconversión"):
            conn.execute("INSERT INTO budgets (name) VALUES (%s)", (name,))
        assert conn.execute(
            "SELECT count(*) AS n FROM budgets WHERE property_id IS NULL"
            " AND name LIKE '[TEST]%%'").fetchone()["n"] == 2


def test_catalog_item_is_provenance_not_dependency(obra):
    """Borrar la partida del catálogo apaga la procedencia y deja el renglón
    intacto: el presupuesto de una propiedad vendida no se puede mover editando
    un catálogo años después."""
    with get_db() as conn:
        conn.execute("DELETE FROM budget_items WHERE id = %s", (obra["item_id"],))
        row = conn.execute("SELECT name, unit, quantity, unit_price, item_id"
                           " FROM budget_lines WHERE id = %s", (obra["line_id"],)).fetchone()
    assert row["item_id"] is None
    assert (row["name"], row["unit"]) == ("[TEST] Piso cerámico", "m²")
    assert row["quantity"] * row["unit_price"] == Decimal("48000.000")


def test_a_chapter_with_items_is_deactivated_never_deleted(obra):
    """Baja lógica: apagar un capítulo libera su nombre para los vivos sin cortar
    la trazabilidad de lo que ya lo citaba."""
    with pytest.raises(IntegrityError):
        with get_db() as conn:
            conn.execute("DELETE FROM budget_chapters WHERE id = %s", (obra["chapter_id"],))
    with get_db() as conn:
        conn.execute("UPDATE budget_chapters SET is_active = FALSE WHERE id = %s",
                     (obra["chapter_id"],))
        reborn = conn.execute(
            "INSERT INTO budget_chapters (name) VALUES ('[TEST] acabados') RETURNING id"
        ).fetchone()["id"]
        assert reborn != obra["chapter_id"]


def test_closing_a_line_demands_the_real_quantity(obra):
    """Un cierre sin cantidad real no produce precio unitario, y un renglón
    cerrado que no enseña precio es un hueco en la historia, no un cierre."""
    with pytest.raises(IntegrityError):
        with get_db() as conn:
            conn.execute("UPDATE budget_lines SET closed_at = now() WHERE id = %s",
                         (obra["line_id"],))


def test_the_residual_has_no_trade(obra):
    """«Otros, por detallar» no es trabajo de ningún oficio: es lo que todavía no
    se reparte, y en cuanto se sepa de qué es deja de ser residuo y se vuelve una
    partida. El API ya rechaza toda escritura sobre el residuo que no sea una
    nota; el CHECK lo vuelve un hecho de la fila, como la 029 hizo con
    `is_residual` mismo."""
    with get_db() as conn:
        category_id = conn.execute(
            "INSERT INTO proveedor_categories (name) VALUES ('[TEST] Oficio') RETURNING id"
        ).fetchone()["id"]
        residual_id = conn.execute(
            "INSERT INTO budget_lines (budget_id, chapter_name, name, unit, quantity,"
            "                          unit_price, is_residual)"
            " VALUES (%s, 'Otros', 'Otros, por detallar', 'lote', 1, 0, TRUE) RETURNING id",
            (obra["budget_id"],)).fetchone()["id"]
    try:
        with pytest.raises(IntegrityError):
            with get_db() as conn:
                conn.execute("UPDATE budget_lines SET supplier_category_id = %s WHERE id = %s",
                             (category_id, residual_id))
        # Y la misma columna en una partida detallada sí entra: lo que el CHECK
        # rechaza es el residuo, no el oficio.
        with get_db() as conn:
            conn.execute("UPDATE budget_lines SET supplier_category_id = %s WHERE id = %s",
                         (category_id, obra["line_id"]))
    finally:
        with get_db() as conn:
            conn.execute("DELETE FROM budget_lines WHERE id = %s", (residual_id,))
            conn.execute("DELETE FROM proveedor_categories WHERE id = %s", (category_id,))


def _observations(line_id: int) -> list[dict]:
    with get_db() as conn:
        return conn.execute(
            "SELECT * FROM budget_price_observations WHERE line_id = %s", (line_id,)).fetchall()


def test_price_history_reads_only_closed_paid_lines_of_real_work(obra):
    """Los tres filtros de la vista, cada uno probado por lo que deja fuera: un
    renglón abierto (podría ser un anticipo), un cierre sin un peso pagado (no
    observó ningún precio) y una plantilla (es una intención, no historia)."""
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

    with get_db() as conn:
        template_line = conn.execute(
            "WITH t AS (INSERT INTO budgets (name) VALUES ('[TEST] Plantilla') RETURNING id)"
            " INSERT INTO budget_lines (budget_id, chapter_name, name, unit, quantity,"
            "                           unit_price, actual_quantity, closed_at)"
            " SELECT id, '[TEST] Acabados', '[TEST] Piso cerámico', 'm²', 10, 999, 10, now()"
            " FROM t RETURNING id").fetchone()["id"]
        conn.execute("INSERT INTO budget_line_payments (line_id, amount) VALUES (%s, 9990)",
                     (template_line,))
    assert _observations(template_line) == []    # plantilla: nunca es historia


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
