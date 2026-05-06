-- ─────────────────────────────────────────────────
-- PATRIO · Real Estate Knowledge Base
-- ─────────────────────────────────────────────────

-- Prospect pipeline (pre-commitment deals being evaluated)
CREATE TABLE IF NOT EXISTS prospects (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  name                     TEXT NOT NULL CHECK (name != ''),
  address                  TEXT NOT NULL CHECK (address != ''),
  city                     TEXT NOT NULL CHECK (city != ''),
  status                   TEXT NOT NULL CHECK (status != ''),  -- evaluating | passed | converted
  url                      TEXT NOT NULL CHECK (url != ''),
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
  hold_months              INTEGER NOT NULL DEFAULT 12,  -- Plazo estimado en meses
  -- Income
  rent_monthly             REAL NOT NULL CHECK (rent_monthly > 0),  -- Renta mensual proyectada
  notes                    TEXT NOT NULL CHECK (notes != ''),
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
  hold_months,
  notes
FROM prospects;

-- ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS projects (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL CHECK (name != ''),
  type              TEXT NOT NULL CHECK (type != ''),                  -- adaptive_reuse | ground_up | flip | land
  address           TEXT NOT NULL CHECK (address != ''),
  city              TEXT NOT NULL CHECK (city != ''),
  status            TEXT NOT NULL CHECK (status != ''),                -- prospect | construction | stabilizing | operating | exited
  total_units       INTEGER NOT NULL,
  acquisition_date  TEXT NOT NULL CHECK (acquisition_date != ''),      -- YYYY-MM
  first_rent_date   TEXT NOT NULL CHECK (first_rent_date != ''),       -- YYYY-MM
  total_investment  REAL NOT NULL,
  current_valuation REAL NOT NULL,
  valuation_date    TEXT NOT NULL CHECK (valuation_date != ''),        -- YYYY-MM
  url               TEXT NOT NULL CHECK (url != ''),
  latitude          REAL NOT NULL,
  longitude         REAL NOT NULL,
  -- JSON columns
  milestones        TEXT NOT NULL CHECK (milestones != ''),  -- {"2021-02":"Adquisición","2023-07":"Primera renta",...}
  budget            TEXT NOT NULL CHECK (budget != ''),      -- {"Adquisición edificio":3225000,"Mano de obra":1729740,...}
  notes             TEXT NOT NULL CHECK (notes != ''),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  portal        TEXT NOT NULL,
  url           TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  address       TEXT NOT NULL DEFAULT '',
  city          TEXT NOT NULL DEFAULT 'Monterrey',
  price         REAL NOT NULL DEFAULT 0,
  sqm_land      REAL NOT NULL DEFAULT 0,
  raw_data      TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'new',  -- new | dismissed | imported
  prospect_id   INTEGER REFERENCES prospects(id),
  scraped_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
