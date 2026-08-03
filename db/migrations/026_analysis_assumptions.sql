-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- Los supuestos del analizador dejan de ser invisibles  (Fase A · punto 6)
--
-- `analysis_snapshots` se documenta como "snapshot inmutable": el registro
-- completo de una corrida, para poder volver a leerla años después y saber con
-- qué se calculó. Pero tres de los supuestos que mueven sus resultados no
-- estaban guardados en ninguna parte:
--
--   · `transaction_cost_pct` (0.08) — entraba como parámetro del request pero
--     solo sobrevivía multiplicado, dentro de `transaction_costs`.
--   · `listing_haircut` (0.06) — el castigo anuncio→venta que se aplica a TODO
--     comparable antes de calcular el precio de mercado. Era un default de
--     `find_comparables` que nadie podía ni ver ni cambiar.
--   · `discount_rate` (0.10) — la tasa con la que se descuenta el NPV a 10
--     años. Era un default de `analyze_property` que la ruta jamás pasaba.
--
-- Sin ellos, "NPV 10 AÑOS" y "PRECIO MERCADO MEDIO" se publican como resultados
-- de un modelo cuyos parámetros no se pueden auditar.
--
-- Backfill: los tres se pueden reconstruir para las corridas existentes sin
-- inventar nada. El haircut y la tasa de descuento eran constantes literales en
-- el código, así que toda corrida anterior usó 0.06 y 0.10 — es un hecho, no
-- una suposición. El costo de transacción se recupera dividiendo lo que ya está
-- guardado; donde el precio de compra es cero la división no existe y la
-- columna queda NULL, que es lo que corresponde cuando no se sabe.
-- ─────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '5s';
SET statement_timeout = '150s';

ALTER TABLE analysis_snapshots
    ADD COLUMN IF NOT EXISTS transaction_cost_pct REAL,
    ADD COLUMN IF NOT EXISTS listing_haircut      REAL,
    ADD COLUMN IF NOT EXISTS discount_rate        REAL;

COMMENT ON COLUMN analysis_snapshots.transaction_cost_pct IS
    'Supuesto: costos de transacción como fracción del precio de compra.';
COMMENT ON COLUMN analysis_snapshots.listing_haircut IS
    'Supuesto: castigo anuncio→venta aplicado al precio de cada comparable antes de estimar el precio de mercado.';
COMMENT ON COLUMN analysis_snapshots.discount_rate IS
    'Supuesto: tasa anual con la que se descuenta el NPV a 10 años.';

UPDATE analysis_snapshots
   SET transaction_cost_pct = CASE WHEN purchase_price > 0
                                   THEN round(transaction_costs / purchase_price, 4)
                              END,
       listing_haircut = 0.06,
       discount_rate   = 0.10
 WHERE transaction_cost_pct IS NULL
   AND listing_haircut      IS NULL
   AND discount_rate        IS NULL;

-- migrate:down

ALTER TABLE analysis_snapshots
    DROP COLUMN IF EXISTS transaction_cost_pct,
    DROP COLUMN IF EXISTS listing_haircut,
    DROP COLUMN IF EXISTS discount_rate;
