-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- El modelo de captura deja de mentir  (Fase A)
--
-- Tres arreglos que comparten una sola causa: había campos cuyo NOMBRE decía
-- una cosa y cuyo CONTENIDO era otra, y nadie podía notarlo desde la ficha.
--
--   1. `land_price` guardaba el precio del ANUNCIO — el precio total del
--      inmueble, no el de su terreno — y encima el sistema le sumaba la obra.
--      Una casa construida se contaba dos veces. La columna pasa a llamarse
--      `purchase_price`: lo que pagas por adquirir el inmueble como está, sea
--      lote o construido. Lo que se suma aparte es siempre obra A EJECUTAR
--      (`sqm_construction` × `construction_cost_per_sqm` × overhead).
--
--   2. `rent_monthly` significaba «renta estimada del underwriting» antes de
--      rentar y «renta cobrada» después: la transición a en_renta la pisaba, y
--      venía prellenada con la estimada, así que confirmar sin leer destruía la
--      proyección. Se parte en dos columnas y el par se vuelve comparable.
--
--   3. `total_investment` era la inversión capturada a mano, pero la API la
--      sombreaba con la base derivada del desglose, así que en una propiedad
--      con desglose completo el dato tecleado no tenía dónde vivir. Pasa a
--      `total_investment_captured` — la columna cruda dice que es captura, y
--      `totalInvestment` queda libre para nombrar la base resuelta.
--
-- Y un cambio de doctrina que no toca datos: los tres SUPUESTOS
-- (`acquisition_cost_pct`, `construction_overhead`, `hold_months`) dejan de
-- escribirse al dar de alta. NULL pasa a significar «supuesto por omisión» —
-- el valor lo resuelve la capa de underwriting al leer, y la ficha lo muestra
-- marcado como tal — y un valor guardado significa «lo eligió una persona».
-- Por eso el gate de `desarrollo` deja de exigirlos: siempre resuelven.
--
-- Nada de dato viejo se corrige en silencio. Lo que puede estar inflado se
-- nombra con RAISE NOTICE, igual que la 024 nombró las ventas aproximadas.
-- ─────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '5s';
SET statement_timeout = '150s';

-- ── 1. Avisos sobre el dato que ya está guardado (antes de tocar nada) ───────

DO $$
DECLARE txt TEXT;
BEGIN
    -- 1a. Precio potencialmente inflado. Un anuncio de inmueble CONSTRUIDO cuyo
    -- precio entró como «terreno» y que además carga obra a ejecutar suma dos
    -- veces lo edificado. No se puede distinguir desde la base si esa obra es
    -- remodelación legítima (que sí se suma) o el edificio que ya se pagó, así
    -- que se nombran las filas y las corrige quien conoce el trato. Los lotes
    -- quedan fuera: ahí construir sobre terreno pelón es exactamente el modelo.
    SELECT string_agg(
               format('%s (compra %s + obra %s m² × %s × %s)',
                      name, land_price, sqm_construction,
                      construction_cost_per_sqm, coalesce(construction_overhead, 1)),
               '; ' ORDER BY name)
      INTO txt
      FROM properties
     WHERE coalesce(sqm_construction, 0) > 0
       AND coalesce(construction_cost_per_sqm, 0) > 0
       AND asset_type IS DISTINCT FROM 'lote';
    IF txt IS NOT NULL THEN
        RAISE NOTICE '025: precio de compra posiblemente inflado (el precio del anuncio ya incluía lo construido y encima se suma obra) — revisar si la obra es remodelación real: %', txt;
    END IF;

    -- 1b. Renta que se vuelve real por estar la propiedad rentada o vendida. Si
    -- la transición se confirmó sin editar el prellenado, ese número sigue
    -- siendo la estimación del underwriting disfrazada de renta cobrada.
    SELECT string_agg(format('%s (%s)', name, rent_monthly), '; ' ORDER BY name)
      INTO txt
      FROM properties
     WHERE status IN ('en_renta', 'vendida') AND rent_monthly IS NOT NULL;
    IF txt IS NOT NULL THEN
        RAISE NOTICE '025: rentas que pasan a rent_monthly_actual — verificar que sean lo cobrado y no la estimación confirmada sin editar: %', txt;
    END IF;

    -- 1c. Supuestos indistinguibles. No se reescriben: para las filas que vienen
    -- de un seed escrito a mano, «capturado» es la verdad. Pero las que traen
    -- exactamente el default viejo pudieron haberlo recibido de CAPTURE_DEFAULTS
    -- sin que nadie lo eligiera, y a partir de aquí la ficha las mostrará como
    -- capturadas. Se nombran para que se revisen.
    -- Los ::real no son adorno: las dos columnas son REAL y un literal suelto es
    -- DOUBLE PRECISION, así que `acquisition_cost_pct = 0.065` es falso para la
    -- fila que guarda exactamente 0.065. Sin el cast este aviso no se dispara
    -- nunca y el silencio se leería como «no hay nada que revisar».
    SELECT string_agg(name, '; ' ORDER BY name) INTO txt
      FROM properties
     WHERE acquisition_cost_pct = 0.065::real
       AND construction_overhead = 1.3::real
       AND hold_months = 12;
    IF txt IS NOT NULL THEN
        RAISE NOTICE '025: supuestos idénticos al default viejo (6.5%% / 1.3 / 12m) — se conservan y se mostrarán como capturados, aunque pudieron venir de CAPTURE_DEFAULTS: %', txt;
    END IF;
