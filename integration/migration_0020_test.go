package integration

import (
	"context"
	"strings"
	"testing"
)

func TestMigration0020FanoutWaitAndVerificationIntent(t *testing.T) {
	pool, _ := testSchema(t, "test_m0020_")
	store := newStoreOnSchema(t, pool)
	must(t, store.Migrate(context.Background()))
	must(t, store.Migrate(context.Background()))
	must(t, store.CheckSchema(context.Background()))
	if !tableExists(t, pool, "credential_verification_intents") {
		t.Fatal("missing credential verification intents")
	}
	var secrets int
	must(t, pool.QueryRow(`SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='credential_verification_intents' AND column_name IN ('password','token','private_key','secret_value','access_token','secret_ref')`).Scan(&secrets))
	if secrets != 0 {
		t.Fatalf("verification intent stores %d secret columns", secrets)
	}
	var def string
	must(t, pool.QueryRow(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='plugin_maintenance_wait_request'`).Scan(&def))
	if !strings.Contains(def, "workspace_id") || !strings.Contains(def, "idempotency_key") {
		t.Fatalf("wait idempotency does not fan out per runtime: %s", def)
	}
	assertCredentialShape(t, pool)
}
