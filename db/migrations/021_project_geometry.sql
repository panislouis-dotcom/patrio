-- migrate:up
ALTER TABLE projects ADD COLUMN IF NOT EXISTS geometry jsonb NOT NULL DEFAULT '{}'::jsonb;

-- migrate:down
ALTER TABLE projects DROP COLUMN IF EXISTS geometry;
