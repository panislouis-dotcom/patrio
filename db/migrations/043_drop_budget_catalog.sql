-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- Se borra el catálogo de obra — decisión de producto, no limpieza técnica.
--
-- `budget_chapters` y `budget_items` (032, con `supplier_category_id` añadido
-- por la 035) tienen CERO renglones en producción. El presupuesto por
-- propiedad —`budgets` → `budget_lines` → `budget_line_payments`— nunca
-- dependió del catálogo para funcionar: `item_id` en `budget_lines` es
-- PROCEDENCIA, `ON DELETE SET NULL` desde que nació, nunca una dependencia.
-- Copiar de otra obra (`copy_lines`/`apply_budget`) sigue viviendo entero en
-- `budget_db.py` sin tocar ninguna de estas dos tablas.
--
-- Por diseño el catálogo no aporta nada hasta la tercera obra cerrada
-- (`budget_price_observations`, migración 032) — no hay historia real que
-- perder. Si algún día vuelve a hacer falta, se construye informado por uso
-- real, no se resucita esta versión sin haber tenido ni un dato.
-- ─────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '5s';        -- ArgoCD PreSync corta a los 180s; no esperamos locks
SET statement_timeout = '150s'; -- dbmate envuelve el archivo en UNA transacción

-- `budget_price_observations` (032) SELECCIONA `l.item_id` — la vista de
-- historia de precios sigue viva, no es catálogo, y por eso no se toca su
-- propósito ni su filtro. Pero una columna que una vista lee no se puede
-- soltar sin quitar antes esa lectura: se recrea idéntica, menos esa columna.
DROP VIEW budget_price_observations;

-- La columna se quita ANTES que las tablas: `budget_lines.item_id` tiene una
-- FK hacia `budget_items`, y `DROP TABLE budget_items` sin haberla quitado
-- antes falla con «other objects depend on it» — la constraint de
-- `budget_lines` es uno de esos objetos. Quitando la columna aquí, los dos
-- DROP de abajo ya no tienen nada que los detenga.
ALTER TABLE budget_lines DROP COLUMN item_id;

-- `budget_items` antes que `budget_chapters`: la partida referencia al
-- capítulo (`chapter_id`), nunca al revés.
DROP TABLE budget_items;
DROP TABLE budget_chapters;

CREATE VIEW budget_price_observations AS
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

-- migrate:down

-- Simétrico y vacío — el catálogo no llevaba una sola fila real, así que no
-- hay nada que preservar. Recrea el esquema tal como quedó tras la 035
-- (mismas columnas, mismos índices, mismos triggers) para que un `dbmate
-- down` no truene, no para que alguien vuelva a poblarlo.

-- Misma razón que en el `up`, al revés: la vista se recreó sin `item_id`
-- porque la columna no existía; hay que quitarla de en medio antes de poder
-- devolverle la columna a `budget_lines`.
DROP VIEW budget_price_observations;

CREATE TABLE budget_chapters (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL CHECK (name <> ''),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  supplier_category_id BIGINT REFERENCES proveedor_categories(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_budget_chapters_name
  ON budget_chapters (lower(name)) WHERE is_active;

CREATE TABLE budget_items (
  id          BIGSERIAL PRIMARY KEY,
  chapter_id  BIGINT NOT NULL REFERENCES budget_chapters(id),
  name        TEXT NOT NULL CHECK (name <> ''),
  unit        TEXT NOT NULL CHECK (unit <> ''),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  supplier_category_id BIGINT REFERENCES proveedor_categories(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_budget_items_name
  ON budget_items (chapter_id, lower(name)) WHERE is_active;
CREATE INDEX idx_budget_items_chapter ON budget_items (chapter_id, sort_order);

CREATE TRIGGER trg_budget_chapters_touch BEFORE UPDATE ON budget_chapters
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_budget_items_touch BEFORE UPDATE ON budget_items
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE budget_lines
  ADD COLUMN item_id BIGINT REFERENCES budget_items(id) ON DELETE SET NULL;

CREATE INDEX idx_budget_lines_item ON budget_lines (item_id) WHERE item_id IS NOT NULL;

-- La vista tal como la dejó la 032, `item_id` incluido.
CREATE VIEW budget_price_observations AS
SELECT l.id                                  AS line_id,
       b.property_id,
       l.item_id,
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
