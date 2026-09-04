-- Presupuesto de obra de cada propiedad sembrada · corre AL FINAL
--
-- Las semillas insertan propiedades después de las migraciones, así que la
-- siembra de la 032 no las alcanza: en una base recién reseteada quedarían 18
-- propiedades sin presupuesto. Este archivo cierra ese hueco, y el `zz_` del
-- nombre es lo que lo mantiene cerrado — seed-db corre los archivos ordenados,
-- así que toda propiedad nueva que se siembre antes queda cubierta sin tocar
-- nada más.
--
-- Es la misma aritmética de la 032, y tiene que seguir siéndolo: un renglón
-- cuyo importe es el costo de obra con el overhead YA APLICADO —un 0 capturado
-- es identidad 1, un NULL resuelve al default 1.3— para que el presupuesto y la
-- calculadora digan el mismo número al peso. Los ::numeric evitan que Postgres
-- promueva a flotante y empiece a diferir de lo que calcula Python por ruido de
-- redondeo.
--
-- EL RENGLÓN ES NORMAL, sin bandera. La 053 retiró el residuo: el total del
-- presupuesto es la suma de sus renglones, y una holgura es un renglón con el
-- nombre que alguien le puso. Por eso el nombre lleva la cuenta que lo produjo,
-- igual que el que escribe `budget_db.seed_estimate_line` al dar de alta una
-- propiedad — una base sembrada y una capturada por el API se leen igual. El
-- `FM` de to_char quita el relleno de ceros, y el `rtrim(…, '.')` quita el punto
-- que FM deja atrás cuando no queda un solo decimal: sin él, 100 m² se
-- imprimía «100. m²». Entre los dos reproducen el `.rstrip("0").rstrip(".")` de
-- `_cifra`. El overhead solo aparece cuando de verdad multiplica, igual que allá.
--
-- Y `seeded = TRUE` se DECLARA aquí, que es la razón de que este archivo no
-- necesite abrir una transacción: las semillas corren con `psql -f` sin `-1`, o
-- sea autocommit por sentencia, así que el presupuesto y su renglón caen en
-- transacciones distintas. Cuando la procedencia se deducía de `created_at` eso
-- dejaba a las 16 propiedades sembradas indelebles; declarándola, el límite
-- transaccional deja de importar. Es exactamente lo que la 054 vino a arreglar.
--
-- Solo siembra lo que falta: correr las semillas dos veces no duplica el costo
-- de obra de nadie. LA OTRA CARA DE ESO: una base sembrada ANTES de la 054 no se
-- repara volviendo a sembrar. Sus renglones ya existen, así que este archivo no
-- los toca, y siguen en `seeded = FALSE` —propiedades que no se borran y que
-- ninguna copia reemplaza—. Se arregla con `make full-reset` y con nada más.
-- Es un problema de bases de desarrollo: en producción el presupuesto y su
-- renglón nacen en la misma transacción y la 054 los rellenó en TRUE.

INSERT INTO budgets (property_id)
SELECT p.id
  FROM properties p
 WHERE NOT EXISTS (SELECT 1 FROM budgets b WHERE b.property_id = p.id)
 ORDER BY p.id;

INSERT INTO budget_lines (budget_id, chapter_name, name, unit, quantity,
                          unit_price, seeded)
SELECT b.id, 'Otros',
       'Estimado inicial · '
         || rtrim(trim(to_char(coalesce(p.sqm_construction::numeric, 0),
                               'FM999,999,990.999')), '.')
         || ' m² × $'
         || rtrim(trim(to_char(coalesce(p.construction_cost_per_sqm, 0),
                               'FM999,999,990.99')), '.')
         || '/m²'
         || CASE WHEN overhead.factor = 1 THEN ''
                 ELSE ' × ' || rtrim(trim(to_char(overhead.factor,
                                                  'FM999,990.9999')), '.') END,
       'lote', 1,
       (coalesce(p.sqm_construction::numeric, 0)
        * coalesce(p.construction_cost_per_sqm, 0)
        * overhead.factor),
       TRUE
  FROM budgets b
  JOIN properties p ON p.id = b.property_id
  JOIN LATERAL (SELECT CASE WHEN p.construction_overhead IS NULL THEN 1.3
                            WHEN p.construction_overhead = 0     THEN 1
                            ELSE p.construction_overhead::numeric END AS factor) overhead ON TRUE
 WHERE NOT EXISTS (SELECT 1 FROM budget_lines l WHERE l.budget_id = b.id)
   -- Sin metraje o sin $/m² no hay estimado que sembrar, y un renglón en $0
   -- llamado «Estimado inicial · 0 m² × $0/m²» no dice nada que el presupuesto
   -- vacío no diga ya. Mismo criterio que `seed_estimate_line`.
   AND coalesce(p.sqm_construction::numeric, 0) * coalesce(p.construction_cost_per_sqm, 0) > 0;
