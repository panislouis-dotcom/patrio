-- ─────────────────────────────────────────────────
-- Propiedad · en renta: Edificio Uno · Adaptive Reuse · Monterrey
-- rent_monthly_projected queda NULL a propósito: nunca se capturó la renta real y
-- inventarla la metería al PDF como si fuera un hecho.
-- ─────────────────────────────────────────────────

INSERT INTO properties (
  name, asset_type, strategy_type, address, city, status, total_units,
  acquisition_date, first_rent_date,
  total_investment_captured, current_valuation, valuation_date,
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
  9500000,
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
