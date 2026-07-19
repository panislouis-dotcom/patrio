-- migrate:up

ALTER TABLE prospects ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT '';

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
  hold_months, notes, type
FROM prospects;

-- Allow prospects to be deleted even when referenced by projects
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_prospect_id_fkey;
ALTER TABLE projects ADD CONSTRAINT projects_prospect_id_fkey
  FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE SET NULL;

-- migrate:down
