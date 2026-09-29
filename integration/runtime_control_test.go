package integration

import (
	"context"
	"sync"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/wanglongan587/cloud/internal/core"
)

// TestRuntimeControlLeaseIsExclusiveAndDatabaseTimed is the phase-3 session
// contract: one open session, a 60s database lease renewed on a 20s cadence,
// and idempotent replay that cannot revive an expired lease.
func TestRuntimeControlLeaseIsExclusiveAndDatabaseTimed(t *testing.T) {
	f := setup(t)
	created := f.create("control-lease")
	f.drain()
	wid := created.O("workspace").S("id")
	bob, _ := f.addUser(t, "bob-control", "Bob")
	carol, carolID := f.addUser(t, "carol-control", "Carol")

	denied, deniedStatus := callUserStatus(t, f, bob, "POST", f.path("/workspaces/"+wid+"/control"), core.Object{}, "bob-acquire")
	if deniedStatus != 403 || denied.S("code") != "runtime_use_forbidden" || len(denied.O("params")) != 0 {
		t.Fatalf("member acquire: status %d %v", deniedStatus, denied)
	}
	if f.openControlSessions(wid) != 0 {
		t.Fatal("forbidden acquire reserved a session")
	}
	overview, overviewStatus := callUserStatus(t, f, bob, "GET", f.path("/workspaces/"+wid+"/control"))
	if overviewStatus != 200 || overview.S("controlState") != "idle" || overview.B("callerHolds") || hasAction(overview, "acquire") || hasControlIdentity(overview) {
		t.Fatalf("overview control: status %d %v", overviewStatus, overview)
	}
	if overview.S("observedState") != "ready" {
		t.Fatalf("overview hid the lifecycle state: %v", overview)
	}
	spoofed, spoofStatus := callUserStatus(t, f, bob, "POST", f.path("/workspaces/"+wid+"/control"), core.Object{"controlEpoch": "2", "userId": uuid.NewString()}, "bob-spoof")
	if spoofStatus != 400 || spoofed.S("code") != "unknown_field" {
		t.Fatalf("client-supplied control identity: status %d %v", spoofStatus, spoofed)
	}

	first := f.call("POST", f.path("/workspaces/"+wid+"/control"), core.Object{}, "acquire-1", 200)
	if first.S("controlState") != "held" || first.S("sessionId") == "" || first.N("controlEpoch") != 1 || !first.B("callerHolds") || !hasAction(first, "renew") || hasAction(first, "acquire") {
		t.Fatalf("acquire: %v", first)
	}
	assertFreshLease(t, f, first.S("sessionId"))
	if f.openControlSessions(wid) != 1 {
		t.Fatal("acquire did not leave one open session")
	}
	second, secondStatus := callUserStatus(t, f, f.user, "POST", f.path("/workspaces/"+wid+"/control"), core.Object{}, "acquire-2")
	if secondStatus != 409 || second.S("code") != "resource_in_use" || f.openControlSessions(wid) != 1 {
		t.Fatalf("second page: status %d %v sessions %d", secondStatus, second, f.openControlSessions(wid))
	}

	renewed := f.call("POST", f.path("/workspaces/"+wid+"/control/renew"), core.Object{"sessionId": first.S("sessionId")}, "renew-1", 200)
	if renewed.S("sessionId") != first.S("sessionId") || renewed.N("controlEpoch") != 1 || renewed.S("controlState") != "held" {
		t.Fatalf("renew changed the binding: %v", renewed)
	}
	assertFreshLease(t, f, first.S("sessionId"))
	conflict, conflictStatus := callUserStatus(t, f, f.user, "POST", f.path("/workspaces/"+wid+"/control/renew"), core.Object{"sessionId": uuid.NewString()}, "renew-1")
	if conflictStatus != 409 || conflict.S("code") != "idempotency_conflict" {
		t.Fatalf("renew input conflict: status %d %v", conflictStatus, conflict)
	}
	if _, err := f.store.Pool.Exec("UPDATE runtime_control_sessions SET expires_at=clock_timestamp()+interval '10 seconds' WHERE id=$1", first.S("sessionId")); err != nil {
		t.Fatal(err)
	}
	replay := f.call("POST", f.path("/workspaces/"+wid+"/control/renew"), core.Object{"sessionId": first.S("sessionId")}, "renew-1", 200)
	if replay.S("sessionId") != first.S("sessionId") || !leaseShorterThan(t, f, first.S("sessionId"), "30 seconds") {
		t.Fatalf("idempotent renew extended the lease: %v", replay)
	}

	if _, err := f.store.Pool.Exec("UPDATE runtime_control_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", first.S("sessionId")); err != nil {
		t.Fatal(err)
	}
	late, lateStatus := callUserStatus(t, f, f.user, "POST", f.path("/workspaces/"+wid+"/control/renew"), core.Object{"sessionId": first.S("sessionId")}, "late-renew")
	if lateStatus != 409 || (late.S("code") != "control_required" && late.S("code") != "control_not_held") || !leaseInThePast(t, f, first.S("sessionId")) {
		t.Fatalf("late renew: status %d %v", lateStatus, late)
	}
	// The stored acquire result is replayed and must not open a new lease.
	stored := f.call("POST", f.path("/workspaces/"+wid+"/control"), core.Object{}, "acquire-1", 200)
	if stored.S("sessionId") != first.S("sessionId") || stored.S("controlState") != "held" || !leaseInThePast(t, f, first.S("sessionId")) || f.openControlSessions(wid) != 1 {
		t.Fatalf("stored acquire revived or replaced the expired lease: %v", stored)
	}
	after := f.call("GET", f.path("/workspaces/"+wid+"/control"), nil, "", 200)
	if after.S("controlState") != "idle" || after.S("observedState") != "ready" || f.openControlSessions(wid) != 0 {
		t.Fatalf("expiry was read as a live lease or a stopped process: %v", after)
	}
	if f.ws(wid).S("observedState") != "ready" {
		t.Fatal("database expiry stopped the runtime")
	}
	again := f.call("POST", f.path("/workspaces/"+wid+"/control"), core.Object{}, "acquire-3", 200)
	if again.N("controlEpoch") != 2 || again.S("sessionId") == first.S("sessionId") || again.S("controlState") != "held" {
		t.Fatalf("reacquire: %v", again)
	}
	f.call("POST", f.path("/workspaces/"+wid+"/control/release"), core.Object{"sessionId": again.S("sessionId")}, "release-1", 200)
	if f.openControlSessions(wid) != 0 {
		t.Fatal("clean release left an open session")
	}
	f.call("PUT", f.path("/members/"+carolID), core.Object{"role": "admin", "status": "active", "version": 1}, "", 200)
	var wg sync.WaitGroup
	statuses := make([]int, 2)
	winners := make([]core.Object, 2)
	callers := []core.Claims{f.user, carol}
	for i, key := range []string{"race-alice", "race-carol"} {
		wg.Add(1)
		go func(i int, key string) {
			defer wg.Done()
			caller := callers[i]
			out, status, err := f.client.Call(context.Background(), "POST", f.path("/workspaces/"+wid+"/control"), "gateway", core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "gateway-a"}}, &caller, key, core.Object{})
			if err != nil {
				t.Errorf("race %s: %v", key, err)
				return
			}
			statuses[i] = status
			winners[i] = out
		}(i, key)
	}
	wg.Wait()
	if !exactlyOne(statuses, 200, 409) || f.openControlSessions(wid) != 1 {
		t.Fatalf("concurrent acquire statuses %v sessions %d", statuses, f.openControlSessions(wid))
	}
	var held core.Object
	for i, status := range statuses {
		if status == 200 {
			held = winners[i]
		} else if winners[i].S("code") != "resource_in_use" {
			t.Fatalf("loser: %v", winners[i])
		}
	}
	if held.N("controlEpoch") != 3 || held.S("controlState") != "held" {
		t.Fatalf("winner: %v", held)
	}
	var holder string
	var memberVersion int64
	must(t, f.store.Pool.QueryRow("SELECT s.holder_user_id::text, m.version FROM runtime_control_sessions s JOIN tenant_memberships m ON m.tenant_id=s.tenant_id AND m.user_id=s.holder_user_id WHERE s.id=$1", held.S("sessionId")).Scan(&holder, &memberVersion))
	actor := f.user
	if holder == f.uid {
		actor = carol
	}
	disabled, disabledStatus := callUserStatus(t, f, actor, "PUT", f.path("/members/"+holder), core.Object{"role": "member", "status": "disabled", "version": memberVersion}, "")
	var observed string
	must(t, f.store.Pool.QueryRow("SELECT observed_state FROM workspaces WHERE id=$1", wid).Scan(&observed))
	if disabledStatus != 200 || disabled.S("status") != "disabled" || f.openControlSessions(wid) != 0 || observed != "ready" {
		t.Fatalf("disabling the holder: status %d %v sessions %d runtime %s", disabledStatus, disabled, f.openControlSessions(wid), observed)
	}
}

