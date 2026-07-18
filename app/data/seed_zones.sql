-- Zones for remodel cost segmentation
INSERT INTO zones (name, cities, notes) VALUES
  ('centro_monterrey',   '["Monterrey"]',          'Centro histórico y colonias aledañas'),
  ('san_pedro',          '["San Pedro Garza García"]', 'Casco urbano y zona Valle'),
  ('monterrey_general',  '["Monterrey"]',          'Colonias fuera del centro (Cumbres, Contry, etc.)'),
  ('zona_metropolitana', '["Guadalupe","Apodaca","Escobedo","Santa Catarina","Juárez"]', 'Resto del área metropolitana')
ON CONFLICT (name) DO NOTHING;
