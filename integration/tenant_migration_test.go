package integration

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"

	"github.com/wanglongan587/cloud/internal/core"
)

func previousSpaceSchema(t *testing.T, pool *sql.DB, tenantName string) (tid, sid, uid string) {
	t.Helper()
	_, err := pool.Exec("CREATE TABLE schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())")
	must(t, err)
	for _, version := range []string{"0001_core.sql", "0002_aggregate_guards.sql", "0003_resource_versions.sql", "0004_effect_intent_and_ticket_scope.sql", "0005_gateway_auth.sql", "0006_collab_spaces.sql", "0007_project_space_scope.sql"} {
		migration, readErr := os.ReadFile(filepath.Join("..", "internal", "core", "migrations", version))
		must(t, readErr)
		_, err = pool.Exec(string(migration))
		must(t, err)
		sum := sha256.Sum256(migration)
		_, err = pool.Exec("INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)", version, hex.EncodeToString(sum[:]))
		must(t, err)
	}
	tid, sid, uid = uuid.NewString(), uuid.NewString(), uuid.NewString()
	tx, err := pool.Begin()
	must(t, err)
	_, err = tx.Exec("INSERT INTO users(id,display_name,status) VALUES($1,'Member','active')", uid)
	must(t, err)
	_, err = tx.Exec("INSERT INTO tenants(id,name,status) VALUES($1,$2,'active')", tid, tenantName)
	must(t, err)
	_, err = tx.Exec("INSERT INTO tenant_memberships(tenant_id,user_id,role,status) VALUES($1,$2,'admin','active')", tid, uid)
	must(t, err)
	_, err = tx.Exec("INSERT INTO collab_workspaces(id,tenant_id,name,slug,created_by) VALUES($1,$2,'Default','legacy-space',$3)", sid, tid, uid)
	must(t, err)
	_, err = tx.Exec("INSERT INTO collab_workspace_members(workspace_id,user_id,role,status) VALUES($1,$2,'owner','active')", sid, uid)
	must(t, err)
	must(t, tx.Commit())
	return tid, sid, uid
}

func TestMigrateFromPreviousSpaceSchemaPreservesCompatibleTenant(t *testing.T) {
	pool, _ := testSchema(t, "test_space_upgrade_")
	tid, sid, uid := previousSpaceSchema(t, pool, "Default")
	store := &core.Store{Pool: pool}
	must(t, store.Migrate(context.Background()))
	must(t, store.Migrate(context.Background()))
	must(t, store.CheckSchema(context.Background()))
	var name, slug, role string
	must(t, pool.QueryRow("SELECT w.name,w.slug,m.role FROM collab_workspaces w JOIN tenant_memberships m ON m.tenant_id=w.tenant_id WHERE w.id=$1 AND w.tenant_id=$2 AND m.user_id=$3", sid, tid, uid).Scan(&name, &slug, &role))
	if name != "Default" || slug != "legacy-space" || role != "admin" {
		t.Fatalf("compatible tenant changed during upgrade: %s %s %s", name, slug, role)
	}
	var oldTable *string
	must(t, pool.QueryRow("SELECT to_regclass('collab_workspace_members')::text").Scan(&oldTable))
	if oldTable != nil {
		t.Fatalf("space membership table survived upgrade: %s", *oldTable)
	}
}

func TestMigrateRejectsIncompatiblePreviousSpaceNames(t *testing.T) {
	pool, _ := testSchema(t, "test_space_incompatible_")
	tid, sid, _ := previousSpaceSchema(t, pool, "Old tenant name")
	store := &core.Store{Pool: pool}
	if err := store.Migrate(context.Background()); err == nil {
		t.Fatal("mismatched historical names were silently reinterpreted")
	}
	var count int
	must(t, pool.QueryRow("SELECT count(*) FROM schema_migrations WHERE version='0017_tenant_membership_and_join.sql'").Scan(&count))
	if count != 0 {
		t.Fatal("failed migration was recorded as applied")
	}
	must(t, pool.QueryRow("SELECT count(*) FROM collab_workspaces WHERE id=$1 AND tenant_id=$2", sid, tid).Scan(&count))
	if count != 1 {
		t.Fatal("failed migration discarded historical space")
	}
}
