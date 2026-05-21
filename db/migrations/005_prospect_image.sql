-- migrate:up

ALTER TABLE prospects ADD COLUMN IF NOT EXISTS image_path TEXT NOT NULL DEFAULT '';

-- migrate:down
