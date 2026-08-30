-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- El renglón sembrado se DECLARA, no se adivina
-- (diseño: docs/plans/2026-08-30-presupuesto-independiente-design.md)
--
-- Dos preguntas del presupuesto dependen de saber si un renglón lo puso el
-- sistema o lo tecleó una persona: si `apply` REEMPLAZA el estimado inicial por
-- el desglose que llega, y si una propiedad se puede BORRAR. Las dos se
-- contestaban por parecido —«a lo más un renglón, sin ejecución, con
-- `created_at` igual al del presupuesto»— y el parecido falla en los dos
-- sentidos:
--
--   1. `_require_budget` crea el presupuesto al vuelo para filas que entraron
--      fuera del API. En esa propiedad, el PRIMER renglón tecleado se inserta en
--      la misma transacción que el presupuesto —`create_line` los envuelve en un
--      solo `with get_db()`— así que hereda el mismo `now()` y se lee como
--      sembrado. `apply` lo borraba en silencio: verificado con un «Clósets
--      cotizados a mano» de $950,000.
--   2. Las semillas corren con `psql -f` SIN `-1` (ver makefile), o sea
--      autocommit por sentencia: el INSERT del presupuesto y el del renglón caen
--      en transacciones distintas y sus marcas difieren. Las 16 propiedades
--      sembradas quedan indelebles y sin reemplazo posible.
--
--      Y ESO NO SE ARREGLA SOLO EN UNA BASE YA SEMBRADA. El relleno de abajo
--      conserva la respuesta de hoy —es su trabajo—, así que esos renglones se
--      quedan en FALSE; y volver a correr las semillas tampoco los toca, porque
--      `seed_zz_presupuestos.sql` sólo escribe donde el presupuesto no tiene
--      renglones. La única salida es `make full-reset`. Producción no tiene el
--      problema: ahí el presupuesto y su renglón nacen en la misma transacción
--      (`create_property` los envuelve en un solo `with get_db()`), así que
--      rellenan en TRUE. Es un defecto de las bases de desarrollo, y sólo de ellas.
--
-- La igualdad de relojes CORRELACIONA con el origen del renglón, pero no es el
-- origen del renglón. Aquí se registra el hecho en vez de inferirlo.
--
-- NO ES `is_residual` OTRA VEZ, y la diferencia es la que importa: aquella
-- bandera DEFINÍA ARITMÉTICA —el total se expresaba en términos de ella, así que
-- toda escritura tenía que mantenerla, y mantenerla mal descuadraba el dinero—.
-- `seeded` es procedencia de escritura única: nada la suma, nada la asienta,
-- ningún importe depende de ella. Se pone al INSERT y no se actualiza jamás. El
-- modo de falla que volvió insostenible a la 033 no puede ocurrir.
--
-- El relleno reproduce EXACTAMENTE el predicado de hoy, así que ninguna
-- propiedad cambia de respuesta el día de la migración; de ahí en adelante el
-- dato es declarado. La guarda del final comprueba eso y sólo eso, presupuesto
-- por presupuesto: que ninguno cambie de respuesta.
--
-- Aditiva y por lo tanto segura bajo expand/contract: los pods VIEJOS ignoran
-- una columna que no nombran. Con una salvedad que conviene decir en voz alta:
-- los renglones que esos pods escriban DURANTE el rollout de PR 1 nacen con
-- `seeded = FALSE`, así que una propiedad dada de alta dentro de esa ventana se
-- lee como capturada —no se borra sola, no la reemplaza una copia—. Es
-- transitorio, dura lo que el rollout (menos de un minuto) y se corrige a mano
-- con un UPDATE sobre esos renglones. Se prefiere ese falso «tiene trabajo» al
-- contrario, que borraría.

SET LOCAL lock_timeout      = '5s';
SET LOCAL statement_timeout = '60s';

-- NOT NULL con DEFAULT no reescribe la tabla desde PG 11: es metadato, y por eso
-- toma el ACCESS EXCLUSIVE un instante en vez de por el tamaño de budget_lines.
ALTER TABLE budget_lines
    ADD COLUMN IF NOT EXISTS seeded BOOLEAN NOT NULL DEFAULT FALSE;