END;
$$;

-- ── 2. Renombres ─────────────────────────────────────────────────────────────
-- Las restricciones se renombran junto con su columna: el nombre de la que
-- Postgres rechaza es lo que la API le enseña al usuario, y una que hable de
-- `land_price` mandaría a buscar un campo que ya no existe.

ALTER TABLE properties RENAME COLUMN land_price TO purchase_price;
ALTER TABLE properties RENAME CONSTRAINT properties_land_price_check
                                      TO properties_purchase_price_check;

ALTER TABLE properties RENAME COLUMN rent_monthly TO rent_monthly_projected;
ALTER TABLE properties RENAME CONSTRAINT properties_rent_monthly_check
                                      TO properties_rent_monthly_projected_check;

ALTER TABLE properties RENAME COLUMN total_investment TO total_investment_captured;
ALTER TABLE properties RENAME CONSTRAINT properties_total_investment_check
                                      TO properties_total_investment_captured_check;

-- ── 3. La renta real, su propia columna ──────────────────────────────────────
-- Mismo contrato que la proyectada: NULL = no capturada, y un 0 no se almacena
-- (una renta de cero no existe; «no renta» se expresa dejándola vacía).

ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS rent_monthly_actual NUMERIC(14,2)
        CONSTRAINT properties_rent_monthly_actual_check CHECK (rent_monthly_actual > 0);

COMMENT ON COLUMN properties.purchase_price IS
    'Lo que se paga por adquirir el inmueble como está (lote o construido). La obra a ejecutar se suma aparte.';
COMMENT ON COLUMN properties.sqm_construction IS
    'Metros cuadrados de obra A EJECUTAR — la que se va a construir o remodelar, no la que el inmueble ya tiene.';
COMMENT ON COLUMN properties.construction_cost_per_sqm IS
    'Costo por m² de la obra a ejecutar.';
COMMENT ON COLUMN properties.rent_monthly_projected IS
    'Renta mensual del underwriting: lo que se estima cobrar. Sobrevive a la renta real para poder compararlas.';
COMMENT ON COLUMN properties.rent_monthly_actual IS
    'Renta mensual efectivamente cobrada. Se captura al entrar a en_renta y nunca se prellena con la estimada.';
COMMENT ON COLUMN properties.total_investment_captured IS
    'Inversión total tecleada a mano. Es la base de capital solo cuando el desglose de costos está incompleto.';
COMMENT ON COLUMN properties.acquisition_cost_pct IS
    'Supuesto: costos de adquisición como fracción del precio de compra. NULL = se aplica el default del sistema (0.065).';
COMMENT ON COLUMN properties.construction_overhead IS
    'Supuesto: multiplicador de costos indirectos de obra. NULL = se aplica el default del sistema (1.3).';
