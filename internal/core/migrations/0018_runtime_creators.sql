-- Flush deferred aggregate checks from earlier migrations before schema changes.
SET CONSTRAINTS ALL IMMEDIATE;
-- Durable ownership and the verified creating actor have different responsibilities.
ALTER TABLE workspaces ADD COLUMN creator_user_id uuid;
ALTER TABLE workspaces ADD COLUMN creator_operation_id uuid REFERENCES operations(id);
ALTER TABLE workspaces ADD COLUMN creator_evidence text NOT NULL DEFAULT 'unknown'
 CHECK(creator_evidence IN ('unknown','creation_operation','verified_request'));
ALTER TABLE workspaces ADD CONSTRAINT runtime_creator_membership
 FOREIGN KEY(tenant_id,creator_user_id) REFERENCES tenant_memberships(tenant_id,user_id);
ALTER TABLE workspaces ADD CONSTRAINT runtime_creator_evidence
 CHECK((creator_evidence='unknown')=(creator_user_id IS NULL));
-- Only one exactly scoped original creation record is evidence. A later operator/owner is not.
WITH sources AS (
 SELECT w.id, count(*) AS matches, min(o.id::text)::uuid AS operation_id,
 min(o.actor_user_id::text)::uuid AS actor
 FROM workspaces w JOIN operations o ON o.workspace_id=w.id AND o.project_id=w.project_id
 AND o.tenant_id=w.tenant_id AND ((w.kind='main' AND o.kind='create_project')
 OR (w.kind='isolated' AND o.kind='create_workspace'))
 GROUP BY w.id
)
UPDATE workspaces w SET creator_user_id=s.actor,creator_operation_id=s.operation_id,
 creator_evidence='creation_operation' FROM sources s WHERE s.id=w.id AND s.matches=1;
-- Unprovable historical creators remain unknown. Their original data and ownership are retained.
CREATE FUNCTION preserve_runtime_creator() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.creator_user_id,NEW.creator_operation_id,NEW.creator_evidence)
 IS DISTINCT FROM (OLD.creator_user_id,OLD.creator_operation_id,OLD.creator_evidence)
 THEN RAISE EXCEPTION 'runtime creator is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER runtime_creator_immutable BEFORE UPDATE ON workspaces
 FOR EACH ROW EXECUTE FUNCTION preserve_runtime_creator();

SET CONSTRAINTS ALL DEFERRED;
