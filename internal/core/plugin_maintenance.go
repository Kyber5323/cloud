package core

// savePluginSelection records an administrator's desired plugin state and
// waits for each live runtime. Acceptance is not installation: the real
// plugin executor is not wired, so a Cloud plan is never observed as installed.
func installSpacePlugin(t *transaction, r *PublicRequest, uid string) Object {
	return savePluginSelection(t, r, uid, "installed")
}

// removeSpacePlugin records removal the same way. A busy or occupied runtime
// keeps the new desired state instead of failing the whole request.
func removeSpacePlugin(t *transaction, r *PublicRequest, uid string) Object {
	return savePluginSelection(t, r, uid, "removed")
}

func savePluginSelection(t *transaction, r *PublicRequest, uid, desiredState string) Object {
	requirePluginAdmin(t, r, uid)
	namespace, identifier, ok := pluginIdentity(r.Body.S("identifier"))
	require(ok, 400, "invalid_plugin_id")
	old := t.spacePluginRow(r.SpaceID, namespace, identifier)
	desiredVersion := ""
	action := "install"
	if desiredState == "removed" {
		require(old != nil, 404, "plugin_not_installed")
		version(old, r.Body.N("version"))
		desiredVersion = old.S("desiredVersion")
		action = "remove"
	} else {
		entry := t.pluginCatalogEntry(namespace + "/" + identifier)
		require(entry != nil, 404, "plugin_not_found")
		require(entry.S("kind") != "pack", 400, "plugin_kind_not_installable")
		desiredVersion = r.Body.S("pluginVersion")
		if desiredVersion == "" {
			desiredVersion = entry.S("version")
		}
		require(desiredVersion == entry.S("version"), 400, "plugin_version_unavailable")
		if old != nil && (old.S("desiredState") != "installed" || old.S("desiredVersion") != desiredVersion) {
			version(old, r.Body.N("version"))
			action = "version_change"
		}
	}
	if old == nil {
		t.exec(`INSERT INTO space_plugins(space_id,tenant_id,source_namespace,identifier,desired_state,desired_version,observed_state) VALUES($1,$2,$3,$4,$5,$6,'pending')`,
			r.SpaceID, r.TenantID, namespace, identifier, desiredState, desiredVersion)
	} else if old.S("desiredState") != desiredState || old.S("desiredVersion") != desiredVersion {
		// The previous observation belonged to the previous desired state.
		// Pending means the new desire is saved, not that install succeeded.
		t.exec(`UPDATE space_plugins SET desired_state=$4,desired_version=$5,observed_state='pending',observed_version=NULL,install_error=NULL,version=version+1,updated_at=now() WHERE space_id=$1 AND source_namespace=$2 AND identifier=$3`,
			r.SpaceID, namespace, identifier, desiredState, desiredVersion)
	}
	for _, w := range livePluginWorkspaces(t, r.SpaceID) {
		t.exec(`INSERT INTO workspace_plugin_instances(workspace_id,tenant_id,owner_user_id,project_id,source_namespace,identifier,observed_state)
			VALUES($1,$2,$3,$4,$5,$6,'pending')
			ON CONFLICT (workspace_id,source_namespace,identifier) DO NOTHING`,
			w.S("id"), w.S("tenantId"), w.S("ownerUserId"), w.S("projectId"), namespace, identifier)
		ensurePluginWait(t, r, uid, w, namespace, identifier, action, desiredVersion)
	}
	continuePluginMaintenance(t)
	return Object{
		"resource":    t.spacePluginRow(r.SpaceID, namespace, identifier),
		"maintenance": pluginMaintenanceSummary(t, r.SpaceID, namespace, identifier),
	}
}

func requirePluginAdmin(t *transaction, r *PublicRequest, uid string) {
	space := t.one("SELECT id FROM collab_workspaces WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL", r.SpaceID, r.TenantID)
	require(space != nil, 404, "not_found")
	member := spaceMember(t, r.SpaceID, uid)
	require(member.S("role") == "admin", 403, "admin_required")
}

