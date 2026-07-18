-- migrate:up

-- Migration 001: Analyzer tables (comparables, remodel_costs, zones, analysis_snapshots)
-- Apply:   psql -f data/migrations/001_analyzer_tables.sql
-- Rollback: run the DOWN section at the bottom

-- ── UP ──────────────────────────────────────────────

-- Zones: simple mapping for remodel cost lookup
CREATE TABLE IF NOT EXISTS zones (
  id        BIGSERIAL PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE CHECK (name != ''),
  cities    JSONB NOT NULL DEFAULT '[]',
  notes     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Remodel / construction cost baselines by zone and intervention level
CREATE TABLE IF NOT EXISTS remodel_costs (
  id                  BIGSERIAL PRIMARY KEY,
  zone_id             BIGINT NOT NULL REFERENCES zones(id),
  intervention_level  TEXT NOT NULL CHECK (intervention_level IN (
                        'cosmetica', 'media', 'total', 'obra_nueva')),
  cost_per_m2_mxn     INTEGER NOT NULL,
  includes            JSONB NOT NULL DEFAULT '[]',
  valid_from          DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until         DATE,
  source              TEXT NOT NULL DEFAULT '',
  notes               TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(zone_id, intervention_level, valid_from)
);

-- Market comparables: remodeled/new properties sold or listed nearby
CREATE TABLE IF NOT EXISTS comparables (
  id              BIGSERIAL PRIMARY KEY,
  source_url      TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL CHECK (source IN (
                    'inmuebles24', 'vivanuncios', 'lamudi', 'propiedades_com',
                    'mercadolibre', 'doorvel', 'off_market', 'other')),
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  address         TEXT NOT NULL DEFAULT '',
  neighborhood    TEXT NOT NULL DEFAULT '',
  city            TEXT NOT NULL DEFAULT 'Monterrey',
  price_mxn       BIGINT NOT NULL,
  area_m2         REAL NOT NULL,
  price_per_m2    REAL GENERATED ALWAYS AS (price_mxn::real / NULLIF(area_m2, 0)) STORED,
  bedrooms        INTEGER,
  bathrooms       INTEGER,
  parking_spots   INTEGER,
  property_type   TEXT NOT NULL CHECK (property_type IN (
                    'casa', 'depto', 'duplex', 'lote', 'local')),
  condition       TEXT NOT NULL CHECK (condition IN (
                    'remodelada', 'nueva', 'semi_nueva', 'por_remodelar')),
  style_tags      JSONB NOT NULL DEFAULT '[]',
  listed_date     DATE,
  sold_date       DATE,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comparables_geo
  ON comparables(lat, lng);
CREATE INDEX IF NOT EXISTS idx_comparables_city
  ON comparables(city);
CREATE INDEX IF NOT EXISTS idx_comparables_type_condition
  ON comparables(property_type, condition);

-- Analysis snapshots: immutable results of each analyzer run
CREATE TABLE IF NOT EXISTS analysis_snapshots (
  id                        BIGSERIAL PRIMARY KEY,
  prospect_id               BIGINT NOT NULL REFERENCES prospects(id),
  generated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Inputs
  purchase_price            REAL NOT NULL,
  remodel_cost_estimate     REAL NOT NULL,
  remodel_cost_per_m2       REAL NOT NULL,
  intervention_level        TEXT NOT NULL,
  transaction_costs         REAL NOT NULL,
  financing_costs           REAL NOT NULL,
  total_cost                REAL NOT NULL,
  holding_period_months     INTEGER NOT NULL,

  -- Exit prices: manual vs market
  exit_price_manual         REAL,
  exit_price_calculated_low REAL,
  exit_price_calculated_mid REAL,
  exit_price_calculated_high REAL,
  exit_price_source         TEXT NOT NULL DEFAULT 'manual'
                              CHECK (exit_price_source IN ('manual','calculated','blended')),
  exit_price_used           REAL NOT NULL,
  manual_vs_market_delta_pct REAL,

  -- Comparables info
  comparable_count          INTEGER NOT NULL DEFAULT 0,
  comparable_ids            JSONB NOT NULL DEFAULT '[]',
  avg_comp_distance_km      REAL,

  -- Metrics
  gross_margin              REAL,
  roi_pct                   REAL,
  irr_pct                   REAL,
  cap_rate_pct              REAL,

  -- Confidence
  confidence_score          INTEGER NOT NULL DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 100),
  confidence_notes          TEXT NOT NULL DEFAULT '',

  -- Data quality
  data_quality_warnings     JSONB NOT NULL DEFAULT '[]',

  UNIQUE(prospect_id, generated_at)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_prospect_date
  ON analysis_snapshots(prospect_id, generated_at DESC);


-- ── DOWN ────────────────────────────────────────────
-- To rollback, run these statements:
--
-- DROP TABLE IF EXISTS analysis_snapshots CASCADE;
-- DROP TABLE IF EXISTS comparables CASCADE;
-- DROP TABLE IF EXISTS remodel_costs CASCADE;
-- DROP TABLE IF EXISTS zones CASCADE;

-- migrate:down
