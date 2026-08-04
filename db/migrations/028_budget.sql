-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- El presupuesto de obra  (Fase 1 · datos)
--
-- Hasta aquí «cuánto va a costar la obra» se contestaba con una fórmula gruesa
-- —m² × $/m² × overhead— y no había dónde poner el detalle. Esta migración crea
-- ese lugar: un presupuesto por propiedad, con capítulos y partidas, y las tres
-- cifras que el control de obra distingue (presupuestado, comprometido, pagado).
--
--   catálogo:  budget_chapters → budget_items          (lo que se sabe hacer)
--   la obra:   budgets → budget_lines → budget_line_payments
--
-- REGLA DURA: ninguna cifra total se guarda.
--     presupuestado = quantity × unit_price       pagado = SUM(pagos)
-- Un `paid_amount` almacenado sería el antipatrón que el glosario ya declaró
-- muerto —«ya no se captura ningún total»— y que la 027 acaba de sacar de la
-- inversión. Son decenas de propiedades: no hay razón de rendimiento que pague
-- el precio de tener dos lugares donde vive el mismo peso.
--
-- COPIAR AL INSTANCIAR, no leer en vivo. Cada renglón nace con su propio
-- nombre, unidad, cantidad y precio; `item_id` apunta al catálogo como
-- PROCEDENCIA, no como dependencia (ON DELETE SET NULL). Editar el catálogo
-- nunca puede mover el presupuesto ya capturado de una propiedad vendida. Es lo
-- contrario de lo que hacen las plantillas de proceso —que se leen en vivo y
-- borran en cascada— y la diferencia es que aquí el objeto es dinero.
--
-- LA SIEMBRA Y EL OVERHEAD. Cada propiedad existente recibe su presupuesto con
-- UNA fila «Otros, por detallar» cuyo importe es exactamente el costo de obra
-- que hoy resuelve la fórmula, CON EL OVERHEAD YA APLICADO. El multiplicador
-- cumple su función una sola vez, aquí, y queda dentro del número: desde este
-- punto la suma del presupuesto ES el costo de obra y no se vuelve a multiplicar
-- por nada. La aritmética de abajo espeja a la letra la de
-- api.finance.underwriting —incluido que un overhead capturado en 0 es identidad
-- 1 y no ×0, y que un NULL resuelve al default 1.3— y los ::numeric no son
-- adorno: sin ellos Postgres promueve a DOUBLE PRECISION y la comparación con lo
-- que calcula Python empieza a fallar por ruido de flotante.
--
-- LO QUE ESTA MIGRACIÓN NO HACE, dicho aquí para que no haya que deducirlo:
-- `construction_cost_per_sqm` y `construction_overhead` SIGUEN SIENDO LOS
-- INSUMOS VIVOS del costo de obra. Quien lee la inversión total sigue leyendo la
-- fórmula, no el presupuesto — mover esa lectura es la fase 2, y hacerlo aquí
-- movería el número en el mismo commit que promete no moverlo. Mientras tanto la
-- fila sembrada dice lo mismo que las columnas, peso por peso, y la guarda del
-- final lo prueba propiedad por propiedad. `sqm_construction` no se toca ni se
-- tocará: es metraje físico y lo leen el analizador y el PDF, a los que no les
-- importa lo que cueste la obra.
-- ─────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '5s';        -- ArgoCD PreSync corta a los 180s; no esperamos locks
SET statement_timeout = '150s'; -- dbmate envuelve el archivo en UNA transacción

-- ── 0. El toque de updated_at, con el nombre que le corresponde ──────────────
-- `properties_touch_updated_at()` (024) tiene este mismo cuerpo bajo un nombre
-- que dice una tabla. Aquí hacen falta cuatro, así que nace la versión genérica.
-- Unificar la vieja con ésta es una limpieza aparte: renombrarla obliga a tocar
-- un trigger que nada de este feature usa.

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- ── 1. El catálogo ───────────────────────────────────────────────────────────
-- Dos niveles, capítulo → partida, y nada más: el desglose de obra que se pidió.
-- Arranca VACÍO — no hay presupuestos históricos que importar — y crece con lo
-- que alguien promueva desde los renglones sueltos que se vayan tecleando.
--
-- BAJA LÓGICA, NUNCA BORRADO. Un capítulo que se deja de usar se apaga con
-- `is_active = FALSE`: los renglones que lo citan siguen citándolo, y la
-- historia de precios sigue pudiendo agrupar por él. Borrar una partida del
-- catálogo es la única operación que podría cortar la trazabilidad de un
-- presupuesto cerrado, y por eso no existe.
--
-- El catálogo NO guarda precio. A propósito: sugerir desde un precio guardado
-- es un bucle de autoconfirmación —presupuestas $1,000, el catálogo aprende
-- $1,000, la próxima vez sugiere $1,000— que nunca toca la realidad. El precio
-- se lee de lo PAGADO en renglones cerrados, por la vista del punto 3.

