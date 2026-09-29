package integration

import (
	"context"
	"database/sql"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"google.golang.org/grpc/codes"

	"github.com/wanglongan587/cloud/internal/controlpb"
	"github.com/wanglongan587/cloud/internal/core"
)

const dispatchRepository = "https://example.invalid/repo.git"

// TestFencedDispatchPersistsIdentityInputAndEpoch records one execution only
// after the current permission check, and keeps that identity stable.
func TestFencedDispatchPersistsIdentityInputAndEpoch(t *testing.T) {
	f := setup(t)
	created := f.create("fenced-dispatch")
	f.drain()
	wid := created.O("workspace").S("id")
	if f.dispatchCount() != 0 || f.ws(wid).S("observedState") != "ready" {
		t.Fatal("the old controller path recorded a fenced dispatch or stopped the runtime")
	}
	held := f.call("POST", f.path("/workspaces/"+wid+"/control"), core.Object{}, "fenced-acquire", 200)
	body := dispatchBody(wid, "exec-fenced-1", held.N("controlEpoch"), f.ws(wid).N("runtimeGeneration"), dispatchRepository, "main", 2)
	first, fault := f.recordDispatch(t, body, "submission-fenced-1", true)
	if fault != nil || first.S("executionId") != "exec-fenced-1" || first.N("controlEpoch") != held.N("controlEpoch") || first.O("input").S("repositoryUrl") != dispatchRepository {
		t.Fatalf("dispatch: %v %v", fault, first)
	}
	replay, replayFault := f.recordDispatch(t, dispatchBody(wid, "exec-fenced-1", held.N("controlEpoch"), f.ws(wid).N("runtimeGeneration"), dispatchRepository, "main", 2), "submission-fenced-1", true)
	again, againFault := f.recordDispatch(t, dispatchBody(wid, "exec-fenced-1", held.N("controlEpoch"), f.ws(wid).N("runtimeGeneration"), dispatchRepository, "main", 2), "submission-fenced-2", true)
	if replayFault != nil || replay.S("executionId") != first.S("executionId") || againFault != nil || again.S("executionId") != "exec-fenced-1" || f.dispatchCount() != 1 {
		t.Fatalf("replay created another execution: %v %v count %d", replay, againFault, f.dispatchCount())
	}
	conflict, conflictFault := f.recordDispatch(t, dispatchBody(wid, "exec-fenced-1", held.N("controlEpoch"), f.ws(wid).N("runtimeGeneration"), dispatchRepository, "other", 2), "submission-fenced-3", true)
	if conflictFault == nil || conflictFault.Code != "dispatch_conflict" || conflict != nil || f.dispatchCount() != 1 {
		t.Fatalf("changed input: %v %v", conflictFault, conflict)
	}
	var actor, kind, input string
	var epoch, generation int64
	var protocol int
	must(t, f.store.Pool.QueryRow(`SELECT actor_user_id::text, actor_kind, control_epoch, runtime_generation, protocol_generation, input::text FROM runtime_control_dispatches WHERE execution_id='exec-fenced-1'`).Scan(&actor, &kind, &epoch, &generation, &protocol, &input))
	if actor != f.uid || kind != "user" || epoch != held.N("controlEpoch") || generation != f.ws(wid).N("runtimeGeneration") || protocol != 2 || f.ws(wid).S("observedState") != "ready" {
		t.Fatalf("stored dispatch actor %s kind %s epoch %d generation %d protocol %d input %s", actor, kind, epoch, generation, protocol, input)
	}

	maint := f.call("POST", f.path("/projects"), core.Object{"name": "Maintenance", "repositoryUrl": dispatchRepository, "defaultBranch": "main"}, "fenced-maint", 202)
	f.drain()
	maintID := maint.O("workspace").S("id")
	var tenant string
	var maintGeneration int64
	must(t, f.store.Pool.QueryRow("SELECT tenant_id::text, runtime_generation FROM workspaces WHERE id=$1", maintID).Scan(&tenant, &maintGeneration))
	if _, err := f.store.Pool.Exec(`INSERT INTO runtime_control_sessions(id,tenant_id,workspace_id,holder_user_id,holder_kind,control_epoch,state,expires_at,change_reason)
		VALUES($1,$2,$3,NULL,'system_maintenance',1,'held',clock_timestamp()+interval '100 years','plugin_maintenance')`, uuid.NewString(), tenant, maintID); err != nil {
		t.Fatal(err)
	}
	system, systemFault := f.recordDispatch(t, dispatchBody(maintID, "exec-maint-1", 1, maintGeneration, dispatchRepository, "main", 2), "submission-maint-1", true)
	var systemActor sql.NullString
	var systemKind string
	must(t, f.store.Pool.QueryRow(`SELECT actor_user_id::text, actor_kind FROM runtime_control_dispatches WHERE execution_id='exec-maint-1'`).Scan(&systemActor, &systemKind))
	if systemFault != nil || system.S("executionId") != "exec-maint-1" || systemActor.Valid || systemKind != "system" || f.ws(maintID).S("observedState") != "ready" {
		t.Fatalf("maintenance dispatch: %v %v actor %v kind %s", systemFault, system, systemActor, systemKind)
	}
}

