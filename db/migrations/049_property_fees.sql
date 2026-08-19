-- migrate:up

-- Comisiones propias del fondo sobre cada propiedad — ver
-- docs/plans/2026-08-19-comisiones-de-inversion-design.md. Tres son
-- porcentajes-con-default (mismo molde que acquisition_cost_pct: nulo hasta
-- que alguien captura, default vivo en Python mientras tanto — sus defaults
-- NO van aquí, van en underwriting.ASSUMPTION_DEFAULTS, un solo lugar).
-- exit_rent_months es un multiplicador con el mismo molde. exit_strategy es
-- distinto: un hecho capturado, sin default — nulo significa que nadie ha
-- decidido el camino de salida todavía, y ninguna comisión de salida se
-- adivina a partir de eso.
ALTER TABLE properties ADD COLUMN land_commission_pct real;
ALTER TABLE properties ADD COLUMN construction_commission_pct real;
ALTER TABLE properties ADD COLUMN exit_sale_commission_pct real;
ALTER TABLE properties ADD COLUMN exit_rent_months real;
ALTER TABLE properties ADD COLUMN exit_strategy text;

ALTER TABLE properties ADD CONSTRAINT properties_land_commission_pct_check
  CHECK (land_commission_pct IS NULL OR land_commission_pct >= 0);
ALTER TABLE properties ADD CONSTRAINT properties_construction_commission_pct_check
  CHECK (construction_commission_pct IS NULL OR construction_commission_pct >= 0);
ALTER TABLE properties ADD CONSTRAINT properties_exit_sale_commission_pct_check
  CHECK (exit_sale_commission_pct IS NULL OR exit_sale_commission_pct >= 0);
ALTER TABLE properties ADD CONSTRAINT properties_exit_rent_months_check
  CHECK (exit_rent_months IS NULL OR exit_rent_months >= 0);
ALTER TABLE properties ADD CONSTRAINT properties_exit_strategy_check
  CHECK (exit_strategy IS NULL OR exit_strategy IN ('venta', 'renta'));

-- migrate:down

ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_exit_strategy_check;
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_exit_rent_months_check;
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_exit_sale_commission_pct_check;
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_construction_commission_pct_check;
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_land_commission_pct_check;
ALTER TABLE properties DROP COLUMN IF EXISTS exit_strategy;
ALTER TABLE properties DROP COLUMN IF EXISTS exit_rent_months;
ALTER TABLE properties DROP COLUMN IF EXISTS exit_sale_commission_pct;
ALTER TABLE properties DROP COLUMN IF EXISTS construction_commission_pct;
ALTER TABLE properties DROP COLUMN IF EXISTS land_commission_pct;
