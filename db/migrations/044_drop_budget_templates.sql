-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- Se retiran las plantillas de presupuesto — decisión de producto, la misma que
-- retiró el catálogo en la 043. Copiar de otra obra se queda como el único
-- punto de partida que no es captura manual.
--
-- El único valor de una plantilla sobre «copiar de otra obra» es estar CURADA, y
-- eso exige que alguien la mantenga; la obra parecida más reciente, en cambio,
-- siempre está más actualizada sin que nadie haga nada. Y el estado actual era
-- una trampa: se podían crear plantillas pero ya no renombrarlas ni borrarlas
-- —esos endpoints se quedaron sin cliente— así que solo se acumulaban.
--
-- NO HAY TABLA QUE TIRAR. Una plantilla nunca fue una entidad: era una fila de
-- `budgets` con `property_id IS NULL` (032). Por eso esto es un borrado de filas
-- más una limpieza de columnas, y por eso lo que queda al final es la invariante
-- que la aplicación siempre supuso y la base nunca exigió:
--
--     TODO PRESUPUESTO PERTENECE A UNA OBRA, Y CADA OBRA TIENE UNO SOLO.
--
-- Las dos mitades pasan de convención a garantía: la primera con el NOT NULL, la
-- segunda porque el índice único deja de ser parcial y empieza a cubrir la tabla
-- entera.
-- ─────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '5s';        -- ArgoCD PreSync corta a los 180s; no esperamos locks
SET statement_timeout = '150s'; -- dbmate envuelve el archivo en UNA transacción

-- Las filas de plantilla se van con sus renglones: `budget_lines.budget_id`
-- lleva `ON DELETE CASCADE` desde la 032, así que este DELETE es el único que
-- hace falta. Sus pagos —si alguno tuviera, que no debería: una plantilla es un
-- plan, no la ejecución de nadie— caen por la misma cadena.
--
-- Va ANTES del NOT NULL por necesidad: la columna no puede volverse obligatoria
-- mientras haya una sola fila que la tenga vacía.
DELETE FROM budgets WHERE property_id IS NULL;

-- El CHECK existía para que una plantilla no naciera sin nombre —era lo único
-- que la distinguía de las demás—. Sin plantillas su primera rama es siempre
-- verdadera, y una condición que ya no puede fallar es ruido que se lee como si
-- vigilara algo.
ALTER TABLE budgets DROP CONSTRAINT budgets_template_needs_name;

-- `name` y `notes` existían SOLO para las plantillas: el propio comentario de la
-- 032 lo dice —«un presupuesto de obra hereda el de su propiedad y no necesita
-- otro que pueda contradecirlo»— y `notes` no la leía nadie más que el listado y
-- la edición de plantillas. Dejarlas vacías para siempre sería dejar dos lugares
-- donde alguien podría volver a nombrar un presupuesto aparte de su obra.
--
-- `uq_budgets_template_name` (sobre `lower(name)`) se va sola con la columna: un
-- índice no sobrevive a la columna que indexa. Se dice aquí para que no parezca
-- un olvido.
ALTER TABLE budgets DROP COLUMN name;
ALTER TABLE budgets DROP COLUMN notes;

ALTER TABLE budgets ALTER COLUMN property_id SET NOT NULL;

-- El índice único ya garantizaba «una obra, un presupuesto», pero solo
-- `WHERE property_id IS NOT NULL` — el hueco era exactamente el de las
-- plantillas, que podían ser muchas. Con la columna obligatoria ese predicado ya
-- no discrimina nada, y un índice parcial cuya condición siempre se cumple
-- afirma que existe un caso que ya no existe. Se recrea completo, con el mismo
-- nombre: no cambia qué se rechaza, cambia que el esquema deje de insinuar un
-- presupuesto huérfano.
DROP INDEX uq_budgets_property;
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_property ON budgets (property_id);

