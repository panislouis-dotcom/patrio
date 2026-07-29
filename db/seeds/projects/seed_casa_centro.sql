-- ─────────────────────────────────────────────────
-- Seed: Casa Centro · Adaptive Reuse · Monterrey
-- Placeholder data — update with real figures
-- ─────────────────────────────────────────────────

INSERT INTO projects (
  name, type, address, city, status, total_units,
  acquisition_date, conclusion_date,
  total_investment, current_valuation, valuation_date,
  url, latitude, longitude,
  milestones, notes
) VALUES (
  'Casa Centro',
  'adaptive_reuse',
  'Barrio Antiguo, Centro, Monterrey',
  'Monterrey',
  'operating',
  3,
  '2022-09',
  '2023-09-01',
  3730000,
  6200000,
  '2026-04',
  'https://refigan.mx/casa-centro',  -- url (placeholder)
  25.6689,   -- approx, near Edificio Uno
  -100.3085,

  '{
    "2022-09": "Adquisición — casa histórica colindante a Edificio Uno",
    "2022-11": "Inicio de obra — redistribución interior, 3 unidades independientes",
    "2023-09": "Primera renta — 12 meses desde adquisición",
    "2024-06": "Operación plena — 3 unidades activas",
    "2026-04": "Valuación actualizada — $6.2M, 1.7x sobre inversión de $3.7M"
  }',

  '3 unidades de renta larga. Datos placeholder — actualizar con cifras reales.'
);
