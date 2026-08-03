-- ─────────────────────────────────────────────────
-- Propiedad · en renta: Edificio Uno · Adaptive Reuse · Monterrey
-- rent_monthly_projected queda NULL a propósito: nunca se capturó la renta real y
-- inventarla la metería al PDF como si fuera un hecho.
-- ─────────────────────────────────────────────────

INSERT INTO properties (
  name, asset_type, strategy_type, address, city, status, total_units,
  acquisition_date, first_rent_date,
  purchase_price, acquisition_cost_pct,
  permits_cost, subdivision_cost, sqm_construction, construction_cost_per_sqm,
  current_valuation, valuation_date,
  url, latitude, longitude,
  milestones, notes
) VALUES (
  'Edificio Uno',
  'edificio',
  'adaptive_reuse',
  'Centro, Monterrey',
  'Monterrey',
  'en_renta',
  13,
  '2021-02-01',
  '2023-07-01',   -- primera renta: 30 meses desde adquisición

  -- La inversión de $9.5M es un total all-in que nunca se desglosó. En la única
  -- gramática que existe se dice así: todo en el precio de compra, con el pct de
  -- adquisición en 0 EXPLÍCITO — NULL significaría «aplica el 6.5% del sistema»
  -- y le sumaría $617,500 que nadie pagó. Los otros cuatro costos en 0 porque no
  -- hay obra a ejecutar que sumar aparte: ya está adentro del total.
  9500000, 0,
  0, 0, 0, 0,

  19000000,
  '2026-04-01',
  'https://refigan.mx/edificio-uno',  -- url (placeholder)
  25.6694,    -- latitude  (Centro Monterrey approx — update with exact coords)
  -100.3098,  -- longitude

  -- milestones (ordered date → description)
  '{
    "2021-02": "Adquisición del inmueble — edificio histórico + casa adyacente",
    "2021-06": "Inicio de obra — rescate estructural, sillar expuesto, patio central",
    "2023-07": "Primera renta — 30 meses desde adquisición, obra integral en histórico",
    "2024-01": "Estabilización — ocupación creciente durante 2024–2025",
    "2026-01": "Operación plena — 11 de 13 unidades activas",
    "2026-04": "Valuación actualizada — $19M, 2x sobre inversión de $9.5M"
  }',

  -- notes
  '6 unidades: 4 departamentos + 2 locales. H6/H7 sin activar, previstas jun 2026 renta corta Mundial.'
);
