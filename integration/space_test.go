package integration

import (
	"context"
	"testing"

	"github.com/golang-jwt/jwt/v5"

	"github.com/wanglongan587/cloud/internal/core"
)

// addUser creates a local identity and joins it to the fixture tenant.
func (f *fixture) addUser(t *testing.T, subject, display string) (core.Claims, string) {
	t.Helper()
	gw := core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "gateway-a"}}
	u := core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: subject}, Source: "corp", DisplayName: display}
	o, status, e := f.client.Call(context.Background(), "GET", "/api/v1/me", "gateway", gw, &u, "", nil)
	must(t, e)
	if status != 200 {
		t.Fatalf("addUser %s: want 200 got %d", subject, status)
	}
	f.addMemberID(o.S("id"), "member")
	return u, o.S("id")
}

// addMemberID seeds authorization state for tests unrelated to joining. The
// public member endpoint deliberately cannot bypass invitation or HR checks.
func (f *fixture) addMemberID(uid, role string) {
	f.t.Helper()
	_, err := f.store.Pool.Exec("INSERT INTO tenant_memberships(tenant_id,user_id,role,status) VALUES($1,$2,$3,'active')", f.tid, uid, role)
	must(f.t, err)
}

// fixtureSpace is the tenant's sole collaboration space.
func (f *fixture) fixtureSpace() core.Object {
	f.t.Helper()
	list := f.call("GET", f.path("/spaces"), nil, "", 200)
	items := list["items"].([]any)
	if len(items) != 1 {
		f.t.Fatalf("tenant must expose one space: %v", list)
	}
	return core.Object(items[0].(map[string]any))
}

func TestTenantOwnsOneVisibleSpaceAndSharesItsName(t *testing.T) {
	f := setup(t)
	space := f.fixtureSpace()
	sid := space.S("id")
	if f.scalar("SELECT count(*) FROM collab_workspaces WHERE tenant_id=$1", f.tid) != 1 {
		t.Fatal("tenant does not own exactly one space")
	}

	renamed := f.call("PATCH", f.path("/spaces/"+sid), core.Object{"name": "Renamed", "description": "", "version": space.N("version")}, "", 200)
	if renamed.S("name") != "Renamed" || renamed.S("slug") != space.S("slug") {
		t.Fatalf("rename changed slug or lost name: %v", renamed)
	}
	if f.scalar("SELECT count(*) FROM tenants WHERE id=$1 AND name='Renamed'", f.tid) != 1 {
		t.Fatal("tenant name did not follow space rename")
	}

	gw := core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "gateway-a"}}
	created, status, e := f.client.Call(context.Background(), "POST", "/api/v1/tenants", "gateway", gw, &f.user, "another-tenant", core.Object{"name": "Another", "slug": "another-space"})
	must(t, e)
	if status != 201 {
		t.Fatalf("user cannot create second tenant: %d %v", status, created)
	}
	joined, status, e := f.client.Call(context.Background(), "GET", "/api/v1/me/spaces", "gateway", gw, &f.user, "", nil)
	must(t, e)
	if status != 200 || len(joined["items"].([]any)) != 2 {
		t.Fatalf("joined spaces do not cover both tenants: %d %v", status, joined)
	}
	if created.O("space").S("slug") != "another-space" {
		t.Fatalf("second tenant did not create requested space: %v", created)
	}
}

func TestArchivedSpaceSlugRemainsReserved(t *testing.T) {
	f := setup(t)
	space := f.fixtureSpace()
	_, err := f.store.Pool.ExecContext(context.Background(), "UPDATE collab_workspaces SET archived_at=now() WHERE id=$1", space.S("id"))
	must(t, err)
	gw := core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "gateway-a"}}
	_, status, callErr := f.client.Call(context.Background(), "POST", "/api/v1/tenants", "gateway", gw, &f.user, "reuse-archived-slug", core.Object{"name": "Reused", "slug": space.S("slug")})
	must(t, callErr)
	if status != 409 {
		t.Fatalf("archived slug must remain reserved: got %d", status)
	}
}
