-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- La deduplicación al escribir  (Fase 4 · el catálogo que aprende)
--
-- El catálogo arranca VACÍO y no hay presupuestos históricos que importar: la
-- única fuente de lo que va a saber es lo que se teclee de aquí en adelante. Eso
-- vuelve a la deduplicación la pieza de la que depende todo lo demás. Si en seis
-- obras se escriben «Piso cerámico», «Colocación piso cerámico» y «Piso ceramico
-- 60x60», el catálogo no tiene tres partidas: tiene una partida partida en tres,
-- cada trozo con una sola observación de precio, y nunca llega a aprender nada.
-- No hay error que ver — solo un módulo que después de un año sigue sin poder
-- sugerir un peso.
--
-- pg_trgm es lo que permite preguntar «¿es la misma que ésta?» mientras alguien
-- escribe. Es una extensión TRUSTED desde PostgreSQL 13, así que la crea el dueño
-- de la base sin superusuario — importa porque en CNPG el usuario de la app no lo
-- es, y un CREATE EXTENSION que exija superusuario tumbaría el migrate-job.
--
-- QUÉ NO HACE ESTA MIGRACIÓN, dicho para que no haya que deducirlo:
--
--   · No fusiona nada. La similitud ORDENA candidatos; quien decide que dos
--     nombres son la misma partida es una persona, con un clic, y por eso la
--     promoción y la fusión son endpoints explícitos. Un catálogo que se fusiona
--     solo se equivoca en silencio, y deshacer una fusión es reconstruir a mano
--     la procedencia de presupuestos ya cerrados.
--   · No normaliza acentos. `unaccent()` no es IMMUTABLE —depende de un
--     diccionario— así que indexarla pide un envoltorio mentiroso; y volver
--     «ceramico» y «cerámico» el mismo grupo sería precisamente fusionar por
--     máquina. La similitud los pone uno junto al otro, que es lo que se quería.
--   · No toca un solo renglón capturado. Todo lo que agrega son índices.
-- ─────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '5s';
SET statement_timeout = '150s';

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Las dos caras de la sugerencia, y las dos hacen falta desde el día uno:
--
--   · el CATÁLOGO es lo curado, lo que alguien ya decidió que es una partida;
--   · los RENGLONES SUELTOS son todo lo demás — y mientras el catálogo esté
--     vacío son la única memoria que existe. Buscar solo en el catálogo dejaría
--     la deduplicación muda justo en los meses en que el catálogo se está
--     formando, que es cuando el daño se hace.
CREATE INDEX IF NOT EXISTS idx_budget_items_name_trgm
  ON budget_items USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_budget_lines_name_trgm
  ON budget_lines USING gin (name gin_trgm_ops);

-- La cola de promoción agrupa por nombre normalizado, y religar hacia atrás
-- busca por ese mismo nombre. `lower(btrim(name))` es la normalización entera —
-- literal a propósito: es la única que no decide por nadie.
--
-- El índice es parcial por lo mismo que la cola lo es. Un renglón que ya tiene
-- procedencia no se promueve, y el residuo tampoco: «Otros, por detallar» existe
-- en TODOS los presupuestos, así que sin excluirlo encabezaría la cola por
-- frecuencia para siempre, proponiendo meter al catálogo el remanente.
CREATE INDEX IF NOT EXISTS idx_budget_lines_promotable
  ON budget_lines (lower(btrim(name)))
  WHERE item_id IS NULL AND NOT is_residual;

-- migrate:down

DROP INDEX IF EXISTS idx_budget_lines_promotable;
DROP INDEX IF EXISTS idx_budget_lines_name_trgm;
DROP INDEX IF EXISTS idx_budget_items_name_trgm;

-- Se puede tirar porque nada más en el esquema la usa: los tres índices de
-- arriba son sus únicos dependientes y acaban de irse. El día que otra tabla
-- estrene trigramas, este DROP deja de ser correcto.
DROP EXTENSION IF EXISTS pg_trgm;
