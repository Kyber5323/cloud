package core

import "strings"

// issueFormContext resolves the issue context a form descriptor may be tailored with: the repository
// and default branch of the project the issue belongs to, and the references the issue can name for
// itself (§38.37b, §38.37c).
//
// An empty issue id means the caller has no issue in hand — that is the plain
// `GET /collaboration/forms/{formRef}` — and yields the zero value, so no platform field is injected. A
// non-empty id is resolved through the tenant-scoped issue lookup, so an unknown or foreign issue is the
// same 404 it would be anywhere else rather than a silently dropped context.
func issueFormContext(t *transaction, tid, issueID string) IssueFormContext {
	if issueID == "" {
		return IssueFormContext{}
	}
	return formContextForIssue(t, tid, issue(t, tid, issueID))
}

// formContextForIssue is issueFormContext for a caller that already holds the issue row, so assist and
// confirm do not re-read what they just loaded.
func formContextForIssue(t *transaction, tid string, i Object) IssueFormContext {
	out := IssueFormContext{IssueID: i.S("id"), ParentIssueID: i.S("parentIssueId")}
	ref := i.S("projectRef")
	if !validID(ref) {
		return out
	}
	// `issues.project_ref` carries no foreign key — migration 0010 adds the column shape-only — so a
	// project that has since been deleted is a missing default, never an error. Reading the branch
	// alongside the repository costs nothing: it is the same row, and `default_branch` is NOT NULL, so
	// a project that exists always yields one.
	if project := t.one("SELECT repository_url, default_branch FROM projects WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL", ref, tid); project != nil {
		out.ProjectID = ref
		out.RepositoryURL = project.S("repositoryUrl")
		out.DefaultBranch = project.S("defaultBranch")
	}
	return out
}

// interaction loads one interaction scoped to its tenant and issue; foreign/missing are 404.
func interaction(t *transaction, tid, iid, ixid string) Object {
	require(validID(ixid), 404, "not_found")
	o := t.one("SELECT * FROM issue_interactions WHERE id=$1 AND tenant_id=$2 AND issue_id=$3", ixid, tid, iid)
	require(o != nil, 404, "not_found")
	return o
}

// interactionList returns the minimal interaction spine for an issue: one row per selected @ target
// on each comment. Comments are 0..N interactions; an interaction is 0..1 initial run (runId).
func interactionList(t *transaction, r *PublicRequest) Object {
	issue(t, r.TenantID, r.IssueID)
	items := t.list("SELECT * FROM issue_interactions WHERE issue_id=$1 AND tenant_id=$2 ORDER BY created_at, id", r.IssueID, r.TenantID)
	return Object{"items": items, "nextCursor": ""}
}

// applyCommentTargets persists the typed @ targets attached to a newly created comment. Human Mention
// stores the typed target with no run; Task Mode (agent/team) enqueues the initial issue-owned run plus
// its context snapshot; Form Mode (workflow) records a *configured-but-unconfirmed* interaction with no
// run — Workflow execution happens only on an explicit Confirm (§38.1, §38.7). Each selected target
// becomes one issue_interactions row. Task runs are appended to *dispatches so the caller dispatches
// them after the comment transaction commits (the global advisory lock must not span external/observer
// writes).
func applyCommentTargets(t *transaction, i Object, r *PublicRequest, uid, commentID string, dispatches *[]dispatchTarget) {
	raw, ok := r.Body["targets"].([]any)
	if !ok {
		return // a plain comment with no targets
	}
	require(len(raw) <= 100, 400, "invalid_input")
	for _, item := range raw {
		m, ok := item.(map[string]any)
		require(ok, 400, "invalid_input")
		targetType, _ := m["type"].(string)
		targetID, _ := m["id"].(string)
		task, _ := m["task"].(string)
		require(validTargetType(targetType) && validID(targetID), 400, "invalid_target")
		mode, _ := modeForType(targetType)
		resolveCollaborationTarget(t, r.TenantID, targetType, targetID)

		var runID any
		if mode == "task" {
			require(strings.TrimSpace(task) != "" && len(task) <= 20000, 400, "task_required")
			input := buildRunContext(t, i, task, targetType, targetID, Object{}, nil)
			runObj := enqueueRun(t, r.TenantID, i.S("id"), targetType, targetID, input, "comment", commentID, "user", uid)
			runID = runObj.S("id")
			*dispatches = append(*dispatches, dispatchTarget{tenantID: r.TenantID, runID: runObj.S("id")})
		}
		// mode == "form": the interaction is recorded with no run and empty input. Selecting a Workflow is
		// not executing it; the frontend loads the descriptor from `formRef`, and only confirmInteraction
		// may create the execution intent.
		id := newID()
		t.exec("INSERT INTO issue_interactions(id,tenant_id,issue_id,comment_id,target_type,target_id,mode,task,run_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", id, r.TenantID, i.S("id"), commentID, targetType, targetID, mode, task, runID)
	}
}

