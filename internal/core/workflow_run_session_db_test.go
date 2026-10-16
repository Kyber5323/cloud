package core

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
)

// workflowSessionGraph is a linear start -> agent -> output graph; the agent carries the prompt
// and the implicit default slot.
func workflowSessionGraph() Object {
	g := wfGraph(
		[]Object{wfNode("s", "start", ""), wfAgentNode("a", Object{"prompt": "Do the thing"}), wfNode("o", "output", "")},
		[][3]string{{"s", "a", ""}, {"a", "o", ""}},
	)
	return g
}

// seedWorkflowSessionScene stages a project-backed run one advance away from session start: the
// binding (the same freeze the creation gate performs), and the project space carries the
// production plugin. Returns the ids the tests read back.
func seedWorkflowSessionScene(t *testing.T, store *Store) (runID, tid, uid, space, project string) {
	t.Helper()
	_, uid = modelUser(t, store, "wf-session")
	tid, wid, sid, rid := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	space, project = uuid.NewString(), uuid.NewString()
	if _, err := store.transact(context.Background(), func(tx *transaction) Object {
		exec := func(name, q string, args ...any) {
			tx.exec(q, args...)
		}
		exec("tenant", `INSERT INTO tenants(id,name,status) VALUES($1,'wfs','active')`, tid)
		exec("memb", `INSERT INTO tenant_memberships(tenant_id,user_id,role,status) VALUES($1,$2,'admin','active')`, tid, uid)
		exec("space", `INSERT INTO collab_workspaces(id,tenant_id,name,slug,created_by) VALUES($1,$2,'wfs','wfs-'||left($4::text,8),$3)`, space, tid, uid, project)
		exec("project", `INSERT INTO projects(id,tenant_id,owner_user_id,space_id,name,repository_url,default_branch,lifecycle) VALUES($1,$2,$3,$4,'wfs','https://example.invalid/wfs.git','main','active')`, project, tid, uid, space)
		exec("main", `INSERT INTO workspaces(id,tenant_id,owner_user_id,creator_user_id,creator_evidence,project_id,kind,desired_state,observed_state,runtime_generation,requested_ref) VALUES($1,$2,$3,$3,'verified_request',$4,'main','running','ready',1,'HEAD')`, uuid.NewString(), tid, uid, project)
		exec("plugin", `INSERT INTO space_plugins(space_id,tenant_id,source_namespace,identifier,desired_state,desired_version,observed_state) VALUES($1,$2,'official','ora-space.opencode','installed','1.0.0','installed')`, space, tid)
		graph, _ := json.Marshal(workflowSessionGraph())
		exec("workflow", `INSERT INTO workflows(id,tenant_id,name,graph) VALUES($1,$2,'wfs',$3::jsonb)`, wid, tid, string(graph))
		exec("snapshot", `INSERT INTO workflow_snapshots(id,tenant_id,workflow_id,version,name,graph) VALUES($1,$2,$3,1,'v1',$4::jsonb)`, sid, tid, wid, string(graph))
		exec("run", `INSERT INTO workflow_runs(id,tenant_id,workflow_id,snapshot_id,name,status,input,created_by,project_id) VALUES($1,$2,$3,$4,'disp','pending','{}'::jsonb,$5,$6)`, rid, tid, wid, sid, uid, project)
		cred := uuid.NewString()
		conn := uuid.NewString()
		exec("credential", `INSERT INTO personal_model_credentials(id,user_id,ciphertext,key_id) VALUES($1,$2,repeat('c',64),'test-key')`, cred, uid)
		exec("connection", `INSERT INTO personal_model_connections(id,user_id,credential_id,name,protocol,base_url,auth_mode,models,enabled) VALUES($1,$2,$3,'Personal Provider','openai-completions','https://models.example.invalid/v1','bearer',$4::jsonb,true)`, conn, uid, cred, jsonText([]any{map[string]any{"id": "vendor/model-v1", "name": "Model V1"}}))
		exec("default", `INSERT INTO personal_model_defaults(user_id,connection_id,model_id,version) VALUES($1,$2,'vendor/model-v1',1)`, uid, conn)
		freezeWorkflowRunExecutors(tx, rid, uid, workflowSessionGraph())
		return Object{}
	}); err != nil {
		t.Fatalf("seed scene: %v", err)
	}
	return rid, tid, uid, space, project
}

