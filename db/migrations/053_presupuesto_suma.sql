-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- El presupuesto es la suma de sus renglones
-- (diseño: docs/plans/2026-08-30-presupuesto-independiente-design.md)
--
-- La 033 le dio regla propia a un renglón: el RESIDUO, cuyo importe era
-- «total del presupuesto − suma de los detallados». Con esa regla el total no
-- era la suma de lo que la tabla enseñaba; era un objetivo fijado desde afuera,
-- y detallar una partida no lo movía — bajaba el residuo. De ahí salieron dos
-- defectos distintos:
--
--   1. La absorción borra la varianza. Cotizar Instalación eléctrica en $165K
--      contra una holgura de $120K debería gritar que el supuesto de $/m² iba
--      corto; el residuo se comía los $45K y el total no se enteraba. Un
--      presupuesto que no puede estar equivocado no enseña nada.
--   2. La liga viva reprecia obra cotizada a mano. Corregir el metraje de 200 a
--      220 m² en la ficha inflaba el presupuesto ENTERO un 10%, capítulos con
--      proveedor incluidos, y nada en la UI lo decía.
--
-- Desde aquí hay UNA regla: el total del presupuesto es la suma de sus
-- renglones. Siempre, sin modos y sin fallback. Una holgura sigue siendo
-- legítima —cargar el alcance no detallado como contingencia explícita es
-- práctica estándar (AACE, RICS NRM1)— pero es un renglón como cualquier otro:
-- se edita, se borra, puede haber cero o tres. Lo que se va es la REGLA, no el
-- dinero.
--
-- Por eso el residuo se CONVIERTE, no se borra. Para la mayoría del portafolio
-- ese renglón ES todo el costo de obra, y de ahí sale construction_budgeted →
-- investment_raw() → comisión de obra → ROI → el prospecto que se le manda a
-- inversionistas. Borrarlo dejaría a esas propiedades en $0 de obra, y eso
-- viaja a documentos que firma gente. Apagar la bandera, en cambio, deja el
-- número intacto: el importe del residuo SIEMPRE estuvo materializado en
-- `quantity`/`unit_price` —la 032 lo sembró como 1 × costo de obra y
-- `_settle_residual` lo reescribía ahí cada vez— y la suma de la que sale
-- construction_budgeted (`budget_db.totals_sql`) nunca filtró por la bandera.
-- No hay nada que recalcular antes de apagarla; la guarda del final lo prueba
-- presupuesto por presupuesto en vez de pedir que se le crea.
--
-- Esta es la mitad EXPAND de un expand/contract, y por eso NO tira la columna:
-- las migraciones corren como hook PreSync de ArgoCD, o sea ANTES de que entren
-- los pods nuevos, y los viejos siguen atendiendo tráfico con
-- `FILTER (WHERE NOT l.is_residual)` adentro de sus queries. Sin la columna
-- contestarían 500 durante todo el rollout. El DROP va en **PR 2 · Contract**,
-- cuando ya no quede código que la nombre — y se lleva solo, por dependencia, al CHECK
-- `budget_lines_residual_has_no_category`.
-- ─────────────────────────────────────────────────────────────────────────────

-- LOCAL las dos, como la 048: dbmate envuelve el archivo en UNA transacción, y
-- un SET a secas (032, 033) le sobrevive al COMMIT y se le queda pegado a la
-- conexión para las migraciones que corren después. El lock_timeout es lo que
-- evita que un UPDATE atorado contra una edición de presupuesto en curso se
-- coma en silencio el activeDeadlineSeconds del Job de deploy: con él la misma
-- colisión falla rápido y ruidosa (55P03) y el Job reintenta.
SET LOCAL lock_timeout      = '5s';
SET LOCAL statement_timeout = '150s';

