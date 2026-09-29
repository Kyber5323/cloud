package integration

import (
	"testing"

	"github.com/wanglongan587/cloud/internal/core"
)

func TestPluginSelectionIsAdminOnlyAndDoesNotReportInstalled(t *testing.T) {
	f := setup(t)
	repo, _ := marketplaceFixture(t, f.root)
	f.syncMarketplace(t, repo)
	sid := f.defaultSpaceID()
	f.spaceProject(t, sid, "plugin-admin-project")
	bob, _ := f.addUser(t, "bob", "Bob")

	denied, status := callUserStatus(t, f, bob, "POST", f.path("/spaces/"+sid+"/plugins"), core.Object{"identifier": "official/hello-world"}, "member-install")
	if status != 403 || denied.S("code") != "admin_required" {
		t.Fatalf("member install: %d %v", status, denied)
	}
	if f.scalar("SELECT count(*) FROM space_plugins WHERE space_id=$1", sid) != 0 || f.scalar("SELECT count(*) FROM operations WHERE kind IN ('install_plugin','remove_plugin')") != 0 || f.scalar("SELECT count(*) FROM plugin_maintenance_waits") != 0 || f.scalar("SELECT count(*) FROM external_effects WHERE kind IN ('plugin_ensure','plugin_delete')") != 0 {
		t.Fatal("rejected member install wrote plugin state")
	}

	out := f.call("POST", f.path("/spaces/"+sid+"/plugins"), core.Object{"identifier": "official/hello-world"}, "admin-install", 200)
	row := out.O("resource")
	summary := out.O("maintenance")
	if row.S("desiredState") != "installed" || row.S("desiredVersion") != "1.0.0" || row.S("observedState") == "installed" || summary.N("completed") != 0 || summary.N("affected") < 1 {
		t.Fatalf("accepted install = %v summary %v", row, summary)
	}
	listed := f.call("GET", f.path("/spaces/"+sid+"/plugins"), nil, "", 200)
	if _, ok := listed["maintenance"]; !ok {
		t.Fatalf("list is missing the maintenance summary: %v", listed)
	}
	wid := f.scalar("SELECT count(*) FROM runtime_control_sessions WHERE holder_kind='system_maintenance' AND state IN ('held','reconciling')")
	if wid != 1 || f.scalar("SELECT count(*) FROM operations WHERE kind='install_plugin'") != 1 {
		t.Fatal("idle runtime did not take maintenance before dispatch")
	}
	blocked, blockedStatus := callUserStatus(t, f, f.user, "POST", f.path("/workspaces/"+workspaceID(t, f)+"/control"), core.Object{}, "user-acquire")
	if blockedStatus != 409 || blocked.S("code") != "resource_in_use" {
		t.Fatalf("acquire during maintenance: %d %v", blockedStatus, blocked)
	}
}

func workspaceID(t *testing.T, f *fixture) string {
	t.Helper()
	var id string
	must(t, f.store.Pool.QueryRow("SELECT id::text FROM workspaces WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1").Scan(&id))
	return id
}

func TestPluginMaintenanceWaitsForHumanRelease(t *testing.T) {
	f := setup(t)
	repo, _ := marketplaceFixture(t, f.root)
	f.syncMarketplace(t, repo)
	sid := f.defaultSpaceID()
	created := f.spaceProject(t, sid, "plugin-wait-project")
	wid := created.O("workspace").S("id")
	session := f.hold(wid, "hold-plugin")

	f.call("POST", f.path("/spaces/"+sid+"/plugins"), core.Object{"identifier": "official/hello-world"}, "wait-install", 200)
	if f.scalar("SELECT count(*) FROM operations WHERE kind='install_plugin'") != 0 || f.scalar("SELECT count(*) FROM plugin_maintenance_waits WHERE state='pending'") != 1 {
		t.Fatal("human session was preempted")
	}
	f.call("POST", f.path("/workspaces/"+wid+"/control/release"), core.Object{"sessionId": session}, "release-plugin", 200)
	if f.scalar("SELECT count(*) FROM operations WHERE kind='install_plugin'") != 1 {
		t.Fatal("release did not continue the saved maintenance")
	}
	f.call("POST", f.path("/spaces/"+sid+"/plugins"), core.Object{"identifier": "official/hello-world"}, "wait-install-again", 200)
	if f.scalar("SELECT count(*) FROM operations WHERE kind='install_plugin'") != 1 {
		t.Fatal("same desired install created another operation")
	}
}

func TestPluginWaitLeavesADeletedRuntime(t *testing.T) {
	f := setup(t)
	repo, _ := marketplaceFixture(t, f.root)
	f.syncMarketplace(t, repo)
	sid := f.defaultSpaceID()
	created := f.spaceProject(t, sid, "plugin-delete-project")
	pid := created.O("resource").S("id")
	wid := created.O("workspace").S("id")
	f.hold(wid, "hold-delete")
	f.call("POST", f.path("/spaces/"+sid+"/plugins"), core.Object{"identifier": "official/hello-world"}, "delete-install", 200)
	if f.scalar("SELECT count(*) FROM operations WHERE kind='install_plugin'") != 0 {
		t.Fatal("install dispatched while the runtime was held")
	}
	f.deleteProject(pid, 202)
	f.drain()
	var deleted int
	must(t, f.store.Pool.QueryRow("SELECT count(*) FROM workspaces WHERE id=$1 AND deleted_at IS NOT NULL", wid).Scan(&deleted))
	if deleted != 1 || f.scalar("SELECT count(*) FROM plugin_maintenance_waits WHERE workspace_id=$1 AND state='failed'", wid) != 1 || f.scalar("SELECT count(*) FROM operations WHERE kind='install_plugin'") != 0 {
		t.Fatal("deleted runtime stayed an install candidate")
	}
}
