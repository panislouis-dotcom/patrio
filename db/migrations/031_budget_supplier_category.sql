-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- El TIPO de proveedor en el presupuesto  (el oficio, no la persona)
--
-- SE SABE QUÉ TIPO DE PERSONA HACE FALTA MUCHO ANTES DE SABER QUIÉN. Al
-- presupuestar ya se sabe que la partida es de plomería; a quién se le da se
-- decide semanas después, cuando hay cotizaciones. Hasta aquí ese conocimiento
-- no tenía dónde vivir: `budget_lines` solo guardaba `supplier_id`, así que la
-- pregunta «¿cuánto de esta obra es electricidad?» no se podía contestar hasta
-- haber contratado a todo el mundo.
--
-- Y el selector de proveedores «sugería» comparando el NOMBRE DEL CAPÍTULO como
-- texto contra los nombres de las categorías del proveedor. Dos vocabularios
-- independientes que solo coinciden por casualidad: hoy hay cero categorías de
-- proveedor y los capítulos se llaman «Otros» y «Capítulo nuevo», así que ese
-- filtro nunca coincidió con nada y el grupo de sugeridos salía siempre vacío
-- sin que nada lo dijera. Una correspondencia hecha a mano, sin integridad
-- referencial — la misma familia de defectos que este módulo lleva una semana
-- eliminando.
--
-- EL PATRÓN YA EXISTE EN EL REPO Y SE COPIA. La migración 015 resolvió esto
-- mismo para los procesos de obra, en dos niveles:
--
--     template_nodes.supplier_category_id      la PLANTILLA declara qué tipo
--     instance_node_states.supplier_id         la INSTANCIA elige al real
--
-- Aquí son tres, porque el catálogo tiene dos niveles:
--
--     budget_chapters.supplier_category_id     el capítulo declara el oficio
--     budget_items.supplier_category_id        override para la excepción
--     budget_lines.supplier_category_id        la copia, en el renglón
--
-- SE CONTRATA AL ALBAÑIL, NO A «COLOCACIÓN DE PISO 60×60». Por eso el oficio se
-- declara en el CAPÍTULO y la partida lo hereda: un NULL en `budget_items` no es
-- un dato faltante, es «el de mi capítulo». El override existe para la excepción
-- real —impermeabilización dentro de azotea— y no para volver a capturar en cada
-- partida lo que el capítulo ya dijo.
--
-- Y EL RENGLÓN LO COPIA, NO LO DERIVA. Es la doctrina del módulo entero, la
-- misma que ya rige el nombre, la unidad y el importe: el renglón ES la
-- afirmación, y editar el catálogo después no puede alterar un presupuesto ya
-- capturado. Que la categoría se resolviera en vivo reabriría exactamente lo que
-- la copia evita, y lo reabriría en el único campo que el resto del renglón no
-- puede desmentir.
--
-- LA CATEGORÍA FILTRA, NUNCA RESTRINGE. No hay CHECK que amarre el proveedor a
-- su categoría, y la ausencia es deliberada: el día que el plomero haga
-- albañilería tiene que poder capturarse. Lo que la categoría hace es ORDENAR el
-- selector —los del oficio arriba, el resto abajo y alcanzable— con una igualdad
-- de ids en vez de una de textos.
--
-- ESTA MIGRACIÓN NO ESCRIBE UNA SOLA FILA. Las tres columnas nacen en NULL y no
-- hay UPDATE que las llene: no existe un mapa de capítulos a oficios que se
-- pueda deducir sin inventarlo, y la única fuente honesta es quien captura. Por
-- eso tampoco hay guarda de no-movimiento como en la 028: no hay aritmética que
-- vigilar, no se toca ninguna columna de dinero, y `budget_price_observations`
-- sigue publicando exactamente las mismas filas con las mismas cifras.
-- ─────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '5s';        -- ArgoCD PreSync corta a los 180s; no esperamos locks
SET statement_timeout = '150s'; -- dbmate envuelve el archivo en UNA transacción

-- `ON DELETE SET NULL` en las tres, igual que la 015: una categoría de proveedor
-- que se retira no puede llevarse por delante ni el catálogo ni un presupuesto
-- capturado. El renglón sobrevive diciendo lo mismo que decía —su nombre, su
-- cantidad, su precio— y lo único que pierde es el oficio, que es justo lo que
-- dejó de existir.

ALTER TABLE budget_chapters
  ADD COLUMN IF NOT EXISTS supplier_category_id BIGINT
    REFERENCES proveedor_categories(id) ON DELETE SET NULL;

