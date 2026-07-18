-- migrate:up
ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS temperatura TEXT CHECK (temperatura IN ('caliente', 'tibio', 'frio')),
  ADD COLUMN IF NOT EXISTS capacidad   TEXT CHECK (capacidad   IN ('<500k', '500k-2M', '2M-5M', '5M+')),
  ADD COLUMN IF NOT EXISTS fuente      TEXT CHECK (fuente      IN ('red_personal', 'referido', 'red_negocios', 'linkedin', 'otro')),
  ADD COLUMN IF NOT EXISTS confianza   TEXT CHECK (confianza   IN ('bajo', 'medio', 'alto'));

-- migrate:down
ALTER TABLE investors
  DROP COLUMN IF EXISTS temperatura,
  DROP COLUMN IF EXISTS capacidad,
  DROP COLUMN IF EXISTS fuente,
  DROP COLUMN IF EXISTS confianza;
