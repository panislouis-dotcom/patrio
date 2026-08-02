-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- Consolidación Prospectos + Proyectos → Propiedades  (Release A, expand)
--
-- Un inmueble es una sola fila con un ciclo de vida por status:
--   prospecto → oferta → desarrollo → {en_renta | vendida};  en_renta → vendida
--   cualquier estado no terminal → archivada (terminal, oculta)
--
-- Qué hace esta migración, en orden:
--   1. Helpers efímeros (pg_temp: mueren con la sesión, no entran a schema.sql).
--   2. Checks de anomalías ANTES de tomar locks anchos — si el dato viejo no
--      cabe en el modelo nuevo, esto aborta con un mensaje que dice cuál fila.
--   3. DDL: properties, property_status_events, property_images,
--      property_id_map + trigger de transiciones.
--   4. Backfill con fusión: cada proyecto es una propiedad (fusionada con su
--      prospecto si lo tiene — gana el proyecto, COALESCE al prospecto); cada
--      prospecto sin proyecto es una propiedad.
--   5. Recableado de las 8 FKs satélite a property_id.
--   6. Las tablas viejas se renombran a *_legacy (no se borran: eso es Release B).
--
-- El storage NO se toca: file_path y el imageKey que vive dentro de geometry
-- conservan las rutas legacy (prospects/N/..., projects/N/...) — GET /files/{path}
-- sirve por key cruda y seguiría sirviendo aunque la fila cambie de id.
-- ─────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '5s';        -- ArgoCD PreSync corta a los 180s; no esperamos locks
SET statement_timeout = '150s'; -- dbmate envuelve el archivo en UNA transacción

-- ── 1. Helpers efímeros ──────────────────────────────────────────────────────
-- Viven en pg_temp: se usan durante la migración y desaparecen al cerrar la
-- sesión, así que no ensucian el esquema ni el dump.

-- Las fechas viejas son TEXT en tres formatos ('YYYY-MM', 'YYYY-MM-DD', vacío).
CREATE OR REPLACE FUNCTION pg_temp.text_to_date(t TEXT) RETURNS DATE
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF t IS NULL OR btrim(t) = '' THEN
        RETURN NULL;
    ELSIF btrim(t) ~ '^\d{4}-\d{2}$' THEN
        RETURN to_date(btrim(t) || '-01', 'YYYY-MM-DD');
    ELSIF btrim(t) ~ '^\d{4}-\d{2}-\d{2}$' THEN
        RETURN to_date(btrim(t), 'YYYY-MM-DD');
    END IF;
    RETURN NULL;
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$$;

-- milestones era TEXT con JSON adentro: lo ilegible se degrada a '{}'.
CREATE OR REPLACE FUNCTION pg_temp.text_to_jsonb(t TEXT) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF t IS NULL OR btrim(t) = '' THEN
        RETURN '{}'::jsonb;
    END IF;
    IF jsonb_typeof(t::jsonb) <> 'object' THEN
        RETURN '{}'::jsonb;
    END IF;
    RETURN t::jsonb;
EXCEPTION WHEN others THEN
    RETURN '{}'::jsonb;
END;
$$;

-- Un proyecto que sigue en obra tiene fecha de primera renta PLANEADA, no real.
-- Esa fecha no puede vivir en first_rent_date (que significa renta ocurrida y
-- de la que depende el gate →en_renta), pero tampoco se tira: se guarda como
-- hito, sin pisar un hito que ya exista en ese mes.
CREATE OR REPLACE FUNCTION pg_temp.with_planned_rent(ms TEXT, planned DATE) RETURNS JSONB
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN planned IS NULL
          OR jsonb_exists(pg_temp.text_to_jsonb(ms), to_char(planned, 'YYYY-MM'))
        THEN pg_temp.text_to_jsonb(ms)
        ELSE pg_temp.text_to_jsonb(ms)
             || jsonb_build_object(to_char(planned, 'YYYY-MM'), 'Primera renta planeada (dato migrado)')
    END;
$$;

