-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- render_prompts.kind: la biblioteca de presets ya no es una sola lista
--
-- Hasta hoy `render_prompts` era una biblioteca plana para renders nacidos de
-- una FOTO: Jardín regional, Fachada minimalista, Alberca... presets de ÁREA,
-- porque una foto muestra un pedazo concreto del terreno o de la casa y el
-- preset describe qué poner ahí.
--
-- Ahora un render también puede nacer de un PLANO (levantamiento). Un plano no
-- tiene "jardín" ni "fachada" que describir — es la distribución completa vista
-- desde arriba. Lo que un preset de plano necesita ofrecer es un ESTILO
-- (cálido contemporáneo, minimalista nórdico...), no un área. Mezclar los dos
-- en una sola lista le ofrecería a un usuario armando un render de plano un
-- preset de "Alberca y asoleadero" que no tiene dónde aplicarse.
--
-- POR QUÉ EL DEFAULT ES 'photo': los 6 presets sembrados en la migración 028
-- son, sin excepción, de área/contenido fotográfico (jardín, fachada, patio,
-- alberca, interior, lote limpio) — nacieron para renders de foto y ninguno
-- describe un estilo puro aplicable a un plano. El default hace que el
-- backfill de esas 6 filas sea automáticamente correcto sin tocar sus datos:
-- ya eran 'photo', simplemente ahora lo dicen explícito.
ALTER TABLE render_prompts ADD COLUMN kind TEXT NOT NULL DEFAULT 'photo'
  CHECK (kind IN ('photo', 'plan'));

-- ── Biblioteca de estilo para planos ─────────────────────────────────────────
-- "Estilo cálido y contemporáneo" es la frase que ya funcionó en los renders
-- históricos de referencia (property_renders de las propiedades 5 y 10, antes
-- de que este feature existiera formalmente): piso de madera, muebles
-- realistas, tonos cálidos, primer intento cercano sin necesitar ediciones de
-- estilo. El resto amplía el catálogo con estilos igual de concretos para que
-- la biblioteca no dependa de un solo sabor.
INSERT INTO render_prompts (name, body, is_default, kind) VALUES
  ('Cálido contemporáneo',
   'Estilo cálido y contemporáneo para amueblar la planta: paredes en blanco '
   'tibio, piso de duela clara o porcelánico símil madera, mobiliario de '
   'líneas simples en madera natural y textiles en lino y algodón, acentos en '
   'tonos terracota y oliva. Iluminación cálida y difusa, acabados actuales '
   'sin ornamento excesivo. Sensación acogedora y habitable en cada espacio.',
   true, 'plan'),
  ('Minimalista nórdico',
   'Estilo minimalista nórdico: paredes blancas, piso de madera clara, '
   'mobiliario funcional de líneas rectas en madera de pino o roble claro, '
   'paleta reducida a blancos, grises suaves y un acento en madera natural. '
   'Textiles de lana y algodón crudo, plantas puntuales, mucha luz natural '
   'difusa. Sensación limpia, ordenada y luminosa.',
   true, 'plan'),
  ('Industrial urbano',
   'Estilo industrial urbano: acabados en concreto pulido o símil, acentos en '
   'ladrillo aparente, herrería negra mate en repisas y patas de mobiliario, '
   'mobiliario de cuero envejecido y madera recuperada. Paleta de grises, '
   'negros y tonos óxido, iluminación tipo riel o colgante expuesta. Carácter '
   'robusto sin perder calidez.',
   true, 'plan'),
  ('Colorido y vibrante',
   'Estilo colorido y vibrante: un muro de acento en tonos saturados (mostaza, '
   'terracota, azul petróleo), mobiliario con piezas de color contrastante, '
   'textiles estampados y cojines de patrones geométricos. Piso claro como '
   'base neutra, iluminación cálida. Ambiente alegre y con personalidad, sin '
   'saturar cada espacio por igual.',
   true, 'plan'),
  ('Clásico cálido',
   'Estilo clásico cálido: molduras sobrias en muros y plafones, piso de '
   'madera en tono miel, mobiliario de líneas curvas y maderas macizas, '
   'tapicería en tonos vino y crema. Herrajes en bronce envejecido, '
   'iluminación cálida tipo lámpara de pie y candil discreto. Ambiente '
   'tradicional, confortable y atemporal.',
   true, 'plan')
ON CONFLICT DO NOTHING;

-- migrate:down

DELETE FROM render_prompts WHERE kind = 'plan';
ALTER TABLE render_prompts DROP COLUMN kind;
