-- A user lease, a Controller lease and a sandbox generation are independent identities.
CREATE TABLE runtime_control_sessions (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
 tenant_id uuid NOT NULL, actor_user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,actor_user_id) REFERENCES tenant_memberships(tenant_id,user_id),
 UNIQUE(id,workspace_id,actor_user_id)
);
CREATE TABLE runtime_controls (
 workspace_id uuid PRIMARY KEY REFERENCES workspaces(id),
 state text NOT NULL CHECK(state IN ('idle','acquiring','held','draining','reconciling','maintenance')),
 control_epoch bigint NOT NULL DEFAULT 0 CHECK(control_epoch>=0),
 session_id uuid, holder_user_id uuid, expires_at timestamptz,
 maintenance_operation_id uuid REFERENCES operations(id),
 bound_sandbox_id uuid REFERENCES sandbox_instances(id),
 binding_confirmed boolean NOT NULL DEFAULT false,
 input_closed boolean NOT NULL DEFAULT false,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(session_id,workspace_id,holder_user_id) REFERENCES runtime_control_sessions(id,workspace_id,actor_user_id),
 CHECK((session_id IS NULL)=(holder_user_id IS NULL)),
 CHECK(state NOT IN ('acquiring','held') OR (session_id IS NOT NULL AND expires_at IS NOT NULL)),
 CHECK(state<>'idle' OR (session_id IS NULL AND maintenance_operation_id IS NULL AND expires_at IS NULL)),
 CHECK(state<>'maintenance' OR maintenance_operation_id IS NOT NULL)
);
CREATE TABLE runtime_control_events (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
 control_epoch bigint NOT NULL, session_id uuid REFERENCES runtime_control_sessions(id),
 actor_user_id uuid REFERENCES users(id), state text NOT NULL, reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Absence of new control records is never proof that an existing running target is safe.
INSERT INTO runtime_controls(workspace_id,state)
 SELECT w.id, CASE WHEN w.observed_state='stopped'
 AND NOT EXISTS(SELECT 1 FROM sandbox_instances s WHERE s.workspace_id=w.id AND s.terminated_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM execution_tickets t WHERE t.workspace_id=w.id AND t.state='active')
 AND NOT EXISTS(SELECT 1 FROM clone_executions e WHERE e.workspace_id=w.id AND e.result IS NULL)
 THEN 'idle' ELSE 'reconciling' END FROM workspaces w;
ALTER TABLE execution_tickets ADD COLUMN control_session_id uuid;
ALTER TABLE execution_tickets ADD COLUMN control_epoch bigint;
ALTER TABLE execution_tickets ADD CONSTRAINT ticket_control_session
 FOREIGN KEY(control_session_id,workspace_id,actor_user_id) REFERENCES runtime_control_sessions(id,workspace_id,actor_user_id);
CREATE UNIQUE INDEX one_controlled_write_ticket ON execution_tickets(workspace_id)
 WHERE state='active' AND control_session_id IS NOT NULL;