-- `type` mezclaba dos vocabularios: el de prospectos era el inmueble
-- (PROPERTY_TYPES del front) y el de proyectos la estrategia. Se parte en dos
-- columnas; lo que no mapea queda NULL y se reporta con RAISE NOTICE.
CREATE OR REPLACE FUNCTION pg_temp.map_asset_type(t TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE lower(btrim(coalesce(t, '')))
        WHEN 'casa'         THEN 'casa'
        WHEN 'departamento' THEN 'departamento'
        WHEN 'local'        THEN 'local'
        WHEN 'edificio'     THEN 'edificio'
        WHEN 'lote'         THEN 'lote'
        WHEN 'bodega'       THEN 'bodega'
        ELSE NULL
    END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.map_strategy_type(t TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE lower(btrim(coalesce(t, '')))
        WHEN 'adaptive_reuse' THEN 'adaptive_reuse'
        WHEN 'ground_up'      THEN 'ground_up'
        WHEN 'flip'           THEN 'flip'
        WHEN 'hold'           THEN 'hold'
        ELSE NULL   -- 'residencial' cae aquí: no es ni inmueble ni estrategia
    END;
$$;

-- ── 2. Checks de anomalías (fail-fast, antes de cualquier lock ancho) ────────

DO $$
DECLARE bad TEXT;
BEGIN
    -- 2a. Un prospecto convertido dos veces produciría dos filas del mismo inmueble.
    SELECT string_agg(prospect_id::text, ', ' ORDER BY prospect_id) INTO bad
    FROM (SELECT prospect_id FROM projects
          WHERE prospect_id IS NOT NULL GROUP BY prospect_id HAVING count(*) > 1) q;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '024: prospectos con más de un proyecto ligado (doble conversión): %', bad;
    END IF;

    -- 2b. Un prospecto 'converted' sin proyecto no tiene con qué fusionarse.
    SELECT string_agg(id::text, ', ' ORDER BY id) INTO bad
    FROM prospects s
    WHERE s.status = 'converted'
      AND NOT EXISTS (SELECT 1 FROM projects j WHERE j.prospect_id = s.id);
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '024: prospectos convertidos sin proyecto ligado: %', bad;
    END IF;

    -- 2c/2d. Vocabulario de status cerrado (el viejo solo exigía <> '').
    SELECT string_agg(DISTINCT format('%s(id %s)', status, id), ', ') INTO bad
    FROM prospects WHERE status NOT IN ('evaluating', 'passed', 'converted');
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '024: prospectos con status fuera de vocabulario: %', bad;
    END IF;

    SELECT string_agg(DISTINCT format('%s(id %s)', status, id), ', ') INTO bad
    FROM projects
    WHERE status NOT IN ('construction', 'en_proceso', 'stabilizing', 'operating', 'exited');
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '024: proyectos con status fuera de vocabulario: %', bad;
    END IF;

    -- 2e. acquisition_date ilegible dejaría sin fecha de compra a una propiedad
    -- ya adquirida (todos los proyectos migran a desarrollo o después).
    SELECT string_agg(format('id %s (%L)', id, acquisition_date), ', ' ORDER BY format('id %s (%L)', id, acquisition_date)) INTO bad
    FROM projects WHERE pg_temp.text_to_date(acquisition_date) IS NULL;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '024: proyectos con acquisition_date no parseable (se espera YYYY-MM o YYYY-MM-DD): %', bad;
    END IF;

    -- 2f. En operating y exited la conclusion_date se vuelve fecha real (primera
    -- renta y venta): si es anterior a la adquisición rompe el orden de fechas a
    -- media migración. En los que siguen en obra la fecha es planeada y solo baja
    -- a milestones, así que no se les exige orden.
    SELECT string_agg(id::text, ', ' ORDER BY id) INTO bad
    FROM projects
    WHERE status IN ('operating', 'exited')
      AND conclusion_date < pg_temp.text_to_date(acquisition_date);
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '024: proyectos con conclusion_date anterior a acquisition_date: %', bad;
    END IF;
END;
$$;

-- Avisos (no bloquean): datos que se migran degradados.
DO $$
DECLARE txt TEXT;
BEGIN
    SELECT string_agg(DISTINCT t, ', ') INTO txt FROM (
        SELECT btrim(type) AS t FROM prospects
         WHERE btrim(type) <> '' AND pg_temp.map_asset_type(type) IS NULL
        UNION
        SELECT btrim(type) FROM projects
         WHERE pg_temp.map_asset_type(type) IS NULL AND pg_temp.map_strategy_type(type) IS NULL
    ) q;
    IF txt IS NOT NULL THEN
        RAISE NOTICE '024: tipos legacy sin mapeo — asset_type/strategy_type quedan NULL: %', txt;
    END IF;

    SELECT string_agg(format('id %s (%L)', id, valuation_date), ', ') INTO txt
    FROM projects WHERE pg_temp.text_to_date(valuation_date) IS NULL;
    IF txt IS NOT NULL THEN
        RAISE NOTICE '024: proyectos con valuation_date no parseable — queda NULL: %', txt;
    END IF;
END;
$$;

-- ── 3. DDL ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS properties (
  id                        BIGSERIAL PRIMARY KEY,

  -- Identidad
  name                      TEXT NOT NULL CHECK (name <> ''),
  address                   TEXT NOT NULL CHECK (address <> ''),
  city                      TEXT NOT NULL CHECK (city <> ''),
  -- url sin CHECK <> '': el viejo obligaba a inventar texto ('trato directo'
  -- aparece en los seeds) cuando la propiedad no venía de un portal.
  url                       TEXT NOT NULL DEFAULT '',
  latitude                  REAL NOT NULL,
  longitude                 REAL NOT NULL,

  -- Ciclo de vida
  status                    TEXT NOT NULL CHECK (status IN
                              ('prospecto', 'oferta', 'desarrollo', 'en_renta', 'vendida', 'archivada')),
  asset_type                TEXT CHECK (asset_type IN
                              ('casa', 'departamento', 'local', 'edificio', 'lote', 'bodega')),
  strategy_type             TEXT CHECK (strategy_type IN
                              ('adaptive_reuse', 'ground_up', 'flip', 'hold')),

  -- Underwriting: los 11 insumos de la proyección (nullable — un prospecto
  -- recién capturado todavía no los tiene todos)
  sqm_land                  REAL          CHECK (sqm_land >= 0),
  sqm_construction          REAL          CHECK (sqm_construction >= 0),
  land_price                NUMERIC(14,2) CHECK (land_price >= 0),
  acquisition_cost_pct      REAL          CHECK (acquisition_cost_pct >= 0),
  permits_cost              NUMERIC(14,2) CHECK (permits_cost >= 0),
  subdivision_cost          NUMERIC(14,2) CHECK (subdivision_cost >= 0),
  construction_cost_per_sqm NUMERIC(14,2) CHECK (construction_cost_per_sqm >= 0),
  construction_overhead     REAL          CHECK (construction_overhead >= 0),
  projected_sale            NUMERIC(14,2) CHECK (projected_sale >= 0),
  hold_months               INTEGER       CHECK (hold_months > 0),
  -- NULL = no capturada · un 0 no se almacena (no-renta se expresa con NULL)
  rent_monthly              NUMERIC(14,2) CHECK (rent_monthly > 0),

  -- Realidad post-compra
  total_units               INTEGER       CHECK (total_units > 0),
  acquisition_date          DATE,
  first_rent_date           DATE,
  sale_date                 DATE,
  sale_price                NUMERIC(14,2) CHECK (sale_price >= 0),
  total_investment          NUMERIC(14,2) CHECK (total_investment >= 0),
  current_valuation         NUMERIC(14,2) CHECK (current_valuation >= 0),
  valuation_date            DATE,
  milestones                JSONB   NOT NULL DEFAULT '{}'::jsonb
                              CHECK (jsonb_typeof(milestones) = 'object'),

  -- Transversales
  geometry                  JSONB   NOT NULL DEFAULT '{}'::jsonb,
  notes                     TEXT    NOT NULL DEFAULT '',
  is_favorite               BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Coherencia entre status y datos (el trigger de transición valida el resto)
  CONSTRAINT properties_en_renta_needs_first_rent
    CHECK (status <> 'en_renta' OR first_rent_date IS NOT NULL),
  CONSTRAINT properties_vendida_needs_sale
    CHECK (status <> 'vendida' OR (sale_date IS NOT NULL AND sale_price IS NOT NULL)),
  CONSTRAINT properties_first_rent_after_acquisition
    CHECK (first_rent_date IS NULL OR acquisition_date IS NULL OR first_rent_date >= acquisition_date),
  CONSTRAINT properties_sale_after_acquisition
    CHECK (sale_date IS NULL OR acquisition_date IS NULL OR sale_date >= acquisition_date),
  CONSTRAINT properties_sale_after_first_rent
    CHECK (sale_date IS NULL OR first_rent_date IS NULL OR sale_date >= first_rent_date)
);

CREATE INDEX IF NOT EXISTS idx_properties_status           ON properties (status);
CREATE INDEX IF NOT EXISTS idx_properties_acquisition_date ON properties (acquisition_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_properties_city_status      ON properties (city, status);
CREATE INDEX IF NOT EXISTS idx_properties_favorite         ON properties (id) WHERE is_favorite;

-- Historia de transiciones: días en oferta, tasa de conversión, tiempo a
-- primera renta. from_status NULL = alta de la propiedad.
CREATE TABLE IF NOT EXISTS property_status_events (
  id           BIGSERIAL PRIMARY KEY,
  property_id  BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  from_status  TEXT CHECK (from_status IN
                 ('prospecto', 'oferta', 'desarrollo', 'en_renta', 'vendida', 'archivada')),
  to_status    TEXT NOT NULL CHECK (to_status IN
                 ('prospecto', 'oferta', 'desarrollo', 'en_renta', 'vendida', 'archivada')),
  effective_on DATE NOT NULL DEFAULT CURRENT_DATE,
  notes        TEXT NOT NULL DEFAULT '',
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_status_events_moves CHECK (from_status IS DISTINCT FROM to_status)
);

CREATE INDEX IF NOT EXISTS idx_property_events_property  ON property_status_events (property_id, effective_on DESC);
CREATE INDEX IF NOT EXISTS idx_property_events_to_status ON property_status_events (to_status, effective_on DESC);

-- Una sola tabla de fotos: las de prospecto entran como 'general'; las de
-- proyecto conservan antes/después. legacy_* deja el rastro para auditar.
CREATE TABLE IF NOT EXISTS property_images (
  id              BIGSERIAL PRIMARY KEY,
  property_id     BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  file_path       TEXT NOT NULL CHECK (file_path <> ''),
  file_name       TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  image_type      TEXT NOT NULL DEFAULT 'general'
                    CHECK (image_type IN ('general', 'antes', 'despues')),
  legacy_source   TEXT CHECK (legacy_source IN ('prospect_images', 'project_images')),
  legacy_image_id BIGINT,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_images_unique_path UNIQUE (property_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_property_images_property ON property_images (property_id, sort_order);

-- Traducción de ids vieja→nueva. Persiste: es la única forma de contestar
-- "¿en qué propiedad quedó el proyecto 7?" después del renombrado.
CREATE TABLE IF NOT EXISTS property_id_map (
  source TEXT   NOT NULL CHECK (source IN ('prospect', 'project')),
  old_id BIGINT NOT NULL,
  new_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  PRIMARY KEY (source, old_id)
);

CREATE INDEX IF NOT EXISTS idx_property_id_map_new ON property_id_map (new_id);

-- ── Trigger de transiciones ──────────────────────────────────────────────────
-- Doble capa: el endpoint POST /api/properties/{id}/transition da los 422 con
-- mensaje; esto es la red de abajo — ningún UPDATE puede saltarse el ciclo.
-- El INSERT no pasa por aquí a propósito: nacer en cualquier estado válido es
-- legítimo (migración, semillas, altas futuras).
CREATE OR REPLACE FUNCTION properties_guard_transition() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    allowed BOOLEAN;
BEGIN
    allowed := CASE OLD.status
        WHEN 'prospecto'  THEN NEW.status IN ('oferta', 'archivada')
        WHEN 'oferta'     THEN NEW.status IN ('desarrollo', 'archivada')
        WHEN 'desarrollo' THEN NEW.status IN ('en_renta', 'vendida', 'archivada')
        WHEN 'en_renta'   THEN NEW.status IN ('vendida', 'archivada')
        -- vendida es terminal: una propiedad vendida ES el track record de la
        -- firma y no puede desaparecer de él archivándola
        WHEN 'vendida'    THEN FALSE
        WHEN 'archivada'  THEN FALSE
        ELSE FALSE
    END;

    IF NOT allowed THEN
        RAISE EXCEPTION 'transición de status no permitida: % → % (propiedad %)',
            OLD.status, NEW.status, OLD.id USING ERRCODE = 'check_violation';
    END IF;

    -- Insumos mínimos por etapa destino. Los CHECKs de tabla ya cubren
    -- en_renta ⇒ first_rent_date y vendida ⇒ sale_date + sale_price; aquí van
    -- los que dependen del destino y no del estado de la fila.
    IF NEW.status = 'oferta' AND coalesce(NEW.projected_sale, 0) <= 0 THEN
        RAISE EXCEPTION 'oferta exige modelo completo: projected_sale > 0 (propiedad %)',
            OLD.id USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status = 'desarrollo' THEN
        IF NEW.acquisition_date IS NULL THEN
            RAISE EXCEPTION 'desarrollo exige acquisition_date (propiedad %)',
                OLD.id USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.total_units IS NULL THEN
            RAISE EXCEPTION 'desarrollo exige total_units (propiedad %)',
                OLD.id USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.current_valuation IS NULL THEN
            RAISE EXCEPTION 'desarrollo exige valuación inicial (propiedad %)',
                OLD.id USING ERRCODE = 'check_violation';
        END IF;
        -- La base de inversión se resuelve de dos formas y solo de dos: el total
        -- capturado a mano, o el desglose COMPLETO de siete campos (con uno
        -- faltante el sistema no puede recomputar nada).
        IF NEW.total_investment IS NULL AND NOT (
               NEW.land_price                IS NOT NULL
           AND NEW.acquisition_cost_pct      IS NOT NULL
           AND NEW.permits_cost              IS NOT NULL
           AND NEW.subdivision_cost          IS NOT NULL
           AND NEW.sqm_construction          IS NOT NULL
           AND NEW.construction_cost_per_sqm IS NOT NULL
           AND NEW.construction_overhead     IS NOT NULL
        ) THEN
            RAISE EXCEPTION 'desarrollo exige base de inversión resoluble: total_investment manual o el desglose completo de los siete costos (propiedad %)',
                OLD.id USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    IF NEW.status = 'en_renta' THEN
        IF NEW.rent_monthly IS NULL THEN
            RAISE EXCEPTION 'en_renta exige rent_monthly (propiedad %)',
                OLD.id USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.current_valuation IS NULL THEN
            RAISE EXCEPTION 'en_renta exige valuación (propiedad %)',
                OLD.id USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_properties_transition ON properties;
CREATE TRIGGER trg_properties_transition
    BEFORE UPDATE OF status ON properties
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION properties_guard_transition();

-- updated_at se mantiene solo: si lo llevara la API, cada endpoint nuevo
-- tendría que acordarse.
CREATE OR REPLACE FUNCTION properties_touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_properties_touch ON properties;
CREATE TRIGGER trg_properties_touch
    BEFORE UPDATE ON properties
    FOR EACH ROW
    EXECUTE FUNCTION properties_touch_updated_at();

-- ── 4. Backfill con fusión ───────────────────────────────────────────────────
-- Columnas puente: sirven para el id_map y el recableado de satélites, y se
-- sueltan al final de esta misma migración.

ALTER TABLE properties ADD COLUMN IF NOT EXISTS legacy_project_id  BIGINT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS legacy_prospect_id BIGINT;

-- 4a. Un proyecto = una propiedad (fusionada con su prospecto si existe).
--     Gana el proyecto; el prospecto rellena lo que el proyecto no tiene.
INSERT INTO properties (
    name, address, city, url, latitude, longitude,
    status, asset_type, strategy_type,
    sqm_land, sqm_construction, land_price, acquisition_cost_pct, permits_cost,
    subdivision_cost, construction_cost_per_sqm, construction_overhead,
    projected_sale, hold_months, rent_monthly,
    total_units, acquisition_date, first_rent_date, sale_date, sale_price,
    total_investment, current_valuation, valuation_date, milestones,
    geometry, notes, is_favorite, created_at, updated_at,
    legacy_project_id, legacy_prospect_id
)
SELECT
    j.name,
    j.address,
    j.city,
    CASE WHEN btrim(j.url) <> '' THEN j.url ELSE coalesce(s.url, '') END,
    coalesce(nullif(j.latitude, 0), s.latitude, 0),
    coalesce(nullif(j.longitude, 0), s.longitude, 0),
    CASE j.status
        WHEN 'construction' THEN 'desarrollo'
        WHEN 'en_proceso'   THEN 'desarrollo'
        WHEN 'stabilizing'  THEN 'desarrollo'
        WHEN 'operating'    THEN 'en_renta'
        WHEN 'exited'       THEN 'vendida'
    END,
    -- el inmueble lo describía el prospecto; la estrategia, el proyecto
    coalesce(pg_temp.map_asset_type(s.type),    pg_temp.map_asset_type(j.type)),
    coalesce(pg_temp.map_strategy_type(j.type), pg_temp.map_strategy_type(s.type)),
    coalesce(j.sqm_land,                  s.sqm_land),
    coalesce(j.sqm_construction,          s.sqm_construction),
    coalesce(j.land_price,                s.land_price),
    coalesce(j.acquisition_cost_pct,      s.acquisition_cost_pct),
    coalesce(j.permits_cost,              s.permits_cost),
    coalesce(j.subdivision_cost,          s.subdivision_cost),
    coalesce(j.construction_cost_per_sqm, s.construction_cost_per_sqm),
    coalesce(j.construction_overhead,     s.construction_overhead),
    coalesce(j.projected_sale,            s.projected_sale),
    nullif(coalesce(j.hold_months,  s.hold_months),  0),
    nullif(coalesce(j.rent_monthly, s.rent_monthly), 0),  -- 0 = no renta → NULL
    nullif(j.total_units, 0),
    pg_temp.text_to_date(j.acquisition_date),
    -- conclusion_date es «PRIMERA RENTA» en la ficha de proyecto, pero solo en
    -- los 'operating' es renta ocurrida. En los demás la fecha no se pierde:
    -- en desarrollo baja a milestones como planeada, y en 'exited' es la fecha
    -- de salida (abajo). first_rent_date solo significa renta real.
    CASE WHEN j.status = 'operating' THEN j.conclusion_date END,
    -- El esquema viejo no tenía salida: para los 'exited' la fecha de venta se
    -- aproxima con conclusion_date y el precio con current_valuation (la marca
    -- congelada). Ambos deben corregirse a mano si hay cifras reales.
    CASE WHEN j.status = 'exited' THEN j.conclusion_date END,
    CASE WHEN j.status = 'exited' THEN j.current_valuation END,
    j.total_investment,
    j.current_valuation,
    pg_temp.text_to_date(j.valuation_date),
    CASE WHEN j.status IN ('construction', 'en_proceso', 'stabilizing')
         THEN pg_temp.with_planned_rent(j.milestones, j.conclusion_date)
         ELSE pg_temp.text_to_jsonb(j.milestones)
    END,
    CASE WHEN j.geometry <> '{}'::jsonb THEN j.geometry ELSE coalesce(s.geometry, '{}'::jsonb) END,
    -- notas: se concatenan en vez de perder las del prospecto
    CASE
        WHEN coalesce(btrim(s.notes), '') = '' THEN j.notes
        WHEN btrim(j.notes) = ''               THEN s.notes
        ELSE j.notes || E'\n\n— Notas del prospecto —\n' || s.notes
    END,
    j.is_favorite OR coalesce(s.is_favorite, FALSE),
    LEAST(j.created_at, s.created_at),   -- LEAST ignora NULL: sin prospecto, la del proyecto
    LEAST(j.created_at, s.created_at),   -- no hay historial de updates que heredar
    j.id,
    s.id
FROM projects j
LEFT JOIN prospects s ON s.id = j.prospect_id;

-- 4b. Prospecto sin proyecto = propiedad pre-compra.
INSERT INTO properties (
    name, address, city, url, latitude, longitude,
    status, asset_type,
    sqm_land, sqm_construction, land_price, acquisition_cost_pct, permits_cost,
    subdivision_cost, construction_cost_per_sqm, construction_overhead,
    projected_sale, hold_months, rent_monthly,
    geometry, notes, is_favorite, created_at, updated_at,
    legacy_prospect_id
)
SELECT
    s.name, s.address, s.city, s.url, s.latitude, s.longitude,
    CASE s.status
        WHEN 'evaluating' THEN 'prospecto'
        WHEN 'passed'     THEN 'oferta'
    END,
    pg_temp.map_asset_type(s.type),
    s.sqm_land, s.sqm_construction, s.land_price, s.acquisition_cost_pct, s.permits_cost,
    s.subdivision_cost, s.construction_cost_per_sqm, s.construction_overhead,
    s.projected_sale,
    nullif(s.hold_months, 0),
    nullif(s.rent_monthly, 0),
    s.geometry, s.notes, s.is_favorite, s.created_at, s.created_at,
    s.id
FROM prospects s
WHERE NOT EXISTS (SELECT 1 FROM projects j WHERE j.prospect_id = s.id);

-- 4c. Mapa de ids (persistente).
INSERT INTO property_id_map (source, old_id, new_id)
SELECT 'project', legacy_project_id, id FROM properties WHERE legacy_project_id IS NOT NULL
UNION ALL
SELECT 'prospect', legacy_prospect_id, id FROM properties WHERE legacy_prospect_id IS NOT NULL;

-- 4d. Estado inicial en la historia. Una sola fila por propiedad: la cadena
-- real de transiciones no existe en el esquema viejo y no se inventa.
INSERT INTO property_status_events (property_id, from_status, to_status, effective_on, notes)
SELECT id, NULL, status, created_at::date,
       'Migración 024: estado inicial importado del esquema legacy.'
FROM properties;

-- 4e. Fotos de ambos lados. file_path se conserva tal cual (apunta al storage).
INSERT INTO property_images (
    property_id, file_path, file_name, content_type, sort_order,
    image_type, legacy_source, legacy_image_id, uploaded_at
)
SELECT p.id, i.file_path, i.file_name, i.content_type, i.sort_order,
       'general', 'prospect_images', i.id, i.uploaded_at
FROM prospect_images i
JOIN properties p ON p.legacy_prospect_id = i.prospect_id
ON CONFLICT (property_id, file_path) DO NOTHING;

INSERT INTO property_images (
    property_id, file_path, file_name, content_type, sort_order,
    image_type, legacy_source, legacy_image_id, uploaded_at
)
SELECT p.id, i.file_path, i.file_name, i.content_type, i.sort_order,
       i.image_type, 'project_images', i.id, i.uploaded_at
FROM project_images i
JOIN properties p ON p.legacy_project_id = i.project_id
ON CONFLICT (property_id, file_path) DO NOTHING;

-- ── 5. Recableado de satélites ───────────────────────────────────────────────

-- 5a. analysis_snapshots: el análisis pre-compra queda colgado de la propiedad
-- fusionada, que es lo que lo vuelve comparable contra la realidad.
ALTER TABLE analysis_snapshots ADD COLUMN IF NOT EXISTS property_id BIGINT;
UPDATE analysis_snapshots a
   SET property_id = m.new_id
  FROM property_id_map m
 WHERE m.source = 'prospect' AND m.old_id = a.prospect_id;
ALTER TABLE analysis_snapshots ALTER COLUMN property_id SET NOT NULL;
ALTER TABLE analysis_snapshots DROP CONSTRAINT IF EXISTS analysis_snapshots_prospect_id_fkey;
ALTER TABLE analysis_snapshots DROP CONSTRAINT IF EXISTS analysis_snapshots_prospect_id_generated_at_key;
DROP INDEX IF EXISTS idx_snapshots_prospect_date;
ALTER TABLE analysis_snapshots DROP COLUMN IF EXISTS prospect_id;
ALTER TABLE analysis_snapshots
    ADD CONSTRAINT analysis_snapshots_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id);
ALTER TABLE analysis_snapshots
    ADD CONSTRAINT analysis_snapshots_property_id_generated_at_key UNIQUE (property_id, generated_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_property_date ON analysis_snapshots (property_id, generated_at DESC);

-- 5b. signals (sonar): el vínculo señal → propiedad captada.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS property_id BIGINT;
UPDATE signals g
   SET property_id = m.new_id
  FROM property_id_map m
 WHERE m.source = 'prospect' AND m.old_id = g.prospect_id;
ALTER TABLE signals DROP CONSTRAINT IF EXISTS signals_prospect_id_fkey;
DROP INDEX IF EXISTS idx_signals_prospect;
ALTER TABLE signals DROP COLUMN IF EXISTS prospect_id;
ALTER TABLE signals
    ADD CONSTRAINT signals_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id);
CREATE INDEX IF NOT EXISTS idx_signals_property ON signals (property_id);

-- 5c. process_instances (procesos de obra).
ALTER TABLE process_instances ADD COLUMN IF NOT EXISTS property_id BIGINT;
UPDATE process_instances pi
   SET property_id = m.new_id
  FROM property_id_map m
 WHERE m.source = 'project' AND m.old_id = pi.project_id;
ALTER TABLE process_instances DROP CONSTRAINT IF EXISTS process_instances_project_id_fkey;
DROP INDEX IF EXISTS idx_instance_project;
ALTER TABLE process_instances DROP COLUMN IF EXISTS project_id;
ALTER TABLE process_instances
    ADD CONSTRAINT process_instances_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id);
CREATE INDEX IF NOT EXISTS idx_instance_property ON process_instances (property_id);

-- 5d. profit_split_config (waterfall) — se conserva el único parcial.
ALTER TABLE profit_split_config ADD COLUMN IF NOT EXISTS property_id BIGINT;
UPDATE profit_split_config c
   SET property_id = m.new_id
  FROM property_id_map m
 WHERE m.source = 'project' AND m.old_id = c.project_id;
ALTER TABLE profit_split_config DROP CONSTRAINT IF EXISTS profit_split_config_project_id_fkey;
DROP INDEX IF EXISTS uq_profit_split_project;
ALTER TABLE profit_split_config DROP COLUMN IF EXISTS project_id;
ALTER TABLE profit_split_config
    ADD CONSTRAINT profit_split_config_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_profit_split_property
    ON profit_split_config (property_id) WHERE property_id IS NOT NULL;

-- 5e. project_investors → property_investors: se renombra en sitio para no
-- perder ids ni el histórico de aportaciones.
ALTER TABLE project_investors RENAME TO property_investors;
ALTER TABLE property_investors RENAME COLUMN project_id TO property_id;
ALTER TABLE property_investors DROP CONSTRAINT IF EXISTS project_investors_project_id_fkey;
UPDATE property_investors pi
   SET property_id = m.new_id
  FROM property_id_map m
 WHERE m.source = 'project' AND m.old_id = pi.property_id;
ALTER TABLE property_investors
    ADD CONSTRAINT property_investors_property_id_fkey
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;
ALTER TABLE property_investors RENAME CONSTRAINT project_investors_pkey TO property_investors_pkey;
ALTER TABLE property_investors RENAME CONSTRAINT project_investors_status_check TO property_investors_status_check;
ALTER TABLE property_investors RENAME CONSTRAINT project_investors_investor_id_fkey TO property_investors_investor_id_fkey;
ALTER SEQUENCE IF EXISTS project_investors_id_seq RENAME TO property_investors_id_seq;
ALTER INDEX IF EXISTS idx_pi_project RENAME TO idx_pi_property;

-- ── 6. Las tablas viejas salen de circulación (Release B las borra) ──────────

ALTER TABLE prospects       RENAME TO prospects_legacy;
ALTER TABLE projects        RENAME TO projects_legacy;
ALTER TABLE prospect_images RENAME TO prospect_images_legacy;
ALTER TABLE project_images  RENAME TO project_images_legacy;

-- Las columnas puente ya cumplieron: property_id_map es la memoria persistente.
ALTER TABLE properties DROP COLUMN IF EXISTS legacy_project_id;
ALTER TABLE properties DROP COLUMN IF EXISTS legacy_prospect_id;

-- migrate:down
-- No soportado. Esta migración fusiona filas de dos tablas en una sola y
-- recablea ocho llaves foráneas: no existe inverso que devuelva los ids
-- viejos ni separe una fila fusionada sin inventar datos. La reversión de
-- Release A es restaurar el backup CNPG previo al deploy — por eso el backup
-- fresco es precondición del merge. Falla ruidosamente para que nadie crea
-- que hizo rollback.
DO $$
BEGIN
    RAISE EXCEPTION '024 no es reversible: restaura el backup CNPG previo al deploy.';
END;
$$;
