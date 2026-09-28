package integration

import (
	"bufio"
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/wanglongan587/cloud/internal/core"
)

// TestRuntimeContentAccessRequiresCreatorOrCurrentAdmin is the phase-2 permission
// matrix: shared overview stays visible, runtime content follows the creator or
// a current administrator, and a missing permission is not reported as occupancy.
func TestRuntimeContentAccessRequiresCreatorOrCurrentAdmin(t *testing.T) {
	f := setup(t)
	validateHTTP(t, f)
	gw := core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "gateway-a"}}
	bob, bobID := f.addUser(t, "bob", "Bob")
	carol, carolID := f.addUser(t, "carol", "Carol")
	dave, _ := f.addUser(t, "dave", "Dave")
	created := f.call("POST", f.path("/projects"), core.Object{"name": "Shared", "repositoryUrl": "https://example.invalid/repo.git", "defaultBranch": "main"}, "use-project", 202)
	pid, mainID := created.O("resource").S("id"), created.O("workspace").S("id")
	projectOp := created.O("operation").S("id")
	f.drain()

	isolated, status, err := f.client.Call(context.Background(), "POST", f.path("/projects/"+pid+"/workspaces"), "gateway", gw, &bob, "bob-runtime", core.Object{"title": "Bob's task", "baseRef": "main"})
	must(t, err)
	if status != 202 {
		t.Fatalf("member create: want 202 got %d (%v)", status, isolated)
	}
	bobRuntime := isolated.O("resource").S("id")
	bobOp := isolated.O("operation").S("id")
	f.drain()
	f.call("PUT", f.path("/members/"+carolID), core.Object{"role": "admin", "status": "active", "version": 1}, "", 200)

	var mainCreator, mainSource, bobCreator, bobSource, bobOwner string
	must(t, f.store.Pool.QueryRow("SELECT creator_user_id::text, creator_source, owner_user_id::text FROM workspaces WHERE id=$1", mainID).Scan(&mainCreator, &mainSource, new(string)))
	must(t, f.store.Pool.QueryRow("SELECT creator_user_id::text, creator_source, owner_user_id::text FROM workspaces WHERE id=$1", bobRuntime).Scan(&bobCreator, &bobSource, &bobOwner))
	if mainCreator != f.uid || mainSource != "create_project_operation" || bobCreator != bobID || bobSource != "create_workspace_operation" || bobOwner != f.uid {
		t.Fatalf("creator diverged from owner: main %s/%s bob %s/%s owner %s", mainCreator, mainSource, bobCreator, bobSource, bobOwner)
	}
	if grants := f.scalar("SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN ('runtime_use_grants','workspace_authorizations')"); grants != 0 {
		t.Fatal("phase 2 created a runtime authorization table")
	}

	all := runtimeItems(t, callUser(t, f, bob, "GET", f.path("/projects/"+pid+"/workspaces?scope=all"), nil, ""))
	if len(all) != 2 {
		t.Fatalf("member overview list: %v", all)
	}
	mainView, ownView := findRuntime(t, all, mainID), findRuntime(t, all, bobRuntime)
	if hasRuntimeContent(mainView) || mainView.B("contentAllowed") || mainView.S("creatorUserId") != f.uid || mainView.S("observedState") == "" {
		t.Fatalf("other member saw main content: %v", mainView)
	}
	if !ownView.B("contentAllowed") || !hasRuntimeContent(ownView) || ownView.S("baseCommitId") != f.commit || ownView.S("title") != "Bob's task" || ownView.S("creatorUserId") != bobID {
		t.Fatalf("creator lost own runtime content: %v", ownView)
	}
	ownOnly := runtimeItems(t, callUser(t, f, bob, "GET", f.path("/projects/"+pid+"/workspaces?scope=own"), nil, ""))
	if len(ownOnly) != 1 || ownOnly[0].S("id") != bobRuntime {
		t.Fatalf("own scope: %v", ownOnly)
	}
	adminOwn := runtimeItems(t, f.call("GET", f.path("/projects/"+pid+"/workspaces?scope=own"), nil, "", 200))
	if len(adminOwn) != 1 || adminOwn[0].S("id") != mainID || !hasRuntimeContent(adminOwn[0]) {
		t.Fatalf("admin own scope: %v", adminOwn)
	}
	adminAll := runtimeItems(t, f.call("GET", f.path("/projects/"+pid+"/workspaces?scope=all"), nil, "", 200))
	if len(adminAll) != 2 || !hasRuntimeContent(findRuntime(t, adminAll, bobRuntime)) || !findRuntime(t, adminAll, bobRuntime).B("contentAllowed") {
		t.Fatalf("admin all scope hid a runtime: %v", adminAll)
	}
	bad, badStatus := callUserStatus(t, f, bob, "GET", f.path("/projects/"+pid+"/workspaces?scope=other"))
	if badStatus != 400 || bad.S("code") != "invalid_input" {
		t.Fatalf("bad scope: status %d %v", badStatus, bad)
	}

	hidden, hiddenStatus := callUserStatus(t, f, bob, "GET", f.path("/workspaces/"+mainID))
	if hiddenStatus != 200 || hasRuntimeContent(hidden) || hidden.B("contentAllowed") || hidden.S("creatorUserId") != f.uid || hidden.S("observedState") == "" {
		t.Fatalf("runtime overview: status %d body %v", hiddenStatus, hidden)
	}
	visible := callUser(t, f, bob, "GET", f.path("/workspaces/"+bobRuntime), nil, "")
	if !visible.B("contentAllowed") || visible.S("requestedRef") == "" || visible.S("baseCommitId") != f.commit {
		t.Fatalf("creator detail: %v", visible)
	}

	var opState string
	var opVersion int64
	must(t, f.store.Pool.QueryRow("SELECT state, version FROM operations WHERE id=$1", projectOp).Scan(&opState, &opVersion))
	deniedOp, deniedStatus := callUserStatus(t, f, bob, "GET", f.path("/operations/"+projectOp))
	if deniedStatus != 403 || deniedOp.S("code") != "runtime_use_forbidden" || len(deniedOp.O("params")) != 0 || hasRuntimeContent(deniedOp) {
		t.Fatalf("operation detail: status %d %v", deniedStatus, deniedOp)
	}
	var opStateAfter string
	var opVersionAfter int64
	must(t, f.store.Pool.QueryRow("SELECT state, version FROM operations WHERE id=$1", projectOp).Scan(&opStateAfter, &opVersionAfter))
	if opStateAfter != opState || opVersionAfter != opVersion {
		t.Fatal("forbidden operation read changed the operation")
	}
	ownOp := callUser(t, f, bob, "GET", f.path("/operations/"+bobOp), nil, "")
	if ownOp.S("id") != bobOp || ownOp.S("actorUserId") != bobID {
		t.Fatalf("creator operation: %v", ownOp)
	}
	retried, retryStatus := callUserStatus(t, f, bob, "POST", f.path("/operations/"+projectOp+"/retry"), core.Object{"version": opVersion}, "bob-retry")
	if retryStatus != 403 || retried.S("code") != "runtime_use_forbidden" || hasRuntimeContent(retried) {
		t.Fatalf("forbidden retry: status %d %v", retryStatus, retried)
	}
	must(t, f.store.Pool.QueryRow("SELECT state, version FROM operations WHERE id=$1", projectOp).Scan(&opStateAfter, &opVersionAfter))
	if opStateAfter != opState || opVersionAfter != opVersion {
		t.Fatal("forbidden retry changed the operation")
	}

	readDenied, readStatus := accessAs(t, f, bob, core.Object{"tenantId": f.tid, "workspaceId": mainID, "action": "read"})
	if readStatus != 403 || readDenied.S("code") != "runtime_use_forbidden" || hasRuntimeContent(readDenied) {
		t.Fatalf("access read: status %d %v", readStatus, readDenied)
	}
	execDenied, execStatus := accessAs(t, f, bob, core.Object{"tenantId": f.tid, "workspaceId": mainID, "action": "execute", "epoch": f.controller.Epoch})
	if execStatus != 403 || execDenied.S("code") != "runtime_use_forbidden" {
		t.Fatalf("access execute without permission: status %d %v", execStatus, execDenied)
	}

	if _, err = f.store.Pool.Exec("UPDATE workspaces SET creator_user_id=NULL, creator_resolution='unknown', creator_resolution_reason='missing', creator_source=NULL, creator_source_operation_id=NULL WHERE id=$1", bobRuntime); err != nil {
		t.Fatal(err)
	}
	unknownMember, unknownStatus := callUserStatus(t, f, bob, "GET", f.path("/workspaces/"+bobRuntime))
	if unknownStatus != 200 || unknownMember.B("contentAllowed") || hasRuntimeContent(unknownMember) || unknownMember.S("creatorResolution") != "unknown" {
		t.Fatalf("unknown creator stayed usable by the former creator: status %d %v", unknownStatus, unknownMember)
	}
	unknownAdmin := callUser(t, f, carol, "GET", f.path("/workspaces/"+bobRuntime), nil, "")
	if !unknownAdmin.B("contentAllowed") || unknownAdmin.S("baseCommitId") != f.commit {
		t.Fatalf("admin could not read an unknown creator runtime: %v", unknownAdmin)
	}
	if _, err = f.store.Pool.Exec("UPDATE workspaces SET creator_user_id=$2, creator_resolution='known', creator_resolution_reason=NULL, creator_source='create_workspace_operation', creator_source_operation_id=$3 WHERE id=$1", bobRuntime, bobID, bobOp); err != nil {
		t.Fatal(err)
	}

	firstID := uuid.NewString()
	admitted, admitStatus := admitAs(t, f, bob, core.Object{"tenantId": f.tid, "workspaceId": bobRuntime, "action": "execute", "ticketId": firstID, "kind": "task", "epoch": f.controller.Epoch})
	if admitStatus != 200 || admitted.S("actorUserId") != bobID {
		t.Fatalf("creator admission: status %d %v", admitStatus, admitted)
	}
	occupied, occupiedStatus := admitAs(t, f, bob, core.Object{"tenantId": f.tid, "workspaceId": bobRuntime, "action": "execute", "ticketId": uuid.NewString(), "kind": "task", "epoch": f.controller.Epoch})
	if occupiedStatus != 409 || occupied.S("code") != "resource_in_use" {
		t.Fatalf("occupied creator: status %d %v", occupiedStatus, occupied)
	}
	adminOccupied, adminOccupiedStatus := admitAs(t, f, carol, core.Object{"tenantId": f.tid, "workspaceId": bobRuntime, "action": "execute", "ticketId": uuid.NewString(), "kind": "task", "epoch": f.controller.Epoch})
	if adminOccupiedStatus != 409 || adminOccupied.S("code") != "resource_in_use" {
		t.Fatalf("occupied admin: status %d %v", adminOccupiedStatus, adminOccupied)
	}
	stranger, strangerStatus := admitAs(t, f, dave, core.Object{"tenantId": f.tid, "workspaceId": bobRuntime, "action": "execute", "ticketId": uuid.NewString(), "kind": "task", "epoch": f.controller.Epoch})
	if strangerStatus != 403 || stranger.S("code") != "runtime_use_forbidden" {
		t.Fatalf("occupied runtime without permission: status %d %v", strangerStatus, stranger)
	}
	if f.scalar("SELECT count(*) FROM execution_tickets WHERE workspace_id=$1 AND state='active'", bobRuntime) != 1 {
		t.Fatal("permission or occupancy refusal created another ticket")
	}

	space := f.fixtureSpace()
	stream := f.subscribe(t, bob, space.S("id"), 200)
	t.Cleanup(func() { stream.Body.Close() })
	f.call("PATCH", f.path("/spaces/"+space.S("id")), core.Object{"name": "Use Renamed", "description": "", "version": space.N("version")}, "", 200)
	if line := readEventLine(t, stream); !strings.Contains(line, "space.updated") || strings.Contains(line, "requestedRef") || strings.Contains(line, "baseCommitId") || strings.Contains(line, "repositoryUrl") {
		t.Fatalf("space event carried runtime content: %s", line)
	}

	demoted, demoteStatus := callUserStatus(t, f, carol, "PUT", f.path("/members/"+f.uid), core.Object{"role": "member", "status": "active", "version": 1}, "")
	if demoteStatus != 200 || demoted.S("role") != "member" {
		t.Fatalf("demote creator admin: status %d %v", demoteStatus, demoted)
	}
	former := callUser(t, f, f.user, "GET", f.path("/workspaces/"+bobRuntime), nil, "")
	if former.B("contentAllowed") || hasRuntimeContent(former) {
		t.Fatalf("demoted admin kept another runtime: %v", former)
	}
	stillOwn := callUser(t, f, f.user, "GET", f.path("/workspaces/"+mainID), nil, "")
	if !stillOwn.B("contentAllowed") || stillOwn.S("baseCommitId") != f.commit {
		t.Fatalf("demoted creator lost own runtime: %v", stillOwn)
	}
	demotedAccess, demotedAccessStatus := accessAs(t, f, f.user, core.Object{"tenantId": f.tid, "workspaceId": bobRuntime, "action": "read"})
	if demotedAccessStatus != 403 || demotedAccess.S("code") != "runtime_use_forbidden" {
		t.Fatalf("demoted access: status %d %v", demotedAccessStatus, demotedAccess)
	}

	disabled, disableStatus := callUserStatus(t, f, carol, "PUT", f.path("/members/"+bobID), core.Object{"role": "member", "status": "disabled", "version": 1}, "")
	if disableStatus != 200 || disabled.S("status") != "disabled" {
		t.Fatalf("disable creator: status %d %v", disableStatus, disabled)
	}
	gone, goneStatus := callUserStatus(t, f, bob, "GET", f.path("/workspaces/"+bobRuntime))
	if goneStatus != 403 || gone.S("code") != "membership_required" || hasRuntimeContent(gone) {
		t.Fatalf("disabled creator: status %d %v", goneStatus, gone)
	}
	goneAccess, goneAccessStatus := accessAs(t, f, bob, core.Object{"tenantId": f.tid, "workspaceId": bobRuntime, "action": "execute", "epoch": f.controller.Epoch})
	if goneAccessStatus != 403 || goneAccess.S("code") != "membership_required" {
		t.Fatalf("disabled access: status %d %v", goneAccessStatus, goneAccess)
	}
}

