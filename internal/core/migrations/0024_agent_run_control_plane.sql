-- Agent IssueRun control plane (specs decisions/cloud/controller-integration/20260928-agent-run-executions-
-- thread-and-upload-grants.md, operation/20260928-plugin-step-and-run-workspace-release.md,
-- plugin-marketplace/20260928-node-executes-plugin-installs.md).
-- Plugin installs move from Substrate effects to Node executions. Session and Revision-delivery work
-- is registered beside clone_executions, which keeps its original meaning. Historical plugin effect
-- rows stay readable; new ones are refused.

CREATE FUNCTION reject_plugin_effect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind IN ('plugin_ensure','plugin_delete') THEN
  RAISE EXCEPTION 'retired effect kind %', NEW.kind USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retired_plugin_effect BEFORE INSERT ON external_effects FOR EACH ROW EXECUTE FUNCTION reject_plugin_effect();

-- In-flight plugin operations start the step again so the next claim snapshots a Node execution
-- input. Installs are idempotent, so redoing a half-finished effect is safe. Historical effect rows
-- are left in place.
UPDATE operations SET state='queued', controller_epoch=NULL, error_code=NULL, retry_at=NULL,
 request=request-'plugins', version=version+1, updated_at=now()
 WHERE kind IN ('install_plugin','remove_plugin') AND step='plugin'
  AND state IN ('queued','running','retry_wait','blocked');

-- A run Workspace belongs to one IssueRun and is hidden from the public Workspace API.
ALTER TABLE workspaces ADD COLUMN issue_run_id uuid UNIQUE REFERENCES issue_runs(id);

-- Work Cloud has accepted for a Controller to claim. execution_id is written when the dispatch is
-- registered; until then the row is claimable. One run has at most one unregistered item.
CREATE TABLE execution_work (
 id uuid PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES issue_runs(id),
 kind text NOT NULL CHECK (kind IN ('agent_session','deliver_revision')),
 input jsonb NOT NULL CHECK (jsonb_typeof(input)='object'),
 target jsonb NOT NULL CHECK (jsonb_typeof(target)='object'),
 available_at timestamptz NOT NULL DEFAULT now(),
 execution_id text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_unregistered_execution_work ON execution_work(run_id) WHERE execution_id IS NULL;

-- Node executions that are not tenant clones: plugin steps, Agent sessions and Revision deliveries.
CREATE TABLE node_executions (
 execution_id text PRIMARY KEY CHECK (length(execution_id) BETWEEN 1 AND 200),
 kind text NOT NULL CHECK (kind IN ('install_plugins','remove_plugins','agent_session','deliver_revision')),
 operation_id uuid NOT NULL,
 work_id uuid REFERENCES execution_work(id),
 workspace_id uuid REFERENCES workspaces(id),
 node_id text NOT NULL CHECK (length(node_id) BETWEEN 1 AND 200),
 node_operation_id text NOT NULL CHECK (length(node_operation_id) BETWEEN 1 AND 200),
 input jsonb NOT NULL CHECK (jsonb_typeof(input)='object'),
 result jsonb,
 dispatched_epoch bigint NOT NULL,
 last_event_sequence bigint NOT NULL DEFAULT 0 CHECK (last_event_sequence >= 0),
 terminated_by_force_stop_id uuid REFERENCES runtime_force_stops(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_pending_plugin_execution ON node_executions(operation_id)
 WHERE kind IN ('install_plugins','remove_plugins') AND result IS NULL AND terminated_by_force_stop_id IS NULL;
CREATE UNIQUE INDEX one_pending_run_execution ON node_executions(operation_id)
 WHERE kind IN ('agent_session','deliver_revision') AND result IS NULL AND terminated_by_force_stop_id IS NULL;

-- Receipts for Thread events and terminal Node events. A sequence is acknowledged only after this row
-- commits. Thread events and the session's terminal event share one sequence space.
CREATE TABLE node_event_receipts (
 execution_id text NOT NULL REFERENCES node_executions(execution_id),
 sequence bigint NOT NULL CHECK (sequence >= 1),
 event text NOT NULL,
 PRIMARY KEY (execution_id, sequence)
);

-- User turns and end requests. They stay claimable until the Node's durable acceptance is recorded.
CREATE TABLE thread_commands (
 id uuid PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES issue_runs(id),
 kind text NOT NULL CHECK (kind IN ('submit_user_turn','end_session')),
 body jsonb NOT NULL CHECK (jsonb_typeof(body)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz,
 delivered_execution_id text
);

-- One row per agent-kind plugin the Space has selected. A failed install on one Workspace does not
-- delete the row; removal retires it so past IssueRuns can still name the agent.
CREATE TABLE space_agents (
 id uuid PRIMARY KEY,
 space_id uuid NOT NULL,
 tenant_id uuid NOT NULL,
 plugin_id text NOT NULL CHECK (length(plugin_id) BETWEEN 1 AND 300),
 display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
 status text NOT NULL CHECK (status IN ('active','retired')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (space_id, tenant_id) REFERENCES collab_workspaces(id, tenant_id),
 UNIQUE (space_id, plugin_id)
);
