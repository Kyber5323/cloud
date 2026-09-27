-- Workflows (workflow editor): the tenant-owned graph document the editor opens, autosaves into, and
-- the collaboration @-mention directory will project into a form descriptor.
--
--   workflows.graph  =  the authored document (nodes / edges / viewport / annotations / global
--                       variables), stored whole because the editor always reads and writes it whole
--
-- Deliberately ONE table and ONE graph column: no per-node or per-edge table (the graph is a document,
-- not a relational aggregate — nothing queries inside it), no published/draft split and no
-- published_snapshot_id yet (publish and version history arrive with the editor's versioning phase,
-- and are additive: a snapshot table referencing this one). Purely additive; edits no applied
-- migration.

CREATE TABLE workflows (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  graph jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(graph) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- A live workflow name is unique per tenant; archiving one frees its name, matching labels.
CREATE UNIQUE INDEX workflow_name_uniq ON workflows(tenant_id, name) WHERE deleted_at IS NULL;
CREATE INDEX workflow_list ON workflows(tenant_id, id);