func callUser(t *testing.T, f *fixture, u core.Claims, method, path string, body core.Object, key string) core.Object {
	t.Helper()
	out, status := callUserStatus(t, f, u, method, path, body, key)
	if status != 200 && status != 202 {
		t.Fatalf("%s %s: want success got %d %v", method, path, status, out)
	}
	return out
}

func callUserStatus(t *testing.T, f *fixture, u core.Claims, method, path string, bodyAndKey ...any) (core.Object, int) {
	t.Helper()
	var body core.Object
	key := ""
	if len(bodyAndKey) > 0 && bodyAndKey[0] != nil {
		body = bodyAndKey[0].(core.Object)
	}
	if len(bodyAndKey) > 1 {
		key = bodyAndKey[1].(string)
	}
	gw := core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "gateway-a"}}
	out, status, err := f.client.Call(context.Background(), method, path, "gateway", gw, &u, key, body)
	must(t, err)
	return out, status
}

func accessAs(t *testing.T, f *fixture, u core.Claims, body core.Object) (core.Object, int) {
	t.Helper()
	out, status, err := f.client.Call(context.Background(), "POST", "/internal/v1/access", "controller", core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: f.client.Subject}}, &u, "", body)
	must(t, err)
	return out, status
}

func admitAs(t *testing.T, f *fixture, u core.Claims, body core.Object) (core.Object, int) {
	t.Helper()
	out, status, err := f.client.Call(context.Background(), "POST", "/internal/v1/admissions", "controller", core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: f.client.Subject}}, &u, "", body)
	must(t, err)
	return out, status
}

