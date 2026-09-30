-- Workflow runs: one persisted execution against one frozen snapshot of a workflow.
--
-- A run viewer is engine-agnostic: it only needs the snapshot graph (the canvas it draws)
-- plus per-node states (the coloring). Everything the read-only Overview and inspector
-- render lives in this one row, so a run survives even if the workflow's live graph has
-- moved on. The graph itself is read from workflow_snapshots.graph via snapshot_id, never
-- copied here — a snapshot is immutable, so the frozen document cannot drift.
--
-- Execution: Cloud has no workflow engine. Create leaves the run `pending`; a deployment
-- forks the simulated executor only through Store.WorkflowRunSimulator (wired by dev
-- fixtures), which fills node_states/rounds and advances the status. Pending is the honest
-- production answer, the same "never claim real work ran" convention issue_runs uses.
-- Additive; edits no applied migration.

CREATE TABLE workflow_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id),
  snapshot_id uuid NOT NULL REFERENCES workflow_snapshots(id),
  name text NOT NULL CHECK(btrim(name) <> ''),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','awaiting_input','succeeded','failed','cancelled')),
  input jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(input) = 'object'),
  node_states jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(node_states) = 'object'),
  rounds jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(rounds) = 'array'),
  error text NOT NULL DEFAULT '',
  started_at timestamptz,
  finished_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- The run history panel lists a workflow's runs; newest first is a frontend sort, and
-- the UUID cursor keeps paging terminal-free (workflows.workflows_list precedent).
CREATE INDEX workflow_run_list ON workflow_runs(workflow_id, created_at, id);