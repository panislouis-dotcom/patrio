-- Propiedad · prospecto: Casa Centro Modesto Arreola · Remodelación o proyecto vertical
INSERT INTO properties (
  name, address, city, status, asset_type, url,
  latitude, longitude,
  sqm_land, sqm_construction,
  land_price, acquisition_cost_pct, permits_cost, subdivision_cost,
  construction_cost_per_sqm, construction_overhead,
  projected_sale, hold_months,
  rent_monthly, notes
) VALUES (
  'Casa Centro Modesto Arreola',
  'Modesto Arreola, Centro, Monterrey NL',
  'Monterrey',
  'prospecto',
  'casa',
  'https://www.doorvel.com/home/propiedades/casas/en-venta/mexico/nuevo-leon/monterrey/243233',
  25.675033, -100.311313,
  110, 184,
  3500000, 0.06, 11000, 0,
  6000, 1.0,
  5000000, 20,
  35000,
  'Remodelación o proyecto vertical. Precio $3,500,000 MXN. Terreno 110 m², construcción 184 m². 3 habitaciones, 3 baños. Ideal para remodelar o crear proyecto vertical comercial o habitacional. Excelente ubicación en centro de Monterrey.'
);
