-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- Financial layer consolidation:
--   1. Drop the two derived-metric views (math now lives in apps/api/finance).
--   2. Convert all 38 float/int money columns to NUMERIC(14,2) (cotizaciones.monto
--      is already NUMERIC). float4 was exact only to 2^24 = 16,777,216 — pesos
--      above that were silently rounded. Ratios/rates/areas stay REAL.
--   3. Rebuild comparables.price_per_m2 generated column off the new NUMERIC price.
--   4. Add prospect's 11 underwriting inputs to projects (Project ⊇ Prospect).
-- NOTE: adding a breakdown (land_price) to a project switches its total_investment
-- from the stored column to a computed value in the API layer (intended).
-- ─────────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS prospect_metrics;
DROP VIEW IF EXISTS project_investor_metrics;

-- 2a. Money columns → NUMERIC(14,2)
ALTER TABLE prospects
    ALTER COLUMN land_price                TYPE NUMERIC(14,2) USING ROUND(land_price::numeric, 2),
    ALTER COLUMN permits_cost              TYPE NUMERIC(14,2) USING ROUND(permits_cost::numeric, 2),
    ALTER COLUMN subdivision_cost          TYPE NUMERIC(14,2) USING ROUND(subdivision_cost::numeric, 2),
    ALTER COLUMN construction_cost_per_sqm TYPE NUMERIC(14,2) USING ROUND(construction_cost_per_sqm::numeric, 2),
    ALTER COLUMN projected_sale            TYPE NUMERIC(14,2) USING ROUND(projected_sale::numeric, 2),
    ALTER COLUMN rent_monthly              TYPE NUMERIC(14,2) USING ROUND(rent_monthly::numeric, 2);

ALTER TABLE projects
    ALTER COLUMN total_investment  TYPE NUMERIC(14,2) USING ROUND(total_investment::numeric, 2),
    ALTER COLUMN current_valuation TYPE NUMERIC(14,2) USING ROUND(current_valuation::numeric, 2);

ALTER TABLE profit_split_config
    ALTER COLUMN exit_price       TYPE NUMERIC(14,2) USING ROUND(exit_price::numeric, 2),
    ALTER COLUMN investor_capital TYPE NUMERIC(14,2) USING ROUND(investor_capital::numeric, 2);

ALTER TABLE project_investors
    ALTER COLUMN interested_amount TYPE NUMERIC(14,2) USING ROUND(interested_amount::numeric, 2),
    ALTER COLUMN committed_amount  TYPE NUMERIC(14,2) USING ROUND(committed_amount::numeric, 2),
    ALTER COLUMN funded_amount     TYPE NUMERIC(14,2) USING ROUND(funded_amount::numeric, 2),
    ALTER COLUMN return_amount     TYPE NUMERIC(14,2) USING ROUND(return_amount::numeric, 2);

ALTER TABLE signals
    ALTER COLUMN price TYPE NUMERIC(14,2) USING ROUND(price::numeric, 2);

ALTER TABLE sonar_signals
    ALTER COLUMN price      TYPE NUMERIC(14,2) USING ROUND(price::numeric, 2),
    ALTER COLUMN last_price TYPE NUMERIC(14,2) USING ROUND(last_price::numeric, 2);

ALTER TABLE sonar_scan_signals
    ALTER COLUMN price_at_scan TYPE NUMERIC(14,2) USING ROUND(price_at_scan::numeric, 2);

