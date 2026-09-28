-- Runtime control authority. This file only adds tables, columns, and constraints.
-- It does not change administrative_stop, the credential owner foreign key, or
-- execution tickets. HTTP behavior is intentionally left for later phases.
--
-- Migrate applies every file in one transaction. 0016 updates workspaces and
-- leaves deferred constraint-trigger events pending, and PostgreSQL then refuses
-- ALTER TABLE on that relation. Flush those events before altering workspaces.

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE workspaces ADD UNIQUE (id, tenant_id);
ALTER TABLE projects ADD UNIQUE (id, space_id, tenant_id);

-- Creator is a separate fact from owner_user_id. Historical rows start unknown
-- and are filled only when one create operation corresponds to that workspace.
-- A missing, conflicting, or unbound record stays unknown; owner is never copied.
ALTER TABLE workspaces
  ADD COLUMN creator_user_id uuid,
  ADD COLUMN creator_resolution text NOT NULL DEFAULT 'unknown',
  ADD COLUMN creator_resolution_reason text DEFAULT 'missing',
  ADD COLUMN creator_source text,
  ADD COLUMN creator_source_operation_id uuid;

WITH isolated_creates AS (
  SELECT w.id AS workspace_id,
         count(o.id) AS n,
         (array_agg(o.id ORDER BY o.id))[1] AS operation_id,
         (array_agg(o.actor_user_id ORDER BY o.id))[1] AS actor_user_id
  FROM workspaces w
  JOIN operations o
    ON o.kind = 'create_workspace'
   AND o.workspace_id = w.id
   AND o.project_id = w.project_id
  WHERE w.kind = 'isolated'
  GROUP BY w.id
)
UPDATE workspaces w
SET creator_user_id = c.actor_user_id,
    creator_resolution = 'known',
    creator_resolution_reason = NULL,
    creator_source = 'create_workspace_operation',
    creator_source_operation_id = c.operation_id
FROM isolated_creates c
WHERE w.id = c.workspace_id
  AND c.n = 1;

WITH isolated_creates AS (
  SELECT w.id AS workspace_id, count(o.id) AS n
  FROM workspaces w
  JOIN operations o
    ON o.kind = 'create_workspace'
   AND o.workspace_id = w.id
   AND o.project_id = w.project_id
  WHERE w.kind = 'isolated'
  GROUP BY w.id
)
UPDATE workspaces w
SET creator_resolution = 'unknown',
    creator_resolution_reason = 'conflict',
    creator_user_id = NULL,
    creator_source = NULL,
    creator_source_operation_id = NULL
FROM isolated_creates c
WHERE w.id = c.workspace_id
  AND c.n > 1;

-- A create_workspace that is not bound to a workspace cannot be assigned by guess.
UPDATE workspaces w
SET creator_resolution_reason = 'unprovable'
WHERE w.kind = 'isolated'
  AND w.creator_resolution = 'unknown'
  AND w.creator_resolution_reason = 'missing'
  AND EXISTS (
    SELECT 1 FROM operations o
    WHERE o.kind = 'create_workspace'
      AND o.project_id = w.project_id
      AND o.workspace_id IS NULL
  );

-- Main runtimes use the project creation record. A null workspace_id counts only
-- when the project has exactly one main workspace, so the record cannot name another.
WITH main_creates AS (
  SELECT w.id AS workspace_id,
         count(o.id) AS n,
         (array_agg(o.id ORDER BY o.id))[1] AS operation_id,
         (array_agg(o.actor_user_id ORDER BY o.id))[1] AS actor_user_id
  FROM workspaces w
  JOIN operations o
    ON o.kind = 'create_project'
   AND o.project_id = w.project_id
   AND (
     o.workspace_id = w.id
     OR (
       o.workspace_id IS NULL
       AND (SELECT count(*) FROM workspaces m WHERE m.project_id = w.project_id AND m.kind = 'main') = 1
     )
   )
  WHERE w.kind = 'main'
  GROUP BY w.id
)
UPDATE workspaces w
SET creator_user_id = c.actor_user_id,
    creator_resolution = 'known',
    creator_resolution_reason = NULL,
    creator_source = 'create_project_operation',
    creator_source_operation_id = c.operation_id
FROM main_creates c
WHERE w.id = c.workspace_id
  AND c.n = 1;

