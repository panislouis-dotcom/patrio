-- Propiedad · prospecto: Casa Centro + Depto Independiente · 3 niveles + sótano
INSERT INTO properties (
  name, address, city, status, asset_type, url,
  latitude, longitude,
  sqm_land, sqm_construction,
  land_price, acquisition_cost_pct, permits_cost, subdivision_cost,
  construction_cost_per_sqm, construction_overhead,
  projected_sale, hold_months,
  rent_monthly, notes
) VALUES (
  'Casa Centro + Depto Independiente',
  'Centro, Monterrey NL',
  'Monterrey',
  'prospecto',
  'casa',
  'https://www.doorvel.com/home/propiedades/casas/en-venta/mexico/nuevo-leon/monterrey/366526',
  25.674859, -100.311910,
  104, 225,
  3600000, 0.06, 11000, 0,
  6000, 1.0,
  7000000, 19,
  39000,
  'Casa con depto independiente en planta alta. Precio $3,600,000 MXN. Terreno 104 m², construcción 225 m². PB: sala-comedor, cocina, estancia, 2 baños, recámara con clóset, lavandería, patio. Sótano: bodega. PA (depto independiente): sala-comedor, cocina, 2 recámaras con clóset, 2 baños, patio. 3er nivel: cuarto de juegos, terraza descubierta. 4 baños total. Potencial de renta dual (casa + depto).'
);
