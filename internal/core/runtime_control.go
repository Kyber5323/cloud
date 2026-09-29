package core

import "strings"

// runtimeControlLease is the approved operation lease. Callers renew every 20
// seconds; each accepted renew resets this database-clock deadline. It is not
// evidence that a process has stopped.
const runtimeControlLease = "60 seconds"

// readRuntimeControl returns the authoritative session view. Acquiring, winding
// down and reconciling stay visible; a missing execution ticket is not idle.
func readRuntimeControl(t *transaction, r *PublicRequest, uid string) Object {
	w := workspace(t, r.TenantID, uid, r.WorkspaceID, false)
	return presentRuntimeControl(t, r, uid, w)
}

// mutateRuntimeControl acquires, renews, releases or reserves one conflicting
// write. The body cannot choose the holder, role or control epoch.
func mutateRuntimeControl(t *transaction, r *PublicRequest, uid string) Object {
	switch {
	case strings.HasSuffix(r.Path, "/activities"):
		return beginRuntimeWrite(t, r, uid)
	case strings.HasSuffix(r.Path, "/renew"):
		return renewRuntimeControl(t, r, uid)
	case strings.HasSuffix(r.Path, "/release"):
		return releaseRuntimeControl(t, r, uid)
	case strings.HasSuffix(r.Path, "/control"):
		return acquireRuntimeControl(t, r, uid)
	default:
		reject(404, "not_found")
		return nil
	}
}

func acquireRuntimeControl(t *transaction, r *PublicRequest, uid string) Object {
	w := runtimeForControl(t, r, uid)
	// Accepted force-stop withdraws handoff until termination is confirmed.
	// Use permission was already checked, so this is not a hidden 403.
	if openForceStop(t, w.S("id")) != nil {
		reject(409, "termination_unconfirmed")
	}
	// An open session, including one still reconciling an unknown execution,
	// keeps the single holder. A known active ticket can be reserved as
	// acquiring, but it does not become a held lease.
	if settleRuntimeControl(t, w) != nil || unknownExecution(t, w.S("id")) {
		reject(409, "resource_in_use")
	}
	state := "held"
	if executionBlocksHandoff(t, w.S("id")) {
		state = "acquiring"
	}
	insertRuntimeControl(t, w, uid, state)
	return presentRuntimeControl(t, r, uid, w)
}

func renewRuntimeControl(t *transaction, r *PublicRequest, uid string) Object {
	w := runtimeForControl(t, r, uid)
	require(validID(r.Body.S("sessionId")), 400, "invalid_input")
	session := matchingControlSession(t, w, uid, r.Body.S("sessionId"))
	if session.S("state") == "acquiring" {
		if executionBlocksHandoff(t, w.S("id")) {
			reject(409, "control_not_held")
		}
		// The same binding becomes held only after this database confirms that
		// no accepted execution is still running. The epoch does not change.
		t.exec("UPDATE runtime_control_sessions SET state='held', change_reason='confirmed', expires_at=clock_timestamp()+$2::interval, version=version+1, updated_at=clock_timestamp() WHERE id=$1 AND state='acquiring'", session.S("id"), runtimeControlLease)
		return presentRuntimeControl(t, r, uid, w)
	}
	if session.S("state") != "held" {
		reject(409, "control_not_held")
	}
	// A late or replayed renew must not match. Idempotent replay never reaches
	// this update, so a stored success cannot extend the row again.
	n := t.execRows("UPDATE runtime_control_sessions SET expires_at=clock_timestamp()+$2::interval, change_reason='renew', version=version+1, updated_at=clock_timestamp() WHERE id=$1 AND state='held' AND holder_user_id=$3 AND expires_at>clock_timestamp()", session.S("id"), runtimeControlLease, uid)
	require(n == 1, 409, "control_not_held")
	return presentRuntimeControl(t, r, uid, w)
}

func releaseRuntimeControl(t *transaction, r *PublicRequest, uid string) Object {
	w := runtimeForControl(t, r, uid)
	require(validID(r.Body.S("sessionId")), 400, "invalid_input")
	session := matchingControlSession(t, w, uid, r.Body.S("sessionId"))
	switch {
	case unknownExecution(t, w.S("id")):
		setRuntimeControlState(t, session, "reconciling", "release")
	case executionBlocksHandoff(t, w.S("id")):
		setRuntimeControlState(t, session, "winding_down", "release")
	default:
		closeRuntimeControl(t, session, "release")
	}
	return presentRuntimeControl(t, r, uid, w)
}

