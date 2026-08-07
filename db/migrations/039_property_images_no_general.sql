-- migrate:up
SET lock_timeout = '5s';
SET statement_timeout = '150s';

-- El backfill va ANTES del cambio de CHECK: si se invierte el orden, toda fila
-- 'general' que sobreviva al ALTER queda violando la restricción nueva.
UPDATE property_images SET image_type = 'antes' WHERE image_type = 'general';

ALTER TABLE property_images
  DROP CONSTRAINT IF EXISTS property_images_image_type_check;
ALTER TABLE property_images
  ADD CONSTRAINT property_images_image_type_check CHECK (image_type IN ('antes', 'despues'));
ALTER TABLE property_images
  ALTER COLUMN image_type SET DEFAULT 'antes';

-- migrate:down
-- Solo se revierte el esquema — las filas movidas de 'general' a 'antes' se
-- quedan en 'antes' (mismo criterio que 026: un down no viaja en el tiempo
-- sobre los datos).
ALTER TABLE property_images ALTER COLUMN image_type SET DEFAULT 'general';
ALTER TABLE property_images DROP CONSTRAINT IF EXISTS property_images_image_type_check;
ALTER TABLE property_images
  ADD CONSTRAINT property_images_image_type_check CHECK (image_type IN ('general', 'antes', 'despues'));
