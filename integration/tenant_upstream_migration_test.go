package integration

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
)

// TestTenantMigrationFrom0016PreservesRuntimeCloneAndPlugins proves that
// changing the membership authority does not rewrite upstream execution facts.
func TestTenantMigrationFrom0016PreservesRuntimeCloneAndPlugins(t *testing.T) {
	pool, _ := testSchema(t, "test_tenant_upstream_")
	entries, err := os.ReadDir(filepath.Join("..", "internal", "core", "migrations"))
	must(t, err)
	var versions []string
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) == ".sql" && entry.Name() < "0017" {
			versions = append(versions, entry.Name())
		}
	}
	applyMigrationsUpTo(t, pool, versions)
	user, tenant, space := uuid.NewString(), uuid.NewString(), uuid.NewString()
	project, workspace, clone := uuid.NewString(), uuid.NewString(), uuid.NewString()
	tx, err := pool.Begin()
	must(t, err)
	t.Cleanup(func() { _ = tx.Rollback() })
	exec := func(query string, args ...any) {
		t.Helper()
		_, e := tx.Exec(query, args...)
		must(t, e)
	}
	exec("INSERT INTO users(id,display_name,status) VALUES($1,'Member','active')", user)
	exec("INSERT INTO tenants(id,name,status) VALUES($1,'Shared','active')", tenant)
	exec("INSERT INTO tenant_memberships(tenant_id,user_id,role,status) VALUES($1,$2,'admin','active')", tenant, user)
	exec("INSERT INTO collab_workspaces(id,tenant_id,name,slug,created_by) VALUES($1,$2,'Shared','shared',$3)", space, tenant, user)
	exec("INSERT INTO collab_workspace_members(workspace_id,user_id,role,status) VALUES($1,$2,'owner','active')", space, user)
	exec("INSERT INTO projects(id,tenant_id,owner_user_id,space_id,name,repository_url,default_branch,lifecycle) VALUES($1,$2,$3,$4,'Project','https://example.invalid/repo.git','main','active')", project, tenant, user, space)
	exec("INSERT INTO workspaces(id,tenant_id,owner_user_id,project_id,kind,desired_state,observed_state,requested_ref,base_commit_id) VALUES($1,$2,$3,$4,'main','running','ready','main','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')", workspace, tenant, user, project)
	exec("INSERT INTO clone_requests(id,tenant_id,actor_user_id,request_id,repository_url,branch,state) VALUES($1,$2,$3,'clone-before-upgrade','https://example.invalid/repo.git','main','queued')", clone, tenant, user)
	exec("INSERT INTO space_plugins(space_id,tenant_id,source_namespace,identifier,desired_state,desired_version,observed_state,observed_version) VALUES($1,$2,'official','example','installed','1.0','installed','1.0')", space, tenant)
	exec("INSERT INTO workspace_plugin_instances(workspace_id,tenant_id,owner_user_id,project_id,source_namespace,identifier,observed_state,observed_version) VALUES($1,$2,$3,$4,'official','example','installed','1.0')", workspace, tenant, user, project)
	must(t, tx.Commit())
	// Full row snapshots include identifiers, versions, timestamps and owner bindings.
	tables := []string{"projects", "workspaces", "clone_requests", "space_plugins", "workspace_plugin_instances", "tenant_memberships"}
	snapshot := func(table string) string {
		t.Helper()
		var value string
		must(t, pool.QueryRow("SELECT row_to_json(r)::text FROM "+table+" r").Scan(&value))
		return value
	}
	before := make(map[string]string, len(tables))
	for _, table := range tables {
		before[table] = snapshot(table)
	}
	store := newStoreOnSchema(t, pool)
	must(t, store.Migrate(context.Background()))
	must(t, store.Migrate(context.Background()))
	must(t, store.CheckSchema(context.Background()))
	for _, table := range tables {
		if after := snapshot(table); after != before[table] {
			t.Fatalf("0017 rewrote upstream %s: before %s after %s", table, before[table], after)
		}
	}
	if columnNullable(t, pool, "projects", "space_id") || tableExists(t, pool, "collab_workspace_members") {
		t.Fatal("0017 must require project space association and remove the second membership authority")
	}
}