// beginRuntimeWrite reserves the one conflicting write for the held session.
// It does not touch files, Git or processes; a second reservation is refused
// before any row is inserted.
func beginRuntimeWrite(t *transaction, r *PublicRequest, uid string) Object {
	w := runtimeForControl(t, r, uid)
	require(validID(r.Body.S("sessionId")), 400, "invalid_input")
	session := matchingControlSession(t, w, uid, r.Body.S("sessionId"))
	if session.S("state") != "held" || session.B("leaseExpired") {
		reject(409, "control_not_held")
	}
	require(t.one("SELECT id FROM runtime_write_activities WHERE workspace_id=$1 AND state IN ('active','unknown')", w.S("id")) == nil, 409, "resource_in_use")
	require(!runtimeOccupied(t, w.S("id")), 409, "resource_in_use")
	t.exec("INSERT INTO runtime_write_activities(id,tenant_id,workspace_id,session_id,actor_user_id,actor_kind,state) VALUES($1,$2,$3,$4,$5,'user','active')", newID(), w.S("tenantId"), w.S("id"), session.S("id"), uid)
	return presentRuntimeControl(t, r, uid, w)
}

// requireHeldRuntimeControl lets an ordinary lifecycle action proceed only for
// the caller that currently holds an unexpired session. Another holder is
// occupancy; a missing binding is not permission failure.
func requireHeldRuntimeControl(t *transaction, r *PublicRequest, uid string, w Object) {
	session := settleRuntimeControl(t, w)
	if session != nil && session.S("holderUserId") != uid {
		reject(409, "resource_in_use")
	}
	if session == nil || r.Body.S("sessionId") != session.S("id") {
		reject(409, "control_required")
	}
	if session.S("state") != "held" || session.B("leaseExpired") {
		reject(409, "control_not_held")
	}
}

// revokeLostRuntimeControl runs in the membership transaction so a disable or
// demotion drops operation rights before the next request.
func revokeLostRuntimeControl(t *transaction, tid, uid string) {
	for _, row := range t.list("SELECT workspace_id FROM runtime_control_sessions WHERE tenant_id=$1 AND holder_user_id=$2 AND state IN ('acquiring','held','winding_down','reconciling')", tid, uid) {
		w := t.one("SELECT * FROM workspaces WHERE id=$1 AND tenant_id=$2", row.S("workspaceId"), tid)
		if w != nil {
			settleRuntimeControl(t, w)
		}
	}
}

func runtimeForControl(t *transaction, r *PublicRequest, uid string) Object {
	w := workspace(t, r.TenantID, uid, r.WorkspaceID, false)
	requireRuntimeUse(t, r.TenantID, uid, w)
	return w
}

func matchingControlSession(t *transaction, w Object, uid, sessionID string) Object {
	session := settleRuntimeControl(t, w)
	if session != nil && session.S("holderUserId") != uid {
		reject(409, "resource_in_use")
	}
	if session == nil || session.S("id") != sessionID {
		reject(409, "control_required")
	}
	return session
}

func insertRuntimeControl(t *transaction, w Object, uid, state string) {
	wid := w.S("id")
	t.exec("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", wid)
	epoch := t.one("SELECT COALESCE(MAX(control_epoch),0)+1 AS next_epoch FROM runtime_control_sessions WHERE workspace_id=$1", wid).N("nextEpoch")
	t.exec("INSERT INTO runtime_control_sessions(id,tenant_id,workspace_id,holder_user_id,holder_kind,control_epoch,state,expires_at,change_reason) VALUES($1,$2,$3,$4,'user',$5,$6,clock_timestamp()+$7::interval,'acquire')", newID(), w.S("tenantId"), wid, uid, epoch, state, runtimeControlLease)
}

func presentRuntimeControl(t *transaction, r *PublicRequest, uid string, w Object) Object {
	session := settleRuntimeControl(t, w)
	blocks := executionBlocksHandoff(t, w.S("id"))
	state := "idle"
	if session != nil {
		state = session.S("state")
	} else if blocks {
		// Accepted or unknown execution still blocks handoff when no session row is open.
		state = "reconciling"
	}
	role := membership(t, r.TenantID, uid, false).S("role")
	out := Object{
		"workspaceId":    w.S("id"),
		"controlState":   state,
		"leaseExpired":   session != nil && session.B("leaseExpired"),
		"observedState":  w.S("observedState"),
		"callerHolds":    false,
		"allowedActions": emptyControlActions(),
	}
	if !runtimeContentAllowed(role, uid, w) {
		return out
	}
	out["allowedActions"] = runtimeControlActions(t, uid, w, session, blocks)
	if session == nil {
		return out
	}
	out["sessionId"] = session.S("id")
	out["holderUserId"] = session.S("holderUserId")
	out["controlEpoch"] = session.N("controlEpoch")
	out["expiresAt"] = session.S("expiresAt")
	out["version"] = session.N("version")
	out["callerHolds"] = session.S("holderUserId") == uid
	return out
}

func emptyControlActions() []any { return make([]any, 0) }

