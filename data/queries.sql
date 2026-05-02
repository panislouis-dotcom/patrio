-- ─────────────────────────────────────────────────
-- PATRIO · Useful Queries
-- ─────────────────────────────────────────────────

-- Prospect pipeline
SELECT name, status,
  printf('$%,.0f', total_investment)  AS inversion,
  printf('$%,.0f', projected_sale)    AS venta,
  printf('$%,.0f', profit)            AS utilidad,
  printf('%.1f%%', roi * 100)         AS roi,
  printf('%.1f%%', cap_rate * 100)    AS cap_rate,
  printf('$%,.0f', rent_monthly)      AS renta_mes
FROM prospect_metrics;

-- ─────────────────────────────────────────────────
-- Portfolio summary
SELECT
  name,
  status,
  printf('$%,.0f', total_investment)              AS invested,
  printf('$%,.0f', current_valuation)             AS valuation,
  printf('%.1fx', current_valuation/total_investment) AS multiple,
  total_units,
  url,
  latitude,
  longitude
FROM projects;

-- Budget breakdown via json_each (one row per item, sortable)
SELECT key AS category, printf('$%,.0f', value) AS amount
FROM projects, json_each(projects.budget)
WHERE projects.id = 1
ORDER BY CAST(value AS REAL) DESC;

-- Budget total
SELECT printf('$%,.0f', SUM(value)) AS total
FROM projects, json_each(projects.budget)
WHERE projects.id = 1;

-- Milestones (sorted by date key)
SELECT key AS date, value AS milestone
FROM projects, json_each(projects.milestones)
WHERE projects.id = 1
ORDER BY key;

