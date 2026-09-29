package integration

import (
	"context"
	"encoding/base64"
	"strings"
	"sync"
	"testing"

	"github.com/golang-jwt/jwt/v5"

	"github.com/wanglongan587/cloud/internal/core"
)

func joinToken(seed byte) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat(string([]byte{seed}), 32)))
}

func joinUser(subject string) core.Claims {
	return core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: subject}, Source: "github.com", DisplayName: subject}
}

func joinCall(t *testing.T, f *fixture, user core.Claims, method, path, key string, body core.Object, want int) core.Object {
	t.Helper()
	gw := core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "gateway-a"}}
	out, status, err := f.client.Call(context.Background(), method, path, "gateway", gw, &user, key, body)
	must(t, err)
	if status != want {
		t.Fatalf("%s %s: want %d, got %d %v", method, path, want, status, out)
	}
	return out
}

func TestInvitationRedeemsOnceAndRemovalImmediatelyRevokesAccess(t *testing.T) {
	f := setup(t)
	token := joinToken('a')
	invite := f.call("POST", f.path("/invitations"), core.Object{"token": token}, "invite-1", 201)
	if invite.S("id") == "" || f.scalar("SELECT count(*) FROM tenant_invitations WHERE id=$1 AND token_hash=decode($2,'hex')", invite.S("id"), strings.Repeat("61", 32)) != 0 {
		t.Fatal("invitation metadata is missing or a raw token was stored")
	}
	bob := joinUser("bob")
	bobIdentity := joinCall(t, f, bob, "GET", "/api/v1/me", "", nil, 200)
	f.call("PUT", f.path("/members/"+bobIdentity.S("id")), core.Object{"role": "member", "status": "active", "version": 0}, "", 404)
	membership := joinCall(t, f, bob, "POST", "/api/v1/join/invitations/redeem", "redeem-bob", core.Object{"token": token}, 200)
	if membership.S("tenantId") != f.tid || membership.S("role") != "member" {
		t.Fatalf("invitation did not create ordinary membership: %v", membership)
	}
	replay := joinCall(t, f, bob, "POST", "/api/v1/join/invitations/redeem", "redeem-bob", core.Object{"token": token}, 200)
	if replay.S("userId") != membership.S("userId") {
		t.Fatal("idempotent replay changed the membership")
	}
	joinCall(t, f, joinUser("carol"), "POST", "/api/v1/join/invitations/redeem", "redeem-carol", core.Object{"token": token}, 404)
	joinCall(t, f, bob, "GET", f.path("/spaces"), "", nil, 200)
	f.call("PUT", f.path("/members/"+membership.S("userId")), core.Object{"role": "member", "status": "disabled", "version": membership.N("version")}, "", 200)
	joinCall(t, f, bob, "GET", f.path("/spaces"), "", nil, 403)
	f.call("PUT", f.path("/members/"+membership.S("userId")), core.Object{"role": "member", "status": "active", "version": membership.N("version") + 1}, "", 409)
	rejoinToken := joinToken('f')
	f.call("POST", f.path("/invitations"), core.Object{"token": rejoinToken}, "invite-rejoin", 201)
	joinCall(t, f, bob, "POST", "/api/v1/join/invitations/redeem", "redeem-rejoin", core.Object{"token": rejoinToken}, 200)
	joinCall(t, f, bob, "GET", f.path("/spaces"), "", nil, 200)
}

func TestInvitationExpiryRevocationAndConcurrentRedemption(t *testing.T) {
	f := setup(t)
	expired := joinToken('b')
	first := f.call("POST", f.path("/invitations"), core.Object{"token": expired}, "invite-expired", 201)
	_, err := f.store.Pool.ExecContext(context.Background(), "UPDATE tenant_invitations SET created_at=now()-interval '8 days',expires_at=now()-interval '7 days' WHERE id=$1", first.S("id"))
	must(t, err)
	joinCall(t, f, joinUser("late"), "POST", "/api/v1/join/invitations/redeem", "late", core.Object{"token": expired}, 404)

	revoked := joinToken('c')
	second := f.call("POST", f.path("/invitations"), core.Object{"token": revoked}, "invite-revoke", 201)
	f.call("DELETE", f.path("/invitations/"+second.S("id")), core.Object{"version": second.N("version")}, "revoke-invite", 200)
	joinCall(t, f, joinUser("revoked"), "POST", "/api/v1/join/invitations/redeem", "revoked", core.Object{"token": revoked}, 404)

	concurrent := joinToken('d')
	f.call("POST", f.path("/invitations"), core.Object{"token": concurrent}, "invite-race", 201)
	var wg sync.WaitGroup
	statuses := make(chan int, 2)
	for _, subject := range []string{"one", "two"} {
		wg.Add(1)
		go func(subject string) {
			defer wg.Done()
			gw := core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "gateway-a"}}
			u := joinUser(subject)
			_, status, callErr := f.client.Call(context.Background(), "POST", "/api/v1/join/invitations/redeem", "gateway", gw, &u, subject, core.Object{"token": concurrent})
			if callErr != nil {
				statuses <- 0
				return
			}
			statuses <- status
		}(subject)
	}
	wg.Wait()
	close(statuses)
	results := map[int]int{}
	for status := range statuses {
		results[status]++
	}
	if results[200] != 1 || results[404] != 1 {
		t.Fatalf("single-use concurrent redemption: %v", results)
	}
}

func TestJoinRequestNeedsAdminApprovalAndLinkCanBeRevoked(t *testing.T) {
	f := setup(t)
	token := joinToken('e')
	link := f.call("POST", f.path("/join-links"), core.Object{"token": token}, "link", 201)
	for _, subject := range []string{"bob", "carol"} {
		request := joinCall(t, f, joinUser(subject), "POST", "/api/v1/join/requests", "apply-"+subject, core.Object{"token": token}, 201)
		if request.S("status") != "pending" {
			t.Fatalf("application should be pending: %v", request)
		}
		joinCall(t, f, joinUser(subject), "GET", f.path("/spaces"), "", nil, 403)
	}
	requests := f.call("GET", f.path("/join-requests"), nil, "", 200)
	items := requests["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("reusable link should admit two applications: %v", requests)
	}
	for _, item := range items {
		row := core.Object(item.(map[string]any))
		decision := "reject"
		if row.S("displayName") == "bob" {
			decision = "approve"
		}
		f.call("POST", f.path("/join-requests/"+row.S("id")+"/"+decision), core.Object{"version": row.N("version")}, "decide-"+row.S("id"), 200)
	}
	joinCall(t, f, joinUser("bob"), "GET", f.path("/spaces"), "", nil, 200)
	joinCall(t, f, joinUser("carol"), "GET", f.path("/spaces"), "", nil, 403)
	f.call("DELETE", f.path("/join-links/"+link.S("id")), core.Object{"version": link.N("version")}, "revoke-link", 200)
	joinCall(t, f, joinUser("dave"), "POST", "/api/v1/join/requests", "apply-dave", core.Object{"token": token}, 404)
}
