package core

// protocolGenerationRuntimeControl is the only protocol generation that may
// record a fenced dispatch. Zero and 1 are the old controller protocol.
const protocolGenerationRuntimeControl int64 = 2

// controlDispatch is the internal entry for one new execution record. Old
// protocol and an unauthenticated caller are refused before a lease replay can
// return a stored response. The caller does not choose the actor.
func controlDispatch(t *transaction, r *ControlRequest) Object {
	require(r.Body.N("protocolGeneration") == protocolGenerationRuntimeControl, 400, "unsupported_protocol")
	require(deliveryAuthenticated(r), 403, "control_capability_unavailable")
	leaseValid(t, r)
	return submitted(t, r, func() Object { return recordControlDispatch(t, r) })
}

// deliveryAuthenticated reports a controller whose service identity was bound
// by a deployment verifier. A verified HTTP service JWT is not that binding,
// and neither is x-ora-controller-id.
func deliveryAuthenticated(r *ControlRequest) bool {
	return r != nil && r.Service != nil && r.Service.Role == "controller" && r.Service.DeliveryAuthenticated
}

// recordControlDispatch checks the current runtime permission and, only then,
// inserts the execution identity, the fixed input and the control epoch.
// A repeated execution id returns the original row and does not apply the
// permission again, so a lost reply cannot mint a second responsibility.
// Refusing a dispatch does not expire the session or change observed_state.
func recordControlDispatch(t *transaction, r *ControlRequest) Object {
	require(r.Body.N("protocolGeneration") == protocolGenerationRuntimeControl, 400, "unsupported_protocol")
	require(deliveryAuthenticated(r), 403, "control_capability_unavailable")
	wid, execution := r.Body.S("workspaceId"), r.Body.S("executionId")
	require(validID(wid) && execution != "" && len(execution) <= 200, 400, "invalid_dispatch")
	require(r.Body.N("controlEpoch") > 0 && r.Body.N("runtimeGeneration") > 0, 400, "invalid_dispatch")
	fixed := cloneDispatchInput(r.Body.O("input"))
	if existing := t.one("SELECT * FROM runtime_control_dispatches WHERE execution_id=$1", execution); existing != nil {
		require(dispatchMatches(existing, wid, r.Body.N("controlEpoch"), r.Body.N("runtimeGeneration"), fixed), 409, "dispatch_conflict")
		return presentControlDispatch(existing)
	}
	w := t.one("SELECT * FROM workspaces WHERE id=$1 AND deleted_at IS NULL", wid)
	require(w != nil, 404, "not_found")
	// Force-stop and a frozen credential are current facts. They block a new
	// execution even when an earlier session row is still open.
	require(openForceStop(t, wid) == nil, 409, "termination_unconfirmed")
	require(!projectCredentialFrozen(t, w.S("projectId")), 409, "credential_unavailable")
	require(w.N("runtimeGeneration") == r.Body.N("runtimeGeneration"), 409, "dispatch_conflict")
	session := openRuntimeControl(t, wid)
	require(session != nil && session.S("state") == "held" && !session.B("leaseExpired") && session.N("controlEpoch") == r.Body.N("controlEpoch"), 409, "control_not_held")
	if session.S("holderKind") == "user" {
		requireRuntimeUse(t, w.S("tenantId"), session.S("holderUserId"), w)
	} else {
		require(session.S("holderKind") == "system_maintenance", 409, "control_not_held")
	}
	// One open conflicting write already owns the runtime. This dispatch would
	// be a second writer, so it is refused before an execution row exists.
	require(t.one("SELECT id FROM runtime_write_activities WHERE workspace_id=$1 AND state IN ('active','unknown')", wid) == nil, 409, "resource_in_use")
	project := t.one("SELECT repository_url FROM projects WHERE id=$1", w.S("projectId"))
	require(project != nil && fixed.S("repositoryUrl") == project.S("repositoryUrl") && fixed.S("branch") == w.S("requestedRef"), 409, "dispatch_conflict")
	actorKind := "user"
	var actor any
	if session.S("holderKind") == "system_maintenance" {
		actorKind = "system"
	} else {
		actor = session.S("holderUserId")
	}
	t.exec(`INSERT INTO runtime_control_dispatches(
		execution_id,tenant_id,workspace_id,session_id,control_epoch,runtime_generation,
		actor_user_id,actor_kind,input,protocol_generation)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,2)`,
		execution, w.S("tenantId"), wid, session.S("id"), session.N("controlEpoch"), w.N("runtimeGeneration"), actor, actorKind, jsonText(fixed))
	return presentControlDispatch(t.one("SELECT * FROM runtime_control_dispatches WHERE execution_id=$1", execution))
}

// cloneDispatchInput keeps only the clone fields Cloud can pin to the runtime.
// Any other kind, or a secret-shaped field, is not a fixed input.
func cloneDispatchInput(input Object) Object {
	require(len(input) > 0, 400, "invalid_dispatch")
	for key := range input {
		switch key {
		case "kind", "repositoryUrl", "branch":
		default:
			reject(400, "invalid_dispatch")
		}
	}
	require(input.S("kind") == "clone" && input.S("repositoryUrl") != "" && input.S("branch") != "", 400, "invalid_dispatch")
	return Object{"kind": "clone", "repositoryUrl": input.S("repositoryUrl"), "branch": input.S("branch")}
}

func dispatchMatches(existing Object, wid string, epoch, generation int64, fixed Object) bool {
	return existing.S("workspaceId") == wid && existing.N("controlEpoch") == epoch && existing.N("runtimeGeneration") == generation && jsonText(existing.O("input")) == jsonText(fixed)
}

func presentControlDispatch(row Object) Object {
	return Object{
		"executionId":       row.S("executionId"),
		"workspaceId":       row.S("workspaceId"),
		"controlEpoch":      row.N("controlEpoch"),
		"runtimeGeneration": row.N("runtimeGeneration"),
		"input":             row.O("input"),
	}
}
