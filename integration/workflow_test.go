package integration

import (
	"context"
	"testing"

	"github.com/wanglongan587/cloud/internal/core"
)

// reviewGraph is the smallest document the editor can open: one undeletable start node, no edges.
func reviewGraph() core.Object {
	return core.Object{
		"nodes": []any{core.Object{
			"id": "start", "type": "workflow", "deletable": false,
			"position": core.Object{"x": 0, "y": 0},
			"data":     core.Object{"kind": "start", "title": "开始", "description": ""},
		}},
		"edges":     []any{},
		"viewport":  core.Object{"x": 0, "y": 0, "zoom": 1},
		"variables": core.Object{"branch": core.Object{"valueType": "string", "value": "main"}},
	}
}

func TestWorkflowCRUD(t *testing.T) {
	f := setup(t)

	// Create: identity, defaults, and the graph stored whole.
	created := f.call("POST", f.path("/workflows"), core.Object{"name": "Review flow", "description": "Reviews a change", "graph": reviewGraph()}, "wf-1", 200).O("resource")
	if created.S("name") != "Review flow" || created.S("description") != "Reviews a change" || created.N("version") != 1 {
		t.Fatalf("unexpected workflow: %v", created)
	}
	wfid := created.S("id")
	graph := created.O("graph")
	if graph.O("viewport").N("zoom") != 1 || graph.O("variables").O("branch").S("value") != "main" {
		t.Fatalf("graph did not round-trip: %v", graph)
	}
	nodes, _ := graph["nodes"].([]any)
	if len(nodes) != 1 {
		t.Fatalf("graph nodes did not round-trip: %v", graph["nodes"])
	}
	// The graph is opaque to the API: a key it has never heard of survives untouched.
	if nodes[0].(map[string]any)["deletable"] != false {
		t.Fatalf("node payload was rewritten: %v", nodes[0])
	}

	// The same idempotency key replays the original response rather than creating a second row.
	replay := f.call("POST", f.path("/workflows"), core.Object{"name": "Review flow", "description": "Reviews a change", "graph": reviewGraph()}, "wf-1", 200).O("resource")
	if replay.S("id") != wfid {
		t.Fatalf("idempotent create made another workflow: %v", replay)
	}

	// A live name is unique per tenant; a different key with the same name is a conflict.
	f.call("POST", f.path("/workflows"), core.Object{"name": "Review flow"}, "wf-2", 409)
	f.call("POST", f.path("/workflows"), core.Object{"name": "  "}, "wf-3", 400)
	f.call("POST", f.path("/workflows"), core.Object{"name": "Bad graph", "graph": []any{}}, "wf-4", 400)
	f.call("POST", f.path("/workflows"), core.Object{"name": "Unknown field", "nodes": []any{}}, "wf-5", 400)

	// A workflow created without a graph opens as an empty document, never as SQL NULL.
	bare := f.call("POST", f.path("/workflows"), core.Object{"name": "Empty flow"}, "wf-6", 200).O("resource")
	if len(bare.O("graph")) != 0 || bare.S("description") != "" {
		t.Fatalf("unexpected defaults: %v", bare)
	}

	// List, then read one back.
	listed := issueItems(f.call("GET", f.path("/workflows"), nil, "", 200))
	if len(listed) != 2 {
		t.Fatalf("workflow list size %d != 2", len(listed))
	}
	f.call("GET", f.path("/workflows/"+wfid), nil, "", 200)
	f.call("GET", f.path("/workflows/"+bare.S("id")), nil, "", 200)
	f.call("GET", f.path("/workflows/not-a-uuid"), nil, "", 404)

	// Update renames, replaces the graph, and bumps the version; the stale version then conflicts.
	renamed := f.call("PUT", f.path("/workflows/"+wfid), core.Object{"name": "Review flow v2", "graph": core.Object{"nodes": []any{}}, "version": created.N("version")}, "", 200)
	if renamed.S("name") != "Review flow v2" || renamed.N("version") != created.N("version")+1 {
		t.Fatalf("workflow update not applied: %v", renamed)
	}
	if len(renamed.O("graph")) != 1 || renamed.S("description") != "Reviews a change" {
		t.Fatalf("update touched a field it was not given: %v", renamed)
	}
	f.call("PUT", f.path("/workflows/"+wfid), core.Object{"name": "Stale", "version": created.N("version")}, "", 409)
	f.call("PUT", f.path("/workflows/"+wfid), core.Object{"name": "No version"}, "", 428)
	f.call("PUT", f.path("/workflows/"+wfid), core.Object{"version": renamed.N("version")}, "", 400)

	// Archiving frees the name and hides the row.
	archived := f.call("DELETE", f.path("/workflows/"+wfid), core.Object{"version": renamed.N("version")}, "wf-del", 200)
	if archived["deletedAt"] == nil {
		t.Fatalf("archive did not set deletedAt: %v", archived)
	}
	f.call("GET", f.path("/workflows/"+wfid), nil, "", 404)
	if len(issueItems(f.call("GET", f.path("/workflows"), nil, "", 200))) != 1 {
		t.Fatal("archived workflow still listed")
	}
	f.call("POST", f.path("/workflows"), core.Object{"name": "Review flow v2"}, "wf-7", 200)

	// Cross-tenant isolation: a workflow is invisible outside its tenant.
	other, e := f.store.Bootstrap(context.Background(), "Other", "corp", "other", "Other")
	must(t, e)
	original := f.tid
	f.tid = other.S("tenantId")
	f.call("GET", f.path("/workflows/"+bare.S("id")), nil, "", 403)
	f.call("GET", f.path("/workflows"), nil, "", 403)
	f.tid = original
}