// TestControlStatesStayDistinctFromIdle covers acquiring, winding down and
// reconciliation. None of those states is reported as idle, and a database
// expiry does not change the runtime's observed state.
func TestControlStatesStayDistinctFromIdle(t *testing.T) {
	f := setup(t)
	created := f.create("control-states")
	f.drain()
	wid := created.O("workspace").S("id")
	ticketID := uuid.NewString()
	admitted, admitStatus := admitAs(t, f, f.user, core.Object{"tenantId": f.tid, "workspaceId": wid, "action": "execute", "ticketId": ticketID, "kind": "task", "epoch": f.controller.Epoch})
	if admitStatus != 200 {
		t.Fatalf("admit: status %d %v", admitStatus, admitted)
	}
	blocked := f.call("GET", f.path("/workspaces/"+wid+"/control"), nil, "", 200)
	if blocked.S("controlState") == "idle" || blocked.S("observedState") != "ready" {
		t.Fatalf("active ticket read as idle: %v", blocked)
	}
	reserved := f.call("POST", f.path("/workspaces/"+wid+"/control"), core.Object{}, "acquire-busy", 200)
	if reserved.S("controlState") != "acquiring" || hasAction(reserved, "write") || hasAction(reserved, "start") {
		t.Fatalf("acquire while executing: %v", reserved)
	}
	before := f.scalar("SELECT count(*) FROM operations WHERE workspace_id=$1", wid)
	refused := f.call("POST", f.path("/workspaces/"+wid+"/start"), core.Object{"version": f.ws(wid).N("version"), "sessionId": reserved.S("sessionId")}, "start-while-acquiring", 409)
	if refused.S("code") != "control_not_held" || f.scalar("SELECT count(*) FROM operations WHERE workspace_id=$1", wid) != before {
		t.Fatalf("acquiring allowed a lifecycle write: %v", refused)
	}
	f.finishTicket(ticketID, f.node(wid))
	promoted := f.call("POST", f.path("/workspaces/"+wid+"/control/renew"), core.Object{"sessionId": reserved.S("sessionId")}, "confirm-held", 200)
	if promoted.S("controlState") != "held" || promoted.N("controlEpoch") != reserved.N("controlEpoch") {
		t.Fatalf("confirmation: %v", promoted)
	}

	f.call("POST", f.path("/workspaces/"+wid+"/control/activities"), core.Object{"sessionId": promoted.S("sessionId")}, "write-1", 200)
	if _, err := f.store.Pool.Exec("UPDATE runtime_control_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", promoted.S("sessionId")); err != nil {
		t.Fatal(err)
	}
	expired := f.call("GET", f.path("/workspaces/"+wid+"/control"), nil, "", 200)
	if expired.S("controlState") == "idle" || expired.S("controlState") == "held" || expired.S("observedState") != "ready" {
		t.Fatalf("expired busy session: %v", expired)
	}
	if f.ws(wid).S("observedState") != "ready" {
		t.Fatal("expiry with an open activity stopped the runtime")
	}
}

