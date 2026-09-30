-- A disposable run owns its runtime without occupying one_project_operation during the session.
-- It uses the existing maintenance binding/epoch; user sessions remain mutually exclusive.
ALTER TABLE runtime_controls ADD COLUMN maintenance_run_id uuid REFERENCES issue_runs(id);
ALTER TABLE runtime_controls DROP CONSTRAINT runtime_controls_check2;
ALTER TABLE runtime_controls DROP CONSTRAINT runtime_controls_check3;
ALTER TABLE runtime_controls ADD CHECK(state<>'idle' OR
 (session_id IS NULL AND maintenance_operation_id IS NULL AND maintenance_run_id IS NULL AND expires_at IS NULL));
ALTER TABLE runtime_controls ADD CHECK(state<>'maintenance' OR
 num_nonnulls(maintenance_operation_id,maintenance_run_id)=1);
ALTER TABLE runtime_controls ADD CHECK(maintenance_operation_id IS NULL OR maintenance_run_id IS NULL);
