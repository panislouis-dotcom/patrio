-- migrate:up

CREATE TABLE IF NOT EXISTS proveedor_categories (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL CHECK (name <> ''),
  description TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proveedores (
  id                 BIGSERIAL PRIMARY KEY,
  name               TEXT NOT NULL CHECK (name <> ''),
  phone              TEXT NOT NULL DEFAULT '',
  email              TEXT NOT NULL DEFAULT '',
  website            TEXT NOT NULL DEFAULT '',
  zona               TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'activo' CHECK (status IN ('activo', 'inactivo', 'vetado')),
  veto_reason        TEXT,
  rating_calidad     SMALLINT CHECK (rating_calidad BETWEEN 1 AND 5),
  rating_puntualidad SMALLINT CHECK (rating_puntualidad BETWEEN 1 AND 5),
  rating_precio      SMALLINT CHECK (rating_precio BETWEEN 1 AND 5),
  notes              TEXT NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'vetado' OR veto_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS proveedor_category_links (
  proveedor_id BIGINT NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  category_id  BIGINT NOT NULL REFERENCES proveedor_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (proveedor_id, category_id)
);

CREATE TABLE IF NOT EXISTS proveedor_photos (
  id           BIGSERIAL PRIMARY KEY,
  proveedor_id BIGINT NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  file_path    TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  content_type TEXT NOT NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proveedor_photos_prov ON proveedor_photos(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_prov_cat_links_cat ON proveedor_category_links(category_id);

-- migrate:down

DROP TABLE IF EXISTS proveedor_photos;
DROP TABLE IF EXISTS proveedor_category_links;
DROP TABLE IF EXISTS proveedores;
DROP TABLE IF EXISTS proveedor_categories;
