package core

import "context"

// CreateRunWorkspace idempotently creates the isolated Workspace and its create_workspace operation
// for one Agent IssueRun. When the Project already has an operation, it returns busy and creates
// nothing: the caller retries. The Workspace is not reachable from the public Workspace API.
func (s *Store) CreateRunWorkspace(ctx context.Context, runID string) (Object, error) {
	return s.transact(ctx, func(t *transaction) Object { return createRunWorkspace(t, runID) })
}

// DeleteRunWorkspace idempotently queues deletion of the run Workspace. A busy Project returns busy.
func (s *Store) DeleteRunWorkspace(ctx context.Context, runID string) (Object, error) {
	return s.transact(ctx, func(t *transaction) Object { return deleteRunWorkspace(t, runID) })
}

func createRunWorkspace(t *transaction, runID string) Object {
	run := t.one("SELECT r.*,i.project_ref,i.creator_user_id FROM issue_runs r JOIN issues i ON i.id=r.issue_id WHERE r.id=$1 AND r.deleted_at IS NULL AND i.deleted_at IS NULL", runID)
	require(run != nil, 404, "not_found")
	require(run.S("executorType") == "agent", 409, "invalid_run")
	require(run.S("projectRef") != "", 409, "issue_project_required")
	if existing := t.one("SELECT * FROM workspaces WHERE issue_run_id=$1", runID); existing != nil {
		op := t.one("SELECT * FROM operations WHERE workspace_id=$1 AND kind='create_workspace' ORDER BY created_at,id LIMIT 1", existing.S("id"))
		return Object{"busy": false, "workspace": existing, "operation": op}
	}
	p := t.one("SELECT * FROM projects WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL", run.S("projectRef"), run.S("tenantId"))
	require(p != nil, 404, "not_found")
	if p.S("lifecycle") != "active" || t.one("SELECT id FROM operations WHERE project_id=$1 AND state IN ('queued','running','retry_wait','blocked')", p.S("id")) != nil {
		return Object{"busy": true}
	}
	wid := newID()
	ref := p.S("defaultBranch")
	require(ref != "" && ref != "HEAD", 400, "default_branch_required")
	insertWorkspace(t, run.S("tenantId"), p.S("ownerUserId"), run.S("creatorUserId"), p.S("id"), wid, "isolated", ref, "Agent run")
	t.exec("UPDATE workspaces SET issue_run_id=$2 WHERE id=$1", wid, runID)
	actor := run.S("creatorUserId")
	op := newOperation(t, &PublicRequest{TenantID: run.S("tenantId"), Key: "run-workspace-" + runID + "-create"}, actor, p.S("id"), wid, "create_workspace", "sandbox", requestHash("run-workspace", runID, Object{"kind": "create"}), Object{})
	return Object{"busy": false, "workspace": t.one("SELECT * FROM workspaces WHERE id=$1", wid), "operation": op}
}

func deleteRunWorkspace(t *transaction, runID string) Object {
	w := t.one("SELECT * FROM workspaces WHERE issue_run_id=$1", runID)
	require(w != nil, 404, "not_found")
	if w["deletedAt"] != nil {
		return Object{"busy": false, "workspace": w}
	}
	if existing := t.one("SELECT * FROM operations WHERE workspace_id=$1 AND kind='delete_workspace' AND state IN ('queued','running','retry_wait','blocked','succeeded') ORDER BY created_at DESC,id DESC LIMIT 1", w.S("id")); existing != nil {
		return Object{"busy": false, "workspace": w, "operation": existing}
	}
	if t.one("SELECT id FROM operations WHERE project_id=$1 AND state IN ('queued','running','retry_wait','blocked')", w.S("projectId")) != nil {
		return Object{"busy": true}
	}
	closeAdmission(t, w, "deleted")
	actor := w.S("creatorUserId")
	op := newOperation(t, &PublicRequest{TenantID: w.S("tenantId"), Key: "run-workspace-" + runID + "-delete"}, actor, w.S("projectId"), w.S("id"), "delete_workspace", "quiesce", requestHash("run-workspace-delete", runID, Object{}), Object{})
	reserveRuntimeMaintenance(t, w.S("id"), op.S("id"))
	return Object{"busy": false, "workspace": t.one("SELECT * FROM workspaces WHERE id=$1", w.S("id")), "operation": op}
}
