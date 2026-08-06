-- migrate:up

-- Un render puede nacer del PLANO, no solo de una foto. El plano no es una foto
-- (no entra a property_images, igual que un render tampoco) y tampoco es el
-- render en sí: es la imagen-fuente desde la que se generó. Cuando la fuente es
-- el plano, source_image_id queda en NULL —no hubo foto de la propiedad— y esta
-- columna guarda la ruta del plano exportado, para poder enseñar el par
-- «plano base | propuesta» sin meter el plano dentro del eje de las fotos.
ALTER TABLE property_renders ADD COLUMN IF NOT EXISTS source_plan_path TEXT;

-- migrate:down

ALTER TABLE property_renders DROP COLUMN IF EXISTS source_plan_path;
