package core

import "strings"

// workflow loads a live workflow scoped to the tenant.
func workflow(t *transaction, tid, wid string) Object {
	require(validID(wid), 404, "not_found")
	w := t.one("SELECT * FROM workflows WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL", wid, tid)
	require(w != nil, 404, "not_found")
	return w
}

func workflowList(t *transaction, r *PublicRequest) Object {
	return page(t, "SELECT * FROM workflows WHERE tenant_id=$1 AND deleted_at IS NULL", []any{r.TenantID}, "id", r)
}

// graphText renders the graph body field. A workflow created without one stores the empty document
// rather than SQL NULL: the column is a NOT NULL object, and the editor opens an empty document as a
// blank canvas. The body field is already proven to be a JSON object by the router's field check.
func graphText(r *PublicRequest) string {
	if g, ok := r.Body["graph"]; ok {
		return jsonText(g)
	}
	return "{}"
}

func createWorkflow(t *transaction, r *PublicRequest) Object {
	name := validText(r.Body.S("name"), 200)
	require(t.one("SELECT id FROM workflows WHERE tenant_id=$1 AND name=$2 AND deleted_at IS NULL", r.TenantID, name) == nil, 409, "workflow_conflict")
	id := newID()
	t.exec("INSERT INTO workflows(id,tenant_id,name,description,graph) VALUES($1,$2,$3,$4,$5)", id, r.TenantID, name, r.Body.S("description"), graphText(r))
	return workflow(t, r.TenantID, id)
}

func updateWorkflow(t *transaction, r *PublicRequest) Object {
	w := workflow(t, r.TenantID, r.WorkflowID)
	version(w, r.Body.N("version"))
	cols := []string{}
	vals := []any{}
	add := func(col string, val any) {
		cols = append(cols, col+"=$"+itoa(len(vals)+1))
		vals = append(vals, val)
	}
	if _, ok := r.Body["name"]; ok {
		name := validText(r.Body.S("name"), 200)
		require(t.one("SELECT id FROM workflows WHERE tenant_id=$1 AND name=$2 AND deleted_at IS NULL AND id<>$3", r.TenantID, name, w.S("id")) == nil, 409, "workflow_conflict")
		add("name", name)
	}
	if _, ok := r.Body["description"]; ok {
		add("description", r.Body.S("description"))
	}
	if _, ok := r.Body["graph"]; ok {
		add("graph", graphText(r))
	}
	require(len(cols) > 0, 400, "invalid_input")
	vals = append(vals, w.S("id"), r.TenantID)
	idPh, tidPh := itoa(len(vals)-1), itoa(len(vals))
	t.exec("UPDATE workflows SET "+strings.Join(cols, ",")+",version=version+1,updated_at=now() WHERE id=$"+idPh+" AND tenant_id=$"+tidPh, vals...)
	return workflow(t, r.TenantID, w.S("id"))
}

func deleteWorkflow(t *transaction, r *PublicRequest) Object {
	w := workflow(t, r.TenantID, r.WorkflowID)
	version(w, r.Body.N("version"))
	t.exec("UPDATE workflows SET deleted_at=now(),version=version+1,updated_at=now() WHERE id=$1", w.S("id"))
	return t.one("SELECT * FROM workflows WHERE id=$1 AND tenant_id=$2", w.S("id"), r.TenantID)
}

// workflowSnapshot loads one snapshot row scoped to a live workflow: archiving the
// workflow hides its whole history, and a cursor to any other workflow is 404.
func workflowSnapshot(t *transaction, tid, wid, sid string) Object {
	require(validID(sid), 404, "not_found")
	workflow(t, tid, wid)
	s := t.one("SELECT * FROM workflow_snapshots WHERE id=$1 AND tenant_id=$2 AND workflow_id=$3", sid, tid, wid)
	require(s != nil, 404, "not_found")
	return s
}

func workflowSnapshotList(t *transaction, r *PublicRequest) Object {
	workflow(t, r.TenantID, r.WorkflowID)
	return page(t, "SELECT * FROM workflow_snapshots WHERE tenant_id=$1 AND workflow_id=$2", []any{r.TenantID, r.WorkflowID}, "id", r)
}

// publishWorkflow freezes the live graph into the next snapshot version. The workflow
// row is locked for the transaction, so two publishes cannot both pick the same next
// version. The snapshot name defaults to the workflow name; the body may override it.
func publishWorkflow(t *transaction, r *PublicRequest) Object {
	w := t.one("SELECT * FROM workflows WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE", r.WorkflowID, r.TenantID)
	require(w != nil, 404, "not_found")
	next := t.one("SELECT COALESCE(MAX(version),0)+1 AS version FROM workflow_snapshots WHERE tenant_id=$1 AND workflow_id=$2", r.TenantID, r.WorkflowID).N("version")
	name := w.S("name")
	if r.Body.S("name") != "" {
		name = validText(r.Body.S("name"), 200)
	}
	id := newID()
	t.exec("INSERT INTO workflow_snapshots(id,tenant_id,workflow_id,version,name,graph) VALUES($1,$2,$3,$4,$5,$6)", id, r.TenantID, r.WorkflowID, next, name, jsonText(w.O("graph")))
	return t.one("SELECT * FROM workflow_snapshots WHERE id=$1 AND tenant_id=$2", id, r.TenantID)
}

// restoreWorkflowSnapshot replaces the live graph with a chosen snapshot's, advancing
// the workflow document version like any editing write would.
func restoreWorkflowSnapshot(t *transaction, r *PublicRequest) Object {
	w := workflow(t, r.TenantID, r.WorkflowID)
	version(w, r.Body.N("version"))
	s := workflowSnapshot(t, r.TenantID, r.WorkflowID, r.SnapshotID)
	t.exec("UPDATE workflows SET graph=$1,version=version+1,updated_at=now() WHERE id=$2 AND tenant_id=$3", jsonText(s.O("graph")), w.S("id"), r.TenantID)
	return workflow(t, r.TenantID, w.S("id"))
}
