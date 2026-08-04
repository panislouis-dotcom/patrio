-- Presupuesto de obra de cada propiedad sembrada · corre AL FINAL
--
-- Las semillas insertan propiedades después de las migraciones, así que la
-- siembra de la 032 no las alcanza: en una base recién reseteada quedarían 18
-- propiedades sin presupuesto. Este archivo cierra ese hueco, y el `zz_` del
-- nombre es lo que lo mantiene cerrado — seed-db corre los archivos ordenados,
-- así que toda propiedad nueva que se siembre antes queda cubierta sin tocar
-- nada más.
--
-- Es la misma aritmética de la 032, y tiene que seguir siéndolo: una fila
-- «Otros, por detallar» cuyo importe es el costo de obra con el overhead YA
-- APLICADO —un 0 capturado es identidad 1, un NULL resuelve al default 1.3—
-- para que el presupuesto y la fórmula digan el mismo número al peso. Los
-- ::numeric evitan que Postgres promueva a flotante y empiece a diferir de lo
-- que calcula Python por ruido de redondeo.
--
-- La fila nace con `is_residual` PRENDIDA (migración 033): es el renglón que
-- absorbe lo que todavía no se detalla, y sin la bandera detallar una partida
-- no tendría de dónde restar — el costo de obra crecería con cada renglón que
-- alguien capturara, sin nada que se viera roto.
--
-- Solo siembra lo que falta: correr las semillas dos veces no duplica el costo
-- de obra de nadie.

INSERT INTO budgets (property_id)
SELECT p.id
  FROM properties p
 WHERE NOT EXISTS (SELECT 1 FROM budgets b WHERE b.property_id = p.id)
 ORDER BY p.id;

INSERT INTO budget_lines (budget_id, chapter_name, name, unit, quantity, unit_price, is_residual)
SELECT b.id, 'Otros', 'Otros, por detallar', 'lote', 1,
       (coalesce(p.sqm_construction::numeric, 0)
        * coalesce(p.construction_cost_per_sqm, 0)
        * CASE WHEN p.construction_overhead IS NULL THEN 1.3
               WHEN p.construction_overhead = 0     THEN 1
               ELSE p.construction_overhead::numeric END),
       TRUE
  FROM budgets b
  JOIN properties p ON p.id = b.property_id
 WHERE NOT EXISTS (SELECT 1 FROM budget_lines l WHERE l.budget_id = b.id);
