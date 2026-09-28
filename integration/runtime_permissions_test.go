package integration

import (
	"context"
	"testing"

	"github.com/golang-jwt/jwt/v5"

	"github.com/wanglongan587/cloud/internal/core"
)

// TestRuntimeContentPermissionsAndReplay exercises HTTP, PostgreSQL and a real cloned directory.
// specs/test-cases/cloud/workspace/runtime-workspace-use-permissions.md#runtime-content-access-requires-its-creator-or-a-current-tenant-admin
func TestRuntimeContentPermissionsAndReplay(t *testing.T) {
	f := setup(t)
	bob, bobID := f.addUser(t, "bob", "Bob")
	gw := core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "gateway-a"}}
	created := f.call("POST", f.path("/projects"), core.Object{"name": "Shared", "repositoryUrl": "https://example.invalid/repo.git", "defaultBranch": "main"}, "create", 202)
	wid, oid := created.O("workspace").S("id"), created.O("operation").S("id")
	f.drain()
	for _, route := range []string{"/workspaces/" + wid, "/operations/" + oid} {
		out, code, err := f.client.Call(context.Background(), "GET", f.path(route), "gateway", gw, &bob, "", nil)
		must(t, err)
		if code != 403 || out.S("code") != "runtime_use_forbidden" {
			t.Fatalf("content permission: %d %v", code, out)
		}
	}
	f.call("PUT", f.path("/members/"+bobID), core.Object{"role": "admin", "status": "active", "version": 1}, "", 200)
	current := f.call("GET", f.path("/workspaces/"+wid), nil, "", 200)
	alice := f.user
	f.user = bob
	body := f.lifecycleBody(wid, current.N("version"))
	f.user = alice
	stopped, code, err := f.client.Call(context.Background(), "POST", f.path("/workspaces/"+wid+"/stop"), "gateway", gw, &bob, "bob-stop", body)
	must(t, err)
	if code != 202 {
		t.Fatalf("administrator stop: %d %v", code, stopped)
	}
	f.call("PUT", f.path("/members/"+bobID), core.Object{"role": "member", "status": "active", "version": 2}, "", 200)
	replay, code, err := f.client.Call(context.Background(), "POST", f.path("/workspaces/"+wid+"/stop"), "gateway", gw, &bob, "bob-stop", body)
	must(t, err)
	if code != 403 || replay.S("code") != "runtime_use_forbidden" {
		t.Fatalf("replay restored demoted administrator access: %d %v", code, replay)
	}
	if f.scalar("SELECT count(*) FROM workspaces WHERE id=$1 AND owner_user_id=$2 AND creator_user_id=$2", wid, f.uid) != 1 {
		t.Fatal("runtime identities were rewritten")
	}
}
