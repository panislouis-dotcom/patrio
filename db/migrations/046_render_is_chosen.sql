-- migrate:up

-- Junto a cada plano o cada foto pueden existir varios renders (varias cadenas de
-- edición independientes: cada "GENERAR RENDER" nuevo arranca una raíz propia). El
-- prospecto necesita UNO por piso+variante y UNO por foto fuente — no "el más
-- reciente", sino el que alguien de verdad revisó y eligió.
--
-- `is_chosen` es la marca; los DOS índices son la garantía. Un render nace de un
-- piso (floor_id + source_variant) o de una foto (source_image_id), nunca de los
-- dos, así que los índices no compiten entre sí — cada uno solo mira su propio
-- grupo (WHERE floor_id/source_image_id IS NOT NULL) y dentro de ese grupo hace
-- físicamente imposible tener dos elegidos a la vez, sin importar qué código
-- escriba la fila después. El único precedente del repo (cotizaciones.is_selected)
-- garantiza "solo uno" con una transacción, sin constraint — aquí "solo uno" es la
-- razón de ser de la feature, no un efecto secundario de cómo se escribe.
--
-- Sin backfill: ninguna propiedad tiene hoy una elección honesta — "el render que
-- alguien de verdad prefirió" nunca se capturó — así que todo nace en FALSE.
ALTER TABLE property_renders ADD COLUMN IF NOT EXISTS is_chosen BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_render_chosen_per_floor
  ON property_renders (property_id, floor_id, source_variant)
  WHERE is_chosen AND floor_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_render_chosen_per_photo
  ON property_renders (property_id, source_image_id)
  WHERE is_chosen AND source_image_id IS NOT NULL;

-- migrate:down

DROP INDEX IF EXISTS idx_render_chosen_per_photo;
DROP INDEX IF EXISTS idx_render_chosen_per_floor;
ALTER TABLE property_renders DROP COLUMN IF EXISTS is_chosen;