// TestOneConflictingWriteAndLifecycleUseTheHeldSession covers the single write
// slot and the ordinary start, stop, restart and delete gates.
func TestOneConflictingWriteAndLifecycleUseTheHeldSession(t *testing.T) {
	f := setup(t)
	created := f.create("control-lifecycle")
	f.drain()
	pid, mainID := created.O("resource").S("id"), created.O("workspace").S("id")
	bob, _ := f.addUser(t, "bob-life", "Bob")
	isolated := callUser(t, f, bob, "POST", f.path("/projects/"+pid+"/workspaces"), core.Object{"title": "Bob runtime", "baseRef": "main"}, "bob-runtime")
	bobRuntime := isolated.O("resource").S("id")
	f.drain()

	missing := f.call("POST", f.path("/workspaces/"+mainID+"/stop"), core.Object{"version": f.ws(mainID).N("version")}, "stop-without-session", 409)
	if missing.S("code") != "control_required" || !f.ws(mainID).B("admissionOpen") {
		t.Fatalf("stop without a session: %v admission %v", missing, f.ws(mainID).B("admissionOpen"))
	}
	forbidden, forbiddenStatus := callUserStatus(t, f, bob, "POST", f.path("/workspaces/"+mainID+"/stop"), core.Object{"version": f.ws(mainID).N("version"), "sessionId": uuid.NewString()}, "bob-stop-main")
	if forbiddenStatus != 403 || forbidden.S("code") != "runtime_use_forbidden" {
		t.Fatalf("stop without use: status %d %v", forbiddenStatus, forbidden)
	}

	mainSession := f.hold(mainID, "hold-main")
	mainDelete := f.call("DELETE", f.path("/workspaces/"+mainID), core.Object{"version": f.ws(mainID).N("version"), "sessionId": mainSession}, "delete-main", 409)
	if mainDelete.S("code") != "main_workspace_required" {
		t.Fatalf("held main delete: %v", mainDelete)
	}
	stop := f.call("POST", f.path("/workspaces/"+mainID+"/stop"), core.Object{"version": f.ws(mainID).N("version"), "sessionId": mainSession}, "stop-main", 202)
	if stop.O("operation").S("kind") != "stop" {
		t.Fatalf("ordinary stop kind: %v", stop.O("operation"))
	}
	f.drain()
	if f.ws(mainID).S("observedState") != "stopped" {
		t.Fatal("held stop did not stop")
	}
	restart := f.call("POST", f.path("/workspaces/"+mainID+"/start"), core.Object{"version": f.ws(mainID).N("version"), "sessionId": mainSession}, "restart-main", 202)
	if restart.O("operation").S("kind") != "start" {
		t.Fatalf("restart kind: %v", restart.O("operation"))
	}
	f.drain()
	if f.ws(mainID).N("runtimeGeneration") != 2 || f.ws(mainID).S("observedState") != "ready" {
		t.Fatalf("restart: %v", f.ws(mainID))
	}

	bobSession := callUser(t, f, bob, "POST", f.path("/workspaces/"+bobRuntime+"/control"), core.Object{}, "bob-hold").S("sessionId")
	ops := f.scalar("SELECT count(*) FROM operations WHERE workspace_id=$1", bobRuntime)
	firstWrite := callUser(t, f, bob, "POST", f.path("/workspaces/"+bobRuntime+"/control/activities"), core.Object{"sessionId": bobSession}, "bob-write")
	if firstWrite.S("controlState") != "held" || hasAction(firstWrite, "write") {
		t.Fatalf("first write: %v", firstWrite)
	}
	secondWrite, secondStatus := callUserStatus(t, f, bob, "POST", f.path("/workspaces/"+bobRuntime+"/control/activities"), core.Object{"sessionId": bobSession}, "bob-write-2")
	if secondStatus != 409 || secondWrite.S("code") != "resource_in_use" || f.scalar("SELECT count(*) FROM runtime_write_activities WHERE workspace_id=$1 AND state IN ('active','unknown')", bobRuntime) != 1 {
		t.Fatalf("second write: status %d %v", secondStatus, secondWrite)
	}
	if f.scalar("SELECT count(*) FROM operations WHERE workspace_id=$1", bobRuntime) != ops {
		t.Fatal("rejected write created an operation")
	}
	winding := callUser(t, f, bob, "POST", f.path("/workspaces/"+bobRuntime+"/control/release"), core.Object{"sessionId": bobSession}, "bob-release")
	if winding.S("controlState") != "winding_down" {
		t.Fatalf("release with a write: %v", winding)
	}
	again, againStatus := callUserStatus(t, f, bob, "POST", f.path("/workspaces/"+bobRuntime+"/control"), core.Object{}, "bob-reacquire")
	if againStatus != 409 || again.S("code") != "resource_in_use" {
		t.Fatalf("acquire during winding down: status %d %v", againStatus, again)
	}
	if _, err := f.store.Pool.Exec("UPDATE runtime_write_activities SET state='unknown', finished_at=NULL, updated_at=clock_timestamp() WHERE workspace_id=$1 AND state='active'", bobRuntime); err != nil {
		t.Fatal(err)
	}
	unknown := callUser(t, f, bob, "GET", f.path("/workspaces/"+bobRuntime+"/control"), nil, "")
	if unknown.S("controlState") != "reconciling" || unknown.S("observedState") == "stopped" {
		t.Fatalf("unknown execution: %v", unknown)
	}
	if _, err := f.store.Pool.Exec("UPDATE runtime_write_activities SET state='finished', finished_at=clock_timestamp(), updated_at=clock_timestamp() WHERE workspace_id=$1", bobRuntime); err != nil {
		t.Fatal(err)
	}
	idle := callUser(t, f, bob, "GET", f.path("/workspaces/"+bobRuntime+"/control"), nil, "")
	if idle.S("controlState") != "idle" {
		t.Fatalf("finished activity did not complete handoff: %v", idle)
	}
	if f.ws(bobRuntime).S("observedState") != "ready" {
		t.Fatal("handoff stopped the runtime")
	}
	next := callUser(t, f, bob, "POST", f.path("/workspaces/"+bobRuntime+"/control"), core.Object{}, "bob-next")
	if next.N("controlEpoch") != 2 || next.S("controlState") != "held" {
		t.Fatalf("next epoch: %v", next)
	}
	removed := callUser(t, f, bob, "DELETE", f.path("/workspaces/"+bobRuntime), core.Object{"version": f.ws(bobRuntime).N("version"), "sessionId": next.S("sessionId")}, "bob-delete")
	if removed.O("operation").S("kind") != "delete_workspace" {
		t.Fatalf("creator delete: %v", removed.O("operation"))
	}
}

