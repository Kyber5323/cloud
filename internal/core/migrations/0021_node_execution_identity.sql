-- Preserve historical wire identities. New runtime attempts use distinct stable Node operations.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE clone_executions ADD COLUMN node_operation_id text;
UPDATE clone_executions SET node_operation_id=operation_id::text;
ALTER TABLE clone_executions ALTER COLUMN node_operation_id SET NOT NULL;
-- Historical duplicate wire operations remain attributable and must be reconciled, not discarded.
CREATE INDEX node_execution_operation ON clone_executions(node_id,node_operation_id);
SET CONSTRAINTS ALL DEFERRED;
