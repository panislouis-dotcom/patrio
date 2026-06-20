-- migrate:up

-- Make zone_id nullable on comparables.
-- The application layer has always treated it as Optional (zoneId: Optional[int] = None)
-- and the form exposes a "— sin zona —" option. Enforcing NOT NULL causes INSERT failures
-- when no zone is selected.
ALTER TABLE comparables ALTER COLUMN zone_id DROP NOT NULL;

-- migrate:down
-- This rollback will fail if any row has zone_id IS NULL.
ALTER TABLE comparables ALTER COLUMN zone_id SET NOT NULL;
