package integration

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/wanglongan587/cloud/internal/core"
)

// runGraph is a two-step document (start -> agent) so the test proves node_states follow the
// graph the run pinned, including that the second node's state appears.
func runGraph() core.Object {
	return core.Object{
		"nodes": []any{
			core.Object{
				"id": "start", "type": "workflow", "deletable": false,
				"position": core.Object{"x": 0, "y": 0},
				"data":     core.Object{"kind": "start", "title": "开始", "description": ""},
			},
			core.Object{
				"id": "agent-1", "type": "workflow",
				"position": core.Object{"x": 300, "y": 0},
				"data": core.Object{"kind": "agent", "title": "评审", "description": "",
					"agentConfig": core.Object{"schemaVersion": 1, "executor": core.Object{}, "prompt": "评审"}},
			},
		},
		"edges": []any{core.Object{
			"id": "e1", "kind": "data", "source": "start", "target": "agent-1",
		}},
		"viewport": core.Object{"x": 0, "y": 0, "zoom": 1},
	}
}

func TestWorkflowRunLifecycle(t *testing.T) {
	f := setup(t)
	wf := f.call("POST", f.path("/workflows"), core.Object{
		"name": "Run target", "graph": runGraph(),
	}, "run-wf", 200).O("resource")
	wfid := wf.S("id")

	// A workflow with no published snapshot cannot be run: the live graph is a draft.
	noSnapshot := f.call("POST", f.path("/workflows/"+wfid+"/runs"), core.Object{"name": "X"}, "run-0", 400)
	if noSnapshot.S("code") != "workflow_no_published_snapshot" {
		t.Fatalf("no-snapshot create code = %q", noSnapshot.S("code"))
	}

	// Publish, then run: the dev simulator (wired by setup) fills the trace and the row is terminal.
	snap := f.call("POST", f.path("/workflows/"+wfid+"/publish"), core.Object{}, "run-pub", 200).O("resource")
	snapID := snap.S("id")
	run := f.call("POST", f.path("/workflows/"+wfid+"/runs"), core.Object{
		"name": "Trial run", "input": core.Object{"branch": "main"},
	}, "run-1", 200).O("resource")
	if run.S("workflowId") != wfid || run.S("name") != "Trial run" || run.S("status") != "succeeded" {
		t.Fatalf("create run wrong: %v", run)
	}
	if run.S("snapshotId") != snapID {
		t.Fatalf("run pinned wrong snapshot: %v", run)
	}
	states := run.O("nodeStates")
	if states.O("start").S("status") != "succeeded" || states.O("agent-1").S("status") != "succeeded" {
		t.Fatalf("run node_states missing nodes: %v", states)
	}
	// The run echoes the kickoff input as its start-node output: the one thing the sim can say truthfully.
	output := states.O("start").O("output").O("input")
	if output.S("branch") != "main" {
		t.Fatalf("start output did not echo input: %v", output)
	}
	// definitionSnapshot is the frozen graph, not the live document: the run carries its own copy.
	ds := run.O("definitionSnapshot")
	if ds.O("viewport").N("zoom") != 1 {
		t.Fatalf("definition snapshot missing: %v", ds)
	}
	if _, ok := run["updatedAt"]; !ok {
		t.Fatal("run missing updatedAt")
	}

	// Same idempotency key replays the same run; a fresh key with no name defaults to the workflow name.
	replay := f.call("POST", f.path("/workflows/"+wfid+"/runs"), core.Object{
		"name": "Trial run", "input": core.Object{"branch": "main"},
	}, "run-1", 200).O("resource")
	if replay.S("id") != run.S("id") {
		t.Fatalf("idempotent create made another run: %v", replay)
	}
	f.call("POST", f.path("/workflows/"+wfid+"/runs"), core.Object{}, "run-2", 200).O("resource")

	// Read one run back and list them (newest of the run-2 page is visible by reading ids).
	one := f.call("GET", f.path("/workflows/"+wfid+"/runs/"+run.S("id")), nil, "", 200)
	if one.S("status") != "succeeded" || one.O("nodeStates").O("agent-1").S("status") != "succeeded" {
		t.Fatalf("run read-back changed the trace: %v", one)
	}
	listed := issueItems(f.call("GET", f.path("/workflows/"+wfid+"/runs"), nil, "", 200))
	if len(listed) != 2 {
		t.Fatalf("run list has %d rows, want 2", len(listed))
	}
	// The generic list returns full rows; page it with limit to prove the envelope carries nextCursor.
	page := f.call("GET", f.path("/workflows/"+wfid+"/runs")+"?limit=1", nil, "", 200)
	if len(issueItems(page)) != 1 || page.S("nextCursor") == "" {
		t.Fatalf("run page envelope wrong: %v", page)
	}

	// A run pinned to a specific, still-owned snapshot works; a foreign snapshot id is read 404.
	explicit := f.call("POST", f.path("/workflows/"+wfid+"/runs"), core.Object{
		"snapshotId": snapID,
	}, "run-3", 200).O("resource")
	if explicit.S("snapshotId") != snapID {
		t.Fatalf("explicit snapshot create wrong: %v", explicit)
	}
	f.call("POST", f.path("/workflows/"+wfid+"/runs"), core.Object{
		"snapshotId": uuid.NewString(),
	}, "run-4", 404)

	// The input must be an object.
	f.call("POST", f.path("/workflows/"+wfid+"/runs"), core.Object{"input": []any{}}, "run-5", 400)
	f.call("GET", f.path("/workflows/"+wfid+"/runs/not-a-uuid"), nil, "", 404)
	f.call("GET", f.path("/workflows/"+wfid+"/runs/"+uuid.NewString()), nil, "", 404)

	// Archiving the workflow hides its whole run history.
	f.call("DELETE", f.path("/workflows/"+wfid), core.Object{"version": f.call("GET", f.path("/workflows/"+wfid), nil, "", 200).N("version")}, "run-del", 200)
	f.call("GET", f.path("/workflows/"+wfid+"/runs"), nil, "", 404)
	f.call("GET", f.path("/workflows/"+wfid+"/runs/"+run.S("id")), nil, "", 404)
	f.call("POST", f.path("/workflows/"+wfid+"/runs"), core.Object{}, "run-6", 404)
}

func TestWorkflowRunTenantIsolation(t *testing.T) {
	f := setup(t)
	wf := f.call("POST", f.path("/workflows"), core.Object{
		"name": "Isolated run source", "graph": runGraph(),
	}, "iso-run-wf", 200).O("resource")
	wfid := wf.S("id")
	f.call("POST", f.path("/workflows/"+wfid+"/publish"), core.Object{}, "iso-run-pub", 200)
	run := f.call("POST", f.path("/workflows/"+wfid+"/runs"), core.Object{}, "iso-run-1", 200).O("resource")

	other, e := f.store.Bootstrap(context.Background(), "Other", "corp", "other", "Other")
	must(t, e)
	original := f.tid
	f.tid = other.S("tenantId")
	// The fixture actor is not a member of the other tenant, so every run operation is a typed 403.
	f.call("GET", f.path("/workflows/"+wfid+"/runs"), nil, "", 403)
	f.call("GET", f.path("/workflows/"+wfid+"/runs/"+run.S("id")), nil, "", 403)
	reject := f.call("POST", f.path("/workflows/"+wfid+"/runs"), core.Object{}, "iso-run-2", 403)
	if reject.S("code") == "" {
		t.Fatalf("cross-tenant reject had no code: %v", reject)
	}
	f.tid = original
}