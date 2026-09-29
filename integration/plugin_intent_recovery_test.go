package integration

import (
	"reflect"
	"testing"

	"github.com/wanglongan587/cloud/internal/core"
)

// A changed selection must wait for the accepted old intent, including a lost result.
// This tests real PostgreSQL authority with an explicit simulated executor, not plugin installation.
// specs/test-cases/cloud/plugin-marketplace/admin-selection-and-idle-maintenance.md#changed-plugin-intent-and-unknown-results-reconcile-without-duplicate-execution
func TestChangedPluginIntentReconcilesUnknownOldResultBeforeRemoval(t *testing.T) {
	f := setup(t)
	repo, artifacts := marketplaceFixture(t, f.root)
	f.syncMarketplace(t, repo)
	f.substrate.MapArtifact("https://example.invalid/artifacts/hello-1.0.0.orax", artifacts["https://example.invalid/artifacts/hello-1.0.0.orax"])
	sid := f.defaultSpaceID()
	created := f.spaceProject(t, sid, "changed-plugin-intent")
	wid := created.O("workspace").S("id")
	f.call("POST", f.pluginSpacePath(sid)+"/plugins", core.Object{"identifier": "official/hello-world", "version": 0}, "old-install", 200)
	op := f.claimPluginOp(t, "install_plugin")
	planned := f.controlStep(t, op, "/effects", core.Object{"kind": "plugin_ensure", "workspaceId": wid}, 200)
	effect := planned.O("effect")
	original := f.substrateSucceed(t, effect) // Accepted externally; its response has not reached Cloud.
	current := f.spacePlugin(sid, "official/hello-world")
	f.call("DELETE", f.pluginSpacePath(sid)+"/plugins", core.Object{"identifier": "official/hello-world", "version": current.N("version")}, "new-remove", 200)
	if f.scalar("SELECT count(*) FROM operations WHERE workspace_id=$1 AND kind IN ('install_plugin','remove_plugin')", wid) != 1 {
		t.Fatal("unknown old result produced a second maintenance operation")
	}
	var maintenance string
	must(t, f.store.Pool.QueryRow("SELECT maintenance_operation_id FROM workspace_plugin_instances WHERE workspace_id=$1", wid).Scan(&maintenance))
	if maintenance != op.S("id") {
		t.Fatal("changed intent erased old responsibility", maintenance)
	}
	recovered := f.substrateSucceed(t, effect) // Stable effect identity queries/replays the original result.
	if !reflect.DeepEqual(original, recovered) {
		t.Fatalf("replay changed old evidence: %v / %v", original, recovered)
	}
	result := f.controlStep(t, planned.O("operation"), "/effects/"+effect.S("id")+"/result", core.Object{"state": "succeeded", "externalId": recovered.S("externalId"), "result": recovered.O("result")}, 200)
	f.controlStep(t, result.O("operation"), "/advance", core.Object{}, 200)
	var state string
	must(t, f.store.Pool.QueryRow("SELECT observed_state FROM workspace_plugin_instances WHERE workspace_id=$1", wid).Scan(&state))
	if state != "pending" || f.spacePlugin(sid, "official/hello-world").S("desiredState") != "removed" {
		t.Fatal("late install result replaced newer removal intent", state)
	}
	f.completeNextPlugin(t, "remove_plugin")
	if f.spacePlugin(sid, "official/hello-world").S("observedState") != "removed" || f.scalar("SELECT count(*) FROM operations WHERE workspace_id=$1 AND kind IN ('install_plugin','remove_plugin')", wid) != 2 {
		t.Fatal("reconciled removal did not execute exactly one new intent")
	}
	if f.scalar("SELECT count(*) FROM external_effects WHERE operation_id=$1", op.S("id")) != 1 {
		t.Fatal("old effect responsibility was duplicated or erased")
	}
}
