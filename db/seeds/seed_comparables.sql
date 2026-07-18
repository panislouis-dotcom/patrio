-- Comparable: Depto Semillero Purísima (inmuebles24)
INSERT INTO comparables (
  address, zone_id, m2, price, listing_url, source_portal, listed_at,
  neighborhood, city, lat, lng,
  bedrooms, bathrooms, parking_spots,
  property_type, condition, notes
) VALUES (
  'Semillero, Purísima, Monterrey NL',
  (SELECT id FROM zones WHERE name = 'centro_monterrey'),
  92, 6500000,
  'https://www.inmuebles24.com/propiedades/clasificado/veclapin-departamento-en-venta-en-semillero-purisima-147968319.html',
  'inmuebles24',
  '2026-05-13',
  'Purísima', 'Monterrey',
  25.671368, -100.324662,
  2, 2, 2,
  'depto', 'semi_nueva',
  'Doble altura, ampliable a 130 m². Se vende con muebles. 2 cajones de estacionamiento. 5 años de antigüedad.'
);

-- Comparable: Depto Barrio W, Centro Monterrey (inmuebles24)
INSERT INTO comparables (
  address, zone_id, m2, price, listing_url, source_portal, listed_at,
  neighborhood, city, lat, lng,
  bedrooms, bathrooms, parking_spots,
  property_type, condition, notes
) VALUES (
  'Barrio W, Centro, Monterrey NL',
  (SELECT id FROM zones WHERE name = 'centro_monterrey'),
  65, 5450000,
  'https://www.inmuebles24.com/propiedades/clasificado/veclapin-departamento-en-venta-en-barrio-w-zona-centro-de-148415258.html',
  'inmuebles24',
  '2026-05-13',
  'Centro', 'Monterrey',
  25.674242, -100.311060,
  2, 2, 1,
  'depto', 'nueva',
  'Piso 32. Equipado con cocina integral, 3 minisplit, boiler de paso. Amenidades: alberca, gym, cine, cowork. Mantenimiento $3,170/mes. Modelo 2 rec (actualmente 1 rec + sala, reversible).'
);

-- Comparable: Depto Centro Monterrey, cerca de Madero (inmuebles24)
INSERT INTO comparables (
  address, zone_id, m2, price, listing_url, source_portal, listed_at,
  neighborhood, city, lat, lng,
  bedrooms, bathrooms, parking_spots,
  property_type, condition, notes
) VALUES (
  'Centro, Monterrey NL (2 cuadras de Av. Madero)',
  (SELECT id FROM zones WHERE name = 'centro_monterrey'),
  97.3, 6500000,
  'https://www.inmuebles24.com/propiedades/clasificado/veclapin-departamento-en-venta-centro-de-monterrey-148300526.html',
  'inmuebles24',
  '2026-05-13',
  'Centro', 'Monterrey',
  25.682385, -100.330095,
  3, 2, NULL,
  'depto', 'nueva',
  '92.1 m² interior + 5.2 m² balcón. Incluye canceles, closets, cocina y A/C. Salida rápida a Constitución y túnel a SPGG.'
);

-- Comparable: Depto Centro Histórico, Tipo D (inmuebles24)
INSERT INTO comparables (
  address, zone_id, m2, price, listing_url, source_portal, listed_at,
  neighborhood, city, lat, lng,
  bedrooms, bathrooms, parking_spots,
  property_type, condition, notes
) VALUES (
  'Centro Histórico, Monterrey NL (cerca Fundidora/Santa Lucía)',
  (SELECT id FROM zones WHERE name = 'centro_monterrey'),
  90, 6813777,
  'https://www.inmuebles24.com/propiedades/clasificado/veclapin-departamento-en-venta-zona-centro-1-recmara-monterrey-146786195.html',
  'inmuebles24',
  '2026-05-13',
  'Centro', 'Monterrey',
  25.673929, -100.300056,
  2, 2, 1,
  'depto', 'nueva',
  'Tipo D 90 m². 2 rec + 1 flex. Incluye cocina + bodega. Acabados (pisos, puertas, baños equipados). Desarrollo nuevo con amenidades, seguridad 24/7, 3 elevadores.'
);

-- Comparable: Depto equipado 3 rec, Centro Monterrey (inmuebles24)
INSERT INTO comparables (
  address, zone_id, m2, price, listing_url, source_portal, listed_at,
  neighborhood, city, lat, lng,
  bedrooms, bathrooms, parking_spots,
  property_type, condition, notes
) VALUES (
  'Centro, Monterrey NL (vista al Cerro de la Silla)',
  (SELECT id FROM zones WHERE name = 'centro_monterrey'),
  97.3, 5400000,
  'https://www.inmuebles24.com/propiedades/clasificado/veclapin-departamento-equipado-de-3-recamaras-listo-para-145170100.html',
  'inmuebles24',
  '2026-05-13',
  'Centro', 'Monterrey',
  25.682505, -100.308477,
  3, 2, 1,
  'depto', 'nueva',
  'Equipado: minisplits inverter, closets, canceles, cocina cuarzo con parrilla/horno/campana, boiler de gas. Balcón con vista panorámica. Opción cajón extra.'
);