-- El relleno: el predicado vigente, palabra por palabra.
--
-- ESTA MIGRACIÓN CORRE UNA VEZ y no se replica sin daño. dbmate no la repite, y
-- eso basta; pero si alguien la vuelve a correr a mano sobre una base donde ya
-- trabajó el código nuevo, la guarda ABORTA. No porque algo esté mal: un
-- estimado que llegó copiado es `seeded = TRUE` con relojes distintos, o sea
-- justo el caso donde los dos lados discrepan por diseño. El `IF NOT EXISTS` y
-- el `NOT l.seeded` evitan trabajo repetido, no convierten el archivo en
-- reejecutable. Si la guarda aborta en un replay, la columna ya estaba bien.
UPDATE budget_lines l
   SET seeded = TRUE
  FROM budgets b
 WHERE b.id = l.budget_id
   AND NOT l.seeded
   AND l.created_at      = b.created_at
   AND l.supplier_id     IS NULL
   AND l.committed_amount IS NULL
   AND l.actual_quantity IS NULL
   AND l.closed_at       IS NULL
   AND NOT EXISTS (SELECT 1 FROM budget_line_payments p WHERE p.line_id = l.id)
   AND (SELECT count(*) FROM budget_lines o WHERE o.budget_id = l.budget_id) = 1;

-- La guarda de conservación: para CADA presupuesto, «¿aquí no ha trabajado
-- nadie?» tiene que dar lo mismo leído por relojes que leído por `seeded`. Si
-- alguno difiere, la migración aborta en vez de dejar propiedades que cambiaron
-- de respuesta sin que nadie lo pidiera.
--
-- Prueba ESO y nada más. No prueba que cada renglón quedara bien marcado: los
-- dos lados exigen `count(l.id) <= 1`, así que marcar de más DENTRO de un
-- presupuesto de varios renglones le resulta invisible. Es inofensivo —los dos
-- consumidores exigen lo mismo— pero la guarda no lo cubre y no hay que leerla
-- como si lo hiciera.
DO $$
DECLARE
    difieren integer;
BEGIN
    SELECT count(*) INTO difieren
      FROM budgets b
     WHERE (SELECT count(l.id) <= 1 AND NOT coalesce(bool_or(
                     l.created_at       <> b.created_at
                  OR l.supplier_id      IS NOT NULL
                  OR l.committed_amount IS NOT NULL
                  OR l.actual_quantity  IS NOT NULL
                  OR l.closed_at        IS NOT NULL
                  OR EXISTS (SELECT 1 FROM budget_line_payments p WHERE p.line_id = l.id)
                   ), FALSE)
              FROM budget_lines l WHERE l.budget_id = b.id)
           IS DISTINCT FROM
           (SELECT count(l.id) <= 1 AND NOT coalesce(bool_or(
                     NOT l.seeded
                  OR l.supplier_id      IS NOT NULL
                  OR l.committed_amount IS NOT NULL
                  OR l.actual_quantity  IS NOT NULL
                  OR l.closed_at        IS NOT NULL
                  OR EXISTS (SELECT 1 FROM budget_line_payments p WHERE p.line_id = l.id)
                   ), FALSE)
              FROM budget_lines l WHERE l.budget_id = b.id);
    IF difieren > 0 THEN
        RAISE EXCEPTION
            'El relleno de seeded no conserva el predicado: % presupuesto(s) '
            'cambian de respuesta a «¿aquí no ha trabajado nadie?». '
            'La migración se aborta sin tocar nada.', difieren;
    END IF;
END $$;

COMMENT ON COLUMN budget_lines.seeded IS
    'Procedencia, no aritmética: TRUE solo en el renglón que el sistema escribió al crear el presupuesto —el estimado de la calculadora, m² × $/m²—. La pone `budget_db.seed_estimate_line` (y las semillas) al INSERT y NADIE la actualiza después. Contesta dos preguntas: si `apply` reemplaza ese renglón por el desglose que llega, y si una propiedad se puede borrar sin perder trabajo. Ningún importe depende de ella: nada la suma y nada la asienta.';

-- migrate:down

-- El SET LOCAL del up no sobrevive a su transacción y dbmate corre el down en
-- una propia, así que se repite: bajar esta migración se intenta durante un
-- incidente, y el ACCESS EXCLUSIVE del DROP choca contra cualquier lectura de
-- presupuestos que esté en curso. Sin timeout se cuelga sin límite.
SET LOCAL lock_timeout = '5s';

ALTER TABLE budget_lines DROP COLUMN IF EXISTS seeded;
