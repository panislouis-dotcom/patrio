-- ─────────────────────────────────────────────────
-- Seed: Edificio Uno · Adaptive Reuse · Monterrey
-- ─────────────────────────────────────────────────

INSERT INTO projects (
  name, type, address, city, status, total_units,
  acquisition_date, conclusion_date,
  total_investment, current_valuation, valuation_date,
  url, latitude, longitude,
  milestones, notes
) VALUES (
  'Edificio Uno',
  'adaptive_reuse',
  'Centro, Monterrey',
  'Monterrey',
  'operating',
  13,
  '2021-02',
  '2023-07-01',
  9500000,
  19000000,
  '2026-04',
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
