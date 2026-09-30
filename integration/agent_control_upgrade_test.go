package integration

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
)

// The forward upgrade preserves pending command order and old runtime-control data.
func TestAgentControlUpgradePreservesPendingCommandOrder(t *testing.T) {
	pool, _ := testSchema(t, "test_agent_upgrade_")
	entries, err := os.ReadDir(filepath.Join("..", "internal", "core", "migrations"))
	must(t, err)
	var versions []string
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) == ".sql" && entry.Name() < "0025" {
			versions = append(versions, entry.Name())
		}
	}
	applyMigrationsUpTo(t, pool, versions)
	user, tenant, issue, run := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	tx, err := pool.BeginTx(t.Context(), nil)
	must(t, err)
	t.Cleanup(func() { _ = tx.Rollback() })
	for _, item := range []struct {
		query string
		args  []any
	}{
		{"INSERT INTO users(id,display_name,status) VALUES($1,'Actor','active')", []any{user}},
		{"INSERT INTO tenants(id,name,status) VALUES($1,'Upgrade','active')", []any{tenant}},
		{"INSERT INTO tenant_memberships(tenant_id,user_id,role,status) VALUES($1,$2,'admin','active')", []any{tenant, user}},
		{"INSERT INTO issues(id,tenant_id,creator_user_id,title,number) VALUES($1,$2,$3,'Upgrade',1)", []any{issue, tenant, user}},
		{"INSERT INTO issue_runs(id,tenant_id,issue_id,executor_type,executor_id) VALUES($1,$2,$3,'agent',$4)", []any{run, tenant, issue, uuid.NewString()}},
	} {
		_, err = tx.Exec(item.query, item.args...)
		must(t, err)
	}
	must(t, tx.Commit())
	ids := []string{"00000000-0000-4000-8000-000000000001", "ffffffff-ffff-4fff-8fff-ffffffffffff"}
	for _, id := range ids {
		_, err = pool.Exec("INSERT INTO thread_commands(id,run_id,kind,body,created_at) VALUES($1,$2,'end_session','{\"reason\":\"user_ended\"}','2026-09-28T00:00:00Z')", id, run)
		must(t, err)
	}
	store := newStoreOnSchema(t, pool)
	must(t, store.Migrate(t.Context()))
	must(t, store.Migrate(t.Context()))
	must(t, store.CheckSchema(t.Context()))
	for i, id := range ids {
		var sequence int
		must(t, pool.QueryRow("SELECT queue_sequence FROM thread_commands WHERE id=$1", id).Scan(&sequence))
		if sequence != i+1 {
			t.Fatal("upgrade changed the prior command order", id, sequence)
		}
	}
	var sequence int
	must(t, pool.QueryRow("INSERT INTO thread_commands(id,run_id,kind,body) VALUES($1,$2,'end_session','{\"reason\":\"user_ended\"}') RETURNING queue_sequence", uuid.NewString(), run).Scan(&sequence))
	if sequence != 3 {
		t.Fatal("new command did not follow the preserved queue", sequence)
	}
}
