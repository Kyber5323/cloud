package integration

import (
	"context"
	"testing"

	"github.com/wanglongan587/cloud/internal/core"
)

// Pending intent is authoritative even when the production executor is unavailable.
func TestPluginSelectionRequiresAdminAndWaitsForControlThenExecutor(t *testing.T) {
	f := setup(t)
	repo, artifacts := marketplaceFixture(t, f.root)
	f.substrate.MapArtifact("https://example.invalid/artifacts/hello-1.0.0.orax", artifacts["https://example.invalid/artifacts/hello-1.0.0.orax"])
	f.syncMarketplace(t, repo)
	sid := f.defaultSpaceID()
	created := f.spaceProject(t, sid, "plugin-pending")
	wid := created.O("workspace").S("id")
	bob, _ := f.addUser(t, "plugin-member", "Bob")
	response, status, err := f.client.Call(context.Background(), "POST", f.pluginSpacePath(sid)+"/plugins", "gateway", core.Claims{Subject: "gateway-a"}, &bob, "member-selection", core.Object{"identifier": "official/hello-world", "version": 0})
	must(t, err)
	if status != 403 || response.S("code") != "space_role_required" {
		t.Fatalf("member mutation: %d %v", status, response)
	}
	if f.scalar("SELECT count(*) FROM space_plugins") != 0 {
		t.Fatal("refused member created selection")
	}
	session := f.controlSession(wid)
	f.store.PluginExecution = core.PluginExecutionUnavailable
	selected := f.call("POST", f.pluginSpacePath(sid)+"/plugins", core.Object{"identifier": "official/hello-world", "version": 0}, "admin-selection", 200).O("resource")
	if selected.N("affectedCount") != 1 || selected.N("waitingControlCount") != 1 || selected.N("completedCount") != 0 {
		t.Fatal(selected)
	}
	if f.scalar("SELECT count(*) FROM operations WHERE workspace_id=$1 AND kind='install_plugin'", wid) != 0 {
		t.Fatal("maintenance stole a human session")
	}
	control := f.call("GET", f.path("/workspaces/"+wid+"/control"), nil, "", 200)
	f.call("POST", f.path("/workspaces/"+wid+"/control/release"), core.Object{"version": control.N("version"), "sessionId": session}, "release-plugin", 200)
	f.acknowledgeSimulatorBindings()
	// A recovery claim revisits the durable target without another installation request.
	f.internal("/internal/v1/operations/claim", core.Object{"epoch": f.controller.Epoch}, 200)
	summary := f.call("GET", f.pluginSpacePath(sid)+"/plugins", nil, "", 200)
	row := core.Object(summary["items"].([]any)[0].(map[string]any))
	if row.N("unavailableCount") != 1 || row.S("observedState") != "pending" {
		t.Fatal(row)
	}
	if f.scalar("SELECT count(*) FROM operations WHERE workspace_id=$1 AND kind='install_plugin'", wid) != 0 {
		t.Fatal("missing executor produced a plan")
	}
	f.store.PluginExecution = core.PluginExecutionSimulation
	f.completeNextPlugin(t, "install_plugin")
	if f.spacePlugin(sid, "official/hello-world").S("observedState") != "installed" {
		t.Fatal("pending intent was not revisited")
	}
}