func ensurePluginWait(t *transaction, r *PublicRequest, uid string, w Object, namespace, identifier, action, desiredVersion string) {
	open := openPluginWait(t, w.S("id"), namespace, identifier)
	if open != nil {
		// An undispatched wait can follow the new desire. An effect that
		// already left Cloud has to be reconciled before the opposite action.
		if open.S("state") == "pending" || open.S("state") == "waiting_for_start" {
			if open.S("desiredAction") != action || open.S("desiredVersion") != desiredVersion {
				t.exec(`UPDATE plugin_maintenance_waits SET desired_action=$2,desired_version=$3,version=version+1,updated_at=now() WHERE id=$1`,
					open.S("id"), action, desiredVersion)
			}
		}
		return
	}
	t.exec(`INSERT INTO plugin_maintenance_waits(id,tenant_id,space_id,project_id,workspace_id,source_namespace,identifier,desired_action,desired_version,state,initiator_user_id,idempotency_key)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11)`,
		newID(), r.TenantID, r.SpaceID, w.S("projectId"), w.S("id"), namespace, identifier, action, desiredVersion, uid, r.Key)
}

func spacePluginList(t *transaction, spaceID string) Object {
	items := t.list(`SELECT space_id,tenant_id,source_namespace,identifier,desired_state,desired_version,observed_state,observed_version,install_error,version,created_at,updated_at,(source_namespace||'/'||identifier) AS id FROM space_plugins WHERE space_id=$1 ORDER BY source_namespace,identifier`, spaceID)
	return Object{"items": items, "maintenance": pluginMaintenanceSummary(t, spaceID, "", "")}
}

func pluginMaintenanceSummary(t *transaction, spaceID, namespace, identifier string) Object {
	q := `SELECT state, count(*) AS n FROM plugin_maintenance_waits WHERE space_id=$1`
	args := []any{spaceID}
	if namespace != "" {
		q += ` AND source_namespace=$2 AND identifier=$3`
		args = append(args, namespace, identifier)
	}
	q += ` GROUP BY state`
	var affected, completed, waiting, waitingStart, failed int64
	for _, row := range t.list(q, args...) {
		n := row.N("n")
		affected += n
		switch row.S("state") {
		case "succeeded":
			completed += n
		case "waiting_for_start":
			waitingStart += n
		case "failed":
			failed += n
		default:
			waiting += n
		}
	}
	return Object{
		"affected":            affected,
		"completed":           completed,
		"waitingForOccupancy": waiting,
		"waitingForStart":     waitingStart,
		"failed":              failed,
	}
}

// continuePluginMaintenance resumes saved waits after a lease release, a
// runtime start, an operation slot freeing, or a controller claim. It does
// not require the administrator to repeat the install.
func continuePluginMaintenance(t *transaction) {
	for _, wait := range t.list(`SELECT * FROM plugin_maintenance_waits WHERE state IN ('pending','waiting_for_start','executing','reconciling') ORDER BY created_at,id`) {
		progressPluginWait(t, wait)
	}
}

func progressPluginWait(t *transaction, wait Object) {
	w := t.one("SELECT * FROM workspaces WHERE id=$1", wait.S("workspaceId"))
	if w == nil || w.S("deletedAt") != "" || w.S("observedState") == "deleted" || w.S("observedState") == "deleting" {
		failPluginWait(t, wait)
		return
	}
	if openForceStop(t, w.S("id")) != nil {
		return
	}
	if wait.S("state") == "executing" || wait.S("state") == "reconciling" {
		reconcilePluginWait(t, wait, w)
		return
	}
	if w.S("observedState") == "stopped" {
		setPluginWaitState(t, wait, "waiting_for_start")
		return
	}
	if !maintenanceSlotFree(t, w) {
		setPluginWaitState(t, wait, "pending")
		return
	}
	dispatchPluginWait(t, wait, w)
}

