package integration

import (
	"context"
	"testing"
)

func TestMigration0021DispatchTableStartsEmpty(t *testing.T) {
	pool, _ := testSchema(t, "test_m0021_")
	applyMigrationsUpTo(t, pool, []string{
		"0001_core.sql", "0002_aggregate_guards.sql", "0003_resource_versions.sql",
		"0004_effect_intent_and_ticket_scope.sql", "0005_gateway_auth.sql",
		"0006_collab_spaces.sql", "0007_project_space_scope.sql", "0008_issues.sql",
		"0009_issue_extensions.sql", "0010_issue_collaboration.sql", "0011_issue_interactions.sql",
		"0012_issue_interaction_input.sql", "0013_project_space_optional.sql", "0014_clone_coordination.sql",
		"0015_plugins.sql", "0016_workspace_runtime_follows_node.sql", "0017_tenant_membership_and_join.sql",
		"0018_runtime_control.sql", "0019_runtime_use_actor.sql", "0020_plugin_maintenance_and_credentials.sql",
	})
	if tableExists(t, pool, "runtime_control_dispatches") {
		t.Fatal("0020 already had fenced dispatches")
	}
	store := newStoreOnSchema(t, pool)
	must(t, store.Migrate(context.Background()))
	must(t, store.Migrate(context.Background()))
	must(t, store.CheckSchema(context.Background()))
	if !tableExists(t, pool, "runtime_control_dispatches") {
		t.Fatal("missing runtime_control_dispatches")
	}
	var rows, secrets int
	must(t, pool.QueryRow(`SELECT count(*) FROM runtime_control_dispatches`).Scan(&rows))
	must(t, pool.QueryRow(`SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='runtime_control_dispatches' AND column_name IN ('password','token','private_key','secret_value','access_token','secret_ref')`).Scan(&secrets))
	var def string
	must(t, pool.QueryRow(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='runtime_control_dispatches'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%protocol_generation%'`).Scan(&def))
	if rows != 0 || secrets != 0 || def == "" {
		t.Fatalf("upgrade invented rows=%d secrets=%d protocol=%s", rows, secrets, def)
	}
}
