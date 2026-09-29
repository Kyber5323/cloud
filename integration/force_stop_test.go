package integration

import (
	"context"
	"database/sql"
	"strings"
	"sync"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/wanglongan587/cloud/internal/core"
)

// TestForceStopIntentIsAdminScoped records one audited intent. administrative_stop
// stays the activity-protected stop, and the initiator leaving does not drop it.
func TestForceStopIntentIsAdminScoped(t *testing.T) {
	f := setup(t)
	created := f.create("force-stop-auth")
	f.drain()
	pid, mainID := created.O("resource").S("id"), created.O("workspace").S("id")
	bob, _ := f.addUser(t, "bob-force", "Bob")
	carol, carolID := f.addUser(t, "carol-force", "Carol")
	f.call("PUT", f.path("/members/"+carolID), core.Object{"role": "admin", "status": "active", "version": 1}, "", 200)
	isolated := f.call("POST", f.path("/projects/"+pid+"/workspaces"), core.Object{"title": "Isolated", "baseRef": "main"}, "force-isolated", 202)
	target := isolated.O("resource").S("id")
	f.drain()
	raceRuntime := f.call("POST", f.path("/projects/"+pid+"/workspaces"), core.Object{"title": "Race", "baseRef": "main"}, "force-race-runtime", 202).O("resource").S("id")
	f.drain()

	denied, deniedStatus := callUserStatus(t, f, bob, "POST", f.path("/workspaces/"+target+"/force-stop"), core.Object{"version": f.ws(target).N("version"), "reason": "member"}, "bob-force")
	if deniedStatus != 403 || denied.S("code") != "admin_required" || f.forceStopCount(target) != 0 {
		t.Fatalf("member force-stop: status %d %v", deniedStatus, denied)
	}
	blank, blankStatus := callUserStatus(t, f, f.user, "POST", f.path("/workspaces/"+target+"/force-stop"), core.Object{"version": f.ws(target).N("version"), "reason": "  "}, "blank-force")
	if blankStatus != 400 || blank.S("code") != "invalid_input" || f.forceStopCount(target) != 0 {
		t.Fatalf("blank reason: status %d %v", blankStatus, blank)
	}
	missing, missingStatus := callUserStatus(t, f, f.user, "POST", f.path("/workspaces/"+target+"/force-stop"), core.Object{"reason": "because"}, "missing-version")
	if missingStatus != 428 || missing.S("code") != "version_required" || f.forceStopCount(target) != 0 {
		t.Fatalf("missing version: status %d %v", missingStatus, missing)
	}
	stale, staleStatus := callUserStatus(t, f, f.user, "POST", f.path("/workspaces/"+target+"/force-stop"), core.Object{"version": f.ws(target).N("version") + 9, "reason": "because"}, "stale-version")
	if staleStatus != 409 || stale.S("code") != "version_conflict" || f.forceStopCount(target) != 0 {
		t.Fatalf("stale version: status %d %v", staleStatus, stale)
	}

	ticketID := uuid.NewString()
	if admitted, status := admitAs(t, f, f.user, core.Object{"tenantId": f.tid, "workspaceId": mainID, "action": "execute", "ticketId": ticketID, "kind": "task", "epoch": f.controller.Epoch}); status != 200 {
		t.Fatalf("admit: status %d %v", status, admitted)
	}
	ops := f.scalar("SELECT count(*) FROM operations WHERE project_id=$1", pid)
	protected, protectedStatus := callUserStatus(t, f, f.user, "POST", f.path("/workspaces/"+mainID+"/administrative-stop"), core.Object{"version": f.ws(mainID).N("version")}, "admin-busy")
	if protectedStatus != 409 || protected.S("code") != "resource_in_use" || f.scalar("SELECT count(*) FROM operations WHERE project_id=$1", pid) != ops || f.forceStopCount(mainID) != 0 {
		t.Fatalf("administrative stop with activity: status %d %v", protectedStatus, protected)
	}
	f.finishTicket(ticketID, f.node(mainID))
	var actorBefore string
	must(t, f.store.Pool.QueryRow("SELECT actor_user_id::text FROM execution_tickets WHERE id=$1", ticketID).Scan(&actorBefore))
	adminStop := f.call("POST", f.path("/workspaces/"+mainID+"/administrative-stop"), core.Object{"version": f.ws(mainID).N("version")}, "admin-stop", 202)
	if adminStop.O("operation").S("kind") != "administrative_stop" || f.forceStopCount(mainID) != 0 {
		t.Fatalf("administrative stop changed meaning: %v", adminStop.O("operation"))
	}
	adminOp := adminStop.O("operation").S("id")

	session := f.hold(target, "hold-target")
	beforeOps := f.scalar("SELECT count(*) FROM operations")
	generation := f.ws(target).N("runtimeGeneration")
	observed := f.ws(target).S("observedState")
	acceptedVersion := f.ws(target).N("version")
	intent := f.call("POST", f.path("/workspaces/"+target+"/force-stop"), core.Object{"version": acceptedVersion, "reason": "controller lost"}, "force-target", 202)
	if intent.S("state") != "requested" || intent.S("workspaceId") != target || intent.S("initiatorUserId") != f.uid || intent.N("targetRuntimeGeneration") != generation || intent.S("reason") != "controller lost" {
		t.Fatalf("accepted intent: %v", intent)
	}
	var sessionState string
	must(t, f.store.Pool.QueryRow("SELECT state FROM runtime_control_sessions WHERE id=$1", session).Scan(&sessionState))
	if f.ws(target).S("observedState") != observed || f.ws(target).B("admissionOpen") || f.openControlSessions(target) != 0 || sessionState != "closed" {
		t.Fatalf("acceptance stopped the runtime or left the session %s: %v", sessionState, f.ws(target))
	}
	if f.scalar("SELECT count(*) FROM operations") != beforeOps {
		t.Fatal("force-stop created an operation")
	}
	var adminKind, adminActor string
	must(t, f.store.Pool.QueryRow("SELECT kind, actor_user_id::text FROM operations WHERE id=$1", adminOp).Scan(&adminKind, &adminActor))
	if adminKind != "administrative_stop" || adminActor != f.uid {
		t.Fatalf("in-flight administrative stop was rewritten: %s %s", adminKind, adminActor)
	}
	var ticketActor, ticketState string
	must(t, f.store.Pool.QueryRow("SELECT actor_user_id::text, state FROM execution_tickets WHERE id=$1", ticketID).Scan(&ticketActor, &ticketState))
	if ticketActor != actorBefore || ticketState != "finished" {
		t.Fatalf("ticket actor or result changed: %s %s", ticketActor, ticketState)
	}
	replay := f.call("POST", f.path("/workspaces/"+target+"/force-stop"), core.Object{"version": acceptedVersion, "reason": "controller lost"}, "force-target", 202)
	if replay.S("id") != intent.S("id") || replay.S("state") != "requested" || f.forceStopCount(target) != 1 {
		t.Fatalf("replay: %v", replay)
	}
	conflict, conflictStatus := callUserStatus(t, f, f.user, "POST", f.path("/workspaces/"+target+"/force-stop"), core.Object{"version": f.ws(target).N("version"), "reason": "different"}, "force-target")
	if conflictStatus != 409 || conflict.S("code") != "idempotency_conflict" || f.forceStopCount(target) != 1 {
		t.Fatalf("same key different reason: status %d %v", conflictStatus, conflict)
	}

	f.raceForceStop(t, carol, raceRuntime)
	gw := core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "gateway-a"}}
	otherTenant, otherTenantStatus, err := f.client.Call(context.Background(), "POST", "/api/v1/tenants", "gateway", gw, &f.user, "other-force-tenant", core.Object{"name": "Other", "slug": "other-force-stop"})
	must(t, err)
	if otherTenantStatus != 201 {
		t.Fatalf("second tenant: %d %v", otherTenantStatus, otherTenant)
	}
	cross, crossStatus := callUserStatus(t, f, f.user, "POST", "/api/v1/tenants/"+otherTenant.O("tenant").S("id")+"/workspaces/"+target+"/force-stop", core.Object{"version": f.ws(target).N("version"), "reason": "cross tenant"}, "cross-force")
	if crossStatus != 404 || f.forceStopCount(target) != 1 {
		t.Fatalf("cross-tenant force-stop: status %d %v", crossStatus, cross)
	}

	var memberVersion int64
	must(t, f.store.Pool.QueryRow("SELECT version FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2", f.tid, f.uid).Scan(&memberVersion))
	disabled, disabledStatus := callUserStatus(t, f, carol, "PUT", f.path("/members/"+f.uid), core.Object{"role": "member", "status": "disabled", "version": memberVersion}, "")
	var still string
	must(t, f.store.Pool.QueryRow("SELECT state FROM runtime_force_stop_intents WHERE id=$1", intent.S("id")).Scan(&still))
	if disabledStatus != 200 || still != "requested" {
		t.Fatalf("initiator left: status %d intent %s body %v", disabledStatus, still, disabled)
	}
	currentVersion := f.workspaceVersion(target)
	again, againStatus := callUserStatus(t, f, f.user, "POST", f.path("/workspaces/"+target+"/force-stop"), core.Object{"version": currentVersion, "reason": "again"}, "alice-after")
	if againStatus != 403 || f.forceStopCount(target) != 1 {
		t.Fatalf("disabled initiator: status %d %v", againStatus, again)
	}
	other, otherStatus := callUserStatus(t, f, carol, "POST", f.path("/workspaces/"+target+"/force-stop"), core.Object{"version": currentVersion, "reason": "second admin"}, "carol-second")
	if otherStatus != 409 || other.S("code") != "resource_in_use" || f.forceStopCount(target) != 1 {
		t.Fatalf("second administrator: status %d %v", otherStatus, other)
	}

	var creator string
	must(t, f.store.Pool.QueryRow("SELECT creator_user_id::text FROM workspaces WHERE id=$1", target).Scan(&creator))
	if creator != f.uid {
		t.Fatalf("creator rewritten: %s", creator)
	}
	if _, status := callUserStatus(t, f, carol, "POST", f.path("/workspaces/"+uuid.NewString()+"/force-stop"), core.Object{"version": 1, "reason": "missing"}, "missing-runtime"); status != 404 {
		t.Fatalf("missing runtime status %d", status)
	}
}