// TestFencedDispatchRejectsUnauthenticatedOldProtocolAndStalePermission keeps
// a refused dispatch from inserting an execution.
func TestFencedDispatchRejectsUnauthenticatedOldProtocolAndStalePermission(t *testing.T) {
	f := setup(t)
	created := f.create("fenced-refuse")
	f.drain()
	wid := created.O("workspace").S("id")
	oid := created.O("operation").S("id")
	held := f.call("POST", f.path("/workspaces/"+wid+"/control"), core.Object{}, "refuse-acquire", 200)
	generation := f.ws(wid).N("runtimeGeneration")
	epoch := held.N("controlEpoch")
	sessionID := held.S("sessionId")

	closed := f.internal("/internal/v1/runtime-control/dispatches", dispatchBody(wid, "exec-http", epoch, generation, dispatchRepository, "main", 2), 403)
	oldProtocol := f.internal("/internal/v1/runtime-control/dispatches", dispatchBody(wid, "exec-http-old", epoch, generation, dispatchRepository, "main", 1), 400)
	unknown := f.internal("/internal/v1/operations/"+oid+"/effects", core.Object{"epoch": 1, "version": 1, "kind": "sandbox_ensure", "workspaceId": wid, "controlEpoch": epoch}, 400)
	if closed.S("code") != "control_capability_unavailable" || oldProtocol.S("code") != "unsupported_protocol" || unknown.S("code") != "unknown_field" {
		t.Fatalf("http gate: closed %v old %v plan %v", closed, oldProtocol, unknown)
	}
	ctx := asController(f.client.Subject)
	client := controlpb.NewRuntimeControlDeliveryServiceClient(f.controlConn)
	_, err := client.RecordControlDispatch(ctx, &controlpb.RecordControlDispatchRequest{SubmissionId: "grpc-old", Epoch: 1, ExecutionId: "exec-grpc-old", WorkspaceId: wid, ControlEpoch: epoch, RuntimeGeneration: generation, ProtocolGeneration: 1, Input: cloneSpec(dispatchRepository, "main")})
	expectStatus(t, err, codes.InvalidArgument, controlpb.ErrorCode_ERROR_CODE_INVALID_INPUT)
	_, err = client.RecordControlDispatch(ctx, &controlpb.RecordControlDispatchRequest{SubmissionId: "grpc-new", Epoch: 1, ExecutionId: "exec-grpc-new", WorkspaceId: wid, ControlEpoch: epoch, RuntimeGeneration: generation, ProtocolGeneration: 2, Input: cloneSpec(dispatchRepository, "main")})
	expectStatus(t, err, codes.FailedPrecondition, controlpb.ErrorCode_ERROR_CODE_CONTROL_CAPABILITY_UNAVAILABLE)
	_, err = client.RecordControlDispatch(ctx, &controlpb.RecordControlDispatchRequest{SubmissionId: "grpc-plugin", Epoch: 1, ExecutionId: "exec-grpc-plugin", WorkspaceId: wid, ControlEpoch: epoch, RuntimeGeneration: generation, ProtocolGeneration: 2, Input: &controlpb.ExecutionInput{Spec: &controlpb.ExecutionInput_InstallPlugins{InstallPlugins: &controlpb.InstallPluginsSpec{}}}})
	expectStatus(t, err, codes.FailedPrecondition, controlpb.ErrorCode_ERROR_CODE_CONTROL_CAPABILITY_UNAVAILABLE)

	unauthenticated, unauthenticatedFault := f.recordDispatch(t, dispatchBody(wid, "exec-store-closed", epoch, generation, dispatchRepository, "main", 2), "store-closed", false)
	legacy, legacyFault := f.recordDispatch(t, dispatchBody(wid, "exec-store-old", epoch, generation, dispatchRepository, "main", 1), "store-old", true)
	if unauthenticatedFault == nil || unauthenticatedFault.Code != "control_capability_unavailable" || unauthenticated != nil || legacyFault == nil || legacyFault.Code != "unsupported_protocol" || legacy != nil {
		t.Fatalf("store gate: %v %v / %v %v", unauthenticatedFault, unauthenticated, legacyFault, legacy)
	}

	cases := []struct {
		name, execution, repo, branch string
		controlEpoch, generation      int64
		code                          string
	}{
		{"stale epoch", "exec-stale-epoch", dispatchRepository, "main", epoch + 9, generation, "control_not_held"},
		{"wrong generation", "exec-stale-gen", dispatchRepository, "main", epoch, generation + 9, "dispatch_conflict"},
		{"wrong repository", "exec-other-repo", "https://example.invalid/other.git", "main", epoch, generation, "dispatch_conflict"},
	}
	for _, c := range cases {
		_, fault := f.recordDispatch(t, dispatchBody(wid, c.execution, c.controlEpoch, c.generation, c.repo, c.branch, 2), c.execution, true)
		if fault == nil || fault.Code != c.code {
			t.Fatalf("%s: %v", c.name, fault)
		}
	}
	secret := dispatchBody(wid, "exec-secret", epoch, generation, dispatchRepository, "main", 2)
	secret["input"] = core.Object{"kind": "clone", "repositoryUrl": dispatchRepository, "branch": "main", "password": "secret-value"}
	_, secretFault := f.recordDispatch(t, secret, "exec-secret", true)
	if secretFault == nil || secretFault.Code != "invalid_dispatch" {
		t.Fatalf("secret input: %v", secretFault)
	}
	if _, err := f.store.Pool.Exec("UPDATE runtime_control_sessions SET state='acquiring' WHERE id=$1", sessionID); err != nil {
		t.Fatal(err)
	}
	_, acquiringFault := f.recordDispatch(t, dispatchBody(wid, "exec-acquiring", epoch, generation, dispatchRepository, "main", 2), "exec-acquiring", true)
	if _, err := f.store.Pool.Exec("UPDATE runtime_control_sessions SET state='held' WHERE id=$1", sessionID); err != nil {
		t.Fatal(err)
	}
	if acquiringFault == nil || acquiringFault.Code != "control_not_held" {
		t.Fatalf("acquiring: %v", acquiringFault)
	}

	f.call("POST", f.path("/workspaces/"+wid+"/control/activities"), core.Object{"sessionId": sessionID}, "refuse-write", 200)
	_, writeFault := f.recordDispatch(t, dispatchBody(wid, "exec-write", epoch, generation, dispatchRepository, "main", 2), "exec-write", true)
	if writeFault == nil || writeFault.Code != "resource_in_use" {
		t.Fatalf("open write: %v", writeFault)
	}

	bob, bobID := f.addUser(t, "bob-dispatch", "Bob")
	f.call("PUT", f.path("/members/"+bobID), core.Object{"role": "admin", "status": "active", "version": 1}, "", 200)
	isolated := f.call("POST", f.path("/projects/"+created.O("resource").S("id")+"/workspaces"), core.Object{"title": "Bob", "baseRef": "main"}, "bob-runtime", 202)
	f.drain()
	bobWorkspace := isolated.O("resource").S("id")
	bobHeld := callUser(t, f, bob, "POST", f.path("/workspaces/"+bobWorkspace+"/control"), core.Object{}, "bob-acquire")
	// The membership API already withdraws a session when use is lost. This
	// update leaves the held row in place so the dispatch itself rechecks it.
	if _, err := f.store.Pool.Exec("UPDATE tenant_memberships SET role='member' WHERE tenant_id=$1 AND user_id=$2", f.tid, bobID); err != nil {
		t.Fatal(err)
	}
	_, demotedFault := f.recordDispatch(t, dispatchBody(bobWorkspace, "exec-demoted", bobHeld.N("controlEpoch"), f.ws(bobWorkspace).N("runtimeGeneration"), dispatchRepository, "main", 2), "exec-demoted", true)
	if demotedFault == nil || demotedFault.Code != "runtime_use_forbidden" {
		t.Fatalf("demoted holder: %v", demotedFault)
	}

	ref := classifiedCredential(t, f, f.uid, "infra/git/fenced", "personal", "alice-authorization")
	if _, err := f.store.Pool.Exec("UPDATE projects SET credential_ref_id=$1 WHERE id=$2", ref, created.O("resource").S("id")); err != nil {
		t.Fatal(err)
	}
	if _, err := f.store.Pool.Exec("UPDATE credential_refs SET availability='frozen', frozen_at=clock_timestamp(), freeze_reason='member_disabled' WHERE id=$1", ref); err != nil {
		t.Fatal(err)
	}
	_, frozenFault := f.recordDispatch(t, dispatchBody(wid, "exec-frozen", epoch, generation, dispatchRepository, "main", 2), "exec-frozen", true)
	if frozenFault == nil || frozenFault.Code != "credential_unavailable" {
		t.Fatalf("frozen credential: %v", frozenFault)
	}
	f.call("POST", f.path("/workspaces/"+wid+"/force-stop"), core.Object{"version": f.ws(wid).N("version"), "reason": "unconfirmed"}, "refuse-force", 202)
	_, stopFault := f.recordDispatch(t, dispatchBody(wid, "exec-force", epoch, generation, dispatchRepository, "main", 2), "exec-force", true)
	if stopFault == nil || stopFault.Code != "termination_unconfirmed" {
		t.Fatalf("force-stop: %v", stopFault)
	}
	if f.dispatchCount() != 0 {
		t.Fatal("a refused dispatch inserted an execution")
	}
}