func (f *fixture) hold(wid, key string) string {
	f.t.Helper()
	got := f.call("POST", f.path("/workspaces/"+wid+"/control"), core.Object{}, key, 200)
	if got.S("controlState") != "held" || got.S("sessionId") == "" {
		f.t.Fatalf("hold %s: %v", wid, got)
	}
	return got.S("sessionId")
}

func (f *fixture) openControlSessions(wid string) int {
	f.t.Helper()
	return f.scalar("SELECT count(*) FROM runtime_control_sessions WHERE workspace_id=$1 AND state IN ('acquiring','held','winding_down','reconciling')", wid)
}

func assertFreshLease(t *testing.T, f *fixture, sessionID string) {
	t.Helper()
	var ok bool
	must(t, f.store.Pool.QueryRow("SELECT expires_at > clock_timestamp() + interval '30 seconds' AND expires_at <= clock_timestamp() + interval '60 seconds' FROM runtime_control_sessions WHERE id=$1", sessionID).Scan(&ok))
	if !ok {
		t.Fatalf("session %s does not have a fresh 60s database lease", sessionID)
	}
}

func leaseShorterThan(t *testing.T, f *fixture, sessionID, window string) bool {
	t.Helper()
	var ok bool
	must(t, f.store.Pool.QueryRow("SELECT expires_at < clock_timestamp() + $2::interval FROM runtime_control_sessions WHERE id=$1", sessionID, window).Scan(&ok))
	return ok
}

func leaseInThePast(t *testing.T, f *fixture, sessionID string) bool {
	t.Helper()
	var ok bool
	must(t, f.store.Pool.QueryRow("SELECT expires_at < clock_timestamp() FROM runtime_control_sessions WHERE id=$1", sessionID).Scan(&ok))
	return ok
}

func hasAction(o core.Object, name string) bool {
	raw, _ := o["allowedActions"].([]any)
	for _, item := range raw {
		if item == name {
			return true
		}
	}
	return false
}

func hasControlIdentity(o core.Object) bool {
	_, session := o["sessionId"]
	_, holder := o["holderUserId"]
	_, epoch := o["controlEpoch"]
	return session || holder || epoch
}

func exactlyOne(statuses []int, ok, conflict int) bool {
	wins, losses := 0, 0
	for _, status := range statuses {
		switch status {
		case ok:
			wins++
		case conflict:
			losses++
		default:
			return false
		}
	}
	return wins == 1 && losses == 1
}
