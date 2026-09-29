package core

// acceptForceStop records one independent termination responsibility.
// It does not create an operation, so an in-flight lifecycle keeps the project
// slot, and it does not mark the runtime stopped: that requires substrate
// evidence this phase does not have. State stays requested.
func acceptForceStop(t *transaction, r *PublicRequest, uid, hash string) Object {
	// The route is administrator-only. Repeating the check keeps the rule in
	// the command, not only in the HTTP allowlist.
	membership(t, r.TenantID, uid, true)
	w := workspace(t, r.TenantID, uid, r.WorkspaceID, true)
	version(w, r.Body.N("version"))
	reason := validText(r.Body.S("reason"), 2000)
	t.exec("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", w.S("id"))
	require(openForceStop(t, w.S("id")) == nil, 409, "resource_in_use")
	id := newID()
	t.exec(`INSERT INTO runtime_force_stop_intents(
		id,tenant_id,workspace_id,initiator_user_id,target_runtime_generation,reason,idempotency_key,request_hash,state)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,'requested')`,
		id, r.TenantID, w.S("id"), uid, w.N("runtimeGeneration"), reason, r.Key, hash)
	linkForceStop(t, id, w)
	// Ordinary qualification ends now. In-flight tickets, writes and operations
	// stay so their actors and results are not rewritten.
	t.exec(`UPDATE runtime_control_sessions
		SET state='closed', closed_at=clock_timestamp(), change_reason='force_stop', version=version+1, updated_at=clock_timestamp()
		WHERE workspace_id=$1 AND state IN ('acquiring','held','winding_down','reconciling')`, w.S("id"))
	// Close new admission without changing desired or observed state. A closed
	// lease is not evidence the process has stopped.
	t.exec("UPDATE workspaces SET admission_open=false, admission_epoch=admission_epoch+1, version=version+1 WHERE id=$1", w.S("id"))
	return presentForceStop(t.one("SELECT * FROM runtime_force_stop_intents WHERE id=$1", id))
}

func presentForceStop(row Object) Object {
	return Object{
		"id":                      row.S("id"),
		"tenantId":                row.S("tenantId"),
		"workspaceId":             row.S("workspaceId"),
		"initiatorUserId":         row.S("initiatorUserId"),
		"targetRuntimeGeneration": row.N("targetRuntimeGeneration"),
		"reason":                  row.S("reason"),
		"idempotencyKey":          row.S("idempotencyKey"),
		"state":                   row.S("state"),
		"version":                 row.N("version"),
		"createdAt":               row.S("createdAt"),
		"updatedAt":               row.S("updatedAt"),
	}
}

// openForceStop is the unconfirmed termination responsibility. A stopped row
// no longer blocks handoff; this phase never writes that state.
func openForceStop(t *transaction, wid string) Object {
	return t.one("SELECT id FROM runtime_force_stop_intents WHERE workspace_id=$1 AND state IN ('requested','terminating','reconciling')", wid)
}

func requireNoOpenForceStop(t *transaction, wid string) {
	require(openForceStop(t, wid) == nil, 409, "termination_unconfirmed")
}

// linkForceStop records the target's in-flight work. Rows are not deleted,
// completed, or failed to free the project operation.
func linkForceStop(t *transaction, intentID string, w Object) {
	for _, row := range t.list("SELECT id FROM operations WHERE project_id=$1 AND state IN ('queued','running','retry_wait','blocked') AND (workspace_id=$2 OR workspace_id IS NULL)", w.S("projectId"), w.S("id")) {
		t.exec("INSERT INTO runtime_force_stop_links(intent_id,target_kind,target_id) VALUES($1,'operation',$2)", intentID, row.S("id"))
	}
	for _, row := range t.list("SELECT id FROM execution_tickets WHERE workspace_id=$1 AND state='active'", w.S("id")) {
		t.exec("INSERT INTO runtime_force_stop_links(intent_id,target_kind,target_id) VALUES($1,'execution_ticket',$2)", intentID, row.S("id"))
	}
	for _, row := range t.list("SELECT id FROM external_effects WHERE workspace_id=$1 AND state IN ('planned','running')", w.S("id")) {
		t.exec("INSERT INTO runtime_force_stop_links(intent_id,target_kind,target_id) VALUES($1,'external_effect',$2)", intentID, row.S("id"))
	}
}

// projectDeleteConflict inspects every live runtime before any of them change.
// Another user's open session is occupancy. The deleting administrator's own
// session is not, because project deletion is not performed through that
// session. Activity and unknown writes block regardless of holder. This never
// inserts a force-stop intent.
func projectDeleteConflict(t *transaction, uid string, workspaces []Object) string {
	for _, w := range workspaces {
		settleRuntimeControl(t, w)
	}
	for _, w := range workspaces {
		if executionBlocksHandoff(t, w.S("id")) {
			return "resource_in_use"
		}
		if session := openRuntimeControl(t, w.S("id")); session != nil && session.S("holderUserId") != uid {
			return "resource_in_use"
		}
		if openForceStop(t, w.S("id")) != nil {
			return "termination_unconfirmed"
		}
	}
	return ""
}

// forceStopBlocksEffect refuses a new ordinary side effect. sandbox_terminate
// stays available so an already accepted ordinary or administrative stop can
// finish; that path does not complete the force-stop intent or delete data.
func forceStopBlocksEffect(kind string) bool {
	switch kind {
	case "sandbox_ensure", "plugin_ensure", "plugin_delete", "workspace_data_delete":
		return true
	default:
		return false
	}
}

// forceStopBlocksStep is the advance half of the same fence. quiesce and
// terminate still belong to an accepted stop and are not data deletion.
func forceStopBlocksStep(step string) bool {
	switch step {
	case "sandbox", "node", "clone", "plugin", "cleanup":
		return true
	default:
		return false
	}
}