// settleSessionWorkspace completes the run Workspace's create operation the way the control plane
// does — the operation settles, admission opens with a recorded baseline and checkout — and returns
// the Workspace id.
func settleSessionWorkspace(t *testing.T, store *Store, runID string) string {
	t.Helper()
	var wsID, createOp string
	if err := store.Pool.QueryRow(`SELECT w.id, o.id FROM workspaces w JOIN operations o ON o.workspace_id=w.id AND o.kind='create_workspace' WHERE w.workflow_run_id=$1`, runID).Scan(&wsID, &createOp); err != nil {
		t.Fatalf("read provisioned workspace: %v", err)
	}
	if _, err := store.transact(context.Background(), func(tx *transaction) Object {
		settleCreateWorkspaceOperation(t, tx, createOp)
		runWorkspaceSettled(tx, runID, "ready")
		tx.exec(`UPDATE workspaces SET observed_state='ready', admission_open=true, base_commit_id=$2, version=version+1 WHERE id=$1`, wsID, baseCommit)
		tx.exec(`INSERT INTO clone_executions(execution_id,operation_id,node_id,node_operation_id,workspace_id,input,result,dispatched_epoch) VALUES($1,$2,'node-checkout','op-checkout',$3,'{"kind":"clone"}',jsonb_build_object('outcome','clone_ready','commit',$4::text),1)`, "exec-checkout-"+wsID[:8], createOp, wsID, baseCommit)
		return Object{}
	}); err != nil {
		t.Fatalf("settle create: %v", err)
	}
	return wsID
}

// startSessionNode connects a Node to the settled Workspace, advances until the agent node is
// committed running, and returns the Node's service id and the released session spec.
func startSessionNode(t *testing.T, store *Store, runID, wsID string) (string, Object) {
	t.Helper()
	_, nodeService := bindConnectedNode(t, store, wsID)
	if _, err := store.Pool.Exec(`UPDATE node_instances SET model_proxy=true WHERE workspace_id=$1`, wsID); err != nil {
		t.Fatal(err)
	}
	if err := store.AdvanceWorkflowRunsOnce(context.Background()); err != nil {
		t.Fatalf("advance to session start: %v", err)
	}
	status, _, states, _ := readWorkflowRun(t, store, runID)
	agent, _ := asWorkflowObject(states["a"])
	if status != "running" || agent == nil || agent.S("status") != "running" {
		t.Fatalf("after session start: %q states=%v; want agent a running", status, states)
	}
	var rawSpec []byte
	if err := store.Pool.QueryRow(`SELECT input FROM execution_work WHERE workflow_run_id=$1 AND kind='agent_session'`, runID).Scan(&rawSpec); err != nil {
		t.Fatalf("read session work: %v", err)
	}
	spec := Object{}
	if err := json.Unmarshal(rawSpec, &spec); err != nil {
		t.Fatal(err)
	}
	if spec.S("agentPluginId") != opencodeAgentCLI || spec.S("agentPluginVersion") != "1.0.0" || spec.S("modelBindingId") == "" {
		t.Fatalf("spec = %v", spec)
	}
	if spec.O("initialTurn").S("turnId") == "" || spec.O("initialTurn")["content"] == nil || spec.S("checkoutExecutionId") != "exec-checkout-"+wsID[:8] {
		t.Fatalf("spec turn/checkout = %v", spec)
	}
	if git := spec.O("gitIdentity"); git.S("name") == "" || git.S("email") == "" {
		t.Fatalf("git identity = %v", git)
	}
	return nodeService, spec
}

// dispatchSession dispatches the released session work from the Node and advances: the pass holds
// the committed running node until terminal evidence arrives.
func dispatchSession(t *testing.T, store *Store, runID, nodeService string, spec Object) string {
	t.Helper()
	execution := "exec-" + runID[:8]
	if _, err := store.transact(context.Background(), func(tx *transaction) Object {
		nodeDispatch(tx, &ControlRequest{Body: Object{"operationId": runID, "executionId": execution, "nodeId": nodeService, "input": spec, "epoch": int64(1)}})
		return Object{}
	}); err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if err := store.AdvanceWorkflowRunsOnce(context.Background()); err != nil {
		t.Fatalf("advance after dispatch: %v", err)
	}
	_, _, held, _ := readWorkflowRun(t, store, runID)
	h, _ := asWorkflowObject(held["a"])
	if h == nil || h.S("status") != "running" {
		t.Fatalf("dispatched session held: %v", held)
	}
	return execution
}

// reportSessionEnd reports the session's terminal event from the Node and runs the settling pass.
func reportSessionEnd(t *testing.T, store *Store, runID, execution, nodeService, reason string) {
	t.Helper()
	if _, err := store.transact(context.Background(), func(tx *transaction) Object {
		executionResult(tx, &ControlRequest{Body: Object{"operationId": runID, "executionId": execution, "result": Object{"outcome": "agent_session_ended", "reason": reason, "node": Object{"nodeId": nodeService}}, "sequence": int64(1), "event": "ended"}}, true)
		return Object{}
	}); err != nil {
		t.Fatalf("report result: %v", err)
	}
	if err := store.AdvanceWorkflowRunsOnce(context.Background()); err != nil {
		t.Fatalf("advance after result: %v", err)
	}
}

