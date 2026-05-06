-- ─────────────────────────────────────────────────
-- Seed: Edificio Uno · Adaptive Reuse · Monterrey
-- ─────────────────────────────────────────────────

INSERT INTO projects (
  name, type, address, city, status, total_units,
  acquisition_date, first_rent_date,
  total_investment, current_valuation, valuation_date,
  url, latitude, longitude,
  milestones, budget, notes
) VALUES (
  'Edificio Uno',
  'adaptive_reuse',
  'Centro, Monterrey',
  'Monterrey',
  'operating',
  13,
  '2021-02',
  '2023-07',
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

  -- budget (category → amount)
  '{
    "Adquisición edificio (proporcional)": 3225000,
    "Notariales, ISAI, avalúo": 202500,
    "Mano de obra": 1729740,
    "Materiales": 1125912,
    "Ingeniería civil y supervisión": 138200,
    "Herramienta": 195410,
    "Acarreo de escombro": 123600,
    "Servicios públicos durante obra": 183099,
    "Predial durante obra": 42000,
    "Impuestos durante obra": 20683,
    "Combustibles y logística": 54900,
    "Otros gastos varios": 14868,
    "Mobiliario y equipamiento": 172716
  }',

  -- notes
  '6 unidades: 4 departamentos + 2 locales. H6/H7 sin activar, previstas jun 2026 renta corta Mundial.'
);
