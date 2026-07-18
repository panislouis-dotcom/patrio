-- Remodel cost baselines for Monterrey metropolitan area (May 2026)
--
-- Sources: market estimates from local contractors and published guides.
-- These are BASELINES to calibrate — actual costs vary by project scope.
--
-- Ranges by intervention level:
--   cosmetica : pintura, pisos, acabados superficiales
--   media     : baños, cocina, eléctrico, plomería parcial
--   total     : estructura, demolición interior, todo nuevo
--   obra_nueva: construcción desde cero (terreno baldío o demolición total)

-- Centro Monterrey
INSERT INTO remodel_costs (zone_id, intervention_level, cost_per_m2_mxn, includes, source, notes)
SELECT z.id, v.level, v.cost, v.includes::jsonb, 'estimación mercado local', v.notes
FROM zones z,
(VALUES
  ('cosmetica',  4500, '["pintura","pisos","limpieza_fachada"]',
   'Rango mercado: $3,500-$5,500/m². Baseline conservador.'),
  ('media',      9000, '["pisos","baños","cocina","eléctrico","plomería_parcial","pintura"]',
   'Rango mercado: $7,000-$12,000/m². Punto medio.'),
  ('total',     16000, '["demolición_interior","estructura","instalaciones","acabados","fachada"]',
   'Rango mercado: $13,000-$20,000/m². Incluye todo menos cimentación.'),
  ('obra_nueva', 6000, '["cimentación","estructura","instalaciones","acabados","fachada"]',
   'Costo actual usado en prospects: $6,000/m². Construcción completa.')
) AS v(level, cost, includes, notes)
WHERE z.name = 'centro_monterrey'
ON CONFLICT (zone_id, intervention_level, valid_from) DO NOTHING;

-- San Pedro Garza García (premium ~20-30% sobre centro)
INSERT INTO remodel_costs (zone_id, intervention_level, cost_per_m2_mxn, includes, source, notes)
SELECT z.id, v.level, v.cost, v.includes::jsonb, 'estimación mercado local', v.notes
FROM zones z,
(VALUES
  ('cosmetica',  5500, '["pintura","pisos","limpieza_fachada"]',
   'Premium ~22% vs centro. Materiales y mano de obra más caros.'),
  ('media',     11000, '["pisos","baños","cocina","eléctrico","plomería_parcial","pintura"]',
   'Premium ~22% vs centro.'),
  ('total',     20000, '["demolición_interior","estructura","instalaciones","acabados","fachada"]',
   'Premium ~25% vs centro. Acabados de mayor especificación.'),
  ('obra_nueva', 8000, '["cimentación","estructura","instalaciones","acabados","fachada"]',
   'Construcción completa en SPGG. Mayor especificación que centro.')
) AS v(level, cost, includes, notes)
WHERE z.name = 'san_pedro'
ON CONFLICT (zone_id, intervention_level, valid_from) DO NOTHING;

-- Monterrey General (similar a centro, ligeramente menor)
INSERT INTO remodel_costs (zone_id, intervention_level, cost_per_m2_mxn, includes, source, notes)
SELECT z.id, v.level, v.cost, v.includes::jsonb, 'estimación mercado local', v.notes
FROM zones z,
(VALUES
  ('cosmetica',  4000, '["pintura","pisos","limpieza_fachada"]',
   'Rango mercado: $3,500-$5,000/m².'),
  ('media',      8000, '["pisos","baños","cocina","eléctrico","plomería_parcial","pintura"]',
   'Rango mercado: $6,500-$10,000/m².'),
  ('total',     14000, '["demolición_interior","estructura","instalaciones","acabados","fachada"]',
   'Rango mercado: $11,000-$17,000/m².'),
  ('obra_nueva', 5500, '["cimentación","estructura","instalaciones","acabados","fachada"]',
   'Construcción estándar fuera de centro.')
) AS v(level, cost, includes, notes)
WHERE z.name = 'monterrey_general'
ON CONFLICT (zone_id, intervention_level, valid_from) DO NOTHING;

-- Zona Metropolitana (más económico)
INSERT INTO remodel_costs (zone_id, intervention_level, cost_per_m2_mxn, includes, source, notes)
SELECT z.id, v.level, v.cost, v.includes::jsonb, 'estimación mercado local', v.notes
FROM zones z,
(VALUES
  ('cosmetica',  3500, '["pintura","pisos","limpieza_fachada"]',
   'Rango mercado: $3,000-$4,500/m².'),
  ('media',      7000, '["pisos","baños","cocina","eléctrico","plomería_parcial","pintura"]',
   'Rango mercado: $5,500-$9,000/m².'),
  ('total',     13000, '["demolición_interior","estructura","instalaciones","acabados","fachada"]',
   'Rango mercado: $10,000-$16,000/m².'),
  ('obra_nueva', 5000, '["cimentación","estructura","instalaciones","acabados","fachada"]',
   'Construcción básica zona metropolitana.')
) AS v(level, cost, includes, notes)
WHERE z.name = 'zona_metropolitana'
ON CONFLICT (zone_id, intervention_level, valid_from) DO NOTHING;
