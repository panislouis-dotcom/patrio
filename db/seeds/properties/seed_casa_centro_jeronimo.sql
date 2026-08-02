-- Propiedad · prospecto: Casa Centro Jerónimo Treviño · Near Thomas Alva Edison
INSERT INTO properties (
  name, address, city, status, asset_type, url,
  latitude, longitude,
  sqm_land, sqm_construction,
  land_price, acquisition_cost_pct, permits_cost, subdivision_cost,
  construction_cost_per_sqm, construction_overhead,
  projected_sale, hold_months,
  rent_monthly, notes
) VALUES (
  'Casa Centro Jerónimo Treviño',
  'Jerónimo Treviño casi esq. Thomas Alva Edison, Centro, Monterrey NL',
  'Monterrey',
  'prospecto',
  'casa',
  'https://www.inmuebles24.com/propiedades/clasificado/veclcain-casa-en-venta-en-el-centro-de-monterrey-nuevo-leon-149383453.html',
  25.684780, -100.334218,
  110, 134,
  2800000, 0.06, 11000, 0,
  6000, 1.0,
  5000000, 26,
  20000,
  'Flip / residencial. Precio $2,800,000 MXN. Terreno 110 m², construcción 134 m² (124 m² según anuncio, 134 m² según comprador). 1 planta. 2 recámaras amplias, 2 baños completos, 1 medio baño. Patio. Buen estado. Libre de gravamen. Acepta crédito. Cerca escuelas, hospitales, metro, transporte público, zonas comerciales y parques.'
);
