package core

import "context"

// A collaboration space is the sole visible representation of its tenant.
// Tenant membership is the only source of its active role and permissions.

// workspaceRole returns the active membership role of uid in spaceID, or "" when
// uid is not an active member of a live, unarchived space and tenant.
// It returns "admin" or "member".
func workspaceRole(t *transaction, spaceID, uid string) string {
	if !validID(spaceID) || !validID(uid) {
		return ""
	}
	m := t.one(`SELECT tm.role FROM collab_workspaces w
JOIN tenant_memberships tm ON tm.tenant_id=w.tenant_id AND tm.user_id=$2
JOIN users u ON u.id=tm.user_id
JOIN tenants tn ON tn.id=w.tenant_id
WHERE w.id=$1
AND w.archived_at IS NULL
AND tm.status='active' AND u.status='active' AND u.deleted_at IS NULL
AND tn.status='active' AND tn.deleted_at IS NULL`, spaceID, uid)
	if m == nil {
		return ""
	}
	return m.S("role")
}

// workspacePerm runs a boolean predicate inside a transaction and surfaces any
// database error to the caller; a failed check still reads false (fail closed).
func (s *Store) workspacePerm(ctx context.Context, pred func(*transaction) bool) (bool, error) {
	out, err := s.transact(ctx, func(t *transaction) Object {
		return Object{"ok": pred(t)}
	})
	if err != nil {
		return false, err
	}
	return out.B("ok"), nil
}

// IsWorkspaceMember reports whether uid is an active member of spaceID.
func (s *Store) IsWorkspaceMember(ctx context.Context, spaceID, uid string) (bool, error) {
	return s.workspacePerm(ctx, func(t *transaction) bool {
		return workspaceRole(t, spaceID, uid) != ""
	})
}

// IsWorkspaceAdmin reports whether uid is an active tenant admin of spaceID.
func (s *Store) IsWorkspaceAdmin(ctx context.Context, spaceID, uid string) (bool, error) {
	return s.workspacePerm(ctx, func(t *transaction) bool {
		return workspaceRole(t, spaceID, uid) == "admin"
	})
}

// workspaceCanDelete requires current tenant administrator authority regardless
// of who originally created the resource.
func workspaceCanDelete(t *transaction, spaceID, uid, _ string) bool {
	return workspaceRole(t, spaceID, uid) == "admin"
}

// CanDeleteWorkspaceResource reports current tenant administrator authority.
// creatorUserID is retained for source compatibility but grants no privilege.
func (s *Store) CanDeleteWorkspaceResource(ctx context.Context, spaceID, uid, creatorUserID string) (bool, error) {
	return s.workspacePerm(ctx, func(t *transaction) bool {
		return workspaceCanDelete(t, spaceID, uid, creatorUserID)
	})
}