// TestForceStopBlocksHandoffRestartAndDelete keeps takeover, restart and data
// deletion closed, and project deletion refuses every runtime without force-stopping.
func TestForceStopBlocksHandoffRestartAndDelete(t *testing.T) {
	f := setup(t)
	created := f.create("force-stop-block")
	f.drain()
	pid, mainID := created.O("resource").S("id"), created.O("workspace").S("id")
	bob, _ := f.addUser(t, "bob-block", "Bob")
	isolated := callUser(t, f, bob, "POST", f.path("/projects/"+pid+"/workspaces"), core.Object{"title": "Bob runtime", "baseRef": "main"}, "bob-block-runtime")
	bobRuntime := isolated.O("resource").S("id")
	f.drain()
	mainOpen, mainEpoch, mainObserved := f.runtimeFact(mainID)
	bobOpen, bobEpoch, bobObserved := f.runtimeFact(bobRuntime)

	bobSession := callUser(t, f, bob, "POST", f.path("/workspaces/"+bobRuntime+"/control"), core.Object{}, "bob-block-hold").S("sessionId")
	blocked := f.deleteProject(pid, 409)
	if blocked.S("code") != "resource_in_use" || f.projectLifecycle(pid) != "active" || f.scalar("SELECT count(*) FROM operations WHERE project_id=$1 AND kind='delete_project'", pid) != 0 || f.forceStopCount(mainID)+f.forceStopCount(bobRuntime) != 0 {
		t.Fatalf("occupied project delete: %v", blocked)
	}
	if open, epoch, observed := f.runtimeFact(mainID); open != mainOpen || epoch != mainEpoch || observed != mainObserved {
		t.Fatalf("project delete changed main: %v %d %s", open, epoch, observed)
	}
	if open, epoch, observed := f.runtimeFact(bobRuntime); open != bobOpen || epoch != bobEpoch || observed != bobObserved {
		t.Fatalf("project delete changed the occupied runtime: %v %d %s", open, epoch, observed)
	}
	callUser(t, f, bob, "POST", f.path("/workspaces/"+bobRuntime+"/control/release"), core.Object{"sessionId": bobSession}, "bob-block-release")
	unknownSession := callUser(t, f, bob, "POST", f.path("/workspaces/"+bobRuntime+"/control"), core.Object{}, "bob-unknown-hold").S("sessionId")
	callUser(t, f, bob, "POST", f.path("/workspaces/"+bobRuntime+"/control/activities"), core.Object{"sessionId": unknownSession}, "bob-unknown-write")
	if _, err := f.store.Pool.Exec("UPDATE runtime_write_activities SET state='unknown', finished_at=NULL, updated_at=clock_timestamp() WHERE workspace_id=$1 AND state='active'", bobRuntime); err != nil {
		t.Fatal(err)
	}
	if unknown := f.deleteProject(pid, 409); unknown.S("code") != "resource_in_use" || f.projectLifecycle(pid) != "active" {
		t.Fatalf("unknown write did not block project delete: %v", unknown)
	}
	if _, err := f.store.Pool.Exec("UPDATE runtime_write_activities SET state='finished', finished_at=clock_timestamp(), updated_at=clock_timestamp() WHERE workspace_id=$1", bobRuntime); err != nil {
		t.Fatal(err)
	}
	callUser(t, f, bob, "POST", f.path("/workspaces/"+bobRuntime+"/control/release"), core.Object{"sessionId": unknownSession}, "bob-unknown-release")

	ticketID := uuid.NewString()
	if _, status := admitAs(t, f, f.user, core.Object{"tenantId": f.tid, "workspaceId": mainID, "action": "execute", "ticketId": ticketID, "kind": "task", "epoch": f.controller.Epoch}); status != 200 {
		t.Fatalf("admit status %d", status)
	}
	if busy := f.deleteProject(pid, 409); busy.S("code") != "resource_in_use" || f.projectLifecycle(pid) != "active" {
		t.Fatalf("active ticket did not block project delete: %v", busy)
	}
	f.finishTicket(ticketID, f.node(mainID))

	mainSession := f.hold(mainID, "hold-main-block")
	stop := f.call("POST", f.path("/workspaces/"+mainID+"/stop"), core.Object{"version": f.ws(mainID).N("version"), "sessionId": mainSession}, "stop-before-force", 202)
	if stop.O("operation").S("kind") != "stop" {
		t.Fatalf("ordinary stop: %v", stop.O("operation"))
	}
	f.drain()
	if f.ws(mainID).S("observedState") != "stopped" {
		t.Fatal("ordinary stop did not stop")
	}
	intent := f.forceStop(mainID, "unconfirmed termination", "force-main-block")
	restart, restartStatus := callUserStatus(t, f, f.user, "POST", f.path("/workspaces/"+mainID+"/start"), core.Object{"version": f.ws(mainID).N("version"), "sessionId": mainSession}, "restart-during-force")
	if restartStatus != 409 || restart.S("code") != "termination_unconfirmed" || f.ws(mainID).S("observedState") != "stopped" {
		t.Fatalf("restart: status %d %v runtime %s", restartStatus, restart, f.ws(mainID).S("observedState"))
	}
	removed, removedStatus := callUserStatus(t, f, f.user, "DELETE", f.path("/workspaces/"+mainID), core.Object{"version": f.ws(mainID).N("version"), "sessionId": mainSession}, "delete-during-force")
	if removedStatus != 409 || removed.S("code") != "termination_unconfirmed" || f.scalar("SELECT count(*) FROM external_effects WHERE workspace_id=$1 AND kind='workspace_data_delete'", mainID) != 0 {
		t.Fatalf("data delete: status %d %v", removedStatus, removed)
	}
	acquire, acquireStatus := callUserStatus(t, f, f.user, "POST", f.path("/workspaces/"+mainID+"/control"), core.Object{}, "acquire-during-force")
	if acquireStatus != 409 || acquire.S("code") != "termination_unconfirmed" || f.openControlSessions(mainID) != 0 || !f.forceStopOpen(intent.S("id")) {
		t.Fatalf("takeover: status %d %v", acquireStatus, acquire)
	}
	var intentState string
	must(t, f.store.Pool.QueryRow("SELECT state FROM runtime_force_stop_intents WHERE id=$1", intent.S("id")).Scan(&intentState))
	if intentState != "requested" {
		t.Fatalf("observed stop completed the force-stop: %s", intentState)
	}

	other := f.hold(bobRuntime, "hold-other")
	otherStop := f.call("POST", f.path("/workspaces/"+bobRuntime+"/stop"), core.Object{"version": f.ws(bobRuntime).N("version"), "sessionId": other}, "stop-other", 202)
	if otherStop.O("operation").S("kind") != "stop" {
		t.Fatalf("other runtime stop: %v", otherStop.O("operation"))
	}
	f.drain()
	if f.ws(bobRuntime).S("observedState") != "stopped" || !f.forceStopOpen(intent.S("id")) {
		t.Fatal("stopping the other runtime changed the force-stop")
	}
	f.call("POST", f.path("/workspaces/"+bobRuntime+"/control/release"), core.Object{"sessionId": other}, "release-other", 200)
	if f.openControlSessions(bobRuntime) != 0 || f.openControlSessions(mainID) != 0 {
		t.Fatal("a control session still occupied a runtime")
	}
	refused := f.deleteProject(pid, 409)
	if refused.S("code") != "termination_unconfirmed" || f.projectLifecycle(pid) != "active" || f.scalar("SELECT count(*) FROM operations WHERE project_id=$1 AND kind='delete_project'", pid) != 0 || f.forceStopCount(mainID) != 1 {
		t.Fatalf("project delete auto-stopped or partially deleted: %v", refused)
	}
}

