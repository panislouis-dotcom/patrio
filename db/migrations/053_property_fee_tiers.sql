-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- Comisión de salida por escalones (Task 1/8 de comisiones venta/renta) — ver
-- docs/plans/2026-08-19-comisiones-de-inversion-design.md.
--
-- Hoy `properties.exit_sale_commission_pct` / `exit_rent_months` (049) guardan
-- UNA tasa plana por propiedad. Esta migración no las toca — siguen vivas, su
-- retiro es una migración futura separada — pero abre, al lado, la posibilidad
-- de que una propiedad defina en cambio una ESCALERA de tasas: "si el precio
-- de venta es >= $6.5M, comisión 7%; si es >= $5.5M, 6%; si no, 5%". Es
-- puramente expand: tabla nueva, nada existente cambia.
--
-- El modelo es de ESCALÓN, no marginal: gana el escalón de threshold más alto
-- que el valor logrado (precio de venta, o una mensualidad de renta) alcanza
-- o supera, y esa tasa se aplica al valor COMPLETO — no hay bracketing como en
-- ISR. `kind` separa la escalera de venta ('venta') de la de renta ('renta');
-- una propiedad puede tener ambas a la vez, cada una con su propia captura.
--
-- Cada escalera necesita un piso: exactamente un renglón por (property_id,
-- kind) con `threshold = NULL`, la tasa que aplica cuando el valor logrado no
-- alcanza ningún threshold capturado. Sin piso la escalera tendría un hueco
-- —un valor bajo cualquier threshold no resolvería a ninguna tasa— así que el
-- piso es obligatorio, no opcional, aunque eso vive como regla de aplicación
-- (la API), no como CHECK: Postgres no puede expresar "al menos una fila con
-- esta propiedad" dentro de la tabla misma.
--
-- Postgres NO deduplica NULLs bajo un UNIQUE normal (cada NULL se considera
-- distinto), así que UNIQUE (property_id, kind, threshold) por sí solo dejaría
-- capturar dos pisos para la misma escalera sin quejarse. El índice único
-- parcial de abajo —WHERE threshold IS NULL— es el que de verdad garantiza
-- "a lo más un piso por escalera".
--
-- Cero renglones para un (property_id, kind) NO es un error: significa "esta
-- propiedad no tiene escalera propia todavía", y la aplicación cae de vuelta a
-- la tasa plana default del modelo. Ese fallback vive en código, no aquí.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS property_fee_tiers (
    id          BIGSERIAL PRIMARY KEY,
    property_id BIGINT  NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL CHECK (kind IN ('venta', 'renta')),
    -- NULL solo en el escalón piso/"else" de la escalera.
    threshold   NUMERIC(14,2),
    rate        NUMERIC(5,4) NOT NULL CHECK (rate >= 0 AND rate <= 1),
    sort_order  INTEGER NOT NULL,
    UNIQUE (property_id, kind, sort_order),
    UNIQUE (property_id, kind, threshold)
);

-- A lo más un piso por escalera — ver nota arriba sobre por qué el UNIQUE de
-- la tabla no basta. Nombrado uq_* como el resto de los índices únicos
-- hechos a mano en este repo (uq_budgets_property, uq_budget_lines_residual).
--
-- Sin índice aparte para property_id solo: los dos UNIQUE de arriba ya
-- empiezan por property_id, así que su btree sirve igual de bien un lookup
-- por property_id solo (prefijo izquierdo) — incluido el que dispara
-- ON DELETE CASCADE al borrar una propiedad. Un tercer índice sería el mismo
-- prefijo repetido sin motivo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_property_fee_tiers_one_floor
    ON property_fee_tiers (property_id, kind) WHERE threshold IS NULL;

-- migrate:down

DROP TABLE IF EXISTS property_fee_tiers;
