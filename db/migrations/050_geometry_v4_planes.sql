-- migrate:up

-- Múltiples planes de proyecto (diseño: docs/plans/2026-08-24-multiples-planes-
-- proyecto-design.md). Dos partes, misma transacción:
--
-- 1) `properties.geometry` v3 → v4: `variants.planned` deja de ser un slot fijo y
--    se vuelve el PRIMER elemento de `variants.plans[]`, con el id LITERAL
--    'planned' y el nombre por default. El id determinista es la decisión de
--    carga estructural de todo el diseño: los renders persistidos con
--    source_variant='planned' direccionan este plan SIN tocar una sola fila de
--    property_renders, y esta migración produce byte-lógicamente lo mismo que la
--    rama v3→v4 de migrateGeometry (types.ts) — un blob migrado en memoria y uno
--    migrado aquí terminan con el MISMO plan id, sin carrera de ids efímeros
--    (la clase de bug que la 048 tuvo que reparar en producción).
--
-- 2) El CHECK de source_variant (migración 040) se relaja: la columna deja de ser
--    el enum ('original'|'planned') y pasa a ser 'original' o el ID de un plan.
--    La validación de que el plan EXISTE es de las rutas (renders.py, contra el
--    geometry vivo), no de un CHECK que no puede mirar otra tabla. Los índices
--    únicos de is_chosen (046) quedan intactos: (property_id, floor_id,
--    source_variant) ya distingue planes cuando la variante es el plan id.
--
-- Un blob v3 cuyo planned miente (presente pero no es un FloorSet real) se queda
-- en v3 sin tocar — migrateGeometry lo rechaza entero al leer ("si miente en una
-- variante puede mentir en la otra"), y no hay nada honesto que escribir de
-- vuelta. v2/v1/basura tampoco se tocan: el migrador TS los resuelve al leer,
-- mismo criterio que la 048.
--
-- `properties.geometry` no es una columna fría: el editor la escribe en vivo.
-- Sin lock_timeout, un UPDATE que choca con un guardado real se queda esperando
-- EN SILENCIO hasta el activeDeadlineSeconds del migrate-job del deploy (el modo
-- de falla conocido del pipeline); con él, falla rápido y ruidoso y el Job
-- reintenta. Mismo razonamiento y mismo valor que la 048.
SET LOCAL lock_timeout = '5s';

UPDATE properties
SET geometry = jsonb_build_object(
  'schemaVersion', 4,
  'variants', jsonb_build_object(
    'original', geometry->'variants'->'original',
    'plans', CASE
      WHEN jsonb_typeof(geometry->'variants'->'planned') = 'object'
           AND jsonb_typeof(geometry->'variants'->'planned'->'floors') = 'array'
      THEN jsonb_build_array(jsonb_build_object(
        'id', 'planned',
        'name', 'Plan de proyecto',
        'fs', geometry->'variants'->'planned'))
      ELSE '[]'::jsonb
    END))
WHERE geometry->>'schemaVersion' = '3'
  AND jsonb_typeof(geometry->'variants'->'original') = 'object'
  AND jsonb_typeof(geometry->'variants'->'original'->'floors') = 'array'
  AND (NOT (geometry->'variants' ? 'planned')
       OR geometry->'variants'->'planned' = 'null'::jsonb
       OR (jsonb_typeof(geometry->'variants'->'planned') = 'object'
           AND jsonb_typeof(geometry->'variants'->'planned'->'floors') = 'array'));

-- El nombre viene autogenerado por Postgres para el CHECK inline de la 040
-- (<tabla>_<columna>_check) — confirmado contra db/schema.sql antes de escribir
-- esto. El reemplazo solo exige no-vacío: '' como variante sería una llave de
-- grupo indistinguible de "sin variante" en los índices de is_chosen.
ALTER TABLE property_renders
  DROP CONSTRAINT IF EXISTS property_renders_source_variant_check;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'property_renders_source_variant_no_vacio'
      AND conrelid = 'property_renders'::regclass
  ) THEN
    ALTER TABLE property_renders
      ADD CONSTRAINT property_renders_source_variant_no_vacio
      CHECK (source_variant IS NULL OR source_variant <> '');
  END IF;
END $$;

-- migrate:down

-- Sin down con efecto, a propósito: en cuanto exista un segundo plan (o un render
-- apuntando a un plan id que no sea 'planned'), colapsar plans[] de vuelta a un
-- solo slot planned destruiría datos, y re-apretar el CHECK del enum haría
-- inválidas filas reales. Mismo criterio que 047/048.
