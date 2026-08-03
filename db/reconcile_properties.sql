-- ─────────────────────────────────────────────────────────────────────────────
-- Reconciliación de la migración 024 (Prospectos + Proyectos → Propiedades)
--
-- El mismo archivo corre ANTES y DESPUÉS: detecta si la migración ya pasó
-- (¿existe `properties`? ¿se llaman las viejas `*_legacy`?) y ajusta de qué
-- tablas lee. Se corre dos veces y se comparan las salidas:
--
--   PRE  (antes del deploy, sobre el dump de prod o sobre la BD viva):
--     docker exec -i patrio-db-1 psql -U postgres -d patrio -f - < db/reconcile_properties.sql
--   POST (después de aplicar 024, mismo comando):
--     docker exec -i patrio-db-1 psql -U postgres -d patrio -f - < db/reconcile_properties.sql
--
--   En el cluster:
--     kubectl exec -it <pod-cnpg> -- psql -U postgres -d patrio < db/reconcile_properties.sql
--
-- La SECCIÓN A (esperado) da el mismo resultado en ambas corridas: sale de las
-- tablas legacy, que 024 renombra pero no toca. La SECCIÓN C solo existe
-- después e incluye el veredicto PASA/DIFIERE de cada invariante.
-- ─────────────────────────────────────────────────────────────────────────────

\pset pager off
\set ON_ERROR_STOP on

SELECT
  CASE WHEN to_regclass('public.prospects_legacy')       IS NOT NULL THEN 'prospects_legacy'       ELSE 'prospects'       END AS src_prospects,
  CASE WHEN to_regclass('public.projects_legacy')        IS NOT NULL THEN 'projects_legacy'        ELSE 'projects'        END AS src_projects,
  CASE WHEN to_regclass('public.prospect_images_legacy') IS NOT NULL THEN 'prospect_images_legacy' ELSE 'prospect_images' END AS src_prospect_images,
  CASE WHEN to_regclass('public.project_images_legacy')  IS NOT NULL THEN 'project_images_legacy'  ELSE 'project_images'  END AS src_project_images,
  CASE WHEN to_regclass('public.properties')             IS NOT NULL THEN 'yes'                    ELSE 'no'              END AS migrated
\gset

\echo ''
\echo '════════════════════════════════════════════════════════════════════'
\echo ' RECONCILIACIÓN 024 · fuente legacy:' :src_prospects '+' :src_projects
\echo ' ¿migración aplicada?:' :migrated
\echo '════════════════════════════════════════════════════════════════════'

-- ── SECCIÓN A · ESPERADO (CTE canónica: espejo del backfill de la migración) ─
\echo ''
\echo '── A1. Propiedades esperadas por status ─────────────────────────────'

WITH expected AS (
    -- cada proyecto es una propiedad (fusionada con su prospecto si lo tiene)
    SELECT CASE j.status
               WHEN 'construction' THEN 'desarrollo'
               WHEN 'en_proceso'   THEN 'desarrollo'
               WHEN 'stabilizing'  THEN 'desarrollo'
               WHEN 'operating'    THEN 'en_renta'
               WHEN 'exited'       THEN 'vendida'
               ELSE '¡FUERA DE VOCABULARIO: ' || j.status || '!'
           END AS status
      FROM :src_projects j
    UNION ALL
    -- cada prospecto sin proyecto es una propiedad pre-compra
    SELECT CASE s.status
               WHEN 'evaluating' THEN 'prospecto'
               WHEN 'passed'     THEN 'oferta'
               ELSE '¡FUERA DE VOCABULARIO: ' || s.status || '!'
           END
      FROM :src_prospects s
     WHERE NOT EXISTS (SELECT 1 FROM :src_projects j WHERE j.prospect_id = s.id)
)
SELECT status AS status_esperado, count(*) AS filas
  FROM expected GROUP BY status ORDER BY status;

\echo ''
\echo '── A2. Totales esperados ────────────────────────────────────────────'

