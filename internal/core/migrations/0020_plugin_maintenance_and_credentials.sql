-- Fan-out maintenance needs one wait per runtime. The original idempotency
-- unique allowed only one row per request, so a second live runtime could not
-- be recorded. Historical credential rows stay unknown; this file does not
-- infer team ownership or store a secret.

DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'plugin_maintenance_waits'
    AND con.contype = 'u'
    AND pg_get_constraintdef(con.oid) LIKE '%idempotency_key%'
    AND pg_get_constraintdef(con.oid) NOT LIKE '%workspace_id%';
  IF cname IS NULL THEN
    RAISE EXCEPTION 'plugin maintenance idempotency constraint not found';
  END IF;
  EXECUTE format('ALTER TABLE plugin_maintenance_waits DROP CONSTRAINT %I', cname);
END $$;

ALTER TABLE plugin_maintenance_waits
  ADD CONSTRAINT plugin_maintenance_wait_request
  UNIQUE (tenant_id, initiator_user_id, idempotency_key, workspace_id);

-- A candidate verification records the administrator's intent. It does not
-- switch projects.credential_ref_id, and it has no secret column.
CREATE TABLE credential_verification_intents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES projects(id),
  initiator_user_id uuid NOT NULL,
  candidate_ref_id uuid NOT NULL REFERENCES credential_refs(id),
  repository_url text NOT NULL CHECK (length(repository_url) > 0),
  capability text NOT NULL CHECK (capability IN ('read', 'write')),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (length(request_hash) > 0),
  project_version bigint NOT NULL CHECK (project_version > 0),
  candidate_version bigint NOT NULL CHECK (candidate_version > 0),
  state text NOT NULL CHECK (state IN ('pending', 'succeeded', 'failed', 'unknown')),
  verified_capability text CHECK (verified_capability IS NULL OR verified_capability IN ('read', 'write')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, initiator_user_id, idempotency_key),
  FOREIGN KEY (tenant_id, initiator_user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  CHECK (
    (state = 'succeeded' AND verified_capability IS NOT NULL)
    OR (state <> 'succeeded' AND verified_capability IS NULL)
  )
);
