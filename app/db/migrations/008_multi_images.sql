-- migrate:up

CREATE TABLE IF NOT EXISTS prospect_images (
  id           BIGSERIAL PRIMARY KEY,
  prospect_id  BIGINT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  file_path    TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  content_type TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_images (
  id           BIGSERIAL PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_path    TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  content_type TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migrate existing single images (skip empty paths, skip already-migrated rows)
INSERT INTO prospect_images (prospect_id, file_path, file_name, content_type)
SELECT id, image_path, split_part(image_path, '/', -1), 'image/jpeg'
FROM prospects
WHERE image_path != ''
  AND NOT EXISTS (
    SELECT 1 FROM prospect_images pi WHERE pi.prospect_id = prospects.id AND pi.file_path = prospects.image_path
  );

INSERT INTO project_images (project_id, file_path, file_name, content_type)
SELECT id, image_path, split_part(image_path, '/', -1), 'image/jpeg'
FROM projects
WHERE image_path != ''
  AND NOT EXISTS (
    SELECT 1 FROM project_images pi WHERE pi.project_id = projects.id AND pi.file_path = projects.image_path
  );

-- Drop the dependent view before dropping the column, then recreate it without image_path
DROP VIEW IF EXISTS prospect_metrics;

-- Drop obsolete scalar columns
ALTER TABLE prospects DROP COLUMN IF EXISTS image_path;
ALTER TABLE projects  DROP COLUMN IF EXISTS image_path;

-- Recreate prospect_metrics view without image_path
CREATE OR REPLACE VIEW prospect_metrics AS
SELECT
    id,
    name,
    address,
    city,
    status,
    url,
    sqm_land,
    sqm_construction,
    land_price,
    acquisition_cost_pct,
    ROUND((land_price * acquisition_cost_pct)::numeric, 0) AS acquisition_costs,
    ROUND((land_price * (1 + acquisition_cost_pct))::numeric, 0) AS acquisition_total,
    permits_cost,
    subdivision_cost,
    ROUND((sqm_construction * construction_cost_per_sqm)::numeric, 0) AS construction_base,
    ROUND((sqm_construction * construction_cost_per_sqm * construction_overhead)::numeric, 0) AS construction_total,
    ROUND((land_price * (1 + acquisition_cost_pct) + permits_cost + subdivision_cost + sqm_construction * construction_cost_per_sqm * construction_overhead)::numeric, 0) AS total_investment,
    projected_sale,
    ROUND((projected_sale - (land_price * (1 + acquisition_cost_pct) + permits_cost + subdivision_cost + sqm_construction * construction_cost_per_sqm * construction_overhead))::numeric, 0) AS profit,
    CASE
        WHEN hold_months > 0
          AND (land_price * (1 + acquisition_cost_pct) + permits_cost + subdivision_cost + sqm_construction * construction_cost_per_sqm * construction_overhead) > 0
          AND projected_sale > 0
        THEN ROUND(
            (POWER(
                projected_sale / (land_price * (1 + acquisition_cost_pct) + permits_cost + subdivision_cost + sqm_construction * construction_cost_per_sqm * construction_overhead),
                12.0 / hold_months
            ) - 1)::numeric,
            4
        )
        ELSE NULL
    END AS roi,
    ROUND((rent_monthly * 12 * 0.70 / NULLIF(projected_sale, 0))::numeric, 4) AS cap_rate,
    ROUND((land_price / NULLIF(sqm_land, 0))::numeric, 2) AS land_price_per_sqm,
    ROUND((projected_sale / NULLIF(sqm_land, 0))::numeric, 2) AS sale_per_sqm,
    ROUND(((land_price * (1 + acquisition_cost_pct) + permits_cost + subdivision_cost + sqm_construction * construction_cost_per_sqm * construction_overhead) / NULLIF(sqm_land, 0))::numeric, 2) AS investment_per_sqm,
    rent_monthly,
    ROUND((rent_monthly * 12)::numeric, 0) AS rent_annual,
    hold_months,
    notes,
    type
FROM prospects;

-- migrate:down
