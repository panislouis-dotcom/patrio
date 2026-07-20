-- migrate:up
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS geometry jsonb NOT NULL DEFAULT '{}'::jsonb;

-- migrate:down
ALTER TABLE prospects DROP COLUMN IF EXISTS geometry;
