-- migrate:up

-- Editar un render (`edit_property_render`) nunca heredó `source_image_id` de su
-- padre — a diferencia de `source_variant`/`floor_id`/`floor_name`, que sí se
-- heredan explícitamente (routes/renders.py, comentario "el hijo hereda... no la
-- recalcula"). Cada edición sobre un render de foto perdía la liga a su foto
-- fuente; la CABEZA de esa cadena —la única que se muestra— quedaba huérfana:
-- sin `source_image_id` la estrella (migración 046) no tiene grupo al que
-- pertenecer y no se ofrece. El código se corrige aparte (routes/renders.py);
-- esta migración repara lo que ya quedó mal escrito en filas existentes.
--
-- Backfill: mismo patrón de caminata que la 040 para `source_variant`. La raíz
-- de una cadena de FOTO (no de plano: `source_plan_path IS NULL`) trae su
-- `source_image_id` correcto desde que nació; se propaga a cualquier
-- descendiente que lo tenga NULL.
WITH RECURSIVE chain AS (
  SELECT id, id AS root FROM property_renders WHERE parent_render_id IS NULL
  UNION ALL
  SELECT r.id, c.root FROM property_renders r JOIN chain c ON r.parent_render_id = c.id
)
UPDATE property_renders pr SET source_image_id = root.source_image_id
FROM chain c
JOIN property_renders root ON root.id = c.root
WHERE pr.id = c.id
  AND pr.source_image_id IS NULL
  AND root.source_plan_path IS NULL
  AND root.source_image_id IS NOT NULL;

-- migrate:down

-- Sin down con efecto, a propósito: después del hecho no hay forma de distinguir
-- un `source_image_id` que ya estaba bien de uno que este backfill puso — deshacer
-- solo podría volver a poner NULL en filas que ya eran NULL antes, efecto neto nulo.
