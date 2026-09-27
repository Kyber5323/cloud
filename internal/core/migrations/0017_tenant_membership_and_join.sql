-- A collaboration space is the one visible identity of its tenant. Existing
-- installations with multiple spaces or reused slugs must reset their test
-- data before applying this deliberate v1 contract change.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM projects WHERE space_id IS NULL) THEN
  RAISE EXCEPTION 'projects without a collaboration space; rebuild incompatible test data';
 END IF;
END $$;
ALTER TABLE projects ALTER COLUMN space_id SET NOT NULL;
ALTER TABLE collab_workspaces ADD CONSTRAINT one_space_per_tenant UNIQUE (tenant_id);
ALTER TABLE collab_workspaces ADD CONSTRAINT global_space_slug UNIQUE (slug);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM collab_workspaces w JOIN tenants t ON t.id=w.tenant_id WHERE w.name<>t.name) THEN
  RAISE EXCEPTION 'incompatible tenant and collaboration space names; rebuild test data';
 END IF;
END $$;
DROP TABLE collab_workspace_members;

-- IDaaS uuid remains the login subject; this verified decimal identifier is
-- carried only to associate Tianzhou-selected people with their first login.
ALTER TABLE gateway_sessions ADD COLUMN global_user_id text
 CHECK (global_user_id IS NULL OR global_user_id ~ '^[0-9]{1,20}$');

CREATE TABLE tenant_invitations (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash)=32),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 consumed_by uuid REFERENCES users(id),
 consumed_at timestamptz,
 version bigint NOT NULL DEFAULT 1 CHECK (version>0),
 CHECK (expires_at>created_at AND expires_at<=created_at+interval '7 days'),
 CHECK ((consumed_by IS NULL)=(consumed_at IS NULL))
);
CREATE INDEX tenant_invitations_tenant ON tenant_invitations(tenant_id,id);

CREATE TABLE tenant_join_links (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash)=32),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 version bigint NOT NULL DEFAULT 1 CHECK (version>0),
 CHECK (expires_at>created_at AND expires_at<=created_at+interval '30 days')
);
CREATE INDEX tenant_join_links_tenant ON tenant_join_links(tenant_id,id);

CREATE TABLE tenant_join_requests (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 user_id uuid NOT NULL REFERENCES users(id),
 link_id uuid NOT NULL REFERENCES tenant_join_links(id),
 status text NOT NULL CHECK(status IN ('pending','approved','rejected')),
 created_at timestamptz NOT NULL DEFAULT now(),
 decided_at timestamptz,
 decided_by uuid REFERENCES users(id),
 version bigint NOT NULL DEFAULT 1 CHECK (version>0),
 CHECK ((status='pending')=(decided_at IS NULL)),
 CHECK ((decided_at IS NULL)=(decided_by IS NULL))
);
CREATE UNIQUE INDEX one_pending_join_request ON tenant_join_requests(tenant_id,user_id) WHERE status='pending';
CREATE INDEX tenant_join_requests_tenant ON tenant_join_requests(tenant_id,id);
CREATE INDEX tenant_join_requests_user ON tenant_join_requests(user_id,id);

-- Joining happens before tenant membership exists, so the existing idempotency
-- table (which has a membership foreign key) cannot record these writes.
CREATE TABLE join_idempotency_records (
 user_id uuid NOT NULL REFERENCES users(id),
 key text NOT NULL CHECK(length(key) BETWEEN 1 AND 200),
 request_hash text NOT NULL,
 response jsonb NOT NULL,
 status integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,key)
);
