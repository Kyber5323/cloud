-- Selection is accepted independently of execution availability. Old facts are retained.
ALTER TABLE space_plugins ADD COLUMN requested_by_user_id uuid REFERENCES users(id);
ALTER TABLE space_plugins ADD COLUMN desired_revision bigint NOT NULL DEFAULT 1 CHECK(desired_revision>0);
ALTER TABLE space_plugins ADD COLUMN selected_release jsonb;
ALTER TABLE workspace_plugin_instances ADD COLUMN desired_revision bigint NOT NULL DEFAULT 1 CHECK(desired_revision>0);
ALTER TABLE workspace_plugin_instances ADD COLUMN pending_reason text;
ALTER TABLE workspace_plugin_instances ADD COLUMN maintenance_operation_id uuid REFERENCES operations(id);
-- Unfenced legacy plugin work cannot resume against an unverified executor.
UPDATE operations SET state='blocked',error_code='executor_capability_unavailable'
 WHERE kind IN ('install_plugin','remove_plugin') AND state IN ('queued','running','retry_wait');