// The wired end to end: one advance provisions the run Workspace, the create settles, a
// connected Node releases the session work item, the Node dispatches and reports, and the run
// settles succeeded with its Workspace deletion declared.
func TestWorkflowSessionRunsEndToEnd(t *testing.T) {
	store := dispatcherDB(t)
	runID, _, _, _, _ := seedWorkflowSessionScene(t, store)
	if err := store.AdvanceWorkflowRunsOnce(context.Background()); err != nil {
		t.Fatalf("advance 1: %v", err)
	}
	status, _, states, _ := readWorkflowRun(t, store, runID)
	if status != "running" || len(states) != 0 {
		t.Fatalf("after advance 1: status=%q states=%v; want running with no node states", status, states)
	}
	wsID := settleSessionWorkspace(t, store, runID)
	// No connected Node yet: the pass holds without committing a node state.
	if err := store.AdvanceWorkflowRunsOnce(context.Background()); err != nil {
		t.Fatalf("advance 2: %v", err)
	}
	if _, _, held, _ := readWorkflowRun(t, store, runID); len(held) != 0 {
		t.Fatalf("advance 2 committed states %v without a connected node", held)
	}
	nodeService, spec := startSessionNode(t, store, runID, wsID)
	execution := dispatchSession(t, store, runID, nodeService, spec)
	// The Node reports a natural end; the run drains to succeeded and cleans up.
	reportSessionEnd(t, store, runID, execution, nodeService, "idle_timeout")
	var runErr string
	status, runErr, states, _ = readWorkflowRun(t, store, runID)
	if status != "succeeded" || runErr != "" {
		t.Fatalf("run settled %q error %q states=%v; want succeeded", status, runErr, states)
	}
	agent, _ := asWorkflowObject(states["a"])
	outs, _ := asWorkflowObject(states["o"])
	if agent == nil || outs == nil || agent.S("status") != "succeeded" || outs.S("status") != "succeeded" {
		t.Fatalf("node states = %v", states)
	}
	if reason := agent.O("output").S("reason"); reason != "idle_timeout" {
		t.Fatalf("agent output reason = %q; want idle_timeout", reason)
	}
	// Terminal cleanup: no unregistered work, and the Workspace deletion is declared.
	var unregistered int
	if err := store.Pool.QueryRow(`SELECT count(*) FROM execution_work WHERE workflow_run_id=$1 AND execution_id IS NULL`, runID).Scan(&unregistered); err != nil {
		t.Fatal(err)
	}
	if unregistered != 0 {
		t.Fatalf("%d unregistered work items survived", unregistered)
	}
	var deletes int
	if err := store.Pool.QueryRow(`SELECT count(*) FROM operations o JOIN workspaces w ON w.id=o.workspace_id WHERE w.workflow_run_id=$1 AND o.kind='delete_workspace'`, runID).Scan(&deletes); err != nil {
		t.Fatal(err)
	}
	if deletes != 1 {
		t.Fatalf("%d delete operations declared; want 1", deletes)
	}
}

// A session that ends `agent_failed` fails its node and the run with that reason — the evidence
// decides, not a policy — and the terminal cleanup still runs.
func TestWorkflowSessionFailureFailsRun(t *testing.T) {
	store := dispatcherDB(t)
	runID, _, _, _, _ := seedWorkflowSessionScene(t, store)
	if err := store.AdvanceWorkflowRunsOnce(context.Background()); err != nil {
		t.Fatalf("advance 1: %v", err)
	}
	wsID := settleSessionWorkspace(t, store, runID)
	nodeService, spec := startSessionNode(t, store, runID, wsID)
	execution := dispatchSession(t, store, runID, nodeService, spec)
	reportSessionEnd(t, store, runID, execution, nodeService, "agent_failed")
	status, runErr, states, _ := readWorkflowRun(t, store, runID)
	if status != "failed" || runErr != "agent_failed" {
		t.Fatalf("run settled %q error %q states=%v; want failed/agent_failed", status, runErr, states)
	}
	agent, _ := asWorkflowObject(states["a"])
	if agent == nil || agent.S("status") != "failed" || agent.O("output").S("reason") != "agent_failed" {
		t.Fatalf("agent state = %v; want failed with agent_failed", states["a"])
	}
	var unregistered int
	if err := store.Pool.QueryRow(`SELECT count(*) FROM execution_work WHERE workflow_run_id=$1 AND execution_id IS NULL`, runID).Scan(&unregistered); err != nil {
		t.Fatal(err)
	}
	if unregistered != 0 {
		t.Fatalf("%d unregistered work items survived a failed run", unregistered)
	}
}

