-- migrate:up

CREATE TABLE IF NOT EXISTS cotizaciones (
  id                     BIGSERIAL PRIMARY KEY,
  instance_node_state_id BIGINT NOT NULL REFERENCES instance_node_states(id) ON DELETE CASCADE,
  proveedor_id           BIGINT REFERENCES proveedores(id) ON DELETE SET NULL,
  proveedor_name_override TEXT NOT NULL DEFAULT '',
  monto                  NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (monto >= 0),
  moneda                 TEXT NOT NULL DEFAULT 'MXN' CHECK (moneda IN ('MXN', 'USD')),
  descripcion            TEXT NOT NULL DEFAULT '',
  notes                  TEXT NOT NULL DEFAULT '',
  fecha_cotizacion       DATE,
  validez_dias           INTEGER CHECK (validez_dias > 0),
  archivo_path           TEXT,
  archivo_nombre         TEXT,
  is_selected            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_node_state ON cotizaciones(instance_node_state_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_proveedor ON cotizaciones(proveedor_id);

-- migrate:down

DROP TABLE IF EXISTS cotizaciones;