// confirmInteraction is the ONLY transition that turns a Workflow interaction into an execution intent
// (§38.7). It re-resolves the target and the *current* descriptor server-side, re-validates the
// submitted values against it, persists them as the interaction's Issue-owned input, creates the
// initial run, and claims the interaction with a compare-and-set on `run_id IS NULL`. Dispatch is the
// caller's post-commit responsibility, so no external effect happens inside this transaction (§38.22).
func confirmInteraction(t *transaction, r *PublicRequest, uid string, dispatches *[]dispatchTarget) Object {
	it := interaction(t, r.TenantID, r.IssueID, r.InteractionID)
	require(it.S("mode") == "form", 409, "interaction_not_confirmable")
	require(it["runId"] == nil, 409, "interaction_already_confirmed")
	i := issue(t, r.TenantID, r.IssueID)
	targetType, targetID := it.S("targetType"), it.S("targetId")
	descriptor := workflowFormDescriptor(t, r.TenantID, targetType, targetID, formContextForIssue(t, r.TenantID, i))
	values := interactionValues(r.Body)
	validateFormValues(descriptor, values, true)

	input := buildRunContext(t, i, "", targetType, targetID, values, appliedContextRefs(r.Body))
	runObj := enqueueRun(t, r.TenantID, i.S("id"), targetType, targetID, input, "interaction", it.S("id"), "user", uid)
	claimed := t.execRows("UPDATE issue_interactions SET input=$3, run_id=$4 WHERE id=$1 AND tenant_id=$2 AND run_id IS NULL", it.S("id"), r.TenantID, jsonText(values), runObj.S("id"))
	require(claimed == 1, 409, "interaction_already_confirmed")
	*dispatches = append(*dispatches, dispatchTarget{tenantID: r.TenantID, runID: runObj.S("id")})
	return Object{"resource": runObj}
}

// assistWorkflow serves AI Assist for a Workflow target *before* any interaction exists. The form is a
// draft until the user confirms it — selecting a workflow must leave no trace in the Timeline — so
// assist is deliberately stateless here: it resolves the target and its current descriptor, reads the
// issue context, and returns suggestions. It writes nothing: no comment, no interaction, no run, no
// context ref, no issue mutation (§38.12, §38.14).
func assistWorkflow(t *transaction, r *PublicRequest) Object {
	i := issue(t, r.TenantID, r.IssueID)
	targetID := r.Body.S("targetId")
	require(validID(targetID), 400, "invalid_target")
	descriptor := workflowFormDescriptor(t, r.TenantID, "workflow", targetID, formContextForIssue(t, r.TenantID, i))
	// Assist is requested while the form is still being filled, so shape is validated but requiredness
	// is not — an incomplete form is exactly when a suggestion is useful.
	current := interactionValues(r.Body)
	validateFormValues(descriptor, current, false)

	in := AssistInput{
		TargetType:       "workflow",
		TargetID:         targetID,
		Descriptor:       descriptor,
		CurrentValues:    current,
		IssueTitle:       i.S("title"),
		IssueDescription: i.S("description"),
		ContextRefs:      t.list("SELECT ref_type, ref_id FROM issue_context_refs WHERE issue_id=$1 AND tenant_id=$2 ORDER BY ref_type, created_at, id", i.S("id"), r.TenantID),
	}
	for _, c := range t.list("SELECT body FROM issue_comments WHERE issue_id=$1 AND tenant_id=$2 AND deleted_at IS NULL ORDER BY seq DESC LIMIT $3", i.S("id"), r.TenantID, maxRecentComments) {
		in.RecentComments = append(in.RecentComments, c.S("body"))
	}
	require(t.assist != nil, 503, "assist_unavailable")
	suggestion, err := t.assist.Suggest(t.ctx, in)
	if err != nil {
		panic(databaseFailure{err})
	}
	return assistSuggestionObject(descriptor, suggestion)
}
