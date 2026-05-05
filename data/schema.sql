-- ─────────────────────────────────────────────────
-- PATRIO · Real Estate Knowledge Base
-- ─────────────────────────────────────────────────

-- Prospect pipeline (pre-commitment deals being evaluated)
CREATE TABLE IF NOT EXISTS prospects (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  name                     TEXT NOT NULL,
  address                  TEXT NOT NULL,
  city                     TEXT NOT NULL,
  status                   TEXT NOT NULL,  -- evaluating | passed | converted
  url                      TEXT NOT NULL,
  latitude                 REAL NOT NULL,
  longitude                REAL NOT NULL,
  -- Size
  sqm_land                 REAL NOT NULL,   -- m2 terreno
  sqm_construction         REAL NOT NULL,   -- m2 construibles
  -- Cost inputs
  land_price               REAL NOT NULL,   -- Terreno (precio de compra)
  acquisition_cost_pct     REAL NOT NULL,   -- Costos de adquisición % (ISAI, honorarios, registro, avalúo, gestoría, imprevistos)
  permits_cost             REAL NOT NULL,   -- Permisos
  subdivision_cost         REAL NOT NULL,   -- Subdivisión
  construction_cost_per_sqm REAL NOT NULL,  -- P/m2 construcción
  construction_overhead    REAL NOT NULL,   -- IVA + indirectos (1.3 = +30%)
  -- Projected exit
  projected_sale           REAL NOT NULL,   -- Venta
  investment_date          TEXT NOT NULL,   -- Fecha Inv. YYYY-MM-DD
  sale_date                TEXT NOT NULL,   -- Fecha Venta YYYY-MM-DD
  -- Income
  rent_monthly             REAL NOT NULL,   -- Renta mensual proyectada
  notes                    TEXT NOT NULL,
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Computed metrics view (all formula-driven — never store these)
CREATE VIEW IF NOT EXISTS prospect_metrics AS
SELECT
  id, name, address, city, status, url,
  sqm_land,
  sqm_construction,
  land_price,
  acquisition_cost_pct,
  ROUND(land_price * acquisition_cost_pct, 0)    AS acquisition_costs,  -- ISAI, honorarios, registro, avalúo, gestoría, imprevistos
  ROUND(land_price * (1 + acquisition_cost_pct), 0) AS acquisition_total, -- Precio + costos de adquisición
  permits_cost,
  subdivision_cost,
  ROUND(sqm_construction * construction_cost_per_sqm, 0)                          AS construction_base,
  ROUND(sqm_construction * construction_cost_per_sqm * construction_overhead, 0)  AS construction_total,
  ROUND(land_price * (1 + acquisition_cost_pct) + permits_cost + subdivision_cost +
        sqm_construction * construction_cost_per_sqm * construction_overhead, 0)   AS total_investment,
  projected_sale,
  ROUND(projected_sale -
       (land_price * (1 + acquisition_cost_pct) + permits_cost + subdivision_cost +
        sqm_construction * construction_cost_per_sqm * construction_overhead), 0)  AS profit,
  ROUND((projected_sale -
        (land_price * (1 + acquisition_cost_pct) + permits_cost + subdivision_cost +
         sqm_construction * construction_cost_per_sqm * construction_overhead)) /
        (land_price * (1 + acquisition_cost_pct) + permits_cost + subdivision_cost +
         sqm_construction * construction_cost_per_sqm * construction_overhead), 4) AS roi,
  ROUND(rent_monthly * 12 / projected_sale, 4)   AS cap_rate,
  ROUND(land_price / sqm_land, 2)                AS land_price_per_sqm,
  ROUND(projected_sale / sqm_land, 2)            AS sale_per_sqm,
  ROUND((land_price * (1 + acquisition_cost_pct) + permits_cost + subdivision_cost +
         sqm_construction * construction_cost_per_sqm * construction_overhead)
        / sqm_land, 2)                            AS investment_per_sqm,
  rent_monthly,
  ROUND(rent_monthly * 12, 0)                    AS rent_annual,
  investment_date,
  sale_date,
  notes
FROM prospects;

-- ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS projects (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  type              TEXT NOT NULL,                  -- adaptive_reuse | ground_up | flip | land
  address           TEXT NOT NULL,
  city              TEXT NOT NULL,
  status            TEXT NOT NULL,                  -- prospect | construction | stabilizing | operating | exited
  total_units       INTEGER NOT NULL,
  acquisition_date  TEXT NOT NULL,                  -- YYYY-MM
  first_rent_date   TEXT NOT NULL,                  -- YYYY-MM
  total_investment  REAL NOT NULL,
  current_valuation REAL NOT NULL,
  valuation_date    TEXT NOT NULL,                  -- YYYY-MM
  url               TEXT NOT NULL,
  latitude          REAL NOT NULL,
  longitude         REAL NOT NULL,
  -- JSON columns
  milestones        TEXT NOT NULL,  -- {"2021-02":"Adquisición","2023-07":"Primera renta",...}
  budget            TEXT NOT NULL,  -- {"Adquisición edificio":3225000,"Mano de obra":1729740,...}
  notes             TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
