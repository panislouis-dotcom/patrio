-- Propiedad · prospecto: Casa Centro Santiago Tapia · Remodelación o construcción
INSERT INTO properties (
  name, address, city, status, asset_type, url,
  latitude, longitude,
  sqm_land, sqm_construction,
  purchase_price, acquisition_cost_pct, permits_cost, subdivision_cost,
  construction_cost_per_sqm, construction_overhead,
  projected_sale, hold_months,
  rent_monthly_projected, notes
) VALUES (
  'Casa Centro Santiago Tapia',
  'Santiago Tapia Ote. 1626, Centro, Monterrey NL 64000',
  'Monterrey',
  'prospecto',
  'casa',
  'https://propiedades.com/inmuebles/casa-en-venta-santiago-tapia-ote-1626-centro-64000-monterrey-nl-1626-monterrey-centro-nuevo_leon-30863193',
  25.678003, -100.299049,
  198, 100,
  2650000, 0.065, 11000, 0,
  6000, 1.0,
  5000000, 8,
  25000,
  'Remodelación o construcción. Precio $2,650,000 MXN. Terreno 198 m², construcción 100 m², 1 piso. 2 recámaras, 2 baños. 33 años de antigüedad. Sobre Santiago Tapia Ote. 1626, Centro.'
);
