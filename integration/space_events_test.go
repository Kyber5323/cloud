package integration

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/wanglongan587/cloud/internal/core"
)

// subscribe opens an SSE stream for the given user; it uses a dedicated client
// because streaming connections outlive the simulator client timeout.
func (f *fixture) subscribe(t *testing.T, u core.Claims, sid string, want int) *http.Response {
	t.Helper()
	gw := core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "gateway-a"}}
	svcTok, e := f.client.Credentials.Token("gateway", gw)
	must(t, e)
	u.Caller = "gateway-a"
	userTok, e := f.client.Credentials.Token("user", u)
	must(t, e)
	req, e := http.NewRequest("GET", f.cloud.URL+f.path("/spaces/"+sid+"/events"), nil)
	must(t, e)
	req.Header.Set("Authorization", "Bearer "+svcTok)
	req.Header.Set("X-Ora-User-Token", userTok)
	res, e := (&http.Client{}).Do(req)
	must(t, e)
	if res.StatusCode != want {
		res.Body.Close()
		t.Fatalf("subscribe: want %d got %d", want, res.StatusCode)
	}
	return res
}

// nextEvent waits for one SSE data line and requires it to carry the type. The bounded read is
// itself part of the assertion: a connection closed by either side surfaces as an immediate read
// error instead of blocking until the timeout.
func nextEvent(t *testing.T, res *http.Response, wantType string) {
	t.Helper()
	type lineOrError struct {
		line string
		e    error
	}
	lines := make(chan lineOrError, 1)
	go func() {
		line, e := bufio.NewReader(res.Body).ReadString('\n')
		lines <- lineOrError{line, e}
	}()
	select {
	case <-time.After(5 * time.Second):
		t.Fatalf("no %s event within 5s", wantType)
	case got := <-lines:
		if got.e != nil {
			t.Fatalf("stream ended before the %s event: %v", wantType, got.e)
		}
		if !strings.Contains(got.line, wantType) {
			t.Fatalf("event mismatch: want %s got %q", wantType, got.line)
		}
	}
}

// TestSpaceEventsAuthorizationAndCommitOrder covers scenarios 15 and 16.
func TestSpaceEventsAuthorizationAndCommitOrder(t *testing.T) {
	f := setup(t)
	gw := core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "gateway-a"}}
	space := f.fixtureSpace()
	sid := space.S("id")
	bob, _ := f.addUser(t, "bob", "Bob")
	carol := core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "carol"}, Source: "corp", DisplayName: "Carol"}

	// Scenario 15: a non-member cannot subscribe.
	refused := f.subscribe(t, carol, sid, 403)
	refused.Body.Close()

	// A member subscribes and receives committed events only.
	stream := f.subscribe(t, bob, sid, 200)
	defer stream.Body.Close()

	// Scenario 16: a rejected mutation publishes nothing. A stale version from
	// the owner conflicts after membership passes but before any update. If the
	// failed PATCH wrongly published, the first event below would be
	// space.updated instead of project.created.
	_, status, e := f.client.Call(context.Background(), "PATCH", f.path("/spaces/"+sid), "gateway", gw, &f.user, "", core.Object{"name": "Stale", "description": "", "version": 99})
	must(t, e)
	if status != 409 {
		t.Fatalf("stale patch: want 409 got %d", status)
	}

	// A committed project creation reaches the subscriber with the project id.
	_, status, e = f.client.Call(context.Background(), "POST", f.path("/spaces/"+sid+"/projects"), "gateway", gw, &bob, "stream-project", core.Object{"name": "Evented", "repositoryUrl": "https://example.invalid/repo.git", "defaultBranch": "main"})
	must(t, e)
	if status != 202 {
		t.Fatalf("create project: want 202 got %d", status)
	}
	nextEvent(t, stream, "project.created")

	// A committed space update reaches the subscriber.
	f.call("PATCH", f.path("/spaces/"+sid), core.Object{"name": "Stream Renamed", "description": "", "version": space.N("version")}, "", 200)
	nextEvent(t, stream, "space.updated")

	// The authoritative state matches the event the client was told about. The
	// evented project is bob's and the list is workspace-shared (Step 3), so it
	// is checked as bob, the creator.
	list, status, e := f.client.Call(context.Background(), "GET", f.path("/spaces/"+sid+"/projects"), "gateway", gw, &bob, "", nil)
	must(t, e)
	if status != 200 || len(list["items"].([]any)) != 1 {
		t.Fatalf("project list missing evented project: %d %v", status, list)
	}
}