WITH main_creates AS (
  SELECT w.id AS workspace_id, count(o.id) AS n
  FROM workspaces w
  JOIN operations o
    ON o.kind = 'create_project'
   AND o.project_id = w.project_id
   AND (
     o.workspace_id = w.id
     OR (
       o.workspace_id IS NULL
       AND (SELECT count(*) FROM workspaces m WHERE m.project_id = w.project_id AND m.kind = 'main') = 1
     )
   )
  WHERE w.kind = 'main'
  GROUP BY w.id
)
UPDATE workspaces w
SET creator_resolution = 'unknown',
    creator_resolution_reason = 'conflict',
    creator_user_id = NULL,
    creator_source = NULL,
    creator_source_operation_id = NULL
FROM main_creates c
WHERE w.id = c.workspace_id
  AND c.n > 1;

UPDATE workspaces w
SET creator_resolution_reason = 'unprovable'
WHERE w.kind = 'main'
  AND w.creator_resolution = 'unknown'
  AND w.creator_resolution_reason = 'missing'
  AND EXISTS (
    SELECT 1 FROM operations o
    WHERE o.kind = 'create_project' AND o.project_id = w.project_id
  );

ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_creator_check CHECK (
    (
      creator_resolution = 'known'
      AND creator_user_id IS NOT NULL
      AND creator_resolution_reason IS NULL
      AND creator_source_operation_id IS NOT NULL
      AND (
        (kind = 'isolated' AND creator_source = 'create_workspace_operation')
        OR (kind = 'main' AND creator_source = 'create_project_operation')
      )
    )
    OR (
      creator_resolution = 'unknown'
      AND creator_user_id IS NULL
      AND creator_source IS NULL
      AND creator_source_operation_id IS NULL
      AND creator_resolution_reason IN ('missing', 'conflict', 'unprovable')
    )
  ),
  ADD FOREIGN KEY (creator_user_id) REFERENCES users(id),
  ADD FOREIGN KEY (creator_source_operation_id) REFERENCES operations(id);

CREATE INDEX workspace_known_creator ON workspaces(tenant_id, creator_user_id)
  WHERE creator_resolution = 'known' AND deleted_at IS NULL;

-- One open operation session per runtime. Closed rows stay as handover history.
-- Idle is the absence of an open row, not a flag that execution has stopped.
CREATE TABLE runtime_control_sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  holder_user_id uuid,
  holder_kind text NOT NULL CHECK (holder_kind IN ('user', 'system_maintenance')),
  control_epoch bigint NOT NULL CHECK (control_epoch > 0),
  state text NOT NULL CHECK (state IN ('acquiring', 'held', 'winding_down', 'reconciling', 'closed')),
  expires_at timestamptz NOT NULL,
  change_reason text NOT NULL CHECK (btrim(change_reason) <> ''),
  closed_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, control_epoch),
  FOREIGN KEY (workspace_id, tenant_id) REFERENCES workspaces(id, tenant_id),
  FOREIGN KEY (tenant_id, holder_user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  CHECK (
    (holder_kind = 'user' AND holder_user_id IS NOT NULL)
    OR (holder_kind = 'system_maintenance' AND holder_user_id IS NULL)
  ),
  CHECK ((state = 'closed') = (closed_at IS NOT NULL))
);

CREATE UNIQUE INDEX one_open_runtime_control_session ON runtime_control_sessions(workspace_id)
  WHERE state IN ('acquiring', 'held', 'winding_down', 'reconciling');

-- A later session must take a new epoch. The workspace row lock serializes the check.
CREATE FUNCTION reject_stale_runtime_control_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE max_epoch bigint;
BEGIN
  PERFORM 1 FROM workspaces WHERE id = NEW.workspace_id FOR UPDATE;
  SELECT COALESCE(MAX(control_epoch), 0) INTO max_epoch
    FROM runtime_control_sessions WHERE workspace_id = NEW.workspace_id;
  IF NEW.control_epoch <= max_epoch THEN
    RAISE EXCEPTION 'runtime control epoch must increase' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER runtime_control_epoch_monotonic
  BEFORE INSERT ON runtime_control_sessions
  FOR EACH ROW EXECUTE FUNCTION reject_stale_runtime_control_epoch();

-- At most one conflicting write is open on a runtime, including an unknown one.
CREATE TABLE runtime_write_activities (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  actor_user_id uuid,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'system')),
  state text NOT NULL CHECK (state IN ('active', 'unknown', 'finished')),
  execution_ticket_id uuid,
  finished_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, workspace_id) REFERENCES runtime_control_sessions(id, workspace_id),
  FOREIGN KEY (workspace_id, tenant_id) REFERENCES workspaces(id, tenant_id),
  FOREIGN KEY (actor_user_id) REFERENCES users(id),
  FOREIGN KEY (execution_ticket_id) REFERENCES execution_tickets(id),
  CHECK (
    (actor_kind = 'user' AND actor_user_id IS NOT NULL)
    OR (actor_kind = 'system' AND actor_user_id IS NULL)
  ),
  CHECK ((state = 'finished') = (finished_at IS NOT NULL))
);

