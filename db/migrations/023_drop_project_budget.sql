-- migrate:up
ALTER TABLE projects DROP COLUMN IF EXISTS budget;

-- migrate:down
-- Recreates the column empty on purpose: the dropped data was fabricated
-- seed-era JSON (never captured through the app), intentionally unrecoverable.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget TEXT NOT NULL DEFAULT '{}';