// TestForceStopDuringInflightWorkStaysOnOneRuntime registers the intent beside
// another runtime's create and refuses a late sandbox for the target itself.
func TestForceStopDuringInflightWorkStaysOnOneRuntime(t *testing.T) {
	f := setup(t)
	created := f.create("force-stop-inflight")
	f.drain()
	pid, mainID := created.O("resource").S("id"), created.O("workspace").S("id")
	pending := f.call("POST", f.path("/projects/"+pid+"/workspaces"), core.Object{"title": "Pending", "baseRef": "main"}, "pending-runtime", 202)
	otherID := pending.O("resource").S("id")
	otherOp := pending.O("operation").S("id")
	var otherState, otherActor, otherKind string
	must(t, f.store.Pool.QueryRow("SELECT state, actor_user_id::text, kind FROM operations WHERE id=$1", otherOp).Scan(&otherState, &otherActor, &otherKind))
	intent := f.forceStop(mainID, "other runtime is creating", "force-while-other")
	var stateNow, actorNow, kindNow string
	must(t, f.store.Pool.QueryRow("SELECT state, actor_user_id::text, kind FROM operations WHERE id=$1", otherOp).Scan(&stateNow, &actorNow, &kindNow))
	if stateNow != otherState || actorNow != otherActor || kindNow != otherKind || f.scalar("SELECT count(*) FROM runtime_force_stop_links WHERE intent_id=$1 AND target_id=$2", intent.S("id"), otherOp) != 0 {
		t.Fatalf("other runtime operation changed: %s %s %s", stateNow, actorNow, kindNow)
	}
	f.drain()
	if f.ws(otherID).S("observedState") != "ready" || !f.ws(otherID).B("admissionOpen") {
		t.Fatalf("other runtime was not left runnable: %v", f.ws(otherID))
	}
	if f.ws(mainID).S("observedState") != "ready" || f.ws(mainID).B("admissionOpen") || !f.forceStopOpen(intent.S("id")) {
		t.Fatalf("main was stopped or reopened: %v", f.ws(mainID))
	}

	fresh := f.create("force-stop-create")
	freshID := fresh.O("workspace").S("id")
	freshOp := fresh.O("operation").S("id")
	var freshActor string
	must(t, f.store.Pool.QueryRow("SELECT actor_user_id::text FROM operations WHERE id=$1", freshOp).Scan(&freshActor))
	freshIntent := f.forceStop(freshID, "create is in flight", "force-create")
	if f.scalar("SELECT count(*) FROM runtime_force_stop_links WHERE intent_id=$1 AND target_kind='operation' AND target_id=$2", freshIntent.S("id"), freshOp) != 1 {
		t.Fatal("in-flight create was not linked")
	}
	if err := f.controller.Drain(context.Background()); err == nil || !strings.Contains(err.Error(), "termination_unconfirmed") {
		t.Fatalf("late create dispatch: %v", err)
	}
	var freshState, actorAfter string
	var errorCode sql.NullString
	must(t, f.store.Pool.QueryRow("SELECT state, actor_user_id::text, error_code FROM operations WHERE id=$1", freshOp).Scan(&freshState, &actorAfter, &errorCode))
	open, _, observed := f.runtimeFact(freshID)
	if freshState == "succeeded" || freshState == "failed" || errorCode.Valid || actorAfter != freshActor || open || observed != "provisioning" || f.scalar("SELECT count(*) FROM sandbox_instances WHERE workspace_id=$1", freshID) != 0 || !f.forceStopOpen(freshIntent.S("id")) {
		t.Fatalf("late create revived the runtime: state %s err %v observed %s open %v", freshState, errorCode, observed, open)
	}
}

