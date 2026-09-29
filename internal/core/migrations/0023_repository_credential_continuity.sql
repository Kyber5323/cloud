-- Existing owner keys and secret references are retained; historical attribution is unknown.
ALTER TABLE credential_refs ADD COLUMN attribution text NOT NULL DEFAULT 'unknown' CHECK(attribution IN ('unknown','personal','team'));
ALTER TABLE credential_refs ADD COLUMN attribution_basis text;
ALTER TABLE credential_refs ADD COLUMN availability text NOT NULL DEFAULT 'available' CHECK(availability IN ('available','frozen','invalid'));
ALTER TABLE credential_refs ADD COLUMN unavailable_reason text;
ALTER TABLE credential_refs ADD COLUMN repository_scope text;
ALTER TABLE credential_refs ADD COLUMN capabilities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(capabilities)='array');
ALTER TABLE credential_refs ADD CONSTRAINT credential_reference_scope UNIQUE(id,tenant_id);
ALTER TABLE projects ADD COLUMN repository_credential_ref_id uuid;
ALTER TABLE projects ADD CONSTRAINT project_effective_repository_credential FOREIGN KEY(repository_credential_ref_id,tenant_id) REFERENCES credential_refs(id,tenant_id);
ALTER TABLE clone_executions ADD COLUMN credential_ref_id uuid REFERENCES credential_refs(id);
ALTER TABLE clone_executions ADD COLUMN credential_ref_version bigint;
ALTER TABLE clone_executions ADD CONSTRAINT execution_credential_binding CHECK((credential_ref_id IS NULL)=(credential_ref_version IS NULL));
CREATE FUNCTION freeze_departed_repository_credentials() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status<>'active' THEN
  UPDATE credential_refs SET availability='frozen',unavailable_reason='associated_member_departed',version=version+1
   WHERE tenant_id=NEW.tenant_id AND owner_user_id=NEW.user_id AND attribution IN ('personal','unknown') AND availability='available';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER departed_repository_credentials AFTER UPDATE OF status ON tenant_memberships FOR EACH ROW EXECUTE FUNCTION freeze_departed_repository_credentials();
CREATE FUNCTION freeze_disabled_user_repository_credentials() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status<>'active' OR NEW.deleted_at IS NOT NULL THEN
  UPDATE credential_refs SET availability='frozen',unavailable_reason='associated_user_disabled',version=version+1
   WHERE owner_user_id=NEW.id AND attribution IN ('personal','unknown') AND availability='available';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER disabled_user_repository_credentials AFTER UPDATE OF status,deleted_at ON users FOR EACH ROW EXECUTE FUNCTION freeze_disabled_user_repository_credentials();
-- Members already inactive at upgrade are frozen as well. Rejoining does not unfreeze a reference.
UPDATE credential_refs c SET availability='frozen',unavailable_reason='associated_member_departed',version=version+1
 WHERE c.attribution IN ('personal','unknown') AND NOT EXISTS(SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=c.tenant_id AND m.user_id=c.owner_user_id AND m.status='active' AND u.status='active' AND u.deleted_at IS NULL);
