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
-- Tres partes, en la MISMA transacción — cada una lee lo que la anterior ya
-- reparó:
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
--
-- 3) Deshace colisiones de `is_chosen` que el paso 2 está a punto de DESTAPAR
--    (no crear): dos renders de la MISMA propiedad y variante, cada uno con su
--    propio id efímero DISTINTO, pueden llevar años ambos con is_chosen=true
--    sin que el índice único de la migración 046 (idx_render_chosen_per_floor)
--    lo note — ids efímeros distintos son, para ese índice, pisos distintos.
--    En cuanto el paso 2 los re-liga al MISMO piso real, esos dos renders
--    quedarían compitiendo por el mismo (property_id, floor_id, source_variant)
--    — y como el índice es NO diferible, truena EN LA MISMA fila del UPDATE del
--    paso 2, a mitad de la migración (visto en prod, propiedad 10: dos renders
--    "Levantamiento" ambos elegidos bajo ids efímeros distintos). Por eso este
--    paso corre ANTES del 2, no después: calcula el mismo destino que el paso 2
--    calculará (misma función, `pg_temp._final_floor_id`, para que no puedan
--    divergir) y desmarca la colisión antes de que el UPDATE del paso 2 llegue
--    a chocar contra el índice.
--
--    Ninguna de las dos filas es más correcta que la otra — no hay forma honesta
--    de adivinar cuál quería el usuario. Se desmarcan LAS DOS (no solo n-1): el
--    documento no adivina (mismo criterio que _plan_rows en prospectus_html.py),
--    y volver a elegir es un solo clic en la UI.
--
-- `properties.geometry` no es una columna fría: el editor de plano la escribe en
-- vivo cada vez que alguien guarda (mismo comentario de arriba). Sin lock_timeout,
-- un UPDATE de esta migración que choca con un guardado real en curso se queda
-- esperando el lock EN SILENCIO hasta el activeDeadlineSeconds del Job de deploy
-- (edg-infra/k8s/apps/refigan/templates/migrate-job.yaml) — y como ese Job es un
-- hook PreSync, el deploy entero se congela sin ningún error legible. Con
-- lock_timeout, la misma colisión falla rápido y ruidoso (55P03), reintenta con
-- el backoffLimit del Job en vez de agotar el presupuesto completo en un solo
-- intento colgado. 5s alcanza de sobra para un guardado normal (los otros
-- statements de esta transacción corren en milisegundos, medido contra datos
-- reales) sin acercarse al límite del Job.
SET LOCAL lock_timeout = '5s';

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

-- El id al que un render TERMINARÁ apuntando tras el paso de repointing de más
-- abajo — misma lógica exacta que ese UPDATE, factorizada para que el paso 3
-- (colisiones) calcule el mismo destino sin poder divergir. Si ya apunta a un
-- piso real, ese es su destino (el repointing no lo toca). Si no, y hay
-- exactamente un piso con ese nombre en esa propiedad+variante, ese es su
-- destino. Cualquier otro caso (0 o 2+ coincidencias de nombre) es NULL — nada
-- que competir, el repointing tampoco lo va a tocar.
-- Nota de sintaxis: el candidato NO se arma con `FROM properties p, LATERAL (...)`
-- al nivel del UPDATE que usa esto — un LATERAL ahí no puede ver la fila externa,
-- solo los FROM-items que lo preceden en esa misma lista (Postgres lo rechaza:
-- "invalid reference to FROM-clause entry for table pr"). Envuelto en una
-- función (o una subconsulta correlacionada) sí puede.
-- El 4º parámetro se llama `floor_name`, no `name` a secas: `properties` TIENE
-- una columna `name` (el nombre de la propiedad) en scope por el `FROM
-- properties p` de abajo — un parámetro `name` ahí queda SOMBREADO por esa
-- columna sin ningún error ni warning, y `f->>'name' = name` termina
-- comparando el nombre del PISO contra el nombre de la PROPIEDAD (nunca
-- coinciden, la función siempre regresa NULL). Costó una ronda entera de
-- debugging encontrarlo — no lo vuelvas a nombrar `name`.
CREATE OR REPLACE FUNCTION pg_temp._final_floor_id(pid bigint, variant text, current_id text, floor_name text)
RETURNS text AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM properties p
      CROSS JOIN LATERAL jsonb_array_elements(p.geometry->'variants'->variant->'floors') AS f
      WHERE p.id = pid AND f->>'id' = current_id
    ) THEN current_id
    ELSE (
      SELECT ids[1] FROM (
        SELECT array_agg(f->>'id') AS ids
        FROM properties p
        CROSS JOIN LATERAL jsonb_array_elements(p.geometry->'variants'->variant->'floors') AS f
        WHERE p.id = pid AND f->>'name' = floor_name
      ) matches
      WHERE array_length(ids, 1) = 1
    )
  END
