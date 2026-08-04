-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- El renglón residual, dicho en el esquema
--
-- La 032 sembró en cada presupuesto UNA fila «Otros, por detallar» con el costo
-- de obra completo. Desde la fase 2 esa fila deja de ser un renglón cualquiera
-- que casualmente se llama así y pasa a tener una regla propia: es el RESIDUO,
-- y su importe es siempre `total del presupuesto − suma de los detallados`.
-- Detallar no crea costo, solo lo distribuye, así que al agregar una partida el
-- residuo baja sola y el total no se mueve.
--
-- Esa regla necesita saber CUÁL renglón es el residuo, y hasta aquí la única
-- respuesta era comparar el nombre contra la cadena 'Otros, por detallar'. Una
-- regla de dinero que depende de que nadie renombre un texto no es una regla:
-- el día que alguien escriba «Otros (por detallar)» el residuo deja de bajar,
-- el total empieza a crecer con cada partida que se detalle, y no hay nada roto
-- que mirar. La bandera lo vuelve un hecho de la fila.
--
-- El índice único parcial es la otra mitad: DOS residuos en un presupuesto
-- serían dos restas compitiendo por el mismo remanente, y el descuadre no
-- tendría dónde verse. Postgres se encarga de que no pueda pasar.
--
-- «Al menos uno» no lo puede fijar un índice —no existe esa restricción— y lo
-- sostiene el API, que crea el residuo junto con el presupuesto y nunca lo
-- borra. La guarda del final prueba que hoy se cumple para toda propiedad.
-- ─────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '5s';
SET statement_timeout = '150s';

ALTER TABLE budget_lines
  ADD COLUMN IF NOT EXISTS is_residual BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN budget_lines.is_residual IS
    'El renglón que absorbe lo que todavía no se detalla: su importe es el total del presupuesto menos la suma de los detallados. No se captura a mano — convertir una resta determinista en una segunda captura es donde nace el descuadre. Uno por presupuesto, y el índice único parcial lo garantiza.';

UPDATE budget_lines SET is_residual = TRUE WHERE name = 'Otros, por detallar';

CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_lines_residual
  ON budget_lines (budget_id) WHERE is_residual;

-- ── Los tres insumos de la calculadora, ya sin nadie que los lea ─────────────
-- La 032 anunció que la fase 2 movería la lectura del costo de obra al
-- presupuesto. Ya se movió: `investment_raw()` recibe la suma presupuestada y
-- el overhead NO vuelve a multiplicar nada — la 032 lo aplicó una sola vez al
-- sembrar y ahí se quedó, dentro del importe. Estas dos columnas ya no las lee
-- ni las escribe el API: sobreviven como los insumos con los que las SEMILLAS
-- calculan el primer renglón de una base recién sembrada, exactamente el mismo
-- papel de calculadora que juegan los campos homónimos de POST /api/properties,
-- que tampoco se guardan. Su DROP va con la reescritura de db/seeds, no aquí.
--
-- `sqm_construction` no lleva aviso porque no lo necesita: es metraje FÍSICO,
-- lo siguen leyendo el analizador y el PDF, y ahora también el costo por m²
-- derivado. Sobrevive intacto, que es lo que la 032 ya prometía.

COMMENT ON COLUMN properties.construction_cost_per_sqm IS
    'RETIRADA como insumo del costo de obra: desde la fase 2 el costo de obra es la suma del presupuesto (budget_lines) y esta cifra se DERIVA —presupuesto ÷ m² de obra— para mostrarse. El API ya no la lee ni la escribe; solo las semillas la usan para calcular el primer renglón. Pendiente de DROP junto con la reescritura de db/seeds.';
COMMENT ON COLUMN properties.construction_overhead IS
    'RETIRADO como multiplicador vivo: la 032 lo aplicó UNA sola vez al sembrar y el 30% de indirectos ya vive dentro del importe del presupuesto. Volver a multiplicar por él inflaría cada costo de obra sin que nada se viera roto. El API ya no lo lee ni lo publica como supuesto; solo las semillas lo usan para calcular el primer renglón. Pendiente de DROP junto con la reescritura de db/seeds.';

-- ── La guarda: un residuo por propiedad, ni cero ni dos ──────────────────────
-- El índice ya impide los dos. Este bloque cubre el cero, que es el caso que
-- rompería la resta en silencio: sin residuo, detallar una partida no tendría
-- de dónde restar y el total crecería con cada renglón.

DO $$
DECLARE txt TEXT;
BEGIN
    SELECT string_agg(format('%s [%s]: %s residuos', p.name, p.id, r.n), '; ' ORDER BY p.id)
      INTO txt
      FROM budgets b
      JOIN properties p ON p.id = b.property_id
      JOIN LATERAL (SELECT count(*) AS n FROM budget_lines l
                     WHERE l.budget_id = b.id AND l.is_residual) r ON TRUE
     WHERE r.n <> 1;
    IF txt IS NOT NULL THEN
        RAISE EXCEPTION
            '033: hay presupuestos sin renglón residual. Sin él, detallar una partida no tiene de dónde restar y el costo de obra crece con cada renglón que se capture: %', txt
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

-- migrate:down

DROP INDEX IF EXISTS uq_budget_lines_residual;
ALTER TABLE budget_lines DROP COLUMN IF EXISTS is_residual;

COMMENT ON COLUMN properties.construction_cost_per_sqm IS
    'Costo por m² de la obra a ejecutar. Todavía es el insumo vivo del costo de obra; su sucesor es la suma de budget_lines (migración 032), y desde la fase 2 esta cifra se deriva —presupuesto ÷ m² de obra— en vez de capturarse.';
COMMENT ON COLUMN properties.construction_overhead IS
    'Supuesto: multiplicador de costos indirectos de obra. NULL = se aplica el default del sistema (1.3); un 0 capturado es identidad 1, nunca ×0. La migración 032 lo aplicó una sola vez al sembrar el presupuesto, y desde la fase 2 deja de multiplicar el costo de obra.';