// TestForceStopDuringPluginInstallDoesNotFinishThePlugin registers force-stop
// while install is in flight and does not mark the plugin installed.
func TestForceStopDuringPluginInstallDoesNotFinishThePlugin(t *testing.T) {
	f := setup(t)
	created := f.create("force-stop-plugin")
	f.drain()
	wid := created.O("workspace").S("id")
	repo, _ := marketplaceFixture(t, f.root)
	f.syncMarketplace(t, repo)
	sid := f.defaultSpaceID()
	installed := f.call("POST", f.path("/spaces/"+sid+"/plugins"), core.Object{"identifier": "official/hello-world"}, "install-force", 200)
	if installed.O("resource").S("observedState") == "installed" {
		t.Fatalf("install completed inside the request: %v", installed.O("resource"))
	}
	var op, actor, kind, state string
	must(t, f.store.Pool.QueryRow("SELECT id::text, actor_user_id::text, kind, state FROM operations WHERE workspace_id=$1 AND kind='install_plugin' AND state IN ('queued','running','retry_wait','blocked')", wid).Scan(&op, &actor, &kind, &state))
	intent := f.forceStop(wid, "plugin is in flight", "force-plugin")
	if f.scalar("SELECT count(*) FROM runtime_force_stop_links WHERE intent_id=$1 AND target_kind='operation' AND target_id=$2", intent.S("id"), op) != 1 {
		t.Fatal("plugin operation was not linked")
	}
	if err := f.controller.Drain(context.Background()); err == nil || !strings.Contains(err.Error(), "termination_unconfirmed") {
		t.Fatalf("plugin dispatch: %v", err)
	}
	var actorAfter, kindAfter, stateAfter string
	var errorCode sql.NullString
	must(t, f.store.Pool.QueryRow("SELECT actor_user_id::text, kind, state, error_code FROM operations WHERE id=$1", op).Scan(&actorAfter, &kindAfter, &stateAfter, &errorCode))
	row := f.spacePlugin(sid, "official/hello-world")
	if actorAfter != actor || kindAfter != kind || stateAfter == "succeeded" || stateAfter == "failed" || errorCode.Valid || row.S("observedState") == "installed" || !f.forceStopOpen(intent.S("id")) {
		t.Fatalf("plugin install was rewritten: op %s %s plugin %s", kindAfter, stateAfter, row.S("observedState"))
	}
}

