-- migrate:up

-- Un render nace de una foto (source_variant NULL: vive con FOTOS) o de un
-- levantamiento ('original' | 'planned': vive con su levantamiento).
ALTER TABLE property_renders ADD COLUMN IF NOT EXISTS source_variant TEXT
  CHECK (source_variant IN ('original', 'planned'));

-- Backfill: todo render-desde-plano existente nació del único plano que
-- había, que ahora es el levantamiento original. Las cadenas de edición
-- heredan la variante de su raíz (mismo patrón de caminata que
-- `chain_is_plan` en renders_db.py, pero en un solo UPDATE en vez de un
-- WITH RECURSIVE por fila).
WITH RECURSIVE chain AS (
  SELECT id, id AS root FROM property_renders WHERE parent_render_id IS NULL
  UNION ALL
  SELECT r.id, c.root FROM property_renders r JOIN chain c ON r.parent_render_id = c.id
)
UPDATE property_renders pr SET source_variant = 'original'
FROM chain c
JOIN property_renders root ON root.id = c.root
WHERE pr.id = c.id AND root.source_plan_path IS NOT NULL;

-- migrate:down

ALTER TABLE property_renders DROP COLUMN IF EXISTS source_variant;
