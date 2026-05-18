-- Fix: add ON DELETE SET NULL to all FK columns referencing team_members
-- Allows deleting team members without blocking on dependent records

ALTER TABLE team_members
  DROP CONSTRAINT IF EXISTS team_members_manager_id_fkey,
  ADD CONSTRAINT team_members_manager_id_fkey
    FOREIGN KEY (manager_id) REFERENCES team_members(id) ON DELETE SET NULL;

ALTER TABLE process_instances
  DROP CONSTRAINT IF EXISTS process_instances_owner_id_fkey,
  ADD CONSTRAINT process_instances_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES team_members(id) ON DELETE SET NULL;

ALTER TABLE instance_node_states
  DROP CONSTRAINT IF EXISTS instance_node_states_assignee_id_fkey,
  ADD CONSTRAINT instance_node_states_assignee_id_fkey
    FOREIGN KEY (assignee_id) REFERENCES team_members(id) ON DELETE SET NULL;

ALTER TABLE profit_split_config
  DROP CONSTRAINT IF EXISTS profit_split_config_finder_member_id_fkey,
  ADD CONSTRAINT profit_split_config_finder_member_id_fkey
    FOREIGN KEY (finder_member_id) REFERENCES team_members(id) ON DELETE SET NULL;

ALTER TABLE profit_split_config
  DROP CONSTRAINT IF EXISTS profit_split_config_responsable_member_id_fkey,
  ADD CONSTRAINT profit_split_config_responsable_member_id_fkey
    FOREIGN KEY (responsable_member_id) REFERENCES team_members(id) ON DELETE SET NULL;

ALTER TABLE profit_split_config
  DROP CONSTRAINT IF EXISTS profit_split_config_lider_member_id_fkey,
  ADD CONSTRAINT profit_split_config_lider_member_id_fkey
    FOREIGN KEY (lider_member_id) REFERENCES team_members(id) ON DELETE SET NULL;
