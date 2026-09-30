package integration

import (
	"testing"

	"github.com/wanglongan587/cloud/internal/controlpb"
	"github.com/wanglongan587/cloud/internal/core"
)

// A changed selection must wait for the accepted old execution, including a lost result.
// The late install result does not overwrite the newer removal, and the removal is a new execution.
func TestChangedPluginIntentReconcilesUnknownOldResultBeforeRemoval(t *testing.T) {
	f := setup(t)
	repo, _ := marketplaceFixture(t, f.root)
	f.syncMarketplace(t, repo)
	sid := f.defaultSpaceID()
	created := f.spaceProject(t, sid, "changed-plugin-intent")
	wid := created.O("workspace").S("id")
	f.call("POST", f.pluginSpacePath(sid)+"/plugins", core.Object{"identifier": "official/hello-world", "version": 0}, "old-install", 200)
	op := f.claimPluginOp(t, "install_plugin")
	f.dispatchPlugin(t, op, "old-exec")
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
	must(t, f.reportPlugin(t, op, "old-exec", []*controlpb.PluginItemResult{{
		PluginId: "official/hello-world",
		Outcome:  &controlpb.PluginItemResult_Installed{Installed: &controlpb.PluginItemInstalled{Version: "1.0.0"}},
	}}))
	f.controlStep(t, op, "/advance", core.Object{}, 200)
	var state string
	must(t, f.store.Pool.QueryRow("SELECT observed_state FROM workspace_plugin_instances WHERE workspace_id=$1", wid).Scan(&state))
	if state != "pending" || f.spacePlugin(sid, "official/hello-world").S("desiredState") != "removed" {
		t.Fatal("late install result replaced newer removal intent", state)
	}
	f.completeNextPlugin(t, "remove_plugin")
	if f.spacePlugin(sid, "official/hello-world").S("observedState") != "removed" || f.scalar("SELECT count(*) FROM operations WHERE workspace_id=$1 AND kind IN ('install_plugin','remove_plugin')", wid) != 2 {
		t.Fatal("reconciled removal did not execute exactly one new intent")
	}
	if f.scalar("SELECT count(*) FROM node_executions WHERE operation_id=$1", op.S("id")) != 1 || f.scalar("SELECT count(*) FROM external_effects WHERE operation_id=$1 AND kind IN ('plugin_ensure','plugin_delete')", op.S("id")) != 0 {
		t.Fatal("old execution was duplicated or turned back into a plugin effect")
	}
}
