package core

// workflowRun loads a live run scoped to its workflow and tenant; a foreign, deleted
// or missing run is 404, and the workflow gate keeps archived workflows (and with them
// their whole run history) out of every read.
func workflowRun(t *transaction, tid, wid, rid string) Object {
	require(validID(rid), 404, "not_found")
	workflow(t, tid, wid)
	o := t.one("SELECT * FROM workflow_runs WHERE id=$1 AND tenant_id=$2 AND workflow_id=$3 AND deleted_at IS NULL", rid, tid, wid)
	require(o != nil, 404, "not_found")
	return composeWorkflowRun(t, o)
}

func workflowRunList(t *transaction, r *PublicRequest) Object {
	w := workflow(t, r.TenantID, r.WorkflowID)
	pageOut := page(t, "SELECT * FROM workflow_runs WHERE tenant_id=$1 AND workflow_id=$2 AND deleted_at IS NULL", []any{r.TenantID, r.WorkflowID}, "id", r)
	// window builds its items in-process as []Object (not []any), so assert that exact type.
	raw, _ := pageOut["items"].([]Object)
	items := make([]any, 0, len(raw))
	for _, row := range raw {
		s := workflowRunSummary(row)
		// The route is already per-workflow, so the label is the same on every row; stamping it
		// keeps list rows schema-identical to a detail read without a per-row join.
		s["workflowName"] = w.S("name")
		items = append(items, s)
	}
	return Object{"items": items, "nextCursor": pageOut.S("nextCursor")}
}

// workflowRunSummary is the row projection shared by list and detail: the run's own fields,
// kept identical so a history row and a detail page never disagree about what a run is.
func workflowRunSummary(run Object) Object {
	rounds, _ := run["rounds"].([]any)
	return Object{
		"id":         run.S("id"),
		"tenantId":   run.S("tenantId"),
		"workflowId": run.S("workflowId"),
		"snapshotId": run.S("snapshotId"),
		"name":       run.S("name"),
		"status":     run.S("status"),
		"input":      run.O("input"),
		"nodeStates": run.O("nodeStates"),
		"rounds":     rounds,
		"error":      run.S("error"),
		"startedAt":  run.S("startedAt"),
		"finishedAt": run.S("finishedAt"),
		"createdAt":  run.S("createdAt"),
		"updatedAt":  run.S("updatedAt"),
	}
}

// composeWorkflowRun joins the workflow label and the frozen snapshot graph onto the run row.
// Snapshots are immutable and never soft-deleted, so the graph a run rendered cannot drift or
// vanish even after the workflow's live document has moved on.
func composeWorkflowRun(t *transaction, run Object) Object {
	summary := workflowRunSummary(run)
	graph := Object{}
	if s := t.one("SELECT graph FROM workflow_snapshots WHERE id=$1", run.S("snapshotId")); s != nil {
		graph = s.O("graph")
	}
	// The run row stores only the workflow id; the name makes detail pages legible without a
	// client-side join. Snapshots freeze their own name too, but the workflow's live name is
	// the stable label for a run that belongs to that workflow.
	workflowName := ""
	if w := t.one("SELECT name FROM workflows WHERE id=$1 AND tenant_id=$2", run.S("workflowId"), run.S("tenantId")); w != nil {
		workflowName = w.S("name")
	}
	summary["workflowName"] = workflowName
	summary["definitionSnapshot"] = graph
	return summary
}

// createWorkflowRun records one execution against one frozen snapshot. Cloud has no
// engine, so the row starts `pending`; a wired Store.WorkflowRunSimulator (dev fixtures
// only) fills the trace and advances the status inside the same transaction — a run is
// never half-persisted. Drafts are disallowed: running the live document would let an
// edit change what an already-created run "executed", so a workflow with no published
// snapshot is a hard error, exactly like desktop's workflow_no_published_snapshot.
func createWorkflowRun(t *transaction, r *PublicRequest) Object {
	w := workflow(t, r.TenantID, r.WorkflowID)
	name := w.S("name")
	if n := r.Body.S("name"); n != "" {
		name = validText(n, 200)
	}
	var s Object
	if r.Body.S("snapshotId") != "" {
		s = workflowSnapshot(t, r.TenantID, r.WorkflowID, r.Body.S("snapshotId"))
	} else {
		s = t.one("SELECT * FROM workflow_snapshots WHERE tenant_id=$1 AND workflow_id=$2 ORDER BY version DESC LIMIT 1", r.TenantID, r.WorkflowID)
		require(s != nil, 400, "workflow_no_published_snapshot")
	}
	input := r.Body.O("input")
	id := newID()
	t.exec("INSERT INTO workflow_runs(id,tenant_id,workflow_id,snapshot_id,name,status,input) VALUES($1,$2,$3,$4,$5,$6,$7)", id, r.TenantID, r.WorkflowID, s.S("id"), name, "pending", jsonText(input))
	if t.simulator != nil {
		nodeStates, rounds, status := t.simulator.SimulateWorkflowRun(s.O("graph"), input)
		t.exec("UPDATE workflow_runs SET node_states=$1,rounds=$2,status=$3,started_at=now(),finished_at=now(),version=version+1,updated_at=now() WHERE id=$4", jsonText(nodeStates), jsonText(rounds), status, id)
	}
	return composeWorkflowRun(t, t.one("SELECT * FROM workflow_runs WHERE id=$1 AND tenant_id=$2", id, r.TenantID))
}