SELECT
    (SELECT count(*) FROM :src_prospects)                          AS prospectos_legacy,
    (SELECT count(*) FROM :src_projects)                           AS proyectos_legacy,
    (SELECT count(*) FROM :src_projects WHERE prospect_id IS NOT NULL) AS pares_a_fusionar,
    (SELECT count(*) FROM :src_prospects) + (SELECT count(*) FROM :src_projects)
      - (SELECT count(*) FROM :src_projects WHERE prospect_id IS NOT NULL) AS propiedades_esperadas,
    (SELECT count(*) FROM :src_prospect_images) + (SELECT count(*) FROM :src_project_images) AS imagenes_esperadas,
    (SELECT coalesce(sum(total_investment),  0) FROM :src_projects) AS inversion_esperada,
    (SELECT coalesce(sum(current_valuation), 0) FROM :src_projects) AS valuacion_esperada;

-- ── SECCIÓN B · ENLACES DE SATÉLITES ────────────────────────────────────────
\echo ''
\echo '── B. Satélites: filas totales vs filas con propiedad ligada ────────'

\if :migrated
SELECT 'analysis_snapshots'  AS tabla, count(*) AS filas, count(property_id) AS ligadas FROM analysis_snapshots
UNION ALL SELECT 'signals',             count(*), count(property_id) FROM signals
UNION ALL SELECT 'process_instances',   count(*), count(property_id) FROM process_instances
UNION ALL SELECT 'profit_split_config', count(*), count(property_id) FROM profit_split_config
UNION ALL SELECT 'property_investors',  count(*), count(property_id) FROM property_investors
ORDER BY tabla;
\else
SELECT 'analysis_snapshots'  AS tabla, count(*) AS filas, count(prospect_id) AS ligadas FROM analysis_snapshots
UNION ALL SELECT 'signals',             count(*), count(prospect_id) FROM signals
UNION ALL SELECT 'process_instances',   count(*), count(project_id)  FROM process_instances
UNION ALL SELECT 'profit_split_config', count(*), count(project_id)  FROM profit_split_config
UNION ALL SELECT 'project_investors',   count(*), count(project_id)  FROM project_investors
ORDER BY tabla;
\endif

-- ── SECCIÓN C · REAL + VEREDICTO (solo después de aplicar 024) ──────────────
\if :migrated

-- Una BD creada desde cero también tiene `properties` y tablas `*_legacy`,
-- pero vacías: ahí no hubo migración que reconciliar y comparar contra las
-- legacy solo produciría DIFIERE falsos (las semillas entran DESPUÉS de 024).
-- El mapa de ids vacío es la señal de que esta BD nació migrada.
SELECT CASE WHEN EXISTS (SELECT 1 FROM property_id_map) THEN 'yes' ELSE 'no' END AS reconcilable
\gset

\if :reconcilable

\echo ''
\echo '── C1. Veredicto por invariante ─────────────────────────────────────'

