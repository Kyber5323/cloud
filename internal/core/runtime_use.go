package core

import (
	"encoding/json"
	"fmt"
)

// runtimeOverviewKeys are safe for every active member. They name the runtime
// and its creator, lifecycle and admission, and they exclude refs, commits and
// operation payloads.
var runtimeOverviewKeys = []string{
	"id", "tenantId", "ownerUserId", "projectId", "kind", "desiredState", "observedState",
	"runtimeGeneration", "version", "admissionOpen", "admissionEpoch", "createdAt", "deletedAt",
	"title", "creatorUserId", "creatorResolution", "creatorResolutionReason",
}

// bindRuntimeCreator stores the verified requester as the runtime creator.
// The creator foreign key points at the create operation, and that operation
// points at the workspace, so the workspace is inserted first and updated in
// the same transaction. owner_user_id is left as the project owner.
func bindRuntimeCreator(t *transaction, workspaceID, creatorID, operationID, source string) {
	t.exec(`UPDATE workspaces
SET creator_user_id=$2, creator_resolution='known', creator_resolution_reason=NULL,
    creator_source=$4, creator_source_operation_id=$3
WHERE id=$1`, workspaceID, creatorID, operationID, source)
}

// runtimeContentAllowed reports whether this membership may see or use the
// runtime's content. Unknown creators are limited to a current administrator.
// The role is the membership row just read, so a demotion applies on the next check.
func runtimeContentAllowed(role, uid string, w Object) bool {
	if role == "admin" {
		return true
	}
	return w.S("creatorResolution") == "known" && w.S("creatorUserId") == uid
}

// requireRuntimeUse rejects a caller who is not the creator or a current
// administrator. The code is distinct from resource_in_use: occupancy is a
// later check and must not describe a missing permission.
func requireRuntimeUse(t *transaction, tid, uid string, w Object) {
	m := membership(t, tid, uid, false)
	require(runtimeContentAllowed(m.S("role"), uid, w), 403, "runtime_use_forbidden")
}

// authorizeOperationUse applies runtime use to the operation's target. A
// project-scoped operation, such as project deletion, covers every runtime of
// that project, including rows kept for cleanup. Knowing the operation id or
// being its historical actor does not grant the detail.
func authorizeOperationUse(t *transaction, tid, uid string, o Object) {
	if wid := o.S("workspaceId"); wid != "" {
		w := t.one("SELECT * FROM workspaces WHERE id=$1 AND tenant_id=$2", wid, tid)
		require(w != nil, 404, "not_found")
		requireRuntimeUse(t, tid, uid, w)
		return
	}
	for _, w := range t.list("SELECT * FROM workspaces WHERE project_id=$1 AND tenant_id=$2", o.S("projectId"), tid) {
		requireRuntimeUse(t, tid, uid, w)
	}
}

// presentRuntime returns the stored row to a caller who may use it, and only
// the overview otherwise. contentAllowed tells the two list shapes apart.
func presentRuntime(w Object, allowed bool) Object {
	out := Object{}
	if allowed {
		for k, v := range w {
			out[k] = v
		}
	} else {
		for _, k := range runtimeOverviewKeys {
			if v, ok := w[k]; ok {
				out[k] = v
			}
		}
	}
	out["contentAllowed"] = allowed
	return out
}

// runtimeList returns every runtime in the project, or only those the caller
// created. scope=all is the default. Members still receive an overview of
// runtimes they cannot use; content fields stay off those rows.
func runtimeList(t *transaction, r *PublicRequest, uid, projectID string) Object {
	scope := r.Scope
	if scope == "" {
		scope = "all"
	}
	require(scope == "all" || scope == "own", 400, "invalid_input")
	role := membership(t, r.TenantID, uid, false).S("role")
	q := "SELECT w.*,wt.branch_name,task.title FROM workspaces w LEFT JOIN workspace_worktrees wt ON wt.workspace_id=w.id LEFT JOIN tasks task ON task.workspace_id=w.id WHERE w.project_id=$1 AND w.tenant_id=$2 AND w.deleted_at IS NULL"
	args := []any{projectID, r.TenantID}
	if scope == "own" {
		q += " AND w.creator_resolution='known' AND w.creator_user_id=$3"
		args = append(args, uid)
	}
	listed := page(t, q, args, "w.id", r)
	items := listed["items"].([]Object)
	for i := range items {
		items[i] = presentRuntime(items[i], runtimeContentAllowed(role, uid, items[i]))
	}
	listed["items"] = items
	return listed
}

// runtimeOccupied reports an active execution ticket. It is the current
// occupancy signal for access; a missing control session is not treated as idle.
func runtimeOccupied(t *transaction, wid string) bool {
	return t.one("SELECT id FROM execution_tickets WHERE workspace_id=$1 AND state='active'", wid) != nil
}

// MarshalSpaceEvent encodes the refresh notice a subscriber may receive.
// The allowlist is the whole payload: runtime content is read again over REST,
// which checks the creator or current administrator.
func MarshalSpaceEvent(ev SpaceEvent) ([]byte, error) {
	switch ev.Type {
	case "space.updated", "space.member_updated", "project.created", "project.updated", "project.archived", "space.plugins_updated", "plugins.catalog_updated":
	default:
		return nil, fmt.Errorf("undeliverable space event %s", ev.Type)
	}
	return json.Marshal(struct {
		Type      string `json:"type"`
		SpaceID   string `json:"spaceId"`
		ProjectID string `json:"projectId,omitempty"`
		Version   int64  `json:"version,omitempty"`
	}{ev.Type, ev.SpaceID, ev.ProjectID, ev.Version})
}