// A session that never dispatches fails honestly once the startup deadline passes: the node and the
// run carry the named reason instead of hanging in `running` forever.
func TestWorkflowSessionStartDeadlineFailsNode(t *testing.T) {
	store := dispatcherDB(t)
	runID, _, _, _, _ := seedWorkflowSessionScene(t, store)
	if err := store.AdvanceWorkflowRunsOnce(context.Background()); err != nil {
		t.Fatalf("advance 1: %v", err)
	}
	wsID := settleSessionWorkspace(t, store, runID)
	startSessionNode(t, store, runID, wsID)
	// The Node never picks the work item up: the committed start ages past the deadline.
	stale := time.Now().Add(-workflowSessionStartDeadline - time.Minute).UTC().Format(time.RFC3339)
	if _, err := store.Pool.Exec(`UPDATE workflow_runs SET node_states=jsonb_set(node_states,'{a,startedAt}',to_jsonb($2::text)) WHERE id=$1`, runID, stale); err != nil {
		t.Fatal(err)
	}
	if err := store.AdvanceWorkflowRunsOnce(context.Background()); err != nil {
		t.Fatalf("advance past deadline: %v", err)
	}
	status, runErr, states, _ := readWorkflowRun(t, store, runID)
	if status != "failed" || runErr != "session start deadline exceeded" {
		t.Fatalf("run settled %q error %q states=%v; want the deadline failure", status, runErr, states)
	}
	agent, _ := asWorkflowObject(states["a"])
	if agent == nil || agent.S("status") != "failed" || agent.O("output").S("reason") != "session_start_deadline_exceeded" {
		t.Fatalf("agent state = %v; want the deadline failure", states["a"])
	}
	var unregistered int
	if err := store.Pool.QueryRow(`SELECT count(*) FROM execution_work WHERE workflow_run_id=$1 AND execution_id IS NULL`, runID).Scan(&unregistered); err != nil {
		t.Fatal(err)
	}
	if unregistered != 0 {
		t.Fatalf("%d undispatched work items survived", unregistered)
	}
}

// The model grant's live binding resolves a WorkflowRun session through the workflow branch: the
// frozen slot binding, the dispatched session execution and the confirmed runtime binding authorize
// it, and an execution that is not this run's session is refused rather than resolved to some other
// run.
func TestWorkflowLiveModelBindingResolvesRun(t *testing.T) {
	store := dispatcherDB(t)
	runID, _, _, _, _ := seedWorkflowSessionScene(t, store)
	if err := store.AdvanceWorkflowRunsOnce(context.Background()); err != nil {
		t.Fatalf("advance 1: %v", err)
	}
	wsID := settleSessionWorkspace(t, store, runID)
	nodeService, spec := startSessionNode(t, store, runID, wsID)
	execution := dispatchSession(t, store, runID, nodeService, spec)
	// The runtime confirms the Node binding once the session is dispatched — the state the model
	// gateway's certificate-bound lookups run against.
	if _, err := store.Pool.Exec(`UPDATE runtime_controls SET binding_confirmed=true,
		bound_sandbox_id=(SELECT sandbox_instance_id FROM node_instances WHERE workspace_id=$1 AND ended_at IS NULL)
		WHERE workspace_id=$1`, wsID); err != nil {
		t.Fatal(err)
	}
	var bindingID, tenant string
	var generation int64
	if err := store.Pool.QueryRow(`SELECT id FROM run_model_bindings WHERE workflow_run_id=$1 AND slot_name='default'`, runID).Scan(&bindingID); err != nil {
		t.Fatalf("read frozen binding: %v", err)
	}
	if err := store.Pool.QueryRow(`SELECT tenant_id, runtime_generation FROM workspaces WHERE id=$1`, wsID).Scan(&tenant, &generation); err != nil {
		t.Fatal(err)
	}
	scope := ModelRuntimeScope{TenantID: tenant, WorkspaceID: wsID, Generation: generation}
	if _, err := store.transact(context.Background(), func(tx *transaction) Object {
		b := liveModelBinding(tx, scope, bindingID, execution)
		if b.S("runId") != runID || b.S("nodeId") != nodeService {
			t.Fatalf("binding = %v; want run %s on node %s", b, runID, nodeService)
		}
		return Object{}
	}); err != nil {
		t.Fatalf("live binding: %v", err)
	}
	if _, err := store.transact(context.Background(), func(tx *transaction) Object {
		liveModelBinding(tx, scope, bindingID, uuid.NewString())
		return Object{}
	}); err == nil || ErrorCode(err).Code != "model_grant_revoked" {
		t.Fatalf("foreign execution: err=%v; want model_grant_revoked", err)
	}
}