-- ── El antes, para poder probar el después ───────────────────────────────────
-- El total de cada presupuesto tal como lo lee hoy el API: suma de
-- quantity × unit_price sobre TODOS los renglones, sin mirar la bandera. Se
-- congela aquí, antes de tocar nada.
--
-- Se guardan todos los presupuestos y no solo los de propiedad: el escenario de
-- un plan (`plan_id` NOT NULL, migración 051) jamás entra a las finanzas, pero
-- su total tampoco tiene por qué moverse, y cubrirlo no cuesta un statement de
-- más.
-- La foto y la verificación tienen que mirar la MISMA tabla. dbmate corre en
-- READ COMMITTED: un INSERT de un usuario que commitea ENTRE la foto y la
-- relectura de la guarda es invisible para la foto y visible para la guarda, y
-- el deploy abortaría diciendo «convertir el residuo movió el presupuesto»
-- cuando lo que se movió fue una captura legítima. La migración se llevaría la
-- culpa de un renglón que alguien metió bien, y el rollout se cae por algo que
-- no hizo. El lock cierra la ventana: bloquea escrituras pero no lecturas —un
-- SELECT toma ACCESS SHARE y no choca—, y respeta el lock_timeout de arriba,
-- así que si de veras hay una edición en curso falla rápido y ruidosa (55P03)
-- en vez de colgarse.
LOCK TABLE budget_lines IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE _053_antes ON COMMIT DROP AS
SELECT b.id                                        AS budget_id,
       b.property_id,
       b.plan_id,
       coalesce(sum(l.quantity * l.unit_price), 0) AS total
  FROM budgets b
  LEFT JOIN budget_lines l ON l.budget_id = b.id
 GROUP BY b.id;

-- ── La conversión ────────────────────────────────────────────────────────────
-- El `WHERE is_residual` hace dos cosas con un solo predicado: no escribe las
-- filas que ya están en FALSE, y deja esta migración corriendo dos veces sin
-- efecto adicional.
UPDATE budget_lines SET is_residual = FALSE WHERE is_residual;

-- Sin residuos no hay «uno por presupuesto» que garantizar. El índice se va
-- ahora y no con el DROP porque es lo único que la bandera todavía IMPONÍA: la
-- columna sobrevive al rollout como dato muerto, la regla no sobrevive ni un
-- minuto.
DROP INDEX IF EXISTS uq_budget_lines_residual;

-- ── Lo que estas tres columnas pasan a ser ───────────────────────────────────
-- Los tres comentarios de la 033 describen un mundo que esta migración cierra.
-- Un comentario de esquema que se queda describiendo la regla anterior se pudre
-- en silencio —nada falla cuando se contradice con el código— y el siguiente
-- que lo lea va a diagnosticar contra un sistema que ya no existe.

COMMENT ON COLUMN budget_lines.is_residual IS
    'MUERTA desde la migración 053: ya no existe el renglón residual. Su regla —«el importe es el total del presupuesto menos la suma de los detallados»— se retiró: el total es la suma de sus renglones y una holgura es un renglón normal, con el nombre que alguien le puso, que se edita y se borra como cualquier otro. Sobrevive en FALSE únicamente para que los pods viejos no truenen durante el rollout (las migraciones corren como hook PreSync, antes de que entren los nuevos). Pendiente de DROP en PR 2 · Contract; nada debe volver a leerla ni escribirla.';

COMMENT ON COLUMN properties.construction_cost_per_sqm IS
    'Supuesto CAPTURADO: el costo por m² que teclea quien evalúa la propiedad. Vuelve a ser insumo —la 033 lo había convertido en derivado (presupuesto ÷ m²)— porque desde la 053 convive CON ese derivado en pantalla, rotulados: tu estimado contra el presupuesto. Dos números reales, ninguno gobierna al otro y ninguno es el fallback del otro; solo así la comparación es honesta. No mueve el presupuesto: la calculadora escribe UN renglón al nacer la propiedad y de ahí en adelante el presupuesto es dato propio.';