// TestRemovedMemberLosesOpenEventStream covers revocation of an already
// established subscription, not only rejection of a new connection.
func TestRemovedMemberLosesOpenEventStream(t *testing.T) {
	f := setup(t)
	space := f.fixtureSpace()
	bob, bobID := f.addUser(t, "bob", "Bob")
	stream := f.subscribe(t, bob, space.S("id"), 200)
	t.Cleanup(func() { stream.Body.Close() })

	f.call("PUT", f.path("/members/"+bobID), core.Object{"role": "member", "status": "disabled", "version": 1}, "", 200)

	type lineOrError struct {
		line string
		err  error
	}
	result := make(chan lineOrError, 1)
	go func() {
		line, err := bufio.NewReader(stream.Body).ReadString('\n')
		result <- lineOrError{line, err}
	}()
	select {
	case got := <-result:
		if got.line != "" || !errors.Is(got.err, io.EOF) {
			t.Fatalf("removed member received an event or open stream: line=%q err=%v", got.line, got.err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("removed member's event stream remained open")
	}
}

// TestNewMembershipNotifiesOnlineMembers checks the three admission paths
// against an already open member stream and keeps idempotent replay silent.
func TestNewMembershipNotifiesOnlineMembers(t *testing.T) {
	f := setup(t)
	stream := f.subscribe(t, f.user, f.fixtureSpace().S("id"), 200)
	t.Cleanup(func() { stream.Body.Close() })

	inviteToken := joinToken('n')
	f.call("POST", f.path("/invitations"), core.Object{"token": inviteToken}, "notify-invite", 201)
	bob := joinUser("bob")
	joinCall(t, f, bob, "POST", "/api/v1/join/invitations/redeem", "notify-redeem", core.Object{"token": inviteToken}, 200)
	nextEvent(t, stream, "space.member_updated")

	// An idempotent replay returns the recorded response without a fresh notice.
	notices, cancel := f.store.Events.Subscribe(f.fixtureSpace().S("id"))
	t.Cleanup(cancel)
	joinCall(t, f, bob, "POST", "/api/v1/join/invitations/redeem", "notify-redeem", core.Object{"token": inviteToken}, 200)
	select {
	case event := <-notices:
		t.Fatalf("idempotent redemption published an event: %v", event)
	default:
	}

	linkToken := joinToken('o')
	f.call("POST", f.path("/join-links"), core.Object{"token": linkToken}, "notify-link", 201)
	request := joinCall(t, f, joinUser("carol"), "POST", "/api/v1/join/requests", "notify-request", core.Object{"token": linkToken}, 201)
	f.call("POST", f.path("/join-requests/"+request.S("id")+"/approve"), core.Object{"version": request.N("version")}, "notify-approval", 200)
	nextEvent(t, stream, "space.member_updated")

	person := core.DirectoryPerson{GlobalUserID: "205045249610656", Name: "Employee", Employed: true}
	_, status, err := f.store.Public(context.Background(), &core.PublicRequest{
		Method: "POST", Path: f.path("/members/huawei"), TenantID: f.tid, Key: "notify-directory", Identity: &f.user,
		Body: core.Object{"keyword": "Employee", "globalUserId": person.GlobalUserID, "role": "member"}, Person: &person,
	})
	must(t, err)
	if status != 200 {
		t.Fatalf("directory add: want 200 got %d", status)
	}
	nextEvent(t, stream, "space.member_updated")
}
