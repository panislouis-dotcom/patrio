-- ─────────────────────────────────────────────────
-- PATRIO · Real Estate Knowledge Base
-- ─────────────────────────────────────────────────

-- Prospect pipeline (pre-commitment deals being evaluated)
CREATE TABLE IF NOT EXISTS prospects (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  name                     TEXT,
  address                  TEXT,
  city                     TEXT DEFAULT 'Monterrey',
  status                   TEXT DEFAULT 'evaluating',  -- evaluating | passed | converted
  url                      TEXT,
  latitude                 REAL,
  longitude                REAL,
  -- Size
  sqm_land                 REAL,   -- m2 terreno
  sqm_construction         REAL,   -- m2 construibles
  -- Cost inputs
  land_price               REAL,   -- Terreno (precio de compra)
  acquisition_cost_pct     REAL DEFAULT 0.065,  -- Costos de adquisición % (ISAI, honorarios, registro, avalúo, gestoría, imprevistos)
  permits_cost             REAL,   -- Permisos
  subdivision_cost         REAL,   -- Subdivisión
  construction_cost_per_sqm REAL,  -- P/m2 construcción
  construction_overhead    REAL DEFAULT 1.3,  -- IVA + indirectos (1.3 = +30%)
  -- Projected exit
  projected_sale           REAL,   -- Venta
  investment_date          TEXT,   -- Fecha Inv. YYYY-MM-DD
  sale_date                TEXT,   -- Fecha Venta YYYY-MM-DD
  -- Income
  rent_monthly             REAL,   -- Renta mensual proyectada
  notes                    TEXT,
  created_at               TEXT DEFAULT (datetime('now'))
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
  type              TEXT DEFAULT 'adaptive_reuse',  -- adaptive_reuse | ground_up | flip | land
  address           TEXT,
  city              TEXT DEFAULT 'Monterrey',
  status            TEXT DEFAULT 'stabilizing',     -- prospect | construction | stabilizing | operating | exited
  total_units       INTEGER,
  acquisition_date  TEXT,                           -- YYYY-MM
  first_rent_date   TEXT,                           -- YYYY-MM
  total_investment  REAL,
  current_valuation REAL,
  valuation_date    TEXT,                           -- YYYY-MM
  url               TEXT,
  latitude          REAL,
  longitude         REAL,
  -- JSON columns
  milestones        TEXT,  -- {"2021-02":"Adquisición","2023-07":"Primera renta",...}
  budget            TEXT,  -- {"Adquisición edificio":3225000,"Mano de obra":1729740,...}
  notes             TEXT,
  created_at        TEXT DEFAULT (datetime('now'))
);
