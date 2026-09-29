package integration

import (
	"context"
	"testing"

	"github.com/golang-jwt/jwt/v5"

	"github.com/wanglongan587/cloud/internal/core"
)

// TestSelfServeTenantProvisioning covers POST /api/v1/tenants: a user who
// belongs to no tenant provisions one for themselves, becomes its
// administrator of its sole space, replays through the idempotency
// key, and cannot reuse the key with a different body.
//
// Evidence for specs/test-cases/cloud/tenancy/self-serve-provisioning.md
// (#a-signed-in-member-provisions-exactly-one-tenant-and-its-first-space,
// #idempotency-key-matches-per-user-across-tenants,
// #the-members-tenant-list-pages-in-ascending-creation-order).
func TestSelfServeTenantProvisioning(t *testing.T) {
	f := setup(t)
	gw := core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "gateway-a"}}
	dave := core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "4242"}, Source: "github.com", DisplayName: "Dave"}
	post := func(body core.Object, key string) (core.Object, int) {
		t.Helper()
		o, status, e := f.client.Call(context.Background(), "POST", "/api/v1/tenants", "gateway", gw, &dave, key, body)
		must(t, e)
		return o, status
	}

	// A first-time identity has no tenant before provisioning.
	tenants, status, e := f.client.Call(context.Background(), "GET", "/api/v1/me/tenants", "gateway", gw, &dave, "", nil)
	must(t, e)
	if status != 200 || len(tenants["items"].([]any)) != 0 {
		t.Fatalf("new user should belong to no tenant: %d %v", status, tenants)
	}

	// Validation happens before anything is written.
	if _, status = post(core.Object{"name": "Acme", "slug": "Bad Slug!"}, "tenant-bad-slug"); status != 400 {
		t.Fatalf("malformed slug: want 400 got %d", status)
	}
	if _, status = post(core.Object{"name": "  ", "slug": "acme"}, "tenant-bad-name"); status != 400 {
		t.Fatalf("blank name: want 400 got %d", status)
	}
	if _, status = post(core.Object{"name": "Acme", "slug": "acme"}, ""); status != 400 {
		t.Fatalf("missing idempotency key: want 400 got %d", status)
	}
	if f.scalar("SELECT count(*) FROM tenants WHERE name='Acme'") != 0 {
		t.Fatal("rejected requests must not create tenants")
	}

	created, status := post(core.Object{"name": "Acme", "slug": "Acme-Team"}, "tenant-create")
	if status != 201 {
		t.Fatalf("provision: want 201 got %d %v", status, created)
	}
	tenant, space := created.O("tenant"), created.O("space")
	tid, sid := tenant.S("id"), space.S("id")
	if tenant.S("name") != "Acme" || tenant.S("role") != "admin" || tenant.S("status") != "active" {
		t.Fatalf("unexpected tenant projection: %v", tenant)
	}
	if space.S("tenantId") != tid || space.S("name") != "Acme" || space.S("slug") != "acme-team" {
		t.Fatalf("unexpected space projection: %v", space)
	}
	uid := f.scalar("SELECT count(*) FROM tenant_memberships WHERE tenant_id=$1 AND role='admin' AND status='active'", tid)
	if uid != 1 {
		t.Fatalf("tenant must have exactly one administrator, got %d", uid)
	}
	if f.scalar("SELECT count(*) FROM collab_workspaces WHERE id=$1 AND tenant_id=$2", sid, tid) != 1 {
		t.Fatal("tenant must own exactly one visible space")
	}

	// The tenant is visible to its creator and usable through space-scoped APIs.
	tenants, status, e = f.client.Call(context.Background(), "GET", "/api/v1/me/tenants", "gateway", gw, &dave, "", nil)
	must(t, e)
	items := tenants["items"].([]any)
	if status != 200 || len(items) != 1 || items[0].(map[string]any)["id"] != tid {
		t.Fatalf("creator should see the new tenant: %d %v", status, tenants)
	}
	spaces, status, e := f.client.Call(context.Background(), "GET", "/api/v1/tenants/"+tid+"/spaces", "gateway", gw, &dave, "", nil)
	must(t, e)
	if status != 200 || len(spaces["items"].([]any)) != 1 {
		t.Fatalf("creator should see the first space: %d %v", status, spaces)
	}

	// Replay returns the original response without a second tenant; a changed
	// body under the same key is a conflict.
	replay, status := post(core.Object{"name": "Acme", "slug": "Acme-Team"}, "tenant-create")
	if status != 201 || replay.O("tenant").S("id") != tid || replay.O("space").S("id") != sid {
		t.Fatalf("replay must return the original tenant: %d %v", status, replay)
	}
	if _, status = post(core.Object{"name": "Other", "slug": "other"}, "tenant-create"); status != 409 {
		t.Fatalf("reused key with different body: want 409 got %d", status)
	}
	if f.scalar("SELECT count(*) FROM tenants t JOIN tenant_memberships m ON m.tenant_id=t.id JOIN user_identities i ON i.user_id=m.user_id WHERE i.source='github.com' AND i.subject='4242'") != 1 {
		t.Fatal("replay or conflict created another tenant")
	}

	// Visible slugs are globally reserved, including across tenants.
	if _, status = post(core.Object{"name": "Acme", "slug": "acme-team"}, "tenant-duplicate-slug"); status != 409 {
		t.Fatalf("reused global slug: want 409 got %d", status)
	}
	second, status := post(core.Object{"name": "Acme", "slug": "acme-team-2"}, "tenant-create-2")
	if status != 201 || second.O("tenant").S("id") == tid {
		t.Fatalf("second tenant: want fresh 201 got %d %v", status, second)
	}
	secondID := second.O("tenant").S("id")

	// The member's tenant list is ordered by creation, so the earliest tenant is
	// first; pagination keeps the cursor an opaque tenant UUID.
	tenants, status, e = f.client.Call(context.Background(), "GET", "/api/v1/me/tenants", "gateway", gw, &dave, "", nil)
	must(t, e)
	items = tenants["items"].([]any)
	if status != 200 || len(items) != 2 || items[0].(map[string]any)["id"] != tid || items[1].(map[string]any)["id"] != secondID {
		t.Fatalf("tenants must list the earliest-created first: %d %v", status, tenants)
	}
	firstPage, status, e := f.client.Call(context.Background(), "GET", "/api/v1/me/tenants?limit=1", "gateway", gw, &dave, "", nil)
	must(t, e)
	if status != 200 || firstPage.S("nextCursor") != tid {
		t.Fatalf("first page must end at the earliest tenant: %d %v", status, firstPage)
	}
	rest, status, e := f.client.Call(context.Background(), "GET", "/api/v1/me/tenants?limit=1&after="+firstPage.S("nextCursor"), "gateway", gw, &dave, "", nil)
	must(t, e)
	restItems, _ := rest["items"].([]any)
	if status != 200 || len(restItems) != 1 || restItems[0].(map[string]any)["id"] != secondID {
		t.Fatalf("cursor must resume at the second tenant: %d %v", status, rest)
	}

	// The fixture tenant is untouched and stays invisible to the new user.
	if _, status, e = f.client.Call(context.Background(), "GET", f.path("/spaces"), "gateway", gw, &dave, "", nil); e != nil || status != 403 {
		t.Fatalf("foreign tenant must stay forbidden: %v %d", e, status)
	}
}
