-- migrate:up
SET lock_timeout = '5s';        -- ArgoCD PreSync corta a los 180s; no esperamos locks
SET statement_timeout = '150s'; -- dbmate envuelve el archivo en UNA transacción

-- ─────────────────────────────────────────────────────────────────────────────
-- Se retira el ANÁLISIS
--
-- Esto NO es un accidente ni una limpieza de tablas huérfanas: es la baja
-- deliberada de una herramienta completa. El ANÁLISIS —el modelo financiero
-- determinista que estimaba ARV contra comparables, costo de remodelación,
-- ROI/TIR de flip y NOI/cash-on-cash/VPN de Build & Hold, con su score de
-- confianza— deja de existir en el producto por decisión explícita. Se van con
-- él sus rutas, su módulo de cálculo y estas dos tablas.
--
-- LO QUE NO SE VA. `comparables` y `zones` se quedan enteras: son la página de
-- Comparables y el sonar, que viven por su cuenta y que el analizador
-- únicamente LEÍA. Que una tabla haya sido insumo de esta herramienta no la
-- vuelve parte de ella.
--
-- POR QUÉ SE TIRA EN VEZ DE APAGARSE. Un `is_active` o una tabla que nadie
-- lee es peor que no tenerla: sigue apareciendo en el esquema, sigue pidiendo
-- que alguien decida qué hacer con ella en cada migración futura, y miente
-- diciendo que el análisis sigue siendo una respuesta que el sistema sabe dar.
-- La 023 ya sentó el precedente —lo que deja de ser verdad se borra— y el
-- glosario no debe conservar palabras que el producto ya no usa.
--
-- LO QUE SE PIERDE. `analysis_snapshots` guardaba corridas del modelo, y una
-- corrida es una función de sus insumos: precio de compra, comparables y
-- supuestos, todos ellos vivos en `properties` y `comparables`. No es captura
-- manual —nadie tecleó un NOI— así que borrarlas no destruye trabajo humano.
-- `remodel_costs` eran baselines de mercado sembrados desde db/seeds, no datos
-- del negocio. El CASCADE está para las dependencias del propio esquema; no
-- hay tabla viva que cuelgue de éstas.

DROP TABLE IF EXISTS analysis_snapshots CASCADE;
DROP TABLE IF EXISTS remodel_costs CASCADE;

-- migrate:down
SET lock_timeout = '5s';
SET statement_timeout = '150s';

-- Vuelve a crear las dos tablas VACÍAS a propósito: la herramienta está
-- retirada por decisión, así que revertir devuelve la FORMA del esquema y no
-- su contenido. Nada de lo que guardaban se reconstruye —las corridas se
-- recalculaban desde `properties`/`comparables`, y los baselines venían de
-- db/seeds—, y por eso este sentido no necesita guarda: crear tablas vacías
-- siempre es seguro.
--
-- Las restricciones van EN LÍNEA, con los nombres que Postgres les da sola, en
-- vez de como ALTER TABLE aparte: así el bloque entero es idempotente igual
-- que su CREATE TABLE, y el esquema volcado sale idéntico al de antes.

CREATE TABLE IF NOT EXISTS analysis_snapshots (
    id bigserial PRIMARY KEY,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    purchase_price numeric(14,2) NOT NULL,
    remodel_cost_estimate numeric(14,2) NOT NULL,
    remodel_cost_per_m2 numeric(14,2) NOT NULL,
    intervention_level text NOT NULL,
    transaction_costs numeric(14,2) NOT NULL,
    financing_costs numeric(14,2) NOT NULL,
    total_cost numeric(14,2) NOT NULL,
    holding_period_months integer NOT NULL,
    exit_price_manual numeric(14,2),
    exit_price_calculated_low numeric(14,2),
    exit_price_calculated_mid numeric(14,2),
    exit_price_calculated_high numeric(14,2),
    exit_price_source text DEFAULT 'manual'::text NOT NULL,
    exit_price_used numeric(14,2) NOT NULL,
    manual_vs_market_delta_pct real,
    comparable_count integer DEFAULT 0 NOT NULL,
    comparable_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    avg_comp_distance_km real,
    gross_margin numeric(14,2),
    roi_pct real,
    irr_pct real,
    cap_rate_pct real,
    confidence_score integer DEFAULT 0 NOT NULL,
    confidence_notes text DEFAULT ''::text NOT NULL,
    data_quality_warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
    arv_manual_override numeric(14,2),
    renta_mensual_estimada numeric(14,2),
    tasa_interes_credito real,
    plazo_credito_meses integer,
    financiamiento_pct real,
    gastos_operativos_pct real,
    noi_anual numeric(14,2),
    debt_service_anual numeric(14,2),
    cash_flow_anual numeric(14,2),
    cash_on_cash_yr1_pct real,
    break_even_months integer,
    npv_10yr numeric(14,2),
    irr_10yr_pct real,
    property_id bigint NOT NULL REFERENCES properties(id),
    transaction_cost_pct real,
    listing_haircut real,
    discount_rate real,
    UNIQUE (property_id, generated_at),
    CONSTRAINT analysis_snapshots_confidence_score_check CHECK (((confidence_score >= 0) AND (confidence_score <= 100))),
    CONSTRAINT analysis_snapshots_exit_price_source_check CHECK ((exit_price_source = ANY (ARRAY['manual'::text, 'calculated'::text, 'blended'::text])))
);

COMMENT ON COLUMN analysis_snapshots.transaction_cost_pct IS 'Supuesto: costos de transacción como fracción del precio de compra.';
COMMENT ON COLUMN analysis_snapshots.listing_haircut IS 'Supuesto: castigo anuncio→venta aplicado al precio de cada comparable antes de estimar el precio de mercado.';
COMMENT ON COLUMN analysis_snapshots.discount_rate IS 'Supuesto: tasa anual con la que se descuenta el NPV a 10 años.';

CREATE INDEX IF NOT EXISTS idx_snapshots_property_date
  ON analysis_snapshots USING btree (property_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS remodel_costs (
    id bigserial PRIMARY KEY,
    zone_id bigint NOT NULL REFERENCES zones(id),
    intervention_level text NOT NULL,
    cost_per_m2_mxn numeric(14,2) NOT NULL,
    includes jsonb DEFAULT '[]'::jsonb NOT NULL,
    valid_from date DEFAULT CURRENT_DATE NOT NULL,
    valid_until date,
    source text DEFAULT ''::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    UNIQUE (zone_id, intervention_level, valid_from),
    CONSTRAINT remodel_costs_intervention_level_check CHECK ((intervention_level = ANY (ARRAY['cosmetica'::text, 'media'::text, 'total'::text, 'obra_nueva'::text])))
);
