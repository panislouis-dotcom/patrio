-- migrate:up
ALTER TABLE projects DROP COLUMN IF EXISTS budget;

-- migrate:down
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget TEXT NOT NULL DEFAULT '{}';