func reconcilePluginWait(t *transaction, wait, w Object) {
	op := latestPluginOperation(t, w.S("id"), wait)
	if op == nil {
		setPluginWaitState(t, wait, "pending")
		if maintenanceSlotFree(t, w) {
			dispatchPluginWait(t, reloadPluginWait(t, wait), w)
		}
		return
	}
	effect := latestEffect(t, op.S("id"))
	if !operationTerminal(op) {
		if effect == nil {
			setPluginWaitState(t, wait, "executing")
			return
		}
		setPluginWaitState(t, wait, "reconciling")
		markMaintenanceReconciling(t, w.S("id"))
		return
	}
	if effect == nil || effect.S("state") == "planned" || effect.S("state") == "running" || effect.S("state") == "succeeded" {
		// A succeeded Cloud effect is still unconfirmed: the real executor
		// has not reported the pinned plugin. Query this effect again; do
		// not plan a second install.
		setPluginWaitState(t, wait, "reconciling")
		markMaintenanceReconciling(t, w.S("id"))
		if effect != nil && effect.S("state") == "succeeded" && !desiredMatchesWait(t, wait) {
			replanPluginWait(t, wait, w)
		}
		return
	}
	failPluginWait(t, wait)
}

func replanPluginWait(t *transaction, wait, w Object) {
	row := t.spacePluginRow(wait.S("spaceId"), wait.S("sourceNamespace"), wait.S("identifier"))
	if row == nil {
		return
	}
	action := "install"
	if row.S("desiredState") == "removed" {
		action = "remove"
	} else if wait.S("desiredAction") != "remove" && row.S("desiredVersion") != wait.S("desiredVersion") {
		action = "version_change"
	}
	t.exec(`UPDATE plugin_maintenance_waits SET desired_action=$2,desired_version=$3,state='pending',version=version+1,updated_at=now() WHERE id=$1`,
		wait.S("id"), action, row.S("desiredVersion"))
	if maintenanceSlotFree(t, w) {
		dispatchPluginWait(t, reloadPluginWait(t, wait), w)
	}
}

func dispatchPluginWait(t *transaction, wait, w Object) {
	if wait == nil || !maintenanceSlotFree(t, w) {
		return
	}
	if openRuntimeControl(t, w.S("id")) == nil {
		insertSystemMaintenance(t, w)
	}
	kind := "install_plugin"
	if wait.S("desiredAction") == "remove" {
		kind = "remove_plugin"
	}
	req := Object{"pluginId": wait.S("sourceNamespace") + "/" + wait.S("identifier"), "version": wait.S("desiredVersion")}
	id := newID()
	t.exec(`INSERT INTO operations(id,tenant_id,actor_user_id,project_id,workspace_id,kind,state,step,request,idempotency_key,request_hash)
		VALUES($1,$2,$3,$4,$5,$6,'queued','plugin',$7,$8,$9)`,
		id, wait.S("tenantId"), wait.S("initiatorUserId"), wait.S("projectId"), wait.S("workspaceId"), kind, jsonText(req), wait.S("idempotencyKey"), requestHash("PLUGIN", wait.S("id"), req))
	t.queued = append(t.queued, id)
	setPluginWaitState(t, wait, "executing")
}

// maintenanceSlotFree is the system-maintenance qualification: no human
// session, no active or unknown execution, a ready runtime, and a free
// project operation slot. Ready alone is not enough, and a stopped runtime
// is handled by the caller so maintenance does not start a sandbox.
func maintenanceSlotFree(t *transaction, w Object) bool {
	session := openRuntimeControl(t, w.S("id"))
	if session != nil && session.S("holderKind") != "system_maintenance" {
		return false
	}
	if w.S("observedState") != "ready" || executionBlocksHandoff(t, w.S("id")) || unknownExecution(t, w.S("id")) {
		return false
	}
	if openForceStop(t, w.S("id")) != nil {
		return false
	}
	if t.one("SELECT id FROM operations WHERE project_id=$1 AND state IN ('queued','running','retry_wait','blocked')", w.S("projectId")) != nil {
		return false
	}
	return true
}

func insertSystemMaintenance(t *transaction, w Object) {
	wid := w.S("id")
	t.exec("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", wid)
	if openRuntimeControl(t, wid) != nil {
		return
	}
	epoch := t.one("SELECT COALESCE(MAX(control_epoch),0)+1 AS next_epoch FROM runtime_control_sessions WHERE workspace_id=$1", wid).N("nextEpoch")
	// The human lease expires in 60 seconds because a person renews it.
	// Maintenance holds the runtime until the wait finishes or fails, so it
	// must not be closed by that heartbeat deadline.
	t.exec(`INSERT INTO runtime_control_sessions(id,tenant_id,workspace_id,holder_user_id,holder_kind,control_epoch,state,expires_at,change_reason)
		VALUES($1,$2,$3,NULL,'system_maintenance',$4,'held',clock_timestamp()+interval '100 years','plugin_maintenance')`,
		newID(), w.S("tenantId"), wid, epoch)
}

