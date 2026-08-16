-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ PARTIDAS CRECEN CON LA OBRA  (y cuáles no)
--
-- Copiar el presupuesto de la obra de al lado sirve por su FORMA, no por su
-- tamaño: el desglose es reusable, las cifras son de esa obra. Para copiarlo
-- DIMENSIONADO al costo que se espera de ésta hay que saber qué renglón escala
-- y cuál no, y esa es una verdad de la PARTIDA, no de la copia:
--
--     el permiso de construcción cuesta lo que cuesta,
--     la casa del doble de tamaño no paga dos licencias.
--
-- Por eso la marca vive en el renglón y se guarda. Preguntarla en cada copia
-- sería preguntar lo mismo para siempre, y responderla por catálogo exigiría un
-- catálogo — que la 043 retiró justamente por no tener quien lo mantuviera.
-- Guardada en el renglón, además VIAJA con la copia (`_COPIED_LINE_COLUMNS`,
-- junto al oficio): un presupuesto copiado nace sabiendo cuáles no escalan, que
-- es aprender sin catálogo.
--
-- EN POSITIVO Y CON DEFAULT TRUE. La enorme mayoría de las partidas sí crece con
-- la obra, así que el default es el caso común y nadie captura nada para
-- obtenerlo; y en positivo porque `NOT is_fixed` en cada query es la doble
-- negación que después se lee al revés. La columna afirma lo que la mayoría es.
--
-- EL RESIDUO SE QUEDA EN TRUE, y no hay CHECK que lo amarre —al revés que
-- `budget_lines_residual_has_no_category`, que sí lo prohíbe—. La diferencia es
-- que ahí el valor sería una afirmación falsa («lo que falta por detallar ya se
-- sabe de qué oficio es») y aquí es la verdadera: el residuo del origen es lo
-- que a esa obra le falta por detallar, y en la copia proporcional ESCALA junto
-- con todo lo demás —entra al denominador del factor y aterriza en el residuo
-- del destino vía `_settle_residual`—. Que la columna diga TRUE en esa fila no
-- es un descuido: es el dato correcto, aunque nadie lo lea, porque el residuo no
-- se copia renglón a renglón.
--
-- ESTA MIGRACIÓN NO ESCRIBE UNA SOLA FILA NI MUEVE UN PESO. `budget_lines` no
-- cambia ninguna columna de dinero, la suma de todo presupuesto queda idéntica y
-- `budget_price_observations` publica exactamente las mismas filas. El default
-- llena las existentes con el valor que ya se les suponía.
-- ─────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '5s';        -- ArgoCD PreSync corta a los 180s; no esperamos locks
SET statement_timeout = '150s'; -- dbmate envuelve el archivo en UNA transacción

ALTER TABLE budget_lines
  ADD COLUMN IF NOT EXISTS is_proportional BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN budget_lines.is_proportional IS
    '¿Esta partida crece con el tamaño de la obra? TRUE es el caso común y por eso es el default: la casa del doble de tamaño lleva el doble de piso. FALSE es la partida de monto propio —permisos, licencias, conexiones—: cuesta lo que cuesta y la copia proporcional la deja intacta, con su importe original. Es verdad de la PARTIDA, no de una copia, y por eso se guarda y VIAJA con ella: un presupuesto copiado nace sabiendo cuáles no escalan. Qué mueve el factor lo decide la unidad: en «lote» —suma alzada, sin medida detrás— escala el PRECIO, y el renglón se sigue leyendo «1 lote»; en m², ml o pza escala la CANTIDAD, porque el precio por unidad es un hecho de mercado que no cambia porque la casa sea más grande.';

-- migrate:down

-- Esta columna es el ÚNICO lugar donde vive «esta partida no crece con la obra».
-- No se deduce del nombre —«Licencias» y «Licencia de uso de suelo» son texto
-- libre—, ni del capítulo, ni de la unidad: el permiso y la impermeabilización
-- son los dos «1 lote». Un DROP mudo se llevaría captura manual irrecuperable,
-- así que primero se pregunta, igual que en la 032 y la 035.
--
-- El TRUE no se cuenta: es el default, nadie lo capturó.

DO $$
DECLARE capturado BIGINT;
BEGIN
    SELECT count(*) INTO capturado FROM budget_lines WHERE NOT is_proportional;
    IF capturado > 0 THEN
        RAISE EXCEPTION '045 no se puede revertir: hay % partidas marcadas como no proporcionales, y esta columna es el único lugar donde vive esa marca. No se deduce del nombre ni del capítulo — expórtala antes de tirarla.', capturado
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

ALTER TABLE budget_lines DROP COLUMN IF EXISTS is_proportional;