WITH esperado AS (
    SELECT
        (SELECT count(*) FROM :src_prospects) + (SELECT count(*) FROM :src_projects)
          - (SELECT count(*) FROM :src_projects WHERE prospect_id IS NOT NULL) AS propiedades,
        (SELECT count(*) FROM :src_prospects) + (SELECT count(*) FROM :src_projects) AS entradas_mapa,
        (SELECT count(*) FROM :src_prospect_images) + (SELECT count(*) FROM :src_project_images) AS imagenes,
        (SELECT coalesce(sum(current_valuation), 0) FROM :src_projects) AS valuacion
),
obtenido AS (
    SELECT
        (SELECT count(*) FROM properties)                              AS propiedades,
        (SELECT count(*) FROM property_id_map)                         AS entradas_mapa,
        (SELECT count(*) FROM property_images)                         AS imagenes,
        (SELECT coalesce(sum(current_valuation), 0) FROM properties)   AS valuacion,
        (SELECT count(*) FROM property_status_events)                  AS eventos
),
checks(invariante, esperado, obtenido) AS (
    SELECT 'propiedades',                e.propiedades::numeric,   o.propiedades::numeric   FROM esperado e, obtenido o
    UNION ALL
    SELECT 'entradas en property_id_map', e.entradas_mapa::numeric, o.entradas_mapa::numeric FROM esperado e, obtenido o
    UNION ALL
    SELECT 'imágenes migradas',          e.imagenes::numeric,      o.imagenes::numeric      FROM esperado e, obtenido o
    UNION ALL
    -- «suma total_investment» ya no es comparable: la 027 disolvió la columna
    -- que 024 llenó. Donde la fila no traía desglose el total pasó a ser su
    -- `purchase_price`, y donde sí lo traía el total tecleado era redundante y
    -- se fue. En ninguno de los dos casos queda una columna que sume lo mismo
    -- que `projects.total_investment`, así que se retira el invariante en vez
    -- de publicar un DIFIERE que no significa nada. A2 lo sigue reportando del
    -- lado legacy, que es donde el dato todavía existe tal como se migró.
    SELECT 'suma current_valuation',     e.valuacion,              o.valuacion              FROM esperado e, obtenido o
    UNION ALL
    -- una propiedad migrada = un evento de estado inicial
    SELECT 'eventos de status iniciales', o.propiedades::numeric,  o.eventos::numeric       FROM obtenido o
)
SELECT invariante, esperado, obtenido,
       CASE WHEN esperado = obtenido THEN 'PASA' ELSE 'DIFIERE' END AS veredicto
  FROM checks;

\echo ''
\echo '── C2. Conteo por status: esperado vs real ──────────────────────────'

WITH expected AS (
    SELECT CASE j.status
               WHEN 'construction' THEN 'desarrollo'
               WHEN 'en_proceso'   THEN 'desarrollo'
               WHEN 'stabilizing'  THEN 'desarrollo'
               WHEN 'operating'    THEN 'en_renta'
               WHEN 'exited'       THEN 'vendida'
           END AS status
      FROM :src_projects j
    UNION ALL
    SELECT CASE s.status WHEN 'evaluating' THEN 'prospecto' WHEN 'passed' THEN 'oferta' END
      FROM :src_prospects s
     WHERE NOT EXISTS (SELECT 1 FROM :src_projects j WHERE j.prospect_id = s.id)
),
esperado AS (SELECT status, count(*) n FROM expected GROUP BY status),
obtenido AS (SELECT status, count(*) n FROM properties GROUP BY status)
SELECT coalesce(e.status, o.status) AS status,
       coalesce(e.n, 0) AS esperado,
       coalesce(o.n, 0) AS obtenido,
       CASE WHEN coalesce(e.n, 0) = coalesce(o.n, 0) THEN 'PASA' ELSE 'DIFIERE' END AS veredicto
  FROM esperado e FULL OUTER JOIN obtenido o ON o.status = e.status
 ORDER BY 1;

\echo ''
\echo '── C3. Integridad referencial (todo debe ser 0) ─────────────────────'

SELECT 'propiedades sin entrada en el mapa' AS problema,
       (SELECT count(*) FROM properties p
         WHERE NOT EXISTS (SELECT 1 FROM property_id_map m WHERE m.new_id = p.id)) AS filas
UNION ALL
SELECT 'entradas del mapa a propiedad inexistente',
       (SELECT count(*) FROM property_id_map m
         WHERE NOT EXISTS (SELECT 1 FROM properties p WHERE p.id = m.new_id))
UNION ALL
SELECT 'prospectos legacy sin mapear',
       (SELECT count(*) FROM :src_prospects s
         WHERE NOT EXISTS (SELECT 1 FROM property_id_map m WHERE m.source='prospect' AND m.old_id = s.id))