func markMaintenanceReconciling(t *transaction, wid string) {
	t.exec(`UPDATE runtime_control_sessions SET state='reconciling', change_reason='plugin_reconcile', version=version+1, updated_at=clock_timestamp()
		WHERE workspace_id=$1 AND holder_kind='system_maintenance' AND state<>'closed' AND state<>'reconciling'`, wid)
}

func failPluginWait(t *transaction, wait Object) {
	t.exec(`UPDATE plugin_maintenance_waits SET state='failed', version=version+1, updated_at=now() WHERE id=$1 AND state IN ('pending','waiting_for_start','executing','reconciling')`, wait.S("id"))
	releaseSystemMaintenanceIfIdle(t, wait.S("workspaceId"))
}

func releaseSystemMaintenanceIfIdle(t *transaction, wid string) {
	if openPluginMaintenance(t, wid) {
		return
	}
	t.exec(`UPDATE runtime_control_sessions SET state='closed', closed_at=clock_timestamp(), change_reason='plugin_maintenance_finished', version=version+1, updated_at=clock_timestamp()
		WHERE workspace_id=$1 AND holder_kind='system_maintenance' AND closed_at IS NULL`, wid)
}

func openPluginMaintenance(t *transaction, wid string) bool {
	return t.one("SELECT id FROM plugin_maintenance_waits WHERE workspace_id=$1 AND state IN ('pending','waiting_for_start','executing','reconciling')", wid) != nil
}

func openPluginWait(t *transaction, wid, namespace, identifier string) Object {
	return t.one(`SELECT * FROM plugin_maintenance_waits WHERE workspace_id=$1 AND source_namespace=$2 AND identifier=$3 AND state IN ('pending','waiting_for_start','executing','reconciling')`, wid, namespace, identifier)
}

func reloadPluginWait(t *transaction, wait Object) Object {
	return t.one("SELECT * FROM plugin_maintenance_waits WHERE id=$1", wait.S("id"))
}

func setPluginWaitState(t *transaction, wait Object, state string) {
	if wait.S("state") == state {
		return
	}
	t.exec("UPDATE plugin_maintenance_waits SET state=$2, version=version+1, updated_at=now() WHERE id=$1", wait.S("id"), state)
}

func desiredMatchesWait(t *transaction, wait Object) bool {
	row := t.spacePluginRow(wait.S("spaceId"), wait.S("sourceNamespace"), wait.S("identifier"))
	if row == nil {
		return true
	}
	if row.S("desiredState") == "removed" {
		return wait.S("desiredAction") == "remove"
	}
	return wait.S("desiredAction") != "remove" && row.S("desiredVersion") == wait.S("desiredVersion")
}

func latestPluginOperation(t *transaction, wid string, wait Object) Object {
	pluginID := wait.S("sourceNamespace") + "/" + wait.S("identifier")
	return t.one(`SELECT * FROM operations WHERE workspace_id=$1 AND kind IN ('install_plugin','remove_plugin') AND request->>'pluginId'=$2 ORDER BY created_at DESC, id DESC LIMIT 1`, wid, pluginID)
}

func latestEffect(t *transaction, operationID string) Object {
	return t.one("SELECT * FROM external_effects WHERE operation_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1", operationID)
}

func operationTerminal(op Object) bool {
	state := op.S("state")
	return state == "succeeded" || state == "failed"
}

// failPluginMaintenance closes the wait when the effect itself failed. The
// safe instance error is already stored by the effect writeback. A later
// business retry is a new request, not another effect id.
func failPluginMaintenance(t *transaction, op Object) {
	namespace, identifier, ok := pluginIdentity(op.O("request").S("pluginId"))
	if !ok {
		return
	}
	if wait := openPluginWait(t, op.S("workspaceId"), namespace, identifier); wait != nil {
		failPluginWait(t, wait)
	}
}