COMMENT ON COLUMN properties.construction_overhead IS
    'Supuesto: multiplicador de costos indirectos de obra. NULL = se aplica el default del sistema (1.3); un 0 capturado es identidad 1, nunca ×0. Aplica SOLO al producir el estimado inicial —el renglón que la calculadora escribe al nacer la propiedad, con el overhead ya dentro del importe— y nunca vuelve a multiplicar el presupuesto, que es la suma de sus renglones. Pendiente de DROP junto con la reescritura de db/seeds.';

-- ── La migración prueba su propia promesa ────────────────────────────────────
-- Presupuesto por presupuesto, el total de antes contra el de ahora, al peso y
-- sin tolerancia.
--
-- Apagar una bandera no puede mover una suma que nunca la miró, así que esta
-- guarda no espera disparar — y aun así va, por dos razones. La primera es que
-- el día de la migración no puede moverse UN SOLO PESO: ese número alimenta
-- investment_raw(), la comisión de obra, el ROI y el prospecto, y en prod no
-- hay nadie mirando. En local no imprime nada; allá prefiere abortar con
-- nombres y cifras a dejar pasar un centavo. La segunda es que le queda de red
-- a quien edite este archivo después: con el LOCK de arriba sosteniendo la
-- tabla, lo único que puede mover dinero entre la foto y esta relectura es un
-- statement de esta misma migración — así que si esto dispara, la culpa es de
-- este archivo y de nadie más, y muere aquí en vez de llegar a un PDF.

DO $$
DECLARE txt TEXT;
BEGIN
    SELECT string_agg(format('%s [%s]%s: antes %s vs ahora %s',
                             coalesce(p.name, '(propiedad borrada)'),
                             coalesce(a.property_id::text, '—'),
                             CASE WHEN a.plan_id IS NULL
                                  THEN '' ELSE ' · plan ' || a.plan_id END,
                             a.total, coalesce(d.total, 0)),
                      '; ' ORDER BY a.budget_id)
      INTO txt
      FROM _053_antes a
      -- LEFT, y el nombre con coalesce: `properties` entra aquí SOLO para poder
      -- decir de quién es el presupuesto. Hoy un INNER daría el mismo resultado
      -- —`property_id` es NOT NULL y su FK es RESTRICT, así que un presupuesto
      -- huérfano no es representable— y por eso esto no repara ningún hueco
      -- vivo. Va igual, porque la garantía que lo sostiene vive en OTRA tabla:
      -- el día que alguien ponga ON DELETE CASCADE o afloje el NOT NULL, un
      -- INNER empezaría a descartar filas en silencio y un presupuesto podría
      -- moverse entero sin que esta guarda dijera nada. Una guarda de
      -- conservación no apuesta su cobertura a un constraint ajeno.
      LEFT JOIN properties p ON p.id = a.property_id
      LEFT JOIN LATERAL (SELECT coalesce(sum(l.quantity * l.unit_price), 0) AS total
                           FROM budget_lines l WHERE l.budget_id = a.budget_id) d ON TRUE
     WHERE coalesce(d.total, 0) <> a.total;
    IF txt IS NOT NULL THEN
        RAISE EXCEPTION
            '053: convertir el residuo movió el presupuesto de estas propiedades. Tenía que quedar idéntico al peso — de ese número salen la inversión total, la comisión de obra y el prospecto: %', txt
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

-- Y que la conversión de veras convirtió. La guarda de arriba solo mira dinero:
-- un WHERE mal puesto que dejara residuos vivos pasaría por ahí sin despeinarse
-- —el total no se movería— y la bandera seguiría gobernando renglones después
-- de que el código dejó de saber de ella.