COMMENT ON COLUMN properties.hold_months IS
    'Supuesto: plazo proyectado en meses. NULL = se aplica el default del sistema (12).';

-- ── 4. La renta guardada se reparte según lo que de verdad significa ─────────
-- En una propiedad rentada o vendida el número que había es lo cobrado. Se
-- mueve a la columna real y la proyectada queda NULL: nunca existió una
-- estimación separada, y ausencia es ausencia — inventar que la proyección
-- valía lo mismo que lo cobrado destruiría el par de aprendizaje antes de
-- estrenarlo. En las demás etapas el número es la estimación y ya está en su
-- columna por el renombre.

UPDATE properties
   SET rent_monthly_actual = rent_monthly_projected,
       rent_monthly_projected = NULL
 WHERE status IN ('en_renta', 'vendida')
   AND rent_monthly_projected IS NOT NULL;

-- ── 5. El trigger de transiciones, al día ────────────────────────────────────
-- Dos cambios de fondo además de los renombres:
--   · en_renta exige la renta REAL, no cualquier renta.
--   · el desglose completo deja de incluir los supuestos. Un supuesto siempre
--     resuelve (por captura o por default), así que exigirlo solo lograba que
--     toda propiedad recién capturada naciera con base 'underwriting' y que la
--     inversión real no se pudiera teclear nunca. Lo que el sistema necesita
--     para poder sumar el total él mismo son los CINCO costos.

CREATE OR REPLACE FUNCTION properties_guard_transition() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    allowed BOOLEAN;
BEGIN
    allowed := CASE OLD.status
        WHEN 'prospecto'  THEN NEW.status IN ('oferta', 'archivada')
        WHEN 'oferta'     THEN NEW.status IN ('desarrollo', 'archivada')
        WHEN 'desarrollo' THEN NEW.status IN ('en_renta', 'vendida', 'archivada')
        WHEN 'en_renta'   THEN NEW.status IN ('vendida', 'archivada')
        -- vendida es terminal: una propiedad vendida ES el track record de la
        -- firma y no puede desaparecer de él archivándola
        WHEN 'vendida'    THEN FALSE
        WHEN 'archivada'  THEN FALSE
        ELSE FALSE
    END;

    -- Los mensajes hablan el vocabulario de docs/glosario.md, no el del esquema:
    -- son lo último que ve alguien que empujó un UPDATE a mano, y «en_renta» o
    -- «projected_sale > 0» no le dicen qué capturar.
    IF NOT allowed THEN
        RAISE EXCEPTION 'No se puede pasar de % a % (propiedad %)',
            property_status_label(OLD.status), property_status_label(NEW.status), OLD.id
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status = 'oferta' AND coalesce(NEW.projected_sale, 0) <= 0 THEN
        RAISE EXCEPTION 'Toda Oferta modela su salida: falta la venta proyectada (propiedad %)',
            OLD.id USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status = 'desarrollo' THEN
        IF NEW.acquisition_date IS NULL THEN
            RAISE EXCEPTION 'Una propiedad en Desarrollo ya se compró: falta la fecha de adquisición (propiedad %)',
                OLD.id USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.total_units IS NULL THEN
            RAISE EXCEPTION 'Falta el número de unidades para pasar a Desarrollo (propiedad %)',
                OLD.id USING ERRCODE = 'check_violation';
        END IF;
        -- Comprar no produce un avalúo: la valuación NO se exige aquí.
        -- La inversión total se resuelve de dos formas y solo de dos: el total
        -- capturado a mano, o el desglose COMPLETO de los cinco costos (con uno
        -- faltante el sistema no puede recomputar nada). Los supuestos no
        -- cuentan: tienen default y nunca faltan de verdad.
        IF NEW.total_investment_captured IS NULL AND NOT (
               NEW.purchase_price            IS NOT NULL
           AND NEW.permits_cost              IS NOT NULL
           AND NEW.subdivision_cost          IS NOT NULL
           AND NEW.sqm_construction          IS NOT NULL
           AND NEW.construction_cost_per_sqm IS NOT NULL
        ) THEN
            RAISE EXCEPTION 'Falta la inversión total para pasar a Desarrollo: captúrala a mano, o completa los cinco costos del desglose (precio de compra, permisos, subdivisión, y los m² de obra a ejecutar con su costo por m²) (propiedad %)',
                OLD.id USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    IF NEW.status = 'en_renta' THEN
        IF NEW.rent_monthly_actual IS NULL THEN
            RAISE EXCEPTION 'Falta la renta mensual cobrada para pasar a En renta: la que se cobra, no la estimada (propiedad %)',
                OLD.id USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- migrate:down

