-- Migration 003: Extend analysis_snapshots for Build & Hold + ARV override
-- Apply:   psql -f data/migrations/003_analyzer.sql
-- Rollback: run the DOWN section at the bottom
--
-- The analysis_snapshots table was created in 001. This migration adds
-- columns for Build & Hold analysis and ARV manual override.

-- ── UP ──────────────────────────────────────────────

-- Build & Hold inputs
ALTER TABLE analysis_snapshots
  ADD COLUMN IF NOT EXISTS renta_mensual_estimada   REAL,
  ADD COLUMN IF NOT EXISTS tasa_interes_credito     REAL,
  ADD COLUMN IF NOT EXISTS plazo_credito_meses      INTEGER,
  ADD COLUMN IF NOT EXISTS financiamiento_pct       REAL,
  ADD COLUMN IF NOT EXISTS gastos_operativos_pct    REAL,
  ADD COLUMN IF NOT EXISTS arv_manual_override      REAL;

-- Build & Hold outputs
ALTER TABLE analysis_snapshots
  ADD COLUMN IF NOT EXISTS noi_anual                REAL,
  ADD COLUMN IF NOT EXISTS debt_service_anual       REAL,
  ADD COLUMN IF NOT EXISTS cash_flow_anual          REAL,
  ADD COLUMN IF NOT EXISTS cash_on_cash_yr1_pct     REAL,
  ADD COLUMN IF NOT EXISTS break_even_months        INTEGER,
  ADD COLUMN IF NOT EXISTS npv_10yr                 REAL,
  ADD COLUMN IF NOT EXISTS irr_10yr_pct             REAL;


-- ── DOWN ────────────────────────────────────────────
-- To rollback:
--
-- ALTER TABLE analysis_snapshots
--   DROP COLUMN IF EXISTS renta_mensual_estimada,
--   DROP COLUMN IF EXISTS tasa_interes_credito,
--   DROP COLUMN IF EXISTS plazo_credito_meses,
--   DROP COLUMN IF EXISTS financiamiento_pct,
--   DROP COLUMN IF EXISTS gastos_operativos_pct,
--   DROP COLUMN IF EXISTS arv_manual_override,
--   DROP COLUMN IF EXISTS noi_anual,
--   DROP COLUMN IF EXISTS debt_service_anual,
--   DROP COLUMN IF EXISTS cash_flow_anual,
--   DROP COLUMN IF EXISTS cash_on_cash_yr1_pct,
--   DROP COLUMN IF EXISTS break_even_months,
--   DROP COLUMN IF EXISTS npv_10yr,
--   DROP COLUMN IF EXISTS irr_10yr_pct;
