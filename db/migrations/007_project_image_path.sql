-- migrate:up

ALTER TABLE projects ADD COLUMN IF NOT EXISTS image_path TEXT NOT NULL DEFAULT '';

-- migrate:down