func runtimeControlActions(t *transaction, uid string, w, session Object, blocks bool) []any {
	actions := emptyControlActions()
	if openForceStop(t, w.S("id")) != nil {
		// Takeover, restart and data deletion stay closed while the intent is open.
		return actions
	}
	held := session != nil && session.S("state") == "held" && !session.B("leaseExpired") && session.S("holderUserId") == uid
	if session == nil && !blocks {
		actions = append(actions, "acquire")
	}
	if held {
		actions = append(actions, "renew")
	}
	if session != nil && session.S("holderUserId") == uid {
		actions = append(actions, "release")
	}
	if !held {
		return actions
	}
	project := t.one("SELECT lifecycle FROM projects WHERE id=$1", w.S("projectId"))
	if project.S("lifecycle") != "active" || t.one("SELECT id FROM operations WHERE project_id=$1 AND state IN ('queued','running','retry_wait','blocked')", w.S("projectId")) != nil {
		return actions
	}
	if w.S("desiredState") == "stopped" && w.S("observedState") == "stopped" {
		actions = append(actions, "start")
	}
	if (w.S("observedState") == "ready" || w.S("observedState") == "stopped" || w.S("observedState") == "unavailable") && !runtimeOccupied(t, w.S("id")) {
		actions = append(actions, "stop")
		if w.S("kind") == "isolated" {
			actions = append(actions, "delete")
		}
	}
	if !blocks {
		actions = append(actions, "write")
	}
	return actions
}

// settleRuntimeControl applies expiry and lost permission with the database
// clock. It never writes the runtime's observed state: a lease ending is not
// a stopped process, and unknown work stays reconciling instead of idle.
func settleRuntimeControl(t *transaction, w Object) Object {
	t.exec("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", w.S("id"))
	session := openRuntimeControl(t, w.S("id"))
	if session == nil {
		return nil
	}
	unknown := unknownExecution(t, w.S("id"))
	blocks := executionBlocksHandoff(t, w.S("id"))
	lost := holderLostRuntimeUse(t, w, session)
	expired := session.B("leaseExpired")
	switch session.S("state") {
	case "held":
		if !expired && !lost {
			return session
		}
		return finishControlLease(t, session, blocks, unknown, controlLossReason(expired, lost))
	case "acquiring":
		if expired || lost {
			return setRuntimeControlState(t, session, "reconciling", controlLossReason(expired, lost))
		}
		return session
	case "winding_down":
		if unknown {
			return setRuntimeControlState(t, session, "reconciling", "unknown_execution")
		}
		if blocks {
			return session
		}
		closeRuntimeControl(t, session, "handoff")
		return nil
	case "reconciling":
		if blocks || unknown {
			return session
		}
		closeRuntimeControl(t, session, "handoff")
		return nil
	default:
		return session
	}
}

func finishControlLease(t *transaction, session Object, blocks, unknown bool, reason string) Object {
	if unknown {
		return setRuntimeControlState(t, session, "reconciling", reason)
	}
	if blocks {
		return setRuntimeControlState(t, session, "winding_down", reason)
	}
	closeRuntimeControl(t, session, reason)
	return nil
}

func controlLossReason(expired, lost bool) string {
	if lost {
		return "permission_revoked"
	}
	if expired {
		return "expire"
	}
	return "handoff"
}

func holderLostRuntimeUse(t *transaction, w, session Object) bool {
	if session.S("holderKind") != "user" {
		return false
	}
	m := t.one("SELECT m.role, m.status FROM tenant_memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND u.status='active' AND u.deleted_at IS NULL", w.S("tenantId"), session.S("holderUserId"))
	if m == nil || m.S("status") != "active" {
		return true
	}
	return !runtimeContentAllowed(m.S("role"), session.S("holderUserId"), w)
}

func executionBlocksHandoff(t *transaction, wid string) bool {
	return runtimeOccupied(t, wid) || t.one("SELECT id FROM runtime_write_activities WHERE workspace_id=$1 AND state IN ('active','unknown')", wid) != nil
}

func unknownExecution(t *transaction, wid string) bool {
	return t.one("SELECT id FROM runtime_write_activities WHERE workspace_id=$1 AND state='unknown'", wid) != nil
}

func openRuntimeControl(t *transaction, wid string) Object {
	return t.one("SELECT s.*, (s.expires_at <= clock_timestamp()) AS lease_expired FROM runtime_control_sessions s WHERE s.workspace_id=$1 AND s.state IN ('acquiring','held','winding_down','reconciling')", wid)
}

func setRuntimeControlState(t *transaction, session Object, state, reason string) Object {
	t.exec("UPDATE runtime_control_sessions SET state=$2, change_reason=$3, version=version+1, updated_at=clock_timestamp() WHERE id=$1 AND state<>'closed'", session.S("id"), state, reason)
	return openRuntimeControl(t, session.S("workspaceId"))
}

func closeRuntimeControl(t *transaction, session Object, reason string) {
	t.exec("UPDATE runtime_control_sessions SET state='closed', closed_at=clock_timestamp(), change_reason=$2, version=version+1, updated_at=clock_timestamp() WHERE id=$1 AND closed_at IS NULL", session.S("id"), reason)
}
