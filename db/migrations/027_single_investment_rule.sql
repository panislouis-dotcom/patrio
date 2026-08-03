-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- La inversión total se calcula de una sola manera
--
-- Hasta aquí había DOS: el desglose de costos cuando estaba completo, y el
-- total tecleado a mano cuando no. Dos caminos significan que la ficha tiene
-- que explicar cuál se usó (`investmentBasis`), que checks.py tiene que
-- confrontarlos cuando existen los dos, y que quien lee un total no sabe qué
-- está leyendo sin mirar otro campo. Queda uno:
--
--     inversión = precio_compra × (1 + pct_adquisición)
--               + permisos + subdivisión
--               + m²_obra × costo_m² × overhead
--
-- Componente ausente vale 0; no hay «desglose completo» contra «incompleto».
-- Una suma de 0 sigue siendo «nada capturado», no «cero pesos invertidos».
--
-- NO SE PIERDE CAPACIDAD. Un total all-in de $9.5M que nadie quiere desglosar
-- se expresa como `purchase_price = 9,500,000` con `acquisition_cost_pct = 0`:
-- lo mismo que decía la columna que muere, dicho en la única gramática que
-- queda. Por eso el backfill de abajo puede vaciar la columna sin mover un peso.
--
-- POR QUÉ EL 0 EXPLÍCITO EN `acquisition_cost_pct` NO ES COSMÉTICO: desde la
-- 025, NULL en un supuesto significa «aplica el default del sistema», y el
-- default de este es 6.5%. Dejarlo NULL al mover $9,500,000 a `purchase_price`
-- le sumaría $617,500 a Edificio Uno que nadie pidió ni capturó. El 0 dice lo
-- único cierto sobre esa fila: el total tecleado ya venía con todo adentro.
-- ─────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '5s';
SET statement_timeout = '150s';

-- ── 1. La base de cada fila, bajo las dos reglas, antes de tocar nada ────────
-- Una sola tabla para que las dos guardas de abajo y el backfill lean la misma
-- aritmética. `desglose` reproduce exactamente lo que calcula
-- api.finance.underwriting.investment() — los ::numeric no son adorno: sin
-- ellos Postgres promueve a DOUBLE PRECISION y la comparación con el total
-- tecleado empieza a fallar por ruido de flotante que Python no tiene.
--
-- `desglose = 0` es la definición operativa de «esta fila no tiene desglose»:
-- todos los costos traen CHECK >= 0, así que una suma de cero solo puede venir
-- de columnas vacías o en cero. Es la misma lectura que instala la regla nueva
-- (suma 0 ⇒ nada capturado), aplicada al dato que ya está guardado.

CREATE TEMP TABLE _027_resuelto ON COMMIT DROP AS
SELECT id, name, status,
       total_investment_captured AS tecleado,
       (coalesce(purchase_price, 0) * (1 + coalesce(acquisition_cost_pct::numeric, 0.065))
        + coalesce(permits_cost, 0)
        + coalesce(subdivision_cost, 0)
        + coalesce(sqm_construction::numeric, 0) * coalesce(construction_cost_per_sqm, 0)
          * CASE WHEN construction_overhead IS NULL THEN 1.3
                 WHEN construction_overhead = 0     THEN 1
                 ELSE construction_overhead::numeric END) AS desglose,
       (purchase_price            IS NOT NULL
        AND permits_cost              IS NOT NULL
        AND subdivision_cost          IS NOT NULL
        AND sqm_construction          IS NOT NULL
        AND construction_cost_per_sqm IS NOT NULL) AS completo
  FROM properties;

-- ── 2. Guarda: ninguna fila pierde un número en silencio ────────────────────
-- El DROP de abajo destruye el total tecleado. Es seguro exactamente cuando ese
-- total es redundante: o la fila no tiene desglose (y el backfill lo convierte
-- en `purchase_price`), o lo tiene y dice lo mismo. Cualquier otra combinación
-- es una fila donde alguien tecleó un número que el desglose contradice, y ahí
-- no hay elección silenciosa que no sea una mentira:
--
--   · con el desglose COMPLETO manda el desglose y el total tecleado se
--     borraría sin que nadie se entere de que no cuadraba;
--   · con el desglose PARCIAL manda hoy el total tecleado, así que borrarlo
--     movería la base publicada — justo lo que esta migración promete no hacer.
--
-- En local no hay ninguna fila así. La migración corre en prod, donde no puedo
-- verla, y prefiere abortar con nombre y cifras a decidir por su cuenta.

DO $$
DECLARE txt TEXT;
BEGIN
    SELECT string_agg(format('%s [%s] (tecleado %s vs desglose %s)',
                             name, id, tecleado, desglose), '; ' ORDER BY id)
      INTO txt
      FROM _027_resuelto
     WHERE tecleado IS NOT NULL
       AND desglose > 0
       AND tecleado <> desglose;
    IF txt IS NOT NULL THEN
        RAISE EXCEPTION
            '027: hay propiedades con inversión tecleada Y desglose de costos que no cuadran. Decide cuál es la verdad antes de migrar: si manda el desglose, vacía total_investment_captured; si manda el total, vacía los costos. Filas: %', txt
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