func (f *fixture) workspaceVersion(wid string) int64 {
	f.t.Helper()
	var version int64
	must(f.t, f.store.Pool.QueryRow("SELECT version FROM workspaces WHERE id=$1", wid).Scan(&version))
	return version
}

func (f *fixture) forceStop(wid, reason, key string) core.Object {
	f.t.Helper()
	return f.call("POST", f.path("/workspaces/"+wid+"/force-stop"), core.Object{"version": f.ws(wid).N("version"), "reason": reason}, key, 202)
}

func (f *fixture) forceStopCount(wid string) int {
	f.t.Helper()
	return f.scalar("SELECT count(*) FROM runtime_force_stop_intents WHERE workspace_id=$1", wid)
}

func (f *fixture) forceStopOpen(id string) bool {
	f.t.Helper()
	return f.scalar("SELECT count(*) FROM runtime_force_stop_intents WHERE id=$1 AND state IN ('requested','terminating','reconciling')", id) == 1
}

func (f *fixture) projectLifecycle(pid string) string {
	f.t.Helper()
	var lifecycle string
	must(f.t, f.store.Pool.QueryRow("SELECT lifecycle FROM projects WHERE id=$1", pid).Scan(&lifecycle))
	return lifecycle
}

func (f *fixture) runtimeFact(wid string) (open bool, epoch int64, observed string) {
	f.t.Helper()
	must(f.t, f.store.Pool.QueryRow("SELECT admission_open, admission_epoch, observed_state FROM workspaces WHERE id=$1", wid).Scan(&open, &epoch, &observed))
	return open, epoch, observed
}