UNION ALL
SELECT 'proyectos legacy sin mapear',
       (SELECT count(*) FROM :src_projects j
         WHERE NOT EXISTS (SELECT 1 FROM property_id_map m WHERE m.source='project' AND m.old_id = j.id))
UNION ALL
SELECT 'propiedades sin evento de status',
       (SELECT count(*) FROM properties p
         WHERE NOT EXISTS (SELECT 1 FROM property_status_events e WHERE e.property_id = p.id))
UNION ALL
SELECT 'imágenes legacy sin migrar (prospect_images)',
       (SELECT count(*) FROM :src_prospect_images i
         WHERE NOT EXISTS (SELECT 1 FROM property_images pi
                            WHERE pi.legacy_source='prospect_images' AND pi.legacy_image_id = i.id))
UNION ALL
SELECT 'imágenes legacy sin migrar (project_images)',
       (SELECT count(*) FROM :src_project_images i
         WHERE NOT EXISTS (SELECT 1 FROM property_images pi
                            WHERE pi.legacy_source='project_images' AND pi.legacy_image_id = i.id))
UNION ALL
SELECT 'analysis_snapshots huérfanos',
       (SELECT count(*) FROM analysis_snapshots a
         WHERE NOT EXISTS (SELECT 1 FROM properties p WHERE p.id = a.property_id))
UNION ALL
SELECT 'signals con propiedad inexistente',
       (SELECT count(*) FROM signals g
         WHERE g.property_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.id = g.property_id))
UNION ALL
SELECT 'process_instances con propiedad inexistente',
       (SELECT count(*) FROM process_instances pi
         WHERE pi.property_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.id = pi.property_id))
UNION ALL
SELECT 'profit_split_config con propiedad inexistente',
       (SELECT count(*) FROM profit_split_config c
         WHERE c.property_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.id = c.property_id))
UNION ALL
SELECT 'property_investors con propiedad inexistente',
       (SELECT count(*) FROM property_investors pi
         WHERE NOT EXISTS (SELECT 1 FROM properties p WHERE p.id = pi.property_id));

\echo ''
\echo '── C4. Filas fusionadas (un inmueble que era dos) ───────────────────'

SELECT m.new_id AS property_id, p.name, p.status,
       max(CASE WHEN m.source='prospect' THEN m.old_id END) AS prospecto_legacy,
       max(CASE WHEN m.source='project'  THEN m.old_id END) AS proyecto_legacy,
       (SELECT count(*) FROM property_images i WHERE i.property_id = m.new_id) AS imagenes
  FROM property_id_map m
  JOIN properties p ON p.id = m.new_id
 GROUP BY m.new_id, p.name, p.status
HAVING count(*) > 1
 ORDER BY m.new_id;

\echo ''
\echo '── C5. Datos que la migración tuvo que aproximar (revisar a mano) ───'

SELECT id, name, status,
       'sale_date/sale_price salen de conclusion_date/current_valuation; first_rent_date queda NULL (el esquema viejo no decía si rentó)' AS nota
  FROM properties WHERE status = 'vendida'
UNION ALL
SELECT id, name, status, 'sin asset_type: el `type` legacy venía vacío o no mapeaba'
  FROM properties WHERE asset_type IS NULL
UNION ALL
SELECT id, name, status, 'la primera renta planeada bajó a milestones (first_rent_date solo guarda renta real)'
  FROM properties p
 WHERE EXISTS (SELECT 1 FROM jsonb_each_text(p.milestones) kv
                WHERE kv.value = 'Primera renta planeada (dato migrado)')
 ORDER BY 1;

\else
\echo ''
\echo '(Secciones C1-C5 omitidas: property_id_map está vacío — esta BD se creó'
\echo ' desde cero con 024 ya aplicada, no migró filas. Lo que haya en'
\echo ' `properties` viene de las semillas, no de las tablas legacy.)'
\endif

\else
\echo ''
\echo '(Secciones C1-C5 omitidas: `properties` todavía no existe — esta es la corrida PRE.)'
\endif

\echo ''