-- ── 3. Aviso: las filas que sí cambian de base, y por qué ───────────────────
-- Solo pueden ser filas SIN total tecleado, porque las que lo traen ya pasaron
-- la guarda. Cambian por la regla nueva y son dos formas:
--
--   · desglose completo que suma 0 — hoy publica «$0 invertido», que es un cero
--     fabricado; a partir de ahora publica «—», que es lo que de verdad se sabe.
--   · desglose parcial con dinero — hoy publica «—» porque le falta un
--     componente; a partir de ahora suma lo que sí está capturado.
--
-- Ninguna de las dos borra dato ni inventa pesos, así que se nombran en vez de
-- abortar. En local esto no imprime nada: es parte de la prueba de no-movimiento.

DO $$
DECLARE txt TEXT;
BEGIN
    SELECT string_agg(format('%s [%s]: %s → %s',
                             name, id,
                             coalesce((CASE WHEN completo THEN desglose END)::text, '—'),
                             coalesce(nullif(desglose, 0)::text, '—')), '; ' ORDER BY id)
      INTO txt
      FROM _027_resuelto
     WHERE tecleado IS NULL
       AND (CASE WHEN completo THEN desglose END) IS DISTINCT FROM nullif(desglose, 0);
    IF txt IS NOT NULL THEN
        RAISE NOTICE '027: la regla nueva cambia la base publicada de estas propiedades (ningún dato se pierde; el desglose parcial ahora suma y el desglose en ceros deja de fingir $0): %', txt;
    END IF;
END;
$$;

-- ── 4. Backfill: el total tecleado se vuelve precio de compra ───────────────
-- Solo las filas sin desglose — la guarda ya garantizó que las demás traen un
-- total redundante. Los cuatro costos restantes bajan a 0 donde estén vacíos
-- para que la fila quede diciendo lo mismo en la gramática nueva: todo el
-- dinero está en la compra y no hay obra ni permisos que sumar aparte.

UPDATE properties p
   SET purchase_price       = r.tecleado,
       acquisition_cost_pct = 0,
       permits_cost              = coalesce(p.permits_cost, 0),
       subdivision_cost          = coalesce(p.subdivision_cost, 0),
       sqm_construction          = coalesce(p.sqm_construction, 0),
       construction_cost_per_sqm = coalesce(p.construction_cost_per_sqm, 0)
  FROM _027_resuelto r
 WHERE r.id = p.id
   AND r.tecleado IS NOT NULL
   AND r.desglose = 0;

-- ── 5. Muere la columna ──────────────────────────────────────────────────────
-- Su CHECK se va con ella (DROP COLUMN arrastra las restricciones de la columna).

ALTER TABLE properties DROP COLUMN total_investment_captured;

COMMENT ON COLUMN properties.acquisition_cost_pct IS
    'Supuesto: costos de adquisición como fracción del precio de compra. NULL = se aplica el default del sistema (0.065). Un 0 capturado dice que el precio de compra ya viene con todo adentro.';

-- ── 6. El gate de `desarrollo`, en la gramática que queda ────────────────────
-- Antes exigía «base de inversión resoluble»: total tecleado O los cinco costos
-- completos. Sin la columna esa disyunción no existe, y su segunda mitad tampoco
-- tiene sentido — con la regla nueva la base SIEMPRE resuelve, así que exigir el
-- desglose completo sería exigir que se tecleen cuatro ceros.
--
-- Lo que queda es más simple y más honesto: a Desarrollo se entra habiendo
-- comprado, y no se compra sin saber cuánto se pagó. `purchase_price > 0` es esa
-- frase. Es también la única exigencia que no se puede satisfacer sin decir algo
-- verdadero: los otros cuatro costos pueden ser cero de verdad, el precio no.
--
-- Espejo exacto de checks.stage_requirements() — el API valida primero para dar
-- un 422 legible; este trigger es la red que ningún UPDATE puede saltarse.

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
        IF coalesce(NEW.purchase_price, 0) <= 0 THEN
            RAISE EXCEPTION 'No se entra a Desarrollo sin saber qué se pagó: falta el precio de compra (propiedad %)',
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

-- No soportado, igual que 024. Volver atrás exigiría reconstruir un total
-- tecleado que ya no existe como dato independiente: en las filas que migraron
-- es indistinguible del precio de compra, y esa fusión es justamente el punto
-- de la migración. Restaurar la columna vacía devolvería el campo, no el dato.
-- Falla ruidosamente para que nadie crea que hizo rollback.
DO $$
BEGIN
    RAISE EXCEPTION '027 no es reversible: el total tecleado se fusionó con el precio de compra. Restaura el backup CNPG previo al deploy.';
END;
$$;
