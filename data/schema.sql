-- ─────────────────────────────────────────────────
-- PATRIO · Real Estate Knowledge Base  (PostgreSQL)
-- ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prospects (
  id                        BIGSERIAL PRIMARY KEY,
  name                      TEXT NOT NULL CHECK (name != ''),
  address                   TEXT NOT NULL CHECK (address != ''),
  city                      TEXT NOT NULL CHECK (city != ''),
  status                    TEXT NOT NULL CHECK (status != ''),
  url                       TEXT NOT NULL CHECK (url != ''),
  latitude                  REAL NOT NULL,
  longitude                 REAL NOT NULL,
  sqm_land                  REAL NOT NULL,
  sqm_construction          REAL NOT NULL,
  land_price                REAL NOT NULL,
  acquisition_cost_pct      REAL NOT NULL,
  permits_cost              REAL NOT NULL,
  subdivision_cost          REAL NOT NULL,
  construction_cost_per_sqm REAL NOT NULL,
  construction_overhead     REAL NOT NULL,
  projected_sale            REAL NOT NULL,
  hold_months               INTEGER NOT NULL DEFAULT 12,
  rent_monthly              REAL NOT NULL CHECK (rent_monthly >= 0),
  notes                     TEXT NOT NULL DEFAULT '',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE VIEW prospect_metrics AS
SELECT
  id, name, address, city, status, url,
  sqm_land, sqm_construction, land_price, acquisition_cost_pct,
  ROUND((land_price * acquisition_cost_pct)::numeric, 0)    AS acquisition_costs,
  ROUND((land_price * (1 + acquisition_cost_pct))::numeric, 0) AS acquisition_total,
  permits_cost, subdivision_cost,
  ROUND((sqm_construction * construction_cost_per_sqm)::numeric, 0)                          AS construction_base,
  ROUND((sqm_construction * construction_cost_per_sqm * construction_overhead)::numeric, 0)  AS construction_total,
  ROUND((land_price * (1 + acquisition_cost_pct) + permits_cost + subdivision_cost +
        sqm_construction * construction_cost_per_sqm * construction_overhead)::numeric, 0)   AS total_investment,
  projected_sale,
  ROUND((projected_sale -
       (land_price * (1 + acquisition_cost_pct) + permits_cost + subdivision_cost +
        sqm_construction * construction_cost_per_sqm * construction_overhead))::numeric, 0)  AS profit,
  ROUND(((projected_sale -
        (land_price * (1 + acquisition_cost_pct) + permits_cost + subdivision_cost +
         sqm_construction * construction_cost_per_sqm * construction_overhead)) /
        NULLIF(land_price * (1 + acquisition_cost_pct) + permits_cost + subdivision_cost +
         sqm_construction * construction_cost_per_sqm * construction_overhead, 0))::numeric, 4) AS roi,
  ROUND((rent_monthly * 12 / NULLIF(projected_sale, 0))::numeric, 4)   AS cap_rate,
  ROUND((land_price / NULLIF(sqm_land, 0))::numeric, 2)                AS land_price_per_sqm,
  ROUND((projected_sale / NULLIF(sqm_land, 0))::numeric, 2)            AS sale_per_sqm,
  ROUND(((land_price * (1 + acquisition_cost_pct) + permits_cost + subdivision_cost +
         sqm_construction * construction_cost_per_sqm * construction_overhead)
        / NULLIF(sqm_land, 0))::numeric, 2)                            AS investment_per_sqm,
  rent_monthly,
  ROUND((rent_monthly * 12)::numeric, 0)                    AS rent_annual,
  hold_months, notes
FROM prospects;

CREATE TABLE IF NOT EXISTS projects (
  id                BIGSERIAL PRIMARY KEY,
  name              TEXT NOT NULL CHECK (name != ''),
  type              TEXT NOT NULL CHECK (type != ''),
  address           TEXT NOT NULL CHECK (address != ''),
  city              TEXT NOT NULL CHECK (city != ''),
  status            TEXT NOT NULL CHECK (status != ''),
  total_units       INTEGER NOT NULL,
  acquisition_date  TEXT NOT NULL CHECK (acquisition_date != ''),
  conclusion_date   DATE NOT NULL,
  total_investment  REAL NOT NULL,
  current_valuation REAL NOT NULL,
  valuation_date    TEXT NOT NULL CHECK (valuation_date != ''),
  url               TEXT NOT NULL CHECK (url != ''),
  latitude          REAL NOT NULL,
  longitude         REAL NOT NULL,
  prospect_id       BIGINT REFERENCES prospects(id),
  milestones        TEXT NOT NULL DEFAULT '{}',
  budget            TEXT NOT NULL DEFAULT '{}',
  notes             TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL CHECK (name != ''),
  role        TEXT NOT NULL CHECK (role IN ('director','responsable_proyecto','lider_proyecto','maestro','ayudante','finder')),
  manager_id  BIGINT REFERENCES team_members(id),
  email       TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS signals (
  id            BIGSERIAL PRIMARY KEY,
  portal        TEXT NOT NULL,
  url           TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  address       TEXT NOT NULL DEFAULT '',
  city          TEXT NOT NULL DEFAULT 'Monterrey',
  price         REAL NOT NULL DEFAULT 0,
  sqm_land      REAL NOT NULL DEFAULT 0,
  raw_data      TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'new',
  prospect_id   BIGINT REFERENCES prospects(id),
  scraped_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS process_templates (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL CHECK (name != ''),
  description TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS template_nodes (
  id                 BIGSERIAL PRIMARY KEY,
  template_id        BIGINT NOT NULL REFERENCES process_templates(id) ON DELETE CASCADE,
  parent_id          BIGINT REFERENCES template_nodes(id) ON DELETE CASCADE,
  name               TEXT NOT NULL CHECK (name != ''),
  description        TEXT NOT NULL DEFAULT '',
  sort_order         INTEGER NOT NULL DEFAULT 0,
  depends_on_id      BIGINT REFERENCES template_nodes(id) ON DELETE SET NULL,
  source_template_id BIGINT REFERENCES process_templates(id),
  duration_days      INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS process_instances (
  id                  BIGSERIAL PRIMARY KEY,
  template_id         BIGINT REFERENCES process_templates(id) ON DELETE CASCADE,
  project_id          BIGINT REFERENCES projects(id),
  owner_id            BIGINT REFERENCES team_members(id),
  task_type           TEXT NOT NULL DEFAULT 'proyecto',
  name                TEXT NOT NULL CHECK (name != ''),
  start_date          TEXT NOT NULL,
  due_date            TEXT,
  frequency_days      INTEGER,
  origin_instance_id  BIGINT REFERENCES process_instances(id),
  completed_at        TEXT,
  duration_locked_at  TEXT,
  status              TEXT NOT NULL DEFAULT 'active',
  notes               TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS instance_node_states (
  id                     BIGSERIAL PRIMARY KEY,
  instance_id            BIGINT NOT NULL REFERENCES process_instances(id) ON DELETE CASCADE,
  template_node_id       BIGINT NOT NULL REFERENCES template_nodes(id) ON DELETE CASCADE,
  status                 TEXT NOT NULL DEFAULT 'pending',
  assignee_id            BIGINT REFERENCES team_members(id),
  actual_start           TEXT,
  actual_end             TEXT,
  notes                  TEXT NOT NULL DEFAULT '',
  duration_override_days INTEGER,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(instance_id, template_node_id)
);

CREATE TABLE IF NOT EXISTS node_files (
  id               BIGSERIAL PRIMARY KEY,
  template_node_id BIGINT NOT NULL REFERENCES template_nodes(id) ON DELETE CASCADE,
  instance_id      BIGINT REFERENCES process_instances(id) ON DELETE CASCADE,
  file_path        TEXT NOT NULL,
  file_name        TEXT NOT NULL,
  content_type     TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'reference',
  uploaded_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS node_comments (
  id               BIGSERIAL PRIMARY KEY,
  instance_id      BIGINT NOT NULL REFERENCES process_instances(id) ON DELETE CASCADE,
  template_node_id BIGINT NOT NULL REFERENCES template_nodes(id) ON DELETE CASCADE,
  body             TEXT NOT NULL,
  author           TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS instance_files (
  id           BIGSERIAL PRIMARY KEY,
  instance_id  BIGINT NOT NULL REFERENCES process_instances(id) ON DELETE CASCADE,
  file_path    TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  content_type TEXT NOT NULL,
  uploaded_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profit_split_config (
  id                    BIGSERIAL PRIMARY KEY,
  project_id            BIGINT REFERENCES projects(id),
  exit_price            REAL,
  investor_capital      REAL,
  investor_rate_annual  REAL NOT NULL DEFAULT 0.12,
  investor_months       REAL,
  isr_rate              REAL NOT NULL DEFAULT 0.30,
  finder_fee_pct        REAL NOT NULL DEFAULT 0.0,
  director_pct          REAL NOT NULL DEFAULT 0.0,
  responsable_pct       REAL NOT NULL DEFAULT 0.0,
  lider_pct             REAL NOT NULL DEFAULT 0.0,
  maestro_pct           REAL NOT NULL DEFAULT 0.0,
  ayudante_pct          REAL NOT NULL DEFAULT 0.0,
  finder_member_id      BIGINT REFERENCES team_members(id),
  responsable_member_id BIGINT REFERENCES team_members(id),
  lider_member_id       BIGINT REFERENCES team_members(id),
  maestro_member_ids    JSONB NOT NULL DEFAULT '[]',
  ayudante_member_ids   JSONB NOT NULL DEFAULT '[]',
  maestro_count         INTEGER,
  ayudante_count        INTEGER,
  planned_end_date      TEXT,
  actual_end_date       TEXT,
  buffer_days           INTEGER NOT NULL DEFAULT 0,
  notes                 TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_profit_split_project
  ON profit_split_config(project_id) WHERE project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS investors (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL CHECK (name != ''),
  apellidos  TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_investors (
  id                   BIGSERIAL PRIMARY KEY,
  project_id           BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  investor_id          BIGINT NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'interesado'
                         CHECK (status IN ('interesado','comprometido','fondeado')),
  interested_amount    REAL NOT NULL DEFAULT 0,
  committed_amount     REAL NOT NULL DEFAULT 0,
  funded_amount        REAL NOT NULL DEFAULT 0,
  interest_rate_annual REAL NOT NULL DEFAULT 0.12,
  investment_date      DATE,
  return_amount        REAL,
  return_date          DATE,
  notes                TEXT NOT NULL DEFAULT '',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE VIEW project_investor_metrics AS
WITH hold AS (
    SELECT
        pi.id AS pi_id,
        CASE
            WHEN p.conclusion_date IS NOT NULL
            THEN (EXTRACT(YEAR FROM p.conclusion_date)::int
                  - EXTRACT(YEAR FROM TO_DATE(p.acquisition_date || '-01', 'YYYY-MM-DD'))::int) * 12
                + (EXTRACT(MONTH FROM p.conclusion_date)::int
                   - EXTRACT(MONTH FROM TO_DATE(p.acquisition_date || '-01', 'YYYY-MM-DD'))::int)
            ELSE (EXTRACT(YEAR FROM CURRENT_DATE)::int
                  - EXTRACT(YEAR FROM TO_DATE(p.acquisition_date || '-01', 'YYYY-MM-DD'))::int) * 12
                + (EXTRACT(MONTH FROM CURRENT_DATE)::int
                   - EXTRACT(MONTH FROM TO_DATE(p.acquisition_date || '-01', 'YYYY-MM-DD'))::int)
        END AS hold_months
    FROM project_investors pi
    JOIN projects p ON p.id = pi.project_id
)
SELECT
    pi.*,
    i.name || CASE WHEN COALESCE(i.apellidos, '') != '' THEN ' ' || i.apellidos ELSE '' END AS investor_name,
    p.name AS project_name,
    h.hold_months,
    ROUND((pi.funded_amount * pi.interest_rate_annual * h.hold_months / 12.0)::numeric, 2)          AS interest_amount,
    ROUND((pi.funded_amount * (1 + pi.interest_rate_annual * h.hold_months / 12.0))::numeric, 2)    AS expected_return,
    ROUND((pi.interest_rate_annual * h.hold_months / 12.0 * 100)::numeric, 2)                       AS return_pct
FROM project_investors pi
JOIN projects p ON p.id = pi.project_id
JOIN investors i ON i.id = pi.investor_id
JOIN hold h ON h.pi_id = pi.id;

CREATE TABLE IF NOT EXISTS users (
  id              BIGSERIAL PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  hashed_password TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sonar market intelligence
CREATE TABLE IF NOT EXISTS sonar_signals (
    id              BIGSERIAL PRIMARY KEY,
    url             TEXT NOT NULL UNIQUE,
    portal          TEXT NOT NULL,
    title           TEXT NOT NULL,
    address         TEXT NOT NULL DEFAULT '',
    municipio_cve   TEXT NOT NULL DEFAULT '',
    municipio_name  TEXT NOT NULL DEFAULT '',
    colonia         TEXT NOT NULL DEFAULT '',
    lat             DOUBLE PRECISION,
    lon             DOUBLE PRECISION,
    price           DOUBLE PRECISION NOT NULL DEFAULT 0,
    sqm_land        DOUBLE PRECISION NOT NULL DEFAULT 0,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_price      DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS sonar_scans (
    id           BIGSERIAL PRIMARY KEY,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    cves         TEXT[],
    found        INT,
    skipped      INT,
    enriched     INT
);

CREATE TABLE IF NOT EXISTS sonar_scan_signals (
    scan_id       BIGINT NOT NULL REFERENCES sonar_scans(id),
    signal_id     BIGINT NOT NULL REFERENCES sonar_signals(id),
    price_at_scan DOUBLE PRECISION,
    PRIMARY KEY (scan_id, signal_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_signals_status      ON signals(status);
CREATE INDEX IF NOT EXISTS idx_signals_prospect    ON signals(prospect_id);
CREATE INDEX IF NOT EXISTS idx_node_template       ON template_nodes(template_id);
CREATE INDEX IF NOT EXISTS idx_node_depends        ON template_nodes(depends_on_id);
CREATE INDEX IF NOT EXISTS idx_instance_template   ON process_instances(template_id);
CREATE INDEX IF NOT EXISTS idx_instance_project    ON process_instances(project_id);
CREATE INDEX IF NOT EXISTS idx_instance_owner      ON process_instances(owner_id);
CREATE INDEX IF NOT EXISTS idx_node_state_inst     ON instance_node_states(instance_id);
CREATE INDEX IF NOT EXISTS idx_node_state_node     ON instance_node_states(template_node_id);
CREATE INDEX IF NOT EXISTS idx_team_manager        ON team_members(manager_id);
CREATE INDEX IF NOT EXISTS idx_node_files_node     ON node_files(template_node_id);
CREATE INDEX IF NOT EXISTS idx_node_files_instance ON node_files(instance_id);
CREATE INDEX IF NOT EXISTS idx_comments_node       ON node_comments(template_node_id, instance_id);
CREATE INDEX IF NOT EXISTS idx_pi_project          ON project_investors(project_id);
CREATE INDEX IF NOT EXISTS idx_pi_investor         ON project_investors(investor_id);
CREATE INDEX IF NOT EXISTS idx_projects_status     ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_acq_date   ON projects(acquisition_date DESC);
CREATE INDEX IF NOT EXISTS idx_instances_status    ON process_instances(status);
CREATE INDEX IF NOT EXISTS idx_instances_origin    ON process_instances(origin_instance_id);
CREATE INDEX IF NOT EXISTS idx_sonar_signals_cve     ON sonar_signals(municipio_cve);
CREATE INDEX IF NOT EXISTS idx_sonar_signals_colonia  ON sonar_signals(colonia);
CREATE INDEX IF NOT EXISTS idx_sonar_scan_signals     ON sonar_scan_signals(scan_id);

-- ─────────────────────────────────────────────────
-- Analyzer tables (Phase 1)
-- ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS zones (
  id        BIGSERIAL PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE CHECK (name != ''),
  cities    JSONB NOT NULL DEFAULT '[]',
  notes     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS analysis_snapshots (
  id                        BIGSERIAL PRIMARY KEY,
  prospect_id               BIGINT NOT NULL REFERENCES prospects(id),
  generated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  purchase_price            REAL NOT NULL,
  remodel_cost_estimate     REAL NOT NULL,
  remodel_cost_per_m2       REAL NOT NULL,
  intervention_level        TEXT NOT NULL,
  transaction_costs         REAL NOT NULL,
  financing_costs           REAL NOT NULL,
  total_cost                REAL NOT NULL,
  holding_period_months     INTEGER NOT NULL,
  exit_price_manual         REAL,
  exit_price_calculated_low REAL,
  exit_price_calculated_mid REAL,
  exit_price_calculated_high REAL,
  exit_price_source         TEXT NOT NULL DEFAULT 'manual'
                              CHECK (exit_price_source IN ('manual','calculated','blended')),
  exit_price_used           REAL NOT NULL,
  manual_vs_market_delta_pct REAL,
  comparable_count          INTEGER NOT NULL DEFAULT 0,
  comparable_ids            JSONB NOT NULL DEFAULT '[]',
  avg_comp_distance_km      REAL,
  gross_margin              REAL,
  roi_pct                   REAL,
  irr_pct                   REAL,
  cap_rate_pct              REAL,
  confidence_score          INTEGER NOT NULL DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 100),
  confidence_notes          TEXT NOT NULL DEFAULT '',
  data_quality_warnings     JSONB NOT NULL DEFAULT '[]',
  UNIQUE(prospect_id, generated_at)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_prospect_date
  ON analysis_snapshots(prospect_id, generated_at DESC);
