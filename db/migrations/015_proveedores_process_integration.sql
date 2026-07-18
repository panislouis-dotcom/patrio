-- migrate:up

ALTER TABLE template_nodes
  ADD COLUMN IF NOT EXISTS supplier_category_id BIGINT REFERENCES proveedor_categories(id) ON DELETE SET NULL;

ALTER TABLE instance_node_states
  ADD COLUMN IF NOT EXISTS supplier_id BIGINT REFERENCES proveedores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_template_nodes_supplier_cat ON template_nodes(supplier_category_id);
CREATE INDEX IF NOT EXISTS idx_ins_node_state_supplier ON instance_node_states(supplier_id);

-- migrate:down

ALTER TABLE instance_node_states DROP COLUMN IF EXISTS supplier_id;
ALTER TABLE template_nodes DROP COLUMN IF EXISTS supplier_category_id;
