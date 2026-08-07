-- migrate:up

-- Editar un render ENCIMA de otro: el hijo apunta a su padre. Así se avanza
-- sobre una sola imagen con instrucciones chicas ("agrega puerta al baño") en
-- vez de reescribir el prompt entero. La lista enseña solo las CABEZAS (renders
-- que nadie edita); el historial se camina hacia atrás por esta liga.
--
-- ON DELETE SET NULL, no CASCADE: borrar un paso intermedio no destruye los que
-- le siguen —pierden la liga hacia atrás, no la imagen—, igual que source_image_id.
ALTER TABLE property_renders ADD COLUMN IF NOT EXISTS parent_render_id BIGINT
  REFERENCES property_renders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_property_renders_parent
  ON property_renders (parent_render_id);

-- migrate:down

DROP INDEX IF EXISTS idx_property_renders_parent;
ALTER TABLE property_renders DROP COLUMN IF EXISTS parent_render_id;