ALTER TABLE budget_items
  ADD COLUMN IF NOT EXISTS supplier_category_id BIGINT
    REFERENCES proveedor_categories(id) ON DELETE SET NULL;

ALTER TABLE budget_lines
  ADD COLUMN IF NOT EXISTS supplier_category_id BIGINT
    REFERENCES proveedor_categories(id) ON DELETE SET NULL;

-- «Otros, por detallar» no es trabajo de ningún oficio: es el remanente, lo que
-- todavía no se reparte. Darle categoría sería afirmar que lo que falta por
-- detallar ya se sabe de qué es —y en cuanto se sepa, deja de ser residuo y se
-- vuelve una partida. El API ya rechaza toda escritura sobre el residuo que no
-- sea una nota; esto lo vuelve un hecho de la fila, como la 029 hizo con
-- `is_residual` mismo.
ALTER TABLE budget_lines
  ADD CONSTRAINT budget_lines_residual_has_no_category
    CHECK (NOT is_residual OR supplier_category_id IS NULL);

-- El índice contesta «¿cuánto de esta obra es electricidad?» y sostiene el
-- `SET NULL` al retirar una categoría, que sin él recorre la tabla entera.
-- Parcial porque durante meses la enorme mayoría de los renglones va a estar en
-- NULL: un renglón sin oficio asignado no es una respuesta a ninguna de las dos
-- preguntas.
--
-- El catálogo NO recibe índice, y la asimetría es a propósito: `budget_chapters`
-- y `budget_items` se leen SIEMPRE completos —`get_catalog` trae los dos niveles
-- de un jalón— así que un índice ahí no ahorra nada y solo agrega algo que
-- mantener.
CREATE INDEX IF NOT EXISTS idx_budget_lines_supplier_category
  ON budget_lines (supplier_category_id) WHERE supplier_category_id IS NOT NULL;

COMMENT ON COLUMN budget_chapters.supplier_category_id IS
    'El OFICIO que este capítulo requiere: se contrata al albañil, no a «colocación de piso 60×60». Sus partidas lo heredan mientras no declaren el suyo. NULL = todavía no se sabe, que es el estado normal mientras el catálogo se forma.';
COMMENT ON COLUMN budget_items.supplier_category_id IS
    'Override del oficio del capítulo, para la excepción real —impermeabilización dentro de azotea—. NULL NO es un dato faltante: es «el de mi capítulo», y por eso no se copia hacia abajo al crear la partida.';
COMMENT ON COLUMN budget_lines.supplier_category_id IS
    'El oficio que este renglón requiere, COPIADO del catálogo al instanciar como el nombre, la unidad y el precio: editar el catálogo después no lo mueve. FILTRA el selector de proveedores por id —no por el nombre del capítulo, que era una coincidencia de textos— y nunca restringe: el día que el plomero haga albañilería tiene que poder capturarse. Que un renglón tenga oficio y todavía no proveedor es el estado normal mientras se presupuesta.';

-- migrate:down

-- Estas tres columnas son el ÚNICO lugar donde vive el oficio de una partida: no
-- se deduce del nombre del capítulo —ésa era justamente la coincidencia de
-- textos que esta migración vino a eliminar— ni del proveedor, que en la mayoría
-- de los renglones todavía no existe. Un DROP mudo se llevaría captura manual
-- irrecuperable, así que primero se pregunta, igual que en la 028.

DO $$
DECLARE capturado BIGINT;
BEGIN
    SELECT count(*) INTO capturado FROM (
        SELECT 1 FROM budget_chapters WHERE supplier_category_id IS NOT NULL
        UNION ALL SELECT 1 FROM budget_items WHERE supplier_category_id IS NOT NULL
        UNION ALL SELECT 1 FROM budget_lines WHERE supplier_category_id IS NOT NULL
    ) t;
    IF capturado > 0 THEN
        RAISE EXCEPTION '031 no se puede revertir: hay % filas con oficio capturado, y estas columnas son el único lugar donde vive. No se deduce del capítulo ni del proveedor — expórtalo antes de tirarlas.', capturado
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

DROP INDEX IF EXISTS idx_budget_lines_supplier_category;
ALTER TABLE budget_lines DROP CONSTRAINT IF EXISTS budget_lines_residual_has_no_category;
ALTER TABLE budget_lines    DROP COLUMN IF EXISTS supplier_category_id;
ALTER TABLE budget_items    DROP COLUMN IF EXISTS supplier_category_id;
ALTER TABLE budget_chapters DROP COLUMN IF EXISTS supplier_category_id;