CREATE UNIQUE INDEX one_conflicting_runtime_write_activity ON runtime_write_activities(workspace_id)
  WHERE state IN ('active', 'unknown');

-- Force-stop is its own intent. operations.kind still means administrative_stop
-- is the activity-protected stop, and this migration does not widen that check.
CREATE TABLE runtime_force_stop_intents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  initiator_user_id uuid NOT NULL,
  target_runtime_generation bigint NOT NULL CHECK (target_runtime_generation >= 0),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (length(request_hash) > 0),
  state text NOT NULL CHECK (state IN ('requested', 'terminating', 'reconciling', 'stopped')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, initiator_user_id, idempotency_key),
  FOREIGN KEY (workspace_id, tenant_id) REFERENCES workspaces(id, tenant_id),
  FOREIGN KEY (tenant_id, initiator_user_id) REFERENCES tenant_memberships(tenant_id, user_id)
);

CREATE UNIQUE INDEX one_open_runtime_force_stop ON runtime_force_stop_intents(workspace_id)
  WHERE state IN ('requested', 'terminating', 'reconciling');

-- Associations are recorded without a foreign key so an in-flight operation,
-- ticket, or effect can stay in place while the intent is open.
CREATE TABLE runtime_force_stop_links (
  intent_id uuid NOT NULL REFERENCES runtime_force_stop_intents(id),
  target_kind text NOT NULL CHECK (target_kind IN ('operation', 'execution_ticket', 'external_effect')),
  target_id uuid NOT NULL,
  PRIMARY KEY (intent_id, target_kind, target_id)
);

-- Accepted plugin maintenance can wait without occupying the single in-flight
-- project operation. Existing instance rows are execution facts and stay as they are.
CREATE TABLE plugin_maintenance_waits (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  space_id uuid NOT NULL,
  project_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  source_namespace text NOT NULL CHECK (length(source_namespace) > 0),
  identifier text NOT NULL CHECK (length(identifier) > 0),
  desired_action text NOT NULL CHECK (desired_action IN ('install', 'remove', 'version_change')),
  desired_version text NOT NULL CHECK (length(desired_version) > 0),
  state text NOT NULL CHECK (state IN ('pending', 'waiting_for_start', 'executing', 'reconciling', 'succeeded', 'failed')),
  initiator_user_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, initiator_user_id, idempotency_key),
  FOREIGN KEY (workspace_id, tenant_id) REFERENCES workspaces(id, tenant_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES workspaces(id, project_id),
  FOREIGN KEY (project_id, space_id, tenant_id) REFERENCES projects(id, space_id, tenant_id),
  FOREIGN KEY (space_id, tenant_id) REFERENCES collab_workspaces(id, tenant_id),
  FOREIGN KEY (tenant_id, initiator_user_id) REFERENCES tenant_memberships(tenant_id, user_id)
);

CREATE UNIQUE INDEX one_open_plugin_maintenance_wait
  ON plugin_maintenance_waits(workspace_id, source_namespace, identifier)
  WHERE state IN ('pending', 'waiting_for_start', 'executing', 'reconciling');

-- Historical references are unknown and still available. Classification is not
-- inferred from owner_user_id, the owner foreign key is unchanged, and no secret
-- is stored. authority_basis is an audit citation, not a credential.
ALTER TABLE credential_refs
  ADD COLUMN scope_kind text NOT NULL DEFAULT 'unknown' CHECK (scope_kind IN ('team', 'personal', 'unknown')),
  ADD COLUMN authority_basis text,
  ADD COLUMN availability text NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'frozen')),
  ADD COLUMN frozen_at timestamptz,
  ADD COLUMN freeze_reason text,
  ADD CONSTRAINT credential_refs_scope_basis_check CHECK (
    (scope_kind = 'unknown' AND authority_basis IS NULL)
    OR (scope_kind IN ('team', 'personal') AND authority_basis IS NOT NULL AND btrim(authority_basis) <> '')
  ),
  ADD CONSTRAINT credential_refs_freeze_check CHECK (
    (availability = 'available' AND frozen_at IS NULL AND freeze_reason IS NULL)
    OR (availability = 'frozen' AND frozen_at IS NOT NULL AND freeze_reason IS NOT NULL AND btrim(freeze_reason) <> '')
  );
