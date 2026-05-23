-- migrate:up
ALTER TABLE project_images
  ADD COLUMN IF NOT EXISTS image_type TEXT NOT NULL DEFAULT 'antes'
  CHECK (image_type IN ('antes', 'despues'));

-- migrate:down
ALTER TABLE project_images
  DROP COLUMN IF EXISTS image_type;
