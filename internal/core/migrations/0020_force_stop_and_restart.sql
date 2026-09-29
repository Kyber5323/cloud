-- Preserve all ordinary operations and executions. Force stop is an independent durable intent.
SET CONSTRAINTS ALL IMMEDIATE;
CREATE TABLE runtime_force_stops (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL REFERENCES workspaces(id),
 actor_user_id uuid NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 state text NOT NULL CHECK(state IN ('registered','terminating','succeeded')),
 control_epoch bigint NOT NULL, runtime_generation bigint NOT NULL, version bigint NOT NULL DEFAULT 1,
 controller_epoch bigint, created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz,
 FOREIGN KEY(tenant_id,actor_user_id) REFERENCES tenant_memberships(tenant_id,user_id)
);
CREATE UNIQUE INDEX one_unfinished_force_stop ON runtime_force_stops(workspace_id) WHERE state<>'succeeded';
CREATE TABLE runtime_force_stop_targets (
 id uuid PRIMARY KEY, force_stop_id uuid NOT NULL REFERENCES runtime_force_stops(id),
 sandbox_id uuid NOT NULL REFERENCES sandbox_instances(id), state text NOT NULL DEFAULT 'planned' CHECK(state IN ('planned','succeeded')),
 result jsonb NOT NULL DEFAULT '{}', confirmed_at timestamptz, UNIQUE(force_stop_id,sandbox_id)
);
ALTER TABLE execution_tickets ADD COLUMN terminated_by_force_stop_id uuid REFERENCES runtime_force_stops(id);
ALTER TABLE clone_executions ADD COLUMN terminated_by_force_stop_id uuid REFERENCES runtime_force_stops(id);
DROP INDEX one_controlled_write_ticket;
CREATE UNIQUE INDEX one_controlled_write_ticket ON execution_tickets(workspace_id)
 WHERE state='active' AND control_session_id IS NOT NULL AND terminated_by_force_stop_id IS NULL;
ALTER TABLE operations DROP CONSTRAINT operations_kind_check;
ALTER TABLE operations ADD CONSTRAINT operations_kind_check CHECK(kind IN
 ('create_project','create_workspace','start','stop','restart','delete_workspace','delete_project','administrative_stop','install_plugin','remove_plugin'));
SET CONSTRAINTS ALL DEFERRED;
