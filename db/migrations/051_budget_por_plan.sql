-- migrate:up

-- Presupuesto-escenario por plan de proyecto (addendum del diseño 2026-08-24).
--
-- `plan_id` NULL = EL presupuesto de la propiedad — la única respuesta viva que
-- alimenta totalInvestment/ROI, sin cambio alguno. Con valor = el escenario de
-- ese plan ("¿cuánto costaría esta propuesta?"), que jamás entra a las
-- finanzas: toda query financiera filtra plan_id IS NULL (budget_db.py). Es un
-- id CONGELADO del plan (vive en el jsonb de geometry, sin FK) — mismo patrón
-- que property_renders.source_variant desde la 050.
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS plan_id TEXT
  CHECK (plan_id IS NULL OR plan_id <> '');

-- El único-por-propiedad se parte en dos: sigue habiendo UN presupuesto de
-- propiedad, y a lo más UN escenario por (propiedad, plan).
DROP INDEX IF EXISTS uq_budgets_property;
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_property
  ON budgets (property_id) WHERE plan_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_property_plan
  ON budgets (property_id, plan_id) WHERE plan_id IS NOT NULL;

-- Las observaciones de precio salen SOLO del presupuesto real de cada
-- propiedad: un escenario NACE copiado del de la propiedad (copy_lines), así
-- que incluirlo duplicaría cada observación; y sus renglones son estimaciones
-- de una propuesta, no obra ejecutada.
CREATE OR REPLACE VIEW budget_price_observations AS
 SELECT l.id AS line_id,
    b.property_id,
    l.chapter_name,
    l.name,
    l.unit,
    l.supplier_id,
    l.closed_at,
    l.quantity AS budgeted_quantity,
    l.actual_quantity,
    (l.quantity * l.unit_price) AS budgeted_amount,
    pagos.paid_amount,
    l.unit_price AS budgeted_unit_price,
    round((pagos.paid_amount / l.actual_quantity), 2) AS actual_unit_price
   FROM budget_lines l
     JOIN budgets b ON b.id = l.budget_id
     JOIN LATERAL ( SELECT COALESCE(sum(p.amount), 0::numeric) AS paid_amount
           FROM budget_line_payments p
          WHERE p.line_id = l.id) pagos ON true
  WHERE l.closed_at IS NOT NULL
    AND pagos.paid_amount > 0::numeric
    AND b.plan_id IS NULL;

-- migrate:down

-- Sin down con efecto, a propósito: tirar la columna destruiría escenarios
-- reales, y restaurar el índice único original fallaría en cuanto exista un
-- solo presupuesto de plan. Mismo criterio que 047/048/050.
