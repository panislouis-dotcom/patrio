-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- Renders: una propuesta no es una fotografía
--
-- Una foto es evidencia de lo que hay. Un render es una propuesta de lo que
-- podría haber. Son dos cosas distintas y el modelo tiene que poder decir cuál
-- está mirando, siempre.
--
-- Por eso el render NO entra a `property_images` como un `image_type` más.
-- Ese enum ('general','antes','despues') es el eje de LA OBRA: qué había antes
-- de meter mano y qué quedó después. Meter 'render' ahí cruza un segundo eje
-- —real contra generado— dentro del primero, y el día que el prospecto
-- imprima un render en la casilla de «después» le habremos dicho a un
-- inversionista que una propuesta es un hecho consumado. Esa es exactamente la
-- clase de mentira que el resto del esquema se niega a decir cuando devuelve
-- NULL en vez de un cero inventado.
--
-- POR QUÉ `prompt_text` SE GUARDA COMPLETO Y NO SOLO EL `prompt_id`: la
-- biblioteca de prompts se edita. Si el render solo apuntara al prompt, el
-- render de ayer citaría el texto de hoy y mentiría sobre cómo se hizo. El
-- texto se congela en el momento de generar; el FK queda solo para saber de
-- qué preset salió, y puede quedar en NULL sin que se pierda la historia.
--
-- POR QUÉ `source_image_id` ES `ON DELETE SET NULL` Y NO `CASCADE`: borrar la
-- foto original no puede destruir un render que ya se enseñó. Pierde la liga
-- de vuelta, no el render.
--
-- LO QUE NO ESTÁ AQUÍ: la cláusula que obliga al modelo a respetar la
-- estructura del inmueble («misma geometría, mismos vanos, mismo número de
-- niveles»). No vive en cada prompt porque entonces un prompt podría olvidarla
-- y producir un render de otra casa. La agrega el código a todos por igual.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS render_prompts (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL CHECK (name <> ''),
  body        TEXT NOT NULL CHECK (body <> ''),
  -- Los sembrados no se borran: son el piso de la biblioteca. Se pueden
  -- duplicar y ajustar, pero siempre queda de dónde partir.
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_render_prompts_name_active
  ON render_prompts (lower(name)) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS property_renders (
  id              BIGSERIAL PRIMARY KEY,
  property_id     BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  source_image_id BIGINT REFERENCES property_images(id) ON DELETE SET NULL,
  file_path       TEXT NOT NULL CHECK (file_path <> ''),
  content_type    TEXT NOT NULL,
  prompt_id       BIGINT REFERENCES render_prompts(id) ON DELETE SET NULL,
  prompt_text     TEXT NOT NULL CHECK (prompt_text <> ''),
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_renders_unique_path UNIQUE (property_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_property_renders_property
  ON property_renders (property_id, created_at DESC);

-- ── Biblioteca inicial ───────────────────────────────────────────────────────
-- Las especies salen de plantas_regionales.md: son las que aguantan Monterrey
-- y Saltillo sin riego de rescate. Un render con pasto inglés y arces vende un
-- jardín que se muere en el primer agosto.
INSERT INTO render_prompts (name, body, is_default) VALUES
  ('Jardín regional (xeriscape)',
   'Jardín frontal xeriscape del noreste de México: mezquite y anacahuita como '
   'árboles de sombra, macizos de agave verde y lechuguilla, salvia azul del '
   'desierto y mirto rojo en floración, zacate búfalo en las zonas abiertas. '
   'Andador de piedra caliza local, grava de río como cubresuelo, sin pasto de '
   'riego alto. Luz de media tarde, cielo despejado.',
   true),
  ('Fachada minimalista contemporánea',
   'Fachada renovada en clave contemporánea sobria: aplanado fino en tono '
   'lino claro, cancelería de aluminio negro mate, un acento de madera cálida '
   'en el acceso, luminarias empotradas de luz cálida. Sin ornamento añadido, '
   'sin cambiar la volumetría.',
   true),
  ('Patio y terraza de estar',
   'Patio trasero convertido en terraza de estar: piso de porcelánico tipo '
   'piedra, pérgola de madera con vigas expuestas, mobiliario exterior bajo en '
   'tonos tierra, iluminación cálida indirecta, macetones con agaves y '
   'ocotillo. Ambiente de atardecer.',
   true),
  ('Alberca y asoleadero',
   'Alberca rectangular de borde infinito discreto con acabado en tono arena, '
   'asoleadero de porcelánico antiderrapante, dos camastros bajos, jardinera '
   'perimetral con lechuguilla y zacate llanero. Agua limpia, luz de mediodía.',
   true),
  ('Interior renovado (sala y cocina)',
   'Interior renovado en planta abierta: muros en blanco cálido, piso de '
   'duela clara, cocina con frentes lisos sin tiradores y cubierta de piedra '
   'gris, iluminación empotrada más lámpara colgante sobre la barra. Mobiliario '
   'sobrio en lino y madera. Sin mover muros ni ventanas.',
   true),
  ('Lote limpio (potencial)',
   'El mismo lote despejado y a nivel: sin escombro, sin maleza, sin vehículos '
   'ni objetos sueltos. Terreno compactado, límites de propiedad legibles, '
   'vegetación existente sana conservada. Luz neutra de mañana.',
   true)
ON CONFLICT DO NOTHING;

-- migrate:down

DROP TABLE IF EXISTS property_renders;
DROP TABLE IF EXISTS render_prompts;
