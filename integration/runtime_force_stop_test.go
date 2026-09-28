package integration

import (
	"testing"

	"github.com/wanglongan587/cloud/internal/controlpb"
	"github.com/wanglongan587/cloud/internal/core"
)

// confirmForceStopInjected is simulated termination evidence for PostgreSQL contract tests only.
// The cluster suite must separately prove actual Docker termination and durable late-ensure fencing.
func (f *fixture) confirmForceStopInjected() {
	api := controlpb.NewRuntimeControlServiceClient(f.controlConn)
	ctx := asController(f.client.Subject)
	pending, err := api.ListForceStops(ctx, &controlpb.ListForceStopsRequest{Epoch: f.controller.Epoch})
	must(f.t, err)
	for _, p := range pending.Plans {
		version := p.Version
		if len(p.Effects) == 0 {
			_, err = api.ConfirmForceStop(ctx, &controlpb.ConfirmForceStopRequest{SubmissionId: "confirm-empty-" + p.Id, Epoch: f.controller.Epoch, ForceStopId: p.Id, Version: version})
			must(f.t, err)
		}
		for _, e := range p.Effects {
			if e.GetState() == controlpb.EffectState_EFFECT_STATE_SUCCEEDED {
				continue
			}
			result, e2 := api.ConfirmForceStop(ctx, &controlpb.ConfirmForceStopRequest{SubmissionId: "confirm-" + e.Id, Epoch: f.controller.Epoch, ForceStopId: p.Id, Version: version, EffectId: e.Id, Terminated: true, LateEnsureFenced: true})
			must(f.t, e2)
			version = result.Version
		}
	}
}

func TestForceStopRegistersDuringLifecycleAndFencesLateEnsureWithoutRewritingHistory(t *testing.T) {
	f := setup(t)
	created := f.create("force-racing-create")
	wid, oid := created.O("workspace").S("id"), created.O("operation").S("id")
	ops := controlpb.NewWorkspaceOperationServiceClient(f.controlConn)
	api := controlpb.NewRuntimeControlServiceClient(f.controlConn)
	ctx := asController(f.client.Subject)
	claim, err := ops.ClaimOperation(ctx, &controlpb.ClaimOperationRequest{Epoch: f.controller.Epoch})
	must(t, err)
	planned, err := ops.PlanEffect(ctx, &controlpb.PlanEffectRequest{SubmissionId: "initial-ensure", Epoch: f.controller.Epoch, OperationId: oid, Version: claim.Snapshot.Operation.Version, WorkspaceId: wid, Kind: controlpb.EffectKind_EFFECT_KIND_SANDBOX_ENSURE})
	must(t, err)
	permitRequest := &controlpb.GetEffectPermitRequest{Epoch: f.controller.Epoch, EffectId: planned.Effect.Id}
	permit, err := api.GetEffectPermit(ctx, permitRequest)
	must(t, err)
	leaseDeadline := int64(f.scalar("SELECT floor(extract(epoch FROM expires_at)*1000)::bigint FROM controller_leases WHERE name='global'"))
	if permit.Permit.ExpiresAtMs > leaseDeadline || permit.Permit.ExpiresAtMs <= permit.Permit.IssuedAtMs {
		t.Fatal("effect permit outlived the Controller lease", permit)
	}
	body := core.Object{"version": f.scalar("SELECT version FROM workspaces WHERE id=$1", wid), "reason": "Terminate a creation with an uncertain response", "impactConfirmed": true}
	f.call("POST", f.path("/workspaces/"+wid+"/force-stop"), core.Object{"version": body["version"], "reason": body["reason"]}, "missing-impact", 400)
	forced := f.call("POST", f.path("/workspaces/"+wid+"/force-stop"), body, "force", 202)
	if f.scalar("SELECT count(*) FROM operations WHERE id=$1 AND state='running' AND version=$2", oid, planned.Operation.Version) != 1 {
		t.Fatal("registration replaced the ordinary operation")
	}
	replay := f.call("POST", f.path("/workspaces/"+wid+"/force-stop"), body, "force", 202)
	if replay.O("forceStop").S("id") != forced.O("forceStop").S("id") {
		t.Fatal("force replay created another intent")
	}
	_, err = api.GetEffectPermit(ctx, permitRequest)
	if err == nil {
		t.Fatal("old ensure plan authorized a new dispatch")
	}
	pending, err := api.ListForceStops(ctx, &controlpb.ListForceStopsRequest{Epoch: f.controller.Epoch})
	must(t, err)
	p := pending.Plans[0]
	if len(p.Effects) != 1 || p.Effects[0].GetRequest().GetSandboxTerminate().GetSandboxInstanceId() != planned.Effect.Id {
		t.Fatal("allocating sandbox was not included", p)
	}
	_, err = api.ConfirmForceStop(ctx, &controlpb.ConfirmForceStopRequest{SubmissionId: "no-tombstone", Epoch: f.controller.Epoch, ForceStopId: p.Id, Version: p.Version, EffectId: p.Effects[0].Id, Terminated: true})
	if err == nil {
		t.Fatal("termination without late-ensure fencing was accepted")
	}
	view := f.call("GET", f.path("/workspaces/"+wid+"/control"), nil, "", 200)
	f.call("POST", f.path("/workspaces/"+wid+"/control/acquire"), core.Object{"version": view.N("version")}, "early-take", 409)
	f.confirmForceStopInjected()
	if f.scalar("SELECT count(*) FROM sandbox_instances WHERE id=$1 AND terminated_at IS NOT NULL", planned.Effect.Id) != 1 || f.scalar("SELECT count(*) FROM external_effects WHERE id=$1 AND state='planned'", planned.Effect.Id) != 1 {
		t.Fatal("termination deleted or falsified the original ensure")
	}
	original := f.call("GET", f.path("/operations/"+oid), nil, "", 200)
	if original.S("state") != "failed" || original.O("result").S("forceStopId") != p.Id {
		t.Fatal("original cancellation lacks force cause", original)
	}
	if f.ws(wid).S("observedState") != "stopped" {
		t.Fatal("confirmed runtime did not stop")
	}
}

func TestRestartIsOneDurableIntentAndNeverClonesAgain(t *testing.T) {
	f := setup(t)
	created := f.create("create-for-restart")
	f.drain()
	wid := created.O("workspace").S("id")
	before := f.ws(wid)
	restarted := f.call("POST", f.path("/workspaces/"+wid+"/restart"), f.lifecycleBody(wid, before.N("version")), "restart", 202)
	if restarted.O("operation").S("kind") != "restart" {
		t.Fatal(restarted)
	}
	f.drain()
	after := f.ws(wid)
	if after.S("observedState") != "ready" || after.N("runtimeGeneration") != before.N("runtimeGeneration")+1 || after.S("baseCommitId") != before.S("baseCommitId") {
		t.Fatal("restart did not preserve clone", after)
	}
	if f.scalar("SELECT count(*) FROM clone_executions WHERE workspace_id=$1", wid) != 1 {
		t.Fatal("restart re-cloned the Workspace")
	}
	if f.scalar("SELECT count(*) FROM operations WHERE id=$1 AND state='succeeded'", restarted.O("operation").S("id")) != 1 {
		t.Fatal("restart intent did not finish")
	}
}
