-- Prospect: Casa Centro Metro · Cerca estación de metro, 2 plantas
INSERT INTO prospects (
  name, address, city, status, url,
  latitude, longitude,
  sqm_land, sqm_construction,
  land_price, acquisition_cost_pct, permits_cost, subdivision_cost,
  construction_cost_per_sqm, construction_overhead,
  projected_sale, investment_date, sale_date,
  rent_monthly, notes
) VALUES (
  'Casa Centro Metro',
  'Centro de Monterrey, cerca estación de metro, Monterrey NL',
  'Monterrey',
  'evaluating',
  'https://monopolio.com.mx/busqueda/propiedad/casa-en-el-corazon-de-monterrey-oportunidad-4',
  25.668222, -100.327551,
  120, 112,
  2650000, 0.06, 11000, 0,
  6000, 1.0,
  5000000, '2025-06-01', '2027-02-01',
  17000,
  'Oportunidad centro. Precio $2,650,000 MXN ($23,661/m²). Terreno 120 m² (6m frente × 20m fondo). Construcción 112 m², 2 plantas. 2 baños. Cerca estación de metro. Ubicación céntrica.'
);
