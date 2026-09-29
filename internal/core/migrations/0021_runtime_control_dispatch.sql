-- Fenced runtime-control dispatch. A row is inserted only after the same
-- transaction has rechecked the current permission. It is not evidence that a
-- Node started, and this migration does not backfill historical executions.
-- An absent row is not idle. No secret column is added.

CREATE TABLE runtime_control_dispatches (
  execution_id text PRIMARY KEY CHECK (length(execution_id) BETWEEN 1 AND 200),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  control_epoch bigint NOT NULL CHECK (control_epoch > 0),
  runtime_generation bigint NOT NULL CHECK (runtime_generation > 0),
  actor_user_id uuid,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'system')),
  input jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  protocol_generation integer NOT NULL CHECK (protocol_generation = 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, workspace_id) REFERENCES runtime_control_sessions (id, workspace_id),
  FOREIGN KEY (workspace_id, tenant_id) REFERENCES workspaces (id, tenant_id),
  FOREIGN KEY (actor_user_id) REFERENCES users (id),
  CHECK (
    (actor_kind = 'user' AND actor_user_id IS NOT NULL)
    OR (actor_kind = 'system' AND actor_user_id IS NULL)
  )
);

CREATE INDEX runtime_control_dispatches_workspace
  ON runtime_control_dispatches (workspace_id, control_epoch);
