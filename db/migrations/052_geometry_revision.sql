-- migrate:up

-- Candado optimista para el blob de geometría (2026-08-24). Guardar geometría
-- reemplaza el JSON COMPLETO (original + todos los planes): dos sesiones con la
-- ficha abierta se pisan en silencio — la que guarda al último borra los planes
-- que la otra creó en medio. Cada lectura entrega esta revisión; cada escritura
-- declara de cuál partió y solo procede si sigue vigente (UPDATE ... WHERE
-- geometry_revision = esperado), incrementándola. Un guardado sobre una
-- revisión vieja contesta 409 en vez de perder datos.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS geometry_revision BIGINT
  NOT NULL DEFAULT 0;

-- migrate:down

ALTER TABLE properties DROP COLUMN IF EXISTS geometry_revision;
