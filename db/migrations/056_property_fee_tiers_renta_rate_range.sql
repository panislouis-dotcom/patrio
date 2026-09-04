-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- Renta commission model change — ver docs/plans (comisión de salida por
-- escalones, kind='renta'). Hasta ahora `rate` en 'renta' era, igual que en
-- 'venta', una FRACCIÓN de [0, 1] (5% de UNA mensualidad de renta). El dueño
-- del producto marcó ese número como irreal: la convención real del fondo es
-- cobrar un NÚMERO DE RENTAS (2, 3, 4+ mensualidades), muy por arriba de 1.
--
-- El CHECK original (`rate >= 0 AND rate <= 1`) era kind-agnóstico y por
-- tanto rechazaba a nivel de base de datos cualquier tramo de renta con
-- `rate > 1`, independientemente de la validación de aplicación
-- (`fee_tiers.validate_tiers`, ya actualizada para exigir solo `rate >= 0`
-- del lado de renta). Esta migración alinea el CHECK con esa regla: venta
-- sigue acotada a [0, 1] (sigue siendo una fracción de precio de venta),
-- renta pierde el tope superior (sigue sin admitir negativos).
--
-- NUMERIC(5,4) no cambia — su máximo representable (9.9999) tiene sobra para
-- los valores reales de "número de rentas" (2-6), no hace falta ampliar
-- precisión.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE property_fee_tiers DROP CONSTRAINT property_fee_tiers_rate_check;
ALTER TABLE property_fee_tiers ADD CONSTRAINT property_fee_tiers_rate_check
    CHECK ((kind = 'venta' AND rate >= 0 AND rate <= 1) OR (kind = 'renta' AND rate >= 0));

-- migrate:down

ALTER TABLE property_fee_tiers DROP CONSTRAINT property_fee_tiers_rate_check;
ALTER TABLE property_fee_tiers ADD CONSTRAINT property_fee_tiers_rate_check
    CHECK (rate >= 0 AND rate <= 1);