-- La vista de historia de precios filtraba `b.property_id IS NOT NULL` para
-- dejar fuera las plantillas: una intención no es una observación, y contarla
-- haría que la historia aprendiera de sí misma. La razón se acabó junto con las
-- plantillas y el filtro pasó a ser siempre verdadero. `CREATE OR REPLACE`
-- porque las columnas y sus tipos no cambian —solo se va el WHERE que ya no
-- discrimina— y así la vista no tiene que soltarse ni volverse a otorgar.
CREATE OR REPLACE VIEW budget_price_observations AS
SELECT l.id                                  AS line_id,
       b.property_id,
       l.chapter_name,
       l.name,
       l.unit,
       l.supplier_id,
       l.closed_at,
       l.quantity                            AS budgeted_quantity,
       l.actual_quantity,
       l.quantity * l.unit_price             AS budgeted_amount,
       pagos.paid_amount,
       l.unit_price                          AS budgeted_unit_price,
       round(pagos.paid_amount / l.actual_quantity, 2) AS actual_unit_price
  FROM budget_lines l
  JOIN budgets b ON b.id = l.budget_id
  JOIN LATERAL (
        SELECT coalesce(sum(p.amount), 0) AS paid_amount
          FROM budget_line_payments p
         WHERE p.line_id = l.id
       ) pagos ON TRUE
 WHERE l.closed_at IS NOT NULL
   AND pagos.paid_amount > 0;

COMMENT ON VIEW budget_price_observations IS
    'Historia de precios: un renglón CERRADO con lo que se pagó por unidad y lo que se había presupuestado. Los renglones abiertos y los cierres sin un peso pagado quedan fuera — cada uno envenena la mediana en silencio, el primero contando anticipos como precios finales y el segundo metiendo ceros.';

-- migrate:down

-- Devuelve el ESQUEMA, no los datos: las plantillas que este `up` borró no se
-- pueden recrear —eran filas capturadas a mano y nada más las guarda—. Un
-- `down` que dijera lo contrario en silencio sería peor que uno incompleto, así
-- que queda dicho aquí: revertir deja la tabla capaz de volver a alojar
-- plantillas, vacía de las que hubiera.

DROP INDEX uq_budgets_property;
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_property ON budgets (property_id) WHERE property_id IS NOT NULL;

ALTER TABLE budgets ALTER COLUMN property_id DROP NOT NULL;

ALTER TABLE budgets ADD COLUMN name  TEXT NOT NULL DEFAULT '';
ALTER TABLE budgets ADD COLUMN notes TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_template_name
  ON budgets (lower(name)) WHERE property_id IS NULL;

ALTER TABLE budgets ADD CONSTRAINT budgets_template_needs_name
  CHECK (property_id IS NOT NULL OR name <> '');

CREATE OR REPLACE VIEW budget_price_observations AS
SELECT l.id                                  AS line_id,
       b.property_id,
       l.chapter_name,
       l.name,
       l.unit,
       l.supplier_id,
       l.closed_at,
       l.quantity                            AS budgeted_quantity,
       l.actual_quantity,
       l.quantity * l.unit_price             AS budgeted_amount,
       pagos.paid_amount,
       l.unit_price                          AS budgeted_unit_price,
       round(pagos.paid_amount / l.actual_quantity, 2) AS actual_unit_price
  FROM budget_lines l
  JOIN budgets b ON b.id = l.budget_id
  JOIN LATERAL (
        SELECT coalesce(sum(p.amount), 0) AS paid_amount
          FROM budget_line_payments p
         WHERE p.line_id = l.id
       ) pagos ON TRUE
 WHERE l.closed_at IS NOT NULL
   AND b.property_id IS NOT NULL
   AND pagos.paid_amount > 0;

COMMENT ON VIEW budget_price_observations IS
    'Historia de precios: un renglón CERRADO de una obra real, con lo que se pagó por unidad y lo que se había presupuestado. Los renglones abiertos, las plantillas y los cierres sin pago quedan fuera — cada uno de los tres envenena la mediana en silencio.';