func (f *fixture) deleteProject(pid string, want int) core.Object {
	f.t.Helper()
	var version int64
	must(f.t, f.store.Pool.QueryRow("SELECT version FROM projects WHERE id=$1", pid).Scan(&version))
	return f.call("DELETE", f.path("/projects/"+pid), core.Object{"version": version}, "delete-"+pid, want)
}

func (f *fixture) raceForceStop(t *testing.T, other core.Claims, wid string) {
	t.Helper()
	version := f.ws(wid).N("version")
	body := core.Object{"version": version, "reason": "race"}
	var wg sync.WaitGroup
	statuses := make([]int, 2)
	results := make([]core.Object, 2)
	callers := []core.Claims{f.user, other}
	keys := []string{"race-force-alice", "race-force-carol"}
	for i := range keys {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			out, status, err := f.client.Call(context.Background(), "POST", f.path("/workspaces/"+wid+"/force-stop"), "gateway", core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "gateway-a"}}, &callers[i], keys[i], body)
			if err != nil {
				t.Errorf("race %s: %v", keys[i], err)
				return
			}
			statuses[i] = status
			results[i] = out
		}(i)
	}
	wg.Wait()
	if !exactlyOne(statuses, 202, 409) || f.forceStopCount(wid) != 1 {
		t.Fatalf("concurrent force-stop statuses %v count %d", statuses, f.forceStopCount(wid))
	}
	for i, status := range statuses {
		if status == 202 && results[i].S("state") != "requested" {
			t.Fatalf("winner: %v", results[i])
		}
		// The winner closes admission and bumps the runtime version, so the
		// loser is a stale target version. Either refusal leaves one intent.
		if status == 409 && results[i].S("code") != "version_conflict" && results[i].S("code") != "resource_in_use" {
			t.Fatalf("loser: %v", results[i])
		}
	}
}
