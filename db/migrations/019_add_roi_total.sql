-- migrate:up

-- Add roi_total: simple (non-annualized) return, (sale - cost) / cost.
-- Complements the existing CAGR-based `roi` column, which annualizes by hold_months.
--
-- NOTE: the base view definition here is the one from db/migrations/008_multi_images.sql
-- (which dropped image_path and recreated the view), NOT 006_unify_prospect_metrics.sql —
-- 006's version is stale; 008 is the last migration to touch this view before this one.
--
-- CREATE OR REPLACE VIEW (not DROP + CREATE) since roi_total is a new trailing
-- column appended after the existing columns — Postgres allows this without a drop,
-- as long as all existing columns keep their name/type/order.
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
    type,
    CASE
        WHEN (land_price * (1 + acquisition_cost_pct) + permits_cost + subdivision_cost + sqm_construction * construction_cost_per_sqm * construction_overhead) > 0
          AND projected_sale > 0
        THEN ROUND(
            ((projected_sale - (land_price * (1 + acquisition_cost_pct) + permits_cost + subdivision_cost + sqm_construction * construction_cost_per_sqm * construction_overhead))
             / (land_price * (1 + acquisition_cost_pct) + permits_cost + subdivision_cost + sqm_construction * construction_cost_per_sqm * construction_overhead))::numeric,
            4
        )
        ELSE NULL
    END AS roi_total
FROM prospects;

-- migrate:down

-- CREATE OR REPLACE VIEW cannot drop trailing columns (Postgres: "cannot drop
-- columns from view"), so restoring the pre-roi_total view requires DROP + CREATE,
-- matching the pattern used by 008_multi_images.sql itself.
DROP VIEW IF EXISTS prospect_metrics;
CREATE VIEW prospect_metrics AS
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
