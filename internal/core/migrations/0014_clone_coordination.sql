-- Clone coordination through the internal control contract. A clone request is work Cloud accepted
-- in its own business transaction and hands to the lease-holding Controller; the execution registry
-- and event receipts are what a Controller writes before dispatching to a Node and before
-- acknowledging a Node event. It stays independent of the Effect-level operations model until the
-- two are aligned by a later decision.
CREATE TABLE clone_requests (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, actor_user_id uuid NOT NULL,
 request_id text NOT NULL CHECK(length(request_id) BETWEEN 1 AND 200),
 repository_url text NOT NULL CHECK(length(repository_url) BETWEEN 1 AND 2000),
 branch text NOT NULL CHECK(length(branch) BETWEEN 1 AND 200),
 state text NOT NULL CHECK(state IN ('queued','dispatched','succeeded','failed')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,actor_user_id) REFERENCES tenant_memberships(tenant_id,user_id),
 UNIQUE(tenant_id,actor_user_id,request_id)
);
CREATE INDEX clone_request_queue ON clone_requests(created_at,id) WHERE state='queued';
-- One execution per request: a retry after an explicit failure is a new request, never a second
-- execution of the same one. Identities are opaque strings chosen by the Controller.
CREATE TABLE clone_executions (
 execution_id text PRIMARY KEY CHECK(length(execution_id) BETWEEN 1 AND 200),
 operation_id uuid NOT NULL UNIQUE REFERENCES clone_requests(id),
 node_id text NOT NULL CHECK(length(node_id) BETWEEN 1 AND 200),
 input jsonb NOT NULL CHECK(jsonb_typeof(input)='object'),
 result jsonb CHECK(result IS NULL OR jsonb_typeof(result)='object'),
 dispatched_epoch bigint NOT NULL CHECK(dispatched_epoch>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
-- The exact Node event that carried a result; (execution, sequence) is the only basis for an Ack.
CREATE TABLE clone_event_receipts (
 execution_id text NOT NULL REFERENCES clone_executions(execution_id),
 sequence bigint NOT NULL CHECK(sequence>=0), event text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(execution_id,sequence)
);
-- Every state-changing control submission: the same identity with the same content returns the
-- recorded response instead of reapplying, so a lost reply is retried without a second effect.
CREATE TABLE control_submissions (
 submission_id text PRIMARY KEY CHECK(length(submission_id) BETWEEN 1 AND 200),
 holder_id text NOT NULL, request_hash text NOT NULL,
 response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),
 created_at timestamptz NOT NULL DEFAULT now()
);
