-- Migration 002: Comparables lifecycle, check log, remodel_costs.updated_at
-- Apply:   psql -f data/migrations/002_comparables_lifecycle.sql
-- Rollback: run the DOWN section at the bottom
--
-- BREAKING: drops and recreates comparables table from 001 (no data exists yet).

-- ── UP ──────────────────────────────────────────────

-- Drop the 001 version of comparables (empty, no data loss)
DROP TABLE IF EXISTS comparables CASCADE;

CREATE TABLE IF NOT EXISTS comparables (
  id                  BIGSERIAL PRIMARY KEY,

  -- Required fields (validated in app layer too)
  address             TEXT NOT NULL CHECK (address != ''),
  zone_id             BIGINT NOT NULL REFERENCES zones(id),
  m2                  REAL NOT NULL CHECK (m2 > 0),
  price               BIGINT NOT NULL CHECK (price > 0),
  listing_url         TEXT NOT NULL CHECK (listing_url != ''),
  source_portal       TEXT NOT NULL CHECK (source_portal IN (
                        'inmuebles24', 'vivanuncios', 'lamudi', 'propiedades_com',
                        'mercadolibre', 'doorvel', 'off_market', 'other')),
  listed_at           TIMESTAMPTZ NOT NULL,
  captured_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Computed
  price_per_m2        REAL GENERATED ALWAYS AS (price::real / NULLIF(m2, 0)) STORED,

  -- Optional descriptors
  neighborhood        TEXT NOT NULL DEFAULT '',
  city                TEXT NOT NULL DEFAULT 'Monterrey',
  lat                 DOUBLE PRECISION,
  lng                 DOUBLE PRECISION,
  bedrooms            INTEGER,
  bathrooms           INTEGER,
  parking_spots       INTEGER,
  property_type       TEXT NOT NULL DEFAULT 'casa' CHECK (property_type IN (
                        'casa', 'depto', 'duplex', 'lote', 'local')),
  condition           TEXT NOT NULL DEFAULT 'remodelada' CHECK (condition IN (
                        'remodelada', 'nueva', 'semi_nueva', 'por_remodelar')),
  style_tags          JSONB NOT NULL DEFAULT '[]',

  -- Lifecycle
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
                        'active', 'sold', 'withdrawn', 'expired')),
  last_checked_at     TIMESTAMPTZ,
  last_seen_active    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sold_at             TIMESTAMPTZ,
  check_failure_count INTEGER NOT NULL DEFAULT 0,

  notes               TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comparables_geo
  ON comparables(lat, lng);
CREATE INDEX IF NOT EXISTS idx_comparables_zone
  ON comparables(zone_id);
CREATE INDEX IF NOT EXISTS idx_comparables_status
  ON comparables(status);
CREATE INDEX IF NOT EXISTS idx_comparables_type_condition
  ON comparables(property_type, condition);
CREATE INDEX IF NOT EXISTS idx_comparables_last_seen
  ON comparables(last_seen_active);

-- Check log: one row per URL verification attempt
CREATE TABLE IF NOT EXISTS comparable_check_log (
  id              BIGSERIAL PRIMARY KEY,
  comparable_id   BIGINT NOT NULL REFERENCES comparables(id),
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  http_status     INTEGER,
  result          TEXT NOT NULL CHECK (result IN (
                    'active', 'sold', 'error', 'timeout', 'redirect')),
  detail          TEXT NOT NULL DEFAULT '',
  CONSTRAINT fk_check_log_comparable FOREIGN KEY (comparable_id)
    REFERENCES comparables(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_check_log_comparable
  ON comparable_check_log(comparable_id, checked_at DESC);

-- Add updated_at to remodel_costs for staleness alerting
ALTER TABLE remodel_costs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();


-- ── DOWN ────────────────────────────────────────────
-- To rollback, run these statements:
--
-- DROP TABLE IF EXISTS comparable_check_log CASCADE;
-- DROP TABLE IF EXISTS comparables CASCADE;
-- ALTER TABLE remodel_costs DROP COLUMN IF EXISTS updated_at;
--
-- Then re-run migration 001 to restore the original comparables table.