ALTER TABLE analysis_snapshots
    ALTER COLUMN purchase_price             TYPE NUMERIC(14,2) USING ROUND(purchase_price::numeric, 2),
    ALTER COLUMN remodel_cost_estimate      TYPE NUMERIC(14,2) USING ROUND(remodel_cost_estimate::numeric, 2),
    ALTER COLUMN remodel_cost_per_m2        TYPE NUMERIC(14,2) USING ROUND(remodel_cost_per_m2::numeric, 2),
    ALTER COLUMN transaction_costs          TYPE NUMERIC(14,2) USING ROUND(transaction_costs::numeric, 2),
    ALTER COLUMN financing_costs            TYPE NUMERIC(14,2) USING ROUND(financing_costs::numeric, 2),
    ALTER COLUMN total_cost                 TYPE NUMERIC(14,2) USING ROUND(total_cost::numeric, 2),
    ALTER COLUMN exit_price_manual          TYPE NUMERIC(14,2) USING ROUND(exit_price_manual::numeric, 2),
    ALTER COLUMN exit_price_calculated_low  TYPE NUMERIC(14,2) USING ROUND(exit_price_calculated_low::numeric, 2),
    ALTER COLUMN exit_price_calculated_mid  TYPE NUMERIC(14,2) USING ROUND(exit_price_calculated_mid::numeric, 2),
    ALTER COLUMN exit_price_calculated_high TYPE NUMERIC(14,2) USING ROUND(exit_price_calculated_high::numeric, 2),
    ALTER COLUMN exit_price_used            TYPE NUMERIC(14,2) USING ROUND(exit_price_used::numeric, 2),
    ALTER COLUMN gross_margin               TYPE NUMERIC(14,2) USING ROUND(gross_margin::numeric, 2),
    ALTER COLUMN arv_manual_override        TYPE NUMERIC(14,2) USING ROUND(arv_manual_override::numeric, 2),
    ALTER COLUMN renta_mensual_estimada     TYPE NUMERIC(14,2) USING ROUND(renta_mensual_estimada::numeric, 2),
    ALTER COLUMN noi_anual                  TYPE NUMERIC(14,2) USING ROUND(noi_anual::numeric, 2),
    ALTER COLUMN debt_service_anual         TYPE NUMERIC(14,2) USING ROUND(debt_service_anual::numeric, 2),
    ALTER COLUMN cash_flow_anual            TYPE NUMERIC(14,2) USING ROUND(cash_flow_anual::numeric, 2),
    ALTER COLUMN npv_10yr                   TYPE NUMERIC(14,2) USING ROUND(npv_10yr::numeric, 2);

ALTER TABLE remodel_costs
    ALTER COLUMN cost_per_m2_mxn TYPE NUMERIC(14,2) USING ROUND(cost_per_m2_mxn::numeric, 2);

-- 3. comparables.price (BIGINT) → NUMERIC; rebuild the generated column off it
ALTER TABLE comparables DROP COLUMN IF EXISTS price_per_m2;
ALTER TABLE comparables
    ALTER COLUMN price TYPE NUMERIC(14,2) USING ROUND(price::numeric, 2);
ALTER TABLE comparables
    ADD COLUMN IF NOT EXISTS price_per_m2 NUMERIC(14,2)
        GENERATED ALWAYS AS (price / NULLIF(m2, 0)) STORED;

-- 4. Project ⊇ Prospect: the 11 underwriting inputs (nullable; money → NUMERIC,
--    areas/ratios → REAL, hold_months → INTEGER, mirroring prospects)
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS sqm_land                  REAL,
    ADD COLUMN IF NOT EXISTS sqm_construction          REAL,
    ADD COLUMN IF NOT EXISTS land_price                NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS acquisition_cost_pct      REAL,
    ADD COLUMN IF NOT EXISTS permits_cost              NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS subdivision_cost          NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS construction_cost_per_sqm NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS construction_overhead     REAL,
    ADD COLUMN IF NOT EXISTS projected_sale            NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS hold_months               INTEGER,
    ADD COLUMN IF NOT EXISTS rent_monthly              NUMERIC(14,2);

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS prospect_id INTEGER REFERENCES prospects(id);

-- migrate:down

ALTER TABLE projects
    DROP COLUMN IF EXISTS sqm_land,
    DROP COLUMN IF EXISTS sqm_construction,
    DROP COLUMN IF EXISTS land_price,
    DROP COLUMN IF EXISTS acquisition_cost_pct,
    DROP COLUMN IF EXISTS permits_cost,
    DROP COLUMN IF EXISTS subdivision_cost,
    DROP COLUMN IF EXISTS construction_cost_per_sqm,
    DROP COLUMN IF EXISTS construction_overhead,
    DROP COLUMN IF EXISTS projected_sale,
    DROP COLUMN IF EXISTS hold_months,
    DROP COLUMN IF EXISTS rent_monthly;
-- NOTE: prospect_id is left in place on down (it predates this migration).

