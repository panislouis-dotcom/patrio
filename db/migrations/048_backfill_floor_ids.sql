-- migrate:up

-- Un piso guardado antes de que `FloorGraph.id` existiera nunca tiene ese campo
-- persistido. `migrateGeometry` (app/web/src/lib/floorplan/types.ts:212-262) lo
-- rellena en MEMORIA con `crypto.randomUUID()` cada vez que el blob se lee — nunca
-- lo escribe de vuelta a menos que alguien guarde el plano. Un render se etiqueta
-- al generarse con el id efímero de ESA carga (routes/renders.py, floor_id); en la
-- siguiente carga migrateGeometry le asigna un id NUEVO al mismo piso, y el render
-- —que sigue intacto en la base— deja de encontrar su piso y desaparece de la
-- vista (RendersPanel.tsx:200). Reportado en prod contra "Vicente Guerrero":
-- generar un render se veía de inmediato y desaparecía al recargar, dos veces.
--
-- Dos partes, en la MISMA transacción — la segunda lee la geometría YA reparada
-- por la primera:
--
-- 1) Repara `properties.geometry`: mismo v2→v3 + backfill de id por piso que
--    migrateGeometry, traducido a SQL. Dos funciones SQL escritas para esta
--    migración y borradas al final — no dejan rastro en el schema, existen solo
--    dentro de esta transacción.
--
-- 2) Repara `property_renders.floor_id`: backfillear la geometría le da a cada
--    piso un id REAL pero nuevo, que no tiene ninguna relación con el id efímero
--    que ya quedó congelado en un render existente — arreglar solo la geometría
--    no reconecta un render ya huérfano. `floor_name` es el nombre del piso
--    CONGELADO al generar (migración 042, "sobrevive a que el piso se renombre o
--    se borre") — es la única liga que sobrevive al id efímero. Un render se
--    re-liga a su piso por nombre, dentro de la MISMA propiedad y variante, y
--    SOLO si hay un único piso con ese nombre — un nombre duplicado es
--    ambigüedad real, no una adivinanza que valga la pena arriesgar.

CREATE OR REPLACE FUNCTION pg_temp._backfill_floor_set(fs jsonb) RETURNS jsonb AS $$
  SELECT jsonb_set(fs, '{floors}', COALESCE((
    SELECT jsonb_agg(
      CASE WHEN coalesce(floor->>'id', '') <> '' THEN floor
           ELSE jsonb_set(floor, '{id}', to_jsonb(gen_random_uuid()::text)) END
      ORDER BY ord)
    FROM jsonb_array_elements(fs->'floors') WITH ORDINALITY AS t(floor, ord)
  ), '[]'::jsonb))
$$ LANGUAGE sql;

-- NULL = blob ilegible (migrateGeometry lo habría rechazado): schemaVersion 1 del
-- editor viejo, `{}`, basura, o un v3 cuyo `planned` miente (presente pero no es
-- un FloorSet real — "si miente en una variante puede mentir en la otra",
-- types.ts:245). Nada que reparar ahí, y nada que se pueda escribir de vuelta sin
-- inventar geometría.
CREATE OR REPLACE FUNCTION pg_temp._migrate_geometry(raw jsonb) RETURNS jsonb AS $$
  SELECT CASE
    WHEN raw->>'schemaVersion' = '3'
         AND jsonb_typeof(raw->'variants'->'original') = 'object'
         AND jsonb_typeof(raw->'variants'->'original'->'floors') = 'array'
         AND (
           NOT (raw->'variants' ? 'planned')
           OR raw->'variants'->'planned' = 'null'::jsonb
           OR (jsonb_typeof(raw->'variants'->'planned') = 'object'
               AND jsonb_typeof(raw->'variants'->'planned'->'floors') = 'array')
         )
    THEN jsonb_build_object(
      'schemaVersion', 3,
      'variants', jsonb_build_object(
        'original', pg_temp._backfill_floor_set(raw->'variants'->'original'),
        'planned', CASE
          WHEN jsonb_typeof(raw->'variants'->'planned') = 'object'
               AND jsonb_typeof(raw->'variants'->'planned'->'floors') = 'array'
          THEN pg_temp._backfill_floor_set(raw->'variants'->'planned')
          ELSE 'null'::jsonb
        END
      )
    )
    WHEN raw->>'schemaVersion' = '2' AND jsonb_typeof(raw->'floors') = 'array'
    THEN jsonb_build_object(
      'schemaVersion', 3,
      'variants', jsonb_build_object(
        'original', pg_temp._backfill_floor_set(jsonb_build_object(
          'slab_m', raw->'slab_m', 'activeFloor', raw->'activeFloor', 'floors', raw->'floors')),
        'planned', 'null'::jsonb
      )
    )
    ELSE NULL
  END
$$ LANGUAGE sql;

UPDATE properties
SET geometry = pg_temp._migrate_geometry(geometry)
WHERE geometry IS NOT NULL
  AND geometry <> '{}'::jsonb
  AND pg_temp._migrate_geometry(geometry) IS NOT NULL
  AND pg_temp._migrate_geometry(geometry) IS DISTINCT FROM geometry;

-- Nota de sintaxis: el candidato NO se arma con `FROM properties p, LATERAL (...)`
-- al nivel del UPDATE — un LATERAL ahí no puede ver `pr`, solo los FROM-items que
-- lo preceden en esa misma lista (Postgres lo rechaza: "invalid reference to
-- FROM-clause entry for table pr"). Envuelto en una subconsulta correlacionada
-- (en SET y en el NOT EXISTS) sí puede: ahí `pr` es una referencia externa normal,
-- no un FROM-item hermano, y esa restricción no aplica.
-- COALESCE al valor actual, no a NULL: una subconsulta escalar sin fila (0 o 2+
-- coincidencias de nombre) evalúa a NULL en Postgres, y un SET directo a eso
-- BORRARÍA floor_id en vez de dejarlo tal cual — justo el caso "nombre duplicado,
-- no toques nada" que esto tiene que proteger.
UPDATE property_renders pr
SET floor_id = COALESCE((
  SELECT ids[1] FROM (
    SELECT array_agg(f->>'id') AS ids
    FROM properties p
    CROSS JOIN LATERAL jsonb_array_elements(p.geometry->'variants'->pr.source_variant->'floors') AS f
    WHERE p.id = pr.property_id AND f->>'name' = pr.floor_name
  ) matches
  WHERE array_length(ids, 1) = 1
), pr.floor_id)
WHERE pr.source_variant IN ('original', 'planned')
  AND coalesce(pr.floor_id, '') <> ''
  AND coalesce(pr.floor_name, '') <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM properties p2
    CROSS JOIN LATERAL jsonb_array_elements(p2.geometry->'variants'->pr.source_variant->'floors') AS f2
    WHERE p2.id = pr.property_id AND f2->>'id' = pr.floor_id
  );

DROP FUNCTION pg_temp._migrate_geometry(jsonb);
DROP FUNCTION pg_temp._backfill_floor_set(jsonb);

-- migrate:down

-- Sin down con efecto, a propósito: después del hecho no hay forma de distinguir
-- un id backfilleado de uno que ya era real, ni un floor_id re-ligado de uno que
-- ya apuntaba bien — deshacer solo podría reintroducir el bug que esta migración
-- repara. Mismo criterio que 047.