$$ LANGUAGE sql;

-- Mismo (property_id, floor_id, source_variant) que protege
-- idx_render_chosen_per_floor — IS NOT DISTINCT FROM en source_variant por
-- higiene (NULL no debería llegar aquí junto a un floor_id no vacío, pero un
-- NULL real rompería la igualdad normal y dejaría pasar una colisión). Corre
-- ANTES del repointing (ver el comentario de cabecera, parte 3): el índice no
-- es diferible, así que la colisión hay que desarmarla antes de que el UPDATE
-- de abajo la escriba, no después.
UPDATE property_renders pr
SET is_chosen = false
WHERE pr.is_chosen
  AND pr.source_variant IN ('original', 'planned')
  AND coalesce(pr.floor_name, '') <> ''
  AND pg_temp._final_floor_id(pr.property_id, pr.source_variant, pr.floor_id, pr.floor_name) IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM property_renders dup
    WHERE dup.is_chosen
      AND dup.id <> pr.id
      AND dup.property_id = pr.property_id
      AND dup.source_variant IS NOT DISTINCT FROM pr.source_variant
      AND coalesce(dup.floor_name, '') <> ''
      AND pg_temp._final_floor_id(dup.property_id, dup.source_variant, dup.floor_id, dup.floor_name)
          = pg_temp._final_floor_id(pr.property_id, pr.source_variant, pr.floor_id, pr.floor_name)
  );

-- COALESCE al valor actual, no a NULL: `_final_floor_id` regresa NULL cuando no
-- hay un destino único (0 o 2+ coincidencias de nombre) — un SET directo a eso
-- BORRARÍA floor_id en vez de dejarlo tal cual, justo el caso "nombre
-- duplicado, no toques nada" que esto tiene que proteger.
UPDATE property_renders pr
SET floor_id = COALESCE(
  pg_temp._final_floor_id(pr.property_id, pr.source_variant, pr.floor_id, pr.floor_name),
  pr.floor_id)
WHERE pr.source_variant IN ('original', 'planned')
  AND coalesce(pr.floor_id, '') <> ''
  AND coalesce(pr.floor_name, '') <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM properties p2
    CROSS JOIN LATERAL jsonb_array_elements(p2.geometry->'variants'->pr.source_variant->'floors') AS f2
    WHERE p2.id = pr.property_id AND f2->>'id' = pr.floor_id
  );

DROP FUNCTION pg_temp._final_floor_id(bigint, text, text, text);
DROP FUNCTION pg_temp._migrate_geometry(jsonb);
DROP FUNCTION pg_temp._backfill_floor_set(jsonb);

-- migrate:down

-- Sin down con efecto, a propósito: después del hecho no hay forma de distinguir
-- un id backfilleado de uno que ya era real, ni un floor_id re-ligado de uno que
-- ya apuntaba bien — deshacer solo podría reintroducir el bug que esta migración
-- repara. Mismo criterio que 047.
