-- Workflow snapshots: immutable, versioned captures of a workflow's graph document.
--
-- Publishing freezes the live graph (workflows.graph) into a row here under the next
-- per-workflow version number; restoring overwrites the live graph back from a chosen
-- snapshot. Snapshots are append-only: an edit never rewrites one, so every historical
-- version survives until its workflow is archived.
--
-- Deliberately no published_snapshot_id pointer on workflows and no published/draft split
-- on the document: the editor always reads and writes the live graph whole, "the published
-- version" is simply the newest snapshot, and nothing outside the editor consumes an
-- explicit active-version mark yet (the run viewer will, and it can read this table
-- directly). Additive; edits no applied migration.

CREATE TABLE workflow_snapshots (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id),
  version bigint NOT NULL CHECK(version > 0),
  name text NOT NULL,
  graph jsonb NOT NULL CHECK(jsonb_typeof(graph) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One version number per workflow; two publishes can never collide.
CREATE UNIQUE INDEX workflow_snapshot_version_uniq ON workflow_snapshots(tenant_id, workflow_id, version);
-- The history panel lists a workflow's versions; the list is full so no partial index.
CREATE INDEX workflow_snapshot_list ON workflow_snapshots(workflow_id, version DESC);