-- Reversible salvo por una cosa, que se dice en vez de esconderse: al volver a
-- una sola columna de renta, la estimada y la real se funden y ya no se pueden
-- separar. Gana la real, que es el dato duro.

DROP FUNCTION IF EXISTS properties_guard_transition() CASCADE;

UPDATE properties
   SET rent_monthly_projected = coalesce(rent_monthly_actual, rent_monthly_projected)
 WHERE rent_monthly_actual IS NOT NULL;

ALTER TABLE properties DROP COLUMN IF EXISTS rent_monthly_actual;

ALTER TABLE properties RENAME CONSTRAINT properties_total_investment_captured_check
                                      TO properties_total_investment_check;
ALTER TABLE properties RENAME COLUMN total_investment_captured TO total_investment;

ALTER TABLE properties RENAME CONSTRAINT properties_rent_monthly_projected_check
                                      TO properties_rent_monthly_check;
ALTER TABLE properties RENAME COLUMN rent_monthly_projected TO rent_monthly;

ALTER TABLE properties RENAME CONSTRAINT properties_purchase_price_check
                                      TO properties_land_price_check;
ALTER TABLE properties RENAME COLUMN purchase_price TO land_price;

CREATE OR REPLACE FUNCTION properties_guard_transition() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    allowed BOOLEAN;
BEGIN
    allowed := CASE OLD.status
        WHEN 'prospecto'  THEN NEW.status IN ('oferta', 'archivada')
        WHEN 'oferta'     THEN NEW.status IN ('desarrollo', 'archivada')
        WHEN 'desarrollo' THEN NEW.status IN ('en_renta', 'vendida', 'archivada')
        WHEN 'en_renta'   THEN NEW.status IN ('vendida', 'archivada')
        WHEN 'vendida'    THEN FALSE
        WHEN 'archivada'  THEN FALSE
        ELSE FALSE
    END;

    IF NOT allowed THEN
        RAISE EXCEPTION 'No se puede pasar de % a % (propiedad %)',
            property_status_label(OLD.status), property_status_label(NEW.status), OLD.id
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status = 'oferta' AND coalesce(NEW.projected_sale, 0) <= 0 THEN
        RAISE EXCEPTION 'Toda Oferta modela su salida: falta la venta proyectada (propiedad %)',
            OLD.id USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status = 'desarrollo' THEN
        IF NEW.acquisition_date IS NULL THEN
            RAISE EXCEPTION 'Una propiedad en Desarrollo ya se compró: falta la fecha de adquisición (propiedad %)',
                OLD.id USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.total_units IS NULL THEN
            RAISE EXCEPTION 'Falta el número de unidades para pasar a Desarrollo (propiedad %)',
                OLD.id USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.total_investment IS NULL AND NOT (
               NEW.land_price                IS NOT NULL
           AND NEW.acquisition_cost_pct      IS NOT NULL
           AND NEW.permits_cost              IS NOT NULL
           AND NEW.subdivision_cost          IS NOT NULL
           AND NEW.sqm_construction          IS NOT NULL
           AND NEW.construction_cost_per_sqm IS NOT NULL
           AND NEW.construction_overhead     IS NOT NULL
        ) THEN
            RAISE EXCEPTION 'Falta la inversión total para pasar a Desarrollo: captúrala a mano o completa el desglose de costos (propiedad %)',
                OLD.id USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    IF NEW.status = 'en_renta' THEN
        IF NEW.rent_monthly IS NULL THEN
            RAISE EXCEPTION 'Falta la renta mensual para pasar a En renta (propiedad %)',
                OLD.id USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_properties_transition ON properties;
CREATE TRIGGER trg_properties_transition
    BEFORE UPDATE OF status ON properties
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION properties_guard_transition();