func (f *fixture) dispatchCount() int {
	return f.scalar("SELECT count(*) FROM runtime_control_dispatches")
}

func (f *fixture) recordDispatch(t *testing.T, body core.Object, submission string, authenticated bool) (core.Object, *core.Fault) {
	t.Helper()
	var epoch int64
	must(t, f.store.Pool.QueryRow("SELECT epoch FROM controller_leases WHERE holder_id=$1", f.client.Subject).Scan(&epoch))
	body["epoch"] = epoch
	claims := &core.Claims{Kind: "service", Role: "controller", DeliveryAuthenticated: authenticated, RegisteredClaims: jwt.RegisteredClaims{Subject: f.client.Subject}}
	out, err := f.store.Control(context.Background(), &core.ControlRequest{Action: "control_dispatch", SubmissionID: submission, Body: body, Service: claims})
	if err != nil {
		return nil, core.ErrorCode(err)
	}
	return out, nil
}

func dispatchBody(wid, execution string, controlEpoch, generation int64, repository, branch string, protocol int64) core.Object {
	return core.Object{
		"executionId":        execution,
		"workspaceId":        wid,
		"controlEpoch":       controlEpoch,
		"runtimeGeneration":  generation,
		"protocolGeneration": protocol,
		"input":              core.Object{"kind": "clone", "repositoryUrl": repository, "branch": branch},
	}
}
