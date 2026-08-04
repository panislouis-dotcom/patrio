-- ─────────────────────────────────────────────────
-- Propiedad · en renta: Casa Centro · Adaptive Reuse · Monterrey
-- Placeholder data — update with real figures
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
  'Casa Centro',
  'casa',
  'adaptive_reuse',
  'Barrio Antiguo, Centro, Monterrey',
  'Monterrey',
  'en_renta',
  3,
  '2022-09-01',
  '2023-09-01',   -- primera renta: 12 meses desde adquisición

  -- Total all-in de $3.73M que nunca se desglosó: todo entra como precio de
  -- compra, con el pct de adquisición en 0 EXPLÍCITO (NULL aplicaría el 6.5%
  -- del sistema y sumaría $242,450 que nadie pagó). Los otros cuatro en 0.
  3730000, 0,
  0, 0, 0, 0,

  6200000,
  '2026-04-01',
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