func runtimeItems(t *testing.T, list core.Object) []core.Object {
	t.Helper()
	raw, ok := list["items"].([]any)
	if !ok {
		t.Fatalf("runtime list: %v", list)
	}
	items := make([]core.Object, len(raw))
	for i, item := range raw {
		items[i] = core.Object(item.(map[string]any))
	}
	return items
}

func findRuntime(t *testing.T, items []core.Object, id string) core.Object {
	t.Helper()
	for _, item := range items {
		if item.S("id") == id {
			return item
		}
	}
	t.Fatalf("missing runtime %s in %v", id, items)
	return nil
}

func readEventLine(t *testing.T, res *http.Response) string {
	t.Helper()
	type lineOrError struct {
		line string
		err  error
	}
	lines := make(chan lineOrError, 1)
	go func() {
		line, err := bufio.NewReader(res.Body).ReadString('\n')
		lines <- lineOrError{line, err}
	}()
	select {
	case <-time.After(5 * time.Second):
		t.Fatal("no space event within 5s")
	case got := <-lines:
		if got.err != nil {
			t.Fatalf("stream ended before the space event: %v", got.err)
		}
		return got.line
	}
	return ""
}

func hasRuntimeContent(w core.Object) bool {
	if _, ok := w["requestedRef"]; ok {
		return true
	}
	if _, ok := w["baseCommitId"]; ok {
		return true
	}
	if _, ok := w["branchName"]; ok {
		return true
	}
	return false
}
