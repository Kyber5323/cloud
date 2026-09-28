-- Execution tickets record the verified initiator. Use of a runtime is the
-- creator or a current administrator, checked on each access. The previous
-- foreign key required the initiator to be the workspace owner, so a member
-- could not enter a runtime they created in a shared project.

ALTER TABLE execution_tickets DROP CONSTRAINT execution_tickets_workspace_id_tenant_id_actor_user_id_fkey;
ALTER TABLE execution_tickets
  ADD FOREIGN KEY (workspace_id, tenant_id) REFERENCES workspaces (id, tenant_id),
  ADD FOREIGN KEY (tenant_id, actor_user_id) REFERENCES tenant_memberships (tenant_id, user_id);
