-- migrate:up

-- Un levantamiento puede tener varios pisos (la propiedad 5, "Locales Salon
-- Escobedo", ya tiene 2 reales: "Planta Baja"/"Planta Alta"). Un render
-- generado desde un plano necesita recordar de QUÉ piso nació, o se vuelve
-- indistinguible de un render del otro piso en cuanto un levantamiento pasa
-- de 1 a 2+ pisos.
--
-- Mismo patrón dual que prompt_id/prompt_text: floor_id es la identidad (debe
-- coincidir con un FloorGraph.id real mientras ese piso exista) y floor_name
-- es el nombre congelado al momento de generar — sobrevive a que el piso se
-- renombre o se borre después, igual que prompt_text sobrevive a que el
-- preset se edite o se archive.
--
-- Sin backfill: ambas columnas quedan NULL para todo render existente. No hay
-- forma honesta de reconstruir de qué piso nació un render que ya existe —
-- ese dato nunca se capturó. Los 8 renders históricos reales de la propiedad
-- 5 (2026-08-05 al 07, de antes de este addendum) son el caso real: se
-- quedan con floor_id/floor_name en NULL para siempre, y así deben mostrarse
-- (sin inventar un piso que no se registró).
ALTER TABLE property_renders ADD COLUMN floor_id text;
ALTER TABLE property_renders ADD COLUMN floor_name text;

-- migrate:down

ALTER TABLE property_renders DROP COLUMN IF EXISTS floor_name;
ALTER TABLE property_renders DROP COLUMN IF EXISTS floor_id;