DO $$
DECLARE txt TEXT;
BEGIN
    SELECT string_agg(format('%s [%s]%s: %s',
                             coalesce(p.name, '(propiedad borrada)'),
                             coalesce(b.property_id::text, '—'),
                             CASE WHEN b.plan_id IS NULL
                                  THEN '' ELSE ' · plan ' || b.plan_id END,
                             CASE WHEN r.n = 1 THEN '1 renglón'
                                  ELSE r.n || ' renglones' END),
                      '; ' ORDER BY b.id)
      INTO txt
      FROM budgets b
      LEFT JOIN properties p ON p.id = b.property_id
      JOIN LATERAL (SELECT count(*) AS n FROM budget_lines l
                     WHERE l.budget_id = b.id AND l.is_residual) r ON TRUE
     WHERE r.n > 0;
    IF txt IS NOT NULL THEN
        RAISE EXCEPTION
            '053: estos presupuestos conservan renglones con is_residual prendida; la conversión no cubrió toda la tabla: %', txt
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

-- migrate:down

-- Esto NO es un rollback: restaura el esquema, no el hecho.
--
-- Cuál renglón era el residuo es información que el UPDATE de arriba destruye,
-- y no hay de dónde recuperarla. La 033 nació justamente porque el nombre
-- «Otros, por detallar» nunca fue identidad confiable —«el día que alguien
-- escriba "Otros (por detallar)" el residuo deja de bajar»— y a estas alturas
-- hay renglones renombrados y capturados a mano. Adivinar por nombre pondría la
-- bandera en la fila equivocada, que es peor que no ponerla: el total empezaría
-- a moverse desde una partida cotizada.
--
-- Así que después de bajar esto todo presupuesto queda con CERO residuos —
-- exactamente el estado que la guarda de la 033 declaraba inválido— y el índice
-- que se recrea queda vacío. Sigue impidiendo dos residuos si alguien los
-- vuelve a crear, y eso es todo lo que puede prometer.
--
-- Bajar el CÓDIGO no necesita bajar esta migración, y ese es el punto de que la
-- columna sobreviva en FALSE: con los pods viejos, `set_total` y
-- `_settle_residual` actualizan cero filas —el total deja de poder moverse
-- desde la ficha, que es justo el defecto que este trabajo vino a quitar— sin
-- romper una sola lectura.

-- El SET LOCAL del up murió en aquel COMMIT y dbmate corre el down en su propia
-- transacción, así que hay que repetirlo. La 033 no lo trae y aquí se deja a
-- propósito: un rollback se intenta DURANTE un incidente, que es justo cuando
-- hay gente editando presupuestos, y el SHARE que toma CREATE UNIQUE INDEX
-- choca contra esa edición. Sin timeout se cuelga sin límite, y colgado es la
-- peor forma de fallar cuando alguien está tratando de revertir.
SET LOCAL lock_timeout = '5s';

CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_lines_residual
  ON budget_lines (budget_id) WHERE is_residual;

COMMENT ON COLUMN budget_lines.is_residual IS
    'El renglón que absorbe lo que todavía no se detalla: su importe es el total del presupuesto menos la suma de los detallados. No se captura a mano — convertir una resta determinista en una segunda captura es donde nace el descuadre. Uno por presupuesto, y el índice único parcial lo garantiza.';

COMMENT ON COLUMN properties.construction_cost_per_sqm IS
    'RETIRADA como insumo del costo de obra: desde la fase 2 el costo de obra es la suma del presupuesto (budget_lines) y esta cifra se DERIVA —presupuesto ÷ m² de obra— para mostrarse. El API ya no la lee ni la escribe; solo las semillas la usan para calcular el primer renglón. Pendiente de DROP junto con la reescritura de db/seeds.';

COMMENT ON COLUMN properties.construction_overhead IS
    'RETIRADO como multiplicador vivo: la 032 lo aplicó UNA sola vez al sembrar y el 30% de indirectos ya vive dentro del importe del presupuesto. Volver a multiplicar por él inflaría cada costo de obra sin que nada se viera roto. El API ya no lo lee ni lo publica como supuesto; solo las semillas lo usan para calcular el primer renglón. Pendiente de DROP junto con la reescritura de db/seeds.';