ALTER TABLE comparables DROP COLUMN IF EXISTS price_per_m2;
ALTER TABLE comparables ALTER COLUMN price TYPE BIGINT USING ROUND(price)::bigint;
ALTER TABLE comparables
    ADD COLUMN IF NOT EXISTS price_per_m2 REAL
        GENERATED ALWAYS AS (price::real / NULLIF(m2, 0)) STORED;

ALTER TABLE remodel_costs
    ALTER COLUMN cost_per_m2_mxn TYPE INTEGER USING ROUND(cost_per_m2_mxn)::integer;

ALTER TABLE analysis_snapshots
    ALTER COLUMN purchase_price             TYPE REAL USING purchase_price::real,
    ALTER COLUMN remodel_cost_estimate      TYPE REAL USING remodel_cost_estimate::real,
    ALTER COLUMN remodel_cost_per_m2        TYPE REAL USING remodel_cost_per_m2::real,
    ALTER COLUMN transaction_costs          TYPE REAL USING transaction_costs::real,
    ALTER COLUMN financing_costs            TYPE REAL USING financing_costs::real,
    ALTER COLUMN total_cost                 TYPE REAL USING total_cost::real,
    ALTER COLUMN exit_price_manual          TYPE REAL USING exit_price_manual::real,
    ALTER COLUMN exit_price_calculated_low  TYPE REAL USING exit_price_calculated_low::real,
    ALTER COLUMN exit_price_calculated_mid  TYPE REAL USING exit_price_calculated_mid::real,
    ALTER COLUMN exit_price_calculated_high TYPE REAL USING exit_price_calculated_high::real,
    ALTER COLUMN exit_price_used            TYPE REAL USING exit_price_used::real,
    ALTER COLUMN gross_margin               TYPE REAL USING gross_margin::real,
    ALTER COLUMN arv_manual_override        TYPE REAL USING arv_manual_override::real,
    ALTER COLUMN renta_mensual_estimada     TYPE REAL USING renta_mensual_estimada::real,
    ALTER COLUMN noi_anual                  TYPE REAL USING noi_anual::real,
    ALTER COLUMN debt_service_anual         TYPE REAL USING debt_service_anual::real,
    ALTER COLUMN cash_flow_anual            TYPE REAL USING cash_flow_anual::real,
    ALTER COLUMN npv_10yr                   TYPE REAL USING npv_10yr::real;

ALTER TABLE sonar_scan_signals
    ALTER COLUMN price_at_scan TYPE DOUBLE PRECISION USING price_at_scan::double precision;

ALTER TABLE sonar_signals
    ALTER COLUMN price      TYPE DOUBLE PRECISION USING price::double precision,
    ALTER COLUMN last_price TYPE DOUBLE PRECISION USING last_price::double precision;

ALTER TABLE signals
    ALTER COLUMN price TYPE REAL USING price::real;

ALTER TABLE project_investors
    ALTER COLUMN interested_amount TYPE REAL USING interested_amount::real,
    ALTER COLUMN committed_amount  TYPE REAL USING committed_amount::real,
    ALTER COLUMN funded_amount     TYPE REAL USING funded_amount::real,
    ALTER COLUMN return_amount     TYPE REAL USING return_amount::real;

ALTER TABLE profit_split_config
    ALTER COLUMN exit_price       TYPE REAL USING exit_price::real,
    ALTER COLUMN investor_capital TYPE REAL USING investor_capital::real;

ALTER TABLE projects
    ALTER COLUMN total_investment  TYPE REAL USING total_investment::real,
    ALTER COLUMN current_valuation TYPE REAL USING current_valuation::real;

ALTER TABLE prospects
    ALTER COLUMN land_price                TYPE REAL USING land_price::real,
    ALTER COLUMN permits_cost              TYPE REAL USING permits_cost::real,
    ALTER COLUMN subdivision_cost          TYPE REAL USING subdivision_cost::real,
    ALTER COLUMN construction_cost_per_sqm TYPE REAL USING construction_cost_per_sqm::real,
    ALTER COLUMN projected_sale            TYPE REAL USING projected_sale::real,
    ALTER COLUMN rent_monthly              TYPE REAL USING rent_monthly::real;

-- Restore the two views verbatim (prospect_metrics from 019, project_investor_metrics from 000)
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

CREATE VIEW project_investor_metrics AS
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
