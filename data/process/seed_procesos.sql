-- Seed process templates
INSERT INTO process_templates (name, description) VALUES
  ('Proyecto de Construcción', 'Proceso estándar para proyectos de obra nueva'),
  ('Análisis de Mercado', 'Revisión periódica del mercado inmobiliario');

-- Template 1: Proyecto de Construcción
-- Root nodes (parent_id NULL)
INSERT INTO template_nodes (template_id, parent_id, name, sort_order, duration_days) VALUES
  (1, NULL, 'Adquisición', 0, NULL),
  (1, NULL, 'Construcción', 1, NULL),
  (1, NULL, 'Salida', 2, NULL);

-- Children of Adquisición (id=1)
INSERT INTO template_nodes (template_id, parent_id, name, sort_order, duration_days) VALUES
  (1, 1, 'Due Diligence', 0, 14),
  (1, 1, 'Cierre notarial', 1, 7);

-- Children of Construcción (id=2)
INSERT INTO template_nodes (template_id, parent_id, name, sort_order, duration_days) VALUES
  (1, 2, 'Permisos', 0, 30),
  (1, 2, 'Obra', 1, 180);

-- Children of Salida (id=3)
INSERT INTO template_nodes (template_id, parent_id, name, sort_order, duration_days) VALUES
  (1, 3, 'Avalúo final', 0, 7),
  (1, 3, 'Venta', 1, NULL);

-- Set sibling dependencies
-- Cierre notarial depends on Due Diligence
UPDATE template_nodes SET depends_on_id = (SELECT id FROM template_nodes WHERE name = 'Due Diligence' AND template_id = 1)
  WHERE name = 'Cierre notarial' AND template_id = 1;

-- Obra depends on Permisos
UPDATE template_nodes SET depends_on_id = (SELECT id FROM template_nodes WHERE name = 'Permisos' AND template_id = 1)
  WHERE name = 'Obra' AND template_id = 1;

-- Venta depends on Avalúo final
UPDATE template_nodes SET depends_on_id = (SELECT id FROM template_nodes WHERE name = 'Avalúo final' AND template_id = 1)
  WHERE name = 'Venta' AND template_id = 1;

-- Root phases: sequential ordering (Adquisicion -> Construccion -> Salida)
UPDATE template_nodes
  SET depends_on_id = (SELECT id FROM template_nodes WHERE name = 'Adquisición' AND template_id = 1)
  WHERE name = 'Construcción' AND template_id = 1;

UPDATE template_nodes
  SET depends_on_id = (SELECT id FROM template_nodes WHERE name = 'Construcción' AND template_id = 1)
  WHERE name = 'Salida' AND template_id = 1;

-- Template 2: Análisis de Mercado (flat, no children)
INSERT INTO template_nodes (template_id, parent_id, name, sort_order, duration_days) VALUES
  (2, NULL, 'Recolección de datos', 0, 2),
  (2, NULL, 'Análisis comparativo', 1, 3),
  (2, NULL, 'Reporte', 2, 1);