CREATE TABLE IF NOT EXISTS budget_chapters (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL CHECK (name <> ''),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La unicidad solo aplica entre los vivos: un capítulo apagado no debe impedir
-- que su nombre se vuelva a usar, y `lower()` es la primera defensa contra el
-- catálogo partido en variantes del mismo nombre.
CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_chapters_name
  ON budget_chapters (lower(name)) WHERE is_active;

CREATE TABLE IF NOT EXISTS budget_items (
  id          BIGSERIAL PRIMARY KEY,
  -- Sin ON DELETE: un capítulo con partidas no se borra, se apaga.
  chapter_id  BIGINT NOT NULL REFERENCES budget_chapters(id),
  name        TEXT NOT NULL CHECK (name <> ''),
  unit        TEXT NOT NULL CHECK (unit <> ''),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_items_name
  ON budget_items (chapter_id, lower(name)) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_budget_items_chapter ON budget_items (chapter_id, sort_order);

-- ── 2. La obra ───────────────────────────────────────────────────────────────
-- Un presupuesto es de una obra (`property_id`) o es una plantilla
-- (`property_id NULL`). Una sola tabla porque copiar es UNA operación usada tres
-- veces —arrancar desde plantilla, arrancar desde otra obra, guardar ésta como
-- plantilla— y tres nombres para un camino de código es tres caminos de código.
--
-- La FK a properties va SIN ON DELETE, igual que profit_split_config: borrar una
-- propiedad con presupuesto se rechaza con un 422 que dice qué la retiene. Un
-- presupuesto es captura manual —cantidades medidas, precios negociados, pagos
-- hechos— y perder eso en una cascada muda es perder trabajo real.

CREATE TABLE IF NOT EXISTS budgets (
  id          BIGSERIAL PRIMARY KEY,
  property_id BIGINT REFERENCES properties(id),
  -- Una plantilla se llama por su nombre; un presupuesto de obra hereda el de
  -- su propiedad y no necesita otro que pueda contradecirlo.
  name        TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT budgets_template_needs_name
    CHECK (property_id IS NOT NULL OR name <> '')
);

-- Un presupuesto por propiedad; plantillas, las que hagan falta.
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_property
  ON budgets (property_id) WHERE property_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_template_name
  ON budgets (lower(name)) WHERE property_id IS NULL;

-- El renglón. Copia el texto del catálogo al nacer —`chapter_name`, `name`,
-- `unit`— para que editar el catálogo no pueda reescribir lo que ya se capturó.
-- `item_id` sobrevive como procedencia y se apaga solo si la partida del
-- catálogo desaparece: el renglón no depende de él para significar nada.
--
-- Un renglón suelto (`item_id NULL`) es de primera clase, no una excepción:
-- obligar a pasar por el catálogo antes de poder anotar una partida es la forma
-- más rápida de que nadie use el módulo. Es el hueco que procesos nunca llenó.
CREATE TABLE IF NOT EXISTS budget_lines (
  id               BIGSERIAL PRIMARY KEY,
  budget_id        BIGINT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  item_id          BIGINT REFERENCES budget_items(id) ON DELETE SET NULL,

  -- Copia, no referencia. El capítulo se guarda por nombre porque es lo que se
  -- imprime y lo que agrupa; un presupuesto se lee completo sin tocar catálogo.
  chapter_name     TEXT NOT NULL CHECK (chapter_name <> ''),
  name             TEXT NOT NULL CHECK (name <> ''),
  unit             TEXT NOT NULL CHECK (unit <> ''),

  -- PRESUPUESTADO. No se guarda: es quantity × unit_price, siempre.
  quantity         NUMERIC(14,3) NOT NULL CHECK (quantity >= 0),
  unit_price       NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),

  -- COMPROMETIDO. Lo que se firmó con un proveedor, y cuándo. Sin CHECK que los
  -- amarre entre sí: la captura es celda por celda con autoguardado, y exigir
  -- que los dos lleguen juntos convertiría un estado intermedio normal en un
  -- error. La cotización seleccionada NO alimenta esto: `cotizaciones.is_selected`
  -- no tiene unicidad en la base, así que leerla sería leer un dato que puede
  -- estar duplicado sin que nada se vea roto.
  supplier_id      BIGINT REFERENCES proveedores(id) ON DELETE SET NULL,
  committed_amount NUMERIC(14,2) CHECK (committed_amount >= 0),
  committed_on     DATE,

  -- EJECUTADO. `actual_quantity` es lo que de verdad se midió al terminar; el
  -- pagado vive en los pagos y en ningún otro lado.
  actual_quantity  NUMERIC(14,3) CHECK (actual_quantity >= 0),

  -- CERRADO es la pieza de la que depende toda la historia de precios: sin ella
  -- $50,000 pagados pueden ser un anticipo o el costo final, y contar anticipos
  -- envenena el catálogo en silencio con precios sistemáticamente bajos. Cerrar
  -- exige la cantidad real: un cierre sin ella no produce un precio unitario, y
  -- un renglón cerrado que no enseña precio no es un cierre, es un hueco.
  closed_at        TIMESTAMPTZ,

  sort_order       INTEGER NOT NULL DEFAULT 0,
  notes            TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT budget_lines_closed_needs_actual_quantity
    CHECK (closed_at IS NULL OR (actual_quantity IS NOT NULL AND actual_quantity > 0))
);

CREATE INDEX IF NOT EXISTS idx_budget_lines_budget ON budget_lines (budget_id, sort_order);
-- La procedencia se recorre al revés cuando se promueve una partida al catálogo
-- y hay que religar hacia atrás los renglones que ya la usaban.
CREATE INDEX IF NOT EXISTS idx_budget_lines_item ON budget_lines (item_id) WHERE item_id IS NOT NULL;

-- Lo único intrínsecamente múltiple de un renglón: anticipo, avances, finiquito.
-- Append-only, como property_status_events: un pago mal capturado se borra, no
-- se reescribe. Sin `updated_at` por eso mismo.
CREATE TABLE IF NOT EXISTS budget_line_payments (
  id         BIGSERIAL PRIMARY KEY,
  line_id    BIGINT NOT NULL REFERENCES budget_lines(id) ON DELETE CASCADE,
  amount     NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  paid_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  notes      TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_line_payments_line ON budget_line_payments (line_id, paid_on);

CREATE TRIGGER trg_budget_chapters_touch BEFORE UPDATE ON budget_chapters
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_budget_items_touch BEFORE UPDATE ON budget_items
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_budgets_touch BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_budget_lines_touch BEFORE UPDATE ON budget_lines
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── 3. La historia de precios es una VISTA ───────────────────────────────────
-- No una tabla: no hay nada que sincronizar, así que no se puede desincronizar.
--
-- Tres filtros, y los tres cambian lo que el catálogo aprende:
--   · `closed_at IS NOT NULL` — solo lo terminado. Un anticipo no es un precio.
--   · `property_id IS NOT NULL` — solo obra real. Una plantilla es una intención,
--     no una observación; contarla haría que el catálogo aprendiera de sí mismo.
--   · pagado > 0 — un renglón cerrado sin un peso pagado no observó ningún
--     precio, y meterlo como $0 envenena la mediana exactamente igual que un
--     anticipo, solo que más rápido.
--
-- Publica las dos caras a propósito. El precio pagado es lo que se va a sugerir;
-- el presupuestado al lado es lo que permite medir el SESGO —«tu presupuesto de
-- instalaciones se queda 18% corto, en 4 de 4 obras»— que con tres obras ya vale
-- más que el precio unitario mismo.

CREATE VIEW budget_price_observations AS
SELECT l.id                                  AS line_id,
       b.property_id,
       l.item_id,
       l.chapter_name,
       l.name,
       l.unit,
       l.supplier_id,
       l.closed_at,
       l.quantity                            AS budgeted_quantity,
       l.actual_quantity,
       l.quantity * l.unit_price             AS budgeted_amount,
       pagos.paid_amount,
       l.unit_price                          AS budgeted_unit_price,
       round(pagos.paid_amount / l.actual_quantity, 2) AS actual_unit_price
  FROM budget_lines l
  JOIN budgets b ON b.id = l.budget_id
  JOIN LATERAL (
        SELECT coalesce(sum(p.amount), 0) AS paid_amount
          FROM budget_line_payments p
         WHERE p.line_id = l.id
       ) pagos ON TRUE
 WHERE l.closed_at IS NOT NULL
   AND b.property_id IS NOT NULL
   AND pagos.paid_amount > 0;

COMMENT ON VIEW budget_price_observations IS
    'Historia de precios: un renglón CERRADO de una obra real, con lo que se pagó por unidad y lo que se había presupuestado. Los renglones abiertos, las plantillas y los cierres sin pago quedan fuera — cada uno de los tres envenena la mediana en silencio.';

-- ── 4. La siembra ────────────────────────────────────────────────────────────
-- El costo de obra de cada propiedad, resuelto con la aritmética exacta de
-- api.finance.underwriting.investment(), en una tabla que la siembra y la guarda
-- leen igual. Una sola definición para el número que esta migración promete no
-- mover.

CREATE TEMP TABLE _028_obra ON COMMIT DROP AS
SELECT id AS property_id,
       (coalesce(sqm_construction::numeric, 0)
        * coalesce(construction_cost_per_sqm, 0)
        * CASE WHEN construction_overhead IS NULL THEN 1.3
               WHEN construction_overhead = 0     THEN 1
               ELSE construction_overhead::numeric END) AS costo_obra
  FROM properties;

-- Nada debería tener presupuesto todavía. Si algo lo tiene, esta migración ya
-- corrió a medias y sembrar otra vez duplicaría el costo de obra: aborta.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM budgets) THEN
        RAISE EXCEPTION '028: ya hay presupuestos en la base antes de sembrar. La siembra no es idempotente — revisa el estado antes de volver a correr.'
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

INSERT INTO budgets (property_id)
SELECT property_id FROM _028_obra ORDER BY property_id;

-- Una sola fila, la que el diseño pidió: el estimado grueso entero, sin detallar.
-- Detallar después no crea costo, solo lo distribuye, y «Otros» es el remanente.
-- `item_id NULL` porque el catálogo arranca vacío: este renglón es exactamente
-- el renglón suelto que el módulo tiene que hacer barato.
--
-- Las propiedades sin obra capturada reciben su fila en $0, no se saltan. Que
-- TODA propiedad tenga presupuesto es lo que le permite a la fase 2 leer la suma
-- sin una rama «si existe presupuesto»; y una suma de 0 sigue significando «nada
-- capturado», que es lo mismo que dicen hoy sus columnas.
INSERT INTO budget_lines (budget_id, chapter_name, name, unit, quantity, unit_price)
SELECT b.id, 'Otros', 'Otros, por detallar', 'lote', 1, o.costo_obra
  FROM budgets b
  JOIN _028_obra o ON o.property_id = b.property_id;

-- ── 5. La migración prueba su propia promesa ─────────────────────────────────
-- Propiedad por propiedad: la suma del presupuesto contra la fórmula. Al peso,
-- sin tolerancia. En local son 18 de 18 y no imprime nada; en prod, donde no
-- puedo mirar, prefiere abortar con nombres y cifras a dejar pasar un peso.

DO $$
DECLARE txt TEXT;
BEGIN
    SELECT string_agg(format('%s [%s]: fórmula %s vs presupuesto %s',
                             p.name, p.id, o.costo_obra, coalesce(s.total, 0)),
                      '; ' ORDER BY p.id)
      INTO txt
      FROM _028_obra o
      JOIN properties p ON p.id = o.property_id
      LEFT JOIN budgets b ON b.property_id = o.property_id
      LEFT JOIN LATERAL (SELECT sum(l.quantity * l.unit_price) AS total
                           FROM budget_lines l WHERE l.budget_id = b.id) s ON TRUE
     WHERE coalesce(s.total, 0) <> o.costo_obra;
    IF txt IS NOT NULL THEN
        RAISE EXCEPTION
            '028: el presupuesto sembrado no reproduce el costo de obra de estas propiedades. La siembra tiene que dar el mismo número al peso o la inversión total se mueve: %', txt
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

-- ── 6. Lo que estas tres columnas van a dejar de ser ─────────────────────────
-- Las dos de costo siguen vivas y siguen siendo el insumo del costo de obra: la
-- fase 2 mueve la lectura al presupuesto. Se les extiende el comentario de la
-- 025 —no se reemplaza— para que quien las lea en el esquema sepa que su sucesor
-- ya existe y no las vuelva a extender. El metraje conserva el suyo tal cual y
-- solo se le agrega por qué no va a morir con ellas.

COMMENT ON COLUMN properties.construction_cost_per_sqm IS
    'Costo por m² de la obra a ejecutar. Todavía es el insumo vivo del costo de obra; su sucesor es la suma de budget_lines (migración 028), y desde la fase 2 esta cifra se deriva —presupuesto ÷ m² de obra— en vez de capturarse.';
COMMENT ON COLUMN properties.construction_overhead IS
    'Supuesto: multiplicador de costos indirectos de obra. NULL = se aplica el default del sistema (1.3); un 0 capturado es identidad 1, nunca ×0. La migración 028 lo aplicó una sola vez al sembrar el presupuesto, y desde la fase 2 deja de multiplicar el costo de obra.';
COMMENT ON COLUMN properties.sqm_construction IS
    'Metros cuadrados de obra A EJECUTAR — la que se va a construir o remodelar, no la que el inmueble ya tiene. Sobrevive al presupuesto: es metraje FÍSICO y lo leen el analizador de mercado y el PDF, a los que no les importa cuánto cueste la obra.';

-- migrate:down

-- Revertir solo es seguro mientras nadie haya capturado nada: las cinco tablas
-- son el único lugar donde vive el desglose de obra, y un DROP mudo se llevaría
-- cantidades medidas, precios negociados y pagos hechos sin que nadie se entere.
-- Así que primero se pregunta si hay algo más que la siembra, y si lo hay,
-- falla ruidosamente en vez de fingir un rollback limpio.

DO $$
DECLARE capturado BIGINT;
BEGIN
    SELECT count(*) INTO capturado FROM (
        SELECT 1 FROM budget_chapters
        UNION ALL SELECT 1 FROM budget_items
        UNION ALL SELECT 1 FROM budget_line_payments
        UNION ALL SELECT 1 FROM budgets WHERE property_id IS NULL
        UNION ALL
        SELECT 1
          FROM budget_lines l
          JOIN budgets b    ON b.id = l.budget_id
          JOIN properties p ON p.id = b.property_id
         WHERE l.name <> 'Otros, por detallar'
            OR l.item_id          IS NOT NULL
            OR l.supplier_id      IS NOT NULL
            OR l.committed_amount IS NOT NULL
            OR l.actual_quantity  IS NOT NULL
            OR l.closed_at        IS NOT NULL
            OR l.quantity * l.unit_price <>
               (coalesce(p.sqm_construction::numeric, 0)
                * coalesce(p.construction_cost_per_sqm, 0)
                * CASE WHEN p.construction_overhead IS NULL THEN 1.3
                       WHEN p.construction_overhead = 0     THEN 1
                       ELSE p.construction_overhead::numeric END)
    ) t;
    IF capturado > 0 THEN
        RAISE EXCEPTION '028 no se puede revertir: hay presupuesto capturado (partidas, pagos, plantillas o catálogo) que estas tablas son las únicas en tener. Exporta lo capturado antes de tirar el módulo.'
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

DROP VIEW IF EXISTS budget_price_observations;
DROP TABLE IF EXISTS budget_line_payments;
DROP TABLE IF EXISTS budget_lines;
DROP TABLE IF EXISTS budgets;
DROP TABLE IF EXISTS budget_items;
DROP TABLE IF EXISTS budget_chapters;
DROP FUNCTION IF EXISTS touch_updated_at();

-- Los comentarios vuelven a decir lo que decían en la 025, no se vacían: sin el
-- presupuesto no hay sucesor que anunciar, pero la distinción entre metros a
-- ejecutar y metros ya construidos sigue siendo verdad y sigue haciendo falta.
COMMENT ON COLUMN properties.sqm_construction IS
    'Metros cuadrados de obra A EJECUTAR — la que se va a construir o remodelar, no la que el inmueble ya tiene.';
COMMENT ON COLUMN properties.construction_cost_per_sqm IS
    'Costo por m² de la obra a ejecutar.';
COMMENT ON COLUMN properties.construction_overhead IS
    'Supuesto: multiplicador de costos indirectos de obra. NULL = se aplica el default del sistema (1.3).';
