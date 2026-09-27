package integration

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/wanglongan587/cloud/internal/core"
)

// invalidDescriptorProvider returns a descriptor that violates the §38.3 invariants (a select with no
// options and a duplicated field key), to prove Issues fails closed instead of rendering it.
type invalidDescriptorProvider struct{ FormRef string }

func (p invalidDescriptorProvider) ResolveFormDescriptor(context.Context, string, string) (core.FormDescriptor, bool, error) {
	return core.FormDescriptor{
		FormRef: p.FormRef,
		Fields: []core.FormField{
			{Key: "scope", Label: "Scope", Type: "select", Required: true},
			{Key: "scope", Label: "Duplicate", Type: "text"},
		},
	}, true, nil
}

// startInputGraph is a graph whose Start node declares an input form. Cloud projects exactly those
// variables onto the @ form, so this graph IS the descriptor the picker renders — there is no
// separate registration step and no fixture identity to keep in sync.
func startInputGraph(variables []any) core.Object {
	return core.Object{
		"nodes": []any{core.Object{
			"id": "start-1", "type": "workflow", "deletable": false,
			"position": core.Object{"x": 0, "y": 0},
			"data": core.Object{
				"kind": "start", "title": "开始", "description": "",
				"inputVariables": variables,
			},
		}},
		"edges":    []any{},
		"viewport": core.Object{"x": 0, "y": 0, "zoom": 1},
	}
}

// reviewVariables is the input form the review workflow publishes: a required text field, an optional
// text field with a default, two selects, and a boolean.
func reviewVariables() []any {
	return []any{
		core.Object{"name": "repository", "displayName": "Repository", "fieldType": "text-input", "valueType": "string", "required": true},
		core.Object{"name": "branch", "displayName": "Branch", "fieldType": "text-input", "valueType": "string", "value": "main"},
		core.Object{"name": "scope", "displayName": "Review scope", "fieldType": "select", "valueType": "string", "required": true,
			"options": []any{"current-issue", "changed-files", "full-repo"}},
		core.Object{"name": "severity", "displayName": "Severity", "fieldType": "select", "valueType": "string", "required": true,
			"options": []any{"low", "medium", "high"}},
		core.Object{"name": "includeDependencies", "displayName": "Include dependencies", "fieldType": "checkbox", "valueType": "boolean", "value": false},
	}
}

// createWorkflow publishes a workflow whose Start node declares `variables` and returns its id. The
// id is also the formRef the target advertises, because Cloud derives both from the same row.
func createWorkflow(t *testing.T, f *fixture, name, key string, variables []any) string {
	t.Helper()
	return f.call("POST", f.path("/workflows"), core.Object{
		"name": name, "description": name + " (test)", "graph": startInputGraph(variables),
	}, key, 200).O("resource").S("id")
}

// reviewWorkflow is the workflow every Form Mode test in this file drives.
func reviewWorkflow(t *testing.T, f *fixture) string {
	t.Helper()
	return createWorkflow(t, f, "Security Review Workflow", "wf-review", reviewVariables())
}

// workflowComment posts a comment addressed at `wid` and returns the form interaction it created.
// Creating the interaction must NOT create a run.
func workflowComment(t *testing.T, f *fixture, wid, iid, key, body string) core.Object {
	t.Helper()
	f.call("POST", f.path("/issues/"+iid+"/comments"), core.Object{
		"body":    body,
		"targets": []any{core.Object{"type": "workflow", "id": wid}},
	}, key, 200)
	for _, it := range issueItems(f.call("GET", f.path("/issues/"+iid+"/interactions"), nil, "", 200)) {
		if it.S("mode") == "form" {
			return it
		}
	}
	t.Fatal("workflow comment did not create a form interaction")
	return nil
}

func confirmPath(f *fixture, iid, ixid string) string {
	return f.path("/issues/" + iid + "/interactions/" + ixid + "/confirm")
}

// assistPath targets the stateless pre-confirm assist route: the form is a draft until the user
// confirms it, so assist must work without a persisted interaction.
func assistPath(f *fixture, iid string) string {
	return f.path("/issues/" + iid + "/collaboration/assist")
}

func workflowAssistBody(targetID string, values core.Object) core.Object {
	return core.Object{"targetId": targetID, "values": values}
}

// validValues is a complete, legal submission for the fixture descriptor.
func validValues() core.Object {
	return core.Object{"repository": "ora-space/cloud", "branch": "main", "scope": "full-repo", "severity": "high"}
}

// TestWorkflowCommentCreatesFormInteractionWithoutRun covers §38.1/§38.6: selecting a workflow records
// a configured-but-unconfirmed interaction and produces no run, no dispatch and no execution.
func TestWorkflowCommentCreatesFormInteractionWithoutRun(t *testing.T) {
	f := setup(t)
	wid := reviewWorkflow(t, f)
	iss := f.call("POST", f.path("/issues"), core.Object{"title": "Security review"}, "wf-issue", 200).O("resource")

	it := workflowComment(t, f, wid, iss.S("id"), "wf-1", "@Security Review Workflow please review")
	if it.S("targetType") != "workflow" || it.S("targetId") != wid {
		t.Fatalf("form interaction target wrong: %v", it)
	}
	if it["runId"] != nil {
		t.Fatalf("form interaction must not carry a run: %v", it)
	}
	if len(it.O("input")) != 0 {
		t.Fatalf("form interaction input must start empty: %v", it)
	}
	if n := f.scalar("SELECT count(*) FROM issue_runs WHERE issue_id=$1", iss.S("id")); n != 0 {
		t.Fatalf("workflow comment created %d runs; selecting is not executing", n)
	}
	// Only the comment is on the timeline — no run activities.
	tl := issueItems(f.call("GET", f.path("/issues/"+iss.S("id")+"/timeline"), nil, "", 200))
	if len(tl) != 1 || tl[0].S("kind") != "comment" {
		t.Fatalf("unexpected timeline for an unconfirmed workflow interaction: %v", tl)
	}
}

// TestFormDescriptorProjection covers the read-only provider-backed descriptor route (§38.17) and the
// target projection that advertises the formRef.
func TestFormDescriptorProjection(t *testing.T) {
	f := setup(t)
	review := reviewWorkflow(t, f)
	// A second workflow, whose Start node exercises a control the review form does not: a number with
	// a default. Its form must come out of its own graph, not out of the review workflow's.
	release := createWorkflow(t, f, "Release Readiness Workflow", "wf-release", []any{
		core.Object{"name": "version", "displayName": "Release version", "fieldType": "text-input", "valueType": "string", "required": true},
		core.Object{"name": "rolloutPercent", "displayName": "Rollout percent", "fieldType": "number", "valueType": "number", "required": true, "value": 10},
		core.Object{"name": "notifyOnCall", "displayName": "Notify on-call", "fieldType": "checkbox", "valueType": "boolean", "value": true},
		core.Object{"name": "rollbackPlan", "displayName": "Rollback plan", "fieldType": "paragraph", "valueType": "string"},
	})

	// The picker projection carries an opaque formRef for each workflow target, never the descriptor.
	advertised := map[string]string{}
	for _, target := range issueItems(f.call("GET", f.path("/collaboration/targets"), nil, "", 200)) {
		if target.S("type") != "workflow" {
			continue
		}
		advertised[target.S("id")] = target.O("interactionDescriptor").S("formRef")
		if _, embedded := target["fields"]; embedded {
			t.Fatalf("target list must not embed the form descriptor: %v", target)
		}
	}
	if advertised[review] != review {
		t.Fatalf("review workflow did not advertise its own id as formRef: %v", advertised)
	}
	if advertised[release] != release {
		t.Fatalf("release workflow did not advertise its own id as formRef: %v", advertised)
	}

	d := f.call("GET", f.path("/collaboration/forms/"+advertised[review]), nil, "", 200)
	if d.S("formRef") != review || d.S("title") != "Security Review Workflow" {
		t.Fatalf("descriptor wrong: %v", d)
	}
	fields, _ := d["fields"].([]any)
	if len(fields) == 0 {
		t.Fatalf("descriptor has no fields: %v", d)
	}
	byKey := map[string]core.Object{}
	for _, raw := range fields {
		field, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("field is not an object: %v", raw)
		}
		o := core.Object(field)
		byKey[o.S("key")] = o
	}
	if byKey["scope"].S("type") != "select" || byKey["severity"].S("type") != "select" {
		t.Fatalf("select fields wrong: %v", byKey)
	}
	if opts, _ := byKey["severity"]["options"].([]any); len(opts) != 3 {
		t.Fatalf("severity options wrong: %v", byKey["severity"])
	}
	if !byKey["repository"].B("required") || byKey["branch"].B("required") {
		t.Fatalf("required flags wrong: %v", byKey)
	}
	// A declared default survives the projection; the display name is the label.
	if byKey["branch"]["defaultValue"] != "main" {
		t.Fatalf("text default lost: %v", byKey["branch"])
	}
	if byKey["includeDependencies"]["defaultValue"] != false {
		t.Fatalf("boolean default lost: %v", byKey["includeDependencies"])
	}
	if byKey["repository"].S("label") != "Repository" {
		t.Fatalf("display name is not the label: %v", byKey["repository"])
	}

	// The second workflow's form is its own.
	other := f.call("GET", f.path("/collaboration/forms/"+release), nil, "", 200)
	otherFields, _ := other["fields"].([]any)
	otherByKey := map[string]core.Object{}
	for _, raw := range otherFields {
		field, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("field is not an object: %v", raw)
		}
		o := core.Object(field)
		otherByKey[o.S("key")] = o
	}
	if otherByKey["rolloutPercent"].S("type") != "number" || otherByKey["rolloutPercent"].N("defaultValue") != 10 {
		t.Fatalf("number field wrong: %v", otherByKey["rolloutPercent"])
	}
	if otherByKey["rollbackPlan"].S("type") != "textarea" {
		t.Fatalf("paragraph field wrong: %v", otherByKey["rollbackPlan"])
	}
	if _, leaked := otherByKey["repository"]; leaked {
		t.Fatalf("a workflow's form leaked into another's: %v", otherByKey)
	}

	// Unknown refs and cross-tenant guesses never leak: an unknown formRef is a typed 404.
	f.call("GET", f.path("/collaboration/forms/does-not-exist"), nil, "", 404)
	f.call("GET", f.path("/collaboration/forms/"+uuid.NewString()), nil, "", 404)
}

// TestFormDescriptorUnavailableAndInvalid covers the provider failure modes (§38.19): no provider is
// 503, a malformed descriptor is 500 — never a partially usable form.
func TestFormDescriptorUnavailableAndInvalid(t *testing.T) {
	f := setup(t)
	wid := reviewWorkflow(t, f)
	iss := f.call("POST", f.path("/issues"), core.Object{"title": "Provider states"}, "wf-prov", 200).O("resource")
	it := workflowComment(t, f, wid, iss.S("id"), "wf-prov-1", "configure")

	original := f.store.Forms
	t.Cleanup(func() { f.store.Forms = original })

	f.store.Forms = nil
	f.call("GET", f.path("/collaboration/forms/"+wid), nil, "", 503)
	f.call("POST", confirmPath(f, iss.S("id"), it.S("id")), core.Object{"values": validValues()}, "wf-prov-c1", 503)

	f.store.Forms = invalidDescriptorProvider{FormRef: wid}
	f.call("GET", f.path("/collaboration/forms/"+wid), nil, "", 500)
	f.call("POST", confirmPath(f, iss.S("id"), it.S("id")), core.Object{"values": validValues()}, "wf-prov-c2", 500)

	// Nothing was executed while the provider was unusable.
	if n := f.scalar("SELECT count(*) FROM issue_runs WHERE issue_id=$1", iss.S("id")); n != 0 {
		t.Fatalf("a failed provider still produced a run")
	}
}

// TestWorkflowAssistIsSideEffectFree covers §38.12/§38.13: assist returns a field-level patch, never
// clobbers a filled value, and touches no Issue state.
func TestWorkflowAssistIsSideEffectFree(t *testing.T) {
	f := setup(t)
	wid := reviewWorkflow(t, f)
	iss := f.call("POST", f.path("/issues"), core.Object{
		"title":       "Auth token leak",
		"description": "the auth token is logged",
	}, "wf-assist-issue", 200).O("resource")
	it := workflowComment(t, f, wid, iss.S("id"), "wf-assist-1", "please review")

	before := f.scalar("SELECT count(*) FROM issue_comments WHERE issue_id=$1", iss.S("id"))
	res := f.call("POST", assistPath(f, iss.S("id")), workflowAssistBody(it.S("targetId"), core.Object{
		"repository": "ora-space/cloud",
	}), "wf-assist-a1", 200)

	suggested := res.O("suggestedValues")
	if suggested.S("scope") == "" || suggested.S("severity") == "" {
		t.Fatalf("assist suggested nothing: %v", res)
	}
	// The issue text mentions auth, so the deterministic mock raises severity.
	if suggested.S("severity") != "high" {
		t.Fatalf("assist severity not deterministic from issue text: %v", suggested)
	}
	// A key the user already filled is never suggested over.
	if _, ok := suggested["repository"]; ok {
		t.Fatalf("assist must not clobber a filled value: %v", suggested)
	}
	if res.O("explanations").S("severity") == "" {
		t.Fatalf("assist explanations missing: %v", res)
	}
	// Suggestions are not persisted anywhere.
	if refs, _ := res["suggestedContextRefs"].([]any); len(refs) != 0 {
		t.Fatalf("fixture assist should suggest no refs: %v", res)
	}

	if n := f.scalar("SELECT count(*) FROM issue_runs WHERE issue_id=$1", iss.S("id")); n != 0 {
		t.Fatalf("assist created a run")
	}
	if n := f.scalar("SELECT count(*) FROM issue_comments WHERE issue_id=$1", iss.S("id")); n != before {
		t.Fatalf("assist wrote a comment")
	}
	if n := f.scalar("SELECT count(*) FROM issue_context_refs WHERE issue_id=$1", iss.S("id")); n != 0 {
		t.Fatalf("assist persisted a context ref")
	}
	if n := f.scalar("SELECT count(*) FROM issue_activities WHERE issue_id=$1", iss.S("id")); n != 0 {
		t.Fatalf("assist wrote an activity")
	}
	reloaded := issueItems(f.call("GET", f.path("/issues/"+iss.S("id")+"/interactions"), nil, "", 200))[0]
	if len(reloaded.O("input")) != 0 {
		t.Fatalf("assist wrote interaction input: %v", reloaded)
	}
}

// TestWorkflowConfirmValidatesAndExecutes covers the confirm boundary end-to-end (§38.7, §38.15,
// §38.20): authoritative re-validation, exactly one run, the persisted interaction input, the run's
// effective snapshot, provenance, and the workflow timeline representation.
func TestWorkflowConfirmValidatesAndExecutes(t *testing.T) {
	f := setup(t)
	wid := reviewWorkflow(t, f)
	iss := f.call("POST", f.path("/issues"), core.Object{"title": "Confirm me", "description": "desc"}, "wf-confirm-issue", 200).O("resource")
	it := workflowComment(t, f, wid, iss.S("id"), "wf-confirm-1", "configure the review")

	// Idempotency-Key is mandatory for POST, like every other mutation.
	f.call("POST", confirmPath(f, iss.S("id"), it.S("id")), core.Object{"values": validValues()}, "", 400)
	// Missing required field.
	f.call("POST", confirmPath(f, iss.S("id"), it.S("id")), core.Object{"values": core.Object{"repository": "ora-space/cloud"}}, "wf-c1", 400)
	// Unknown field key.
	f.call("POST", confirmPath(f, iss.S("id"), it.S("id")), core.Object{"values": core.Object{
		"repository": "ora-space/cloud", "scope": "full-repo", "severity": "high", "bogus": "x",
	}}, "wf-c2", 400)
	// Value outside the declared options.
	f.call("POST", confirmPath(f, iss.S("id"), it.S("id")), core.Object{"values": core.Object{
		"repository": "ora-space/cloud", "scope": "not-an-option", "severity": "high",
	}}, "wf-c3", 400)
	// Wrong scalar type for a boolean field.
	f.call("POST", confirmPath(f, iss.S("id"), it.S("id")), core.Object{"values": core.Object{
		"repository": "ora-space/cloud", "scope": "full-repo", "severity": "high", "includeDependencies": "yes",
	}}, "wf-c4", 400)
	// A malformed applied-context-ref list.
	f.call("POST", confirmPath(f, iss.S("id"), it.S("id")), core.Object{
		"values": validValues(), "contextRefs": []any{core.Object{"refType": "not_a_type", "refId": uuid.NewString()}},
	}, "wf-c5", 400)
	if n := f.scalar("SELECT count(*) FROM issue_runs WHERE issue_id=$1", iss.S("id")); n != 0 {
		t.Fatalf("a rejected confirm created a run")
	}

	created := f.call("POST", confirmPath(f, iss.S("id"), it.S("id")), core.Object{"values": validValues()}, "wf-confirm-ok", 200).O("resource")
	// The confirm response is the committed enqueue: dispatch is post-commit, so execution has not been
	// observed yet (§19 ordering). The frontend re-reads the run/timeline afterwards.
	if created.S("status") != "queued" || created.S("executorType") != "workflow" || created.S("executorId") != wid {
		t.Fatalf("workflow run wrong at confirm time: %v", created)
	}
	// Provenance points at the interaction that authorized it.
	if created.S("triggerEvidenceKind") != "interaction" || created.S("triggerEvidenceRefId") != it.S("id") {
		t.Fatalf("workflow run provenance wrong: %v", created)
	}
	// Re-read: the mock dispatcher drove it to completion through the observer seam.
	run := f.call("GET", f.path("/issues/"+iss.S("id")+"/runs/"+created.S("id")), nil, "", 200)
	if run.S("status") != "completed" || run.S("externalExecutionId") == "" {
		t.Fatalf("workflow run did not complete through the observer: %v", run)
	}

	// Exactly one run, and the interaction is now confirmed with its own persisted input.
	if n := f.scalar("SELECT count(*) FROM issue_runs WHERE issue_id=$1", iss.S("id")); n != 1 {
		t.Fatalf("confirm produced %d runs", n)
	}
	reloaded := issueItems(f.call("GET", f.path("/issues/"+iss.S("id")+"/interactions"), nil, "", 200))[0]
	if reloaded.S("runId") != run.S("id") {
		t.Fatalf("interaction was not claimed: %v", reloaded)
	}
	if reloaded.O("input").S("scope") != "full-repo" || reloaded.O("input").S("severity") != "high" {
		t.Fatalf("confirmed interaction input not persisted: %v", reloaded.O("input"))
	}
	if _, stored := reloaded.O("input")["fields"]; stored {
		t.Fatalf("the descriptor must never be stored as interaction input")
	}

	// The run snapshot is the effective execution-time input, and it equals what the dispatcher got.
	input := run.O("input")
	if input.S("task") != "" || input.O("interactionValues").S("repository") != "ora-space/cloud" {
		t.Fatalf("run snapshot wrong: %v", input)
	}
	if input.O("issue").S("title") != "Confirm me" || input.O("target").S("type") != "workflow" {
		t.Fatalf("run snapshot lost issue/target context: %v", input)
	}
	if _, ok := input["recentComments"]; !ok {
		t.Fatalf("run snapshot lost the recent-comment window: %v", input)
	}

	// Timeline: comment, enqueued, started, progress, system message, completed — and NO workflow-authored comment.
	tl := issueItems(f.call("GET", f.path("/issues/"+iss.S("id")+"/timeline"), nil, "", 200))
	actions := []string{}
	for _, e := range tl {
		if e.S("kind") == "activity" {
			actions = append(actions, e.S("action"))
		}
	}
	want := []string{"run.enqueued", "run.started", "run.progress", "run.message", "run.completed"}
	if len(actions) != len(want) {
		t.Fatalf("workflow timeline actions = %v, want %v", actions, want)
	}
	for i, a := range want {
		if actions[i] != a {
			t.Fatalf("workflow timeline actions = %v, want %v", actions, want)
		}
	}
	for _, e := range tl {
		if e.S("authorType") == "workflow" {
			t.Fatalf("a workflow must never author content: %v", e)
		}
	}
	message := tl[4]
	if message.S("authorType") != "system" || message.O("details").S("executorType") != "workflow" ||
		message.O("details").S("executorId") != wid || message.O("details").S("message") == "" {
		t.Fatalf("workflow message activity wrong: %v", message)
	}
	// seq is strictly increasing and unique across the merged timeline.
	for i := 1; i < len(tl); i++ {
		if tl[i].N("seq") <= tl[i-1].N("seq") {
			t.Fatalf("timeline seq not strictly increasing: %v", tl)
		}
	}
}

// TestWorkflowConfirmIdempotencyAndDoubleConfirm covers §38.22: the same key+body replays, a changed
// body under the same key conflicts, and a second confirm can never produce a second run.
func TestWorkflowConfirmIdempotencyAndDoubleConfirm(t *testing.T) {
	f := setup(t)
	wid := reviewWorkflow(t, f)
	iss := f.call("POST", f.path("/issues"), core.Object{"title": "Idempotent"}, "wf-idem-issue", 200).O("resource")
	it := workflowComment(t, f, wid, iss.S("id"), "wf-idem-1", "configure")

	first := f.call("POST", confirmPath(f, iss.S("id"), it.S("id")), core.Object{"values": validValues()}, "wf-idem-confirm", 200).O("resource")
	replay := f.call("POST", confirmPath(f, iss.S("id"), it.S("id")), core.Object{"values": validValues()}, "wf-idem-confirm", 200).O("resource")
	if replay.S("id") != first.S("id") {
		t.Fatalf("idempotent replay returned a different run: %v vs %v", replay.S("id"), first.S("id"))
	}
	// Same key, different body -> 409 from the shared idempotency infrastructure.
	f.call("POST", confirmPath(f, iss.S("id"), it.S("id")), core.Object{"values": core.Object{
		"repository": "other/repo", "scope": "full-repo", "severity": "low",
	}}, "wf-idem-confirm", 409)

	// A different key on an already-confirmed interaction is a conflict, not a second execution.
	f.call("POST", confirmPath(f, iss.S("id"), it.S("id")), core.Object{"values": validValues()}, "wf-idem-second", 409)

	if n := f.scalar("SELECT count(*) FROM issue_runs WHERE issue_id=$1", iss.S("id")); n != 1 {
		t.Fatalf("double confirm produced %d runs", n)
	}
}

// TestWorkflowConfirmScopeAndModeGuards covers the security invariants of §38.31: a confirm is scoped to
// its own issue and tenant, and only a Form Mode interaction is confirmable/assistable.
func TestWorkflowConfirmScopeAndModeGuards(t *testing.T) {
	f := setup(t)
	wid := reviewWorkflow(t, f)
	a := f.call("POST", f.path("/issues"), core.Object{"title": "A"}, "wf-scope-a", 200).O("resource")
	b := f.call("POST", f.path("/issues"), core.Object{"title": "B"}, "wf-scope-b", 200).O("resource")
	it := workflowComment(t, f, wid, a.S("id"), "wf-scope-1", "configure")

	// Same tenant, wrong issue -> 404 (never a cross-issue claim).
	f.call("POST", confirmPath(f, b.S("id"), it.S("id")), core.Object{"values": validValues()}, "wf-scope-1c", 404)
	// Unknown interaction -> 404.
	f.call("POST", confirmPath(f, a.S("id"), uuid.NewString()), core.Object{"values": validValues()}, "wf-scope-2c", 404)
	f.call("POST", assistPath(f, a.S("id")), workflowAssistBody(uuid.NewString(), core.Object{}), "wf-scope-2a", 404)

	// A mention/task interaction is not a form and cannot be confirmed or assisted.
	f.call("POST", f.path("/issues/"+a.S("id")+"/comments"), core.Object{
		"body": "hey", "targets": []any{core.Object{"type": "user", "id": f.uid}},
	}, "wf-scope-mention", 200)
	mention := issueItems(f.call("GET", f.path("/issues/"+a.S("id")+"/interactions"), nil, "", 200))
	var mentionID string
	for _, x := range mention {
		if x.S("mode") == "mention" {
			mentionID = x.S("id")
		}
	}
	if mentionID == "" {
		t.Fatal("mention interaction missing")
	}
	f.call("POST", confirmPath(f, a.S("id"), mentionID), core.Object{"values": core.Object{}}, "wf-scope-3c", 409)
	// Assist is stateless and workflow-only: a non-workflow target id does not resolve as a workflow
	// target, so it is a typed 404 rather than a hint that the id exists.
	f.call("POST", assistPath(f, a.S("id")), workflowAssistBody(mentionID, core.Object{}), "wf-scope-3a", 404)

	if n := f.scalar("SELECT count(*) FROM issue_runs WHERE issue_id=$1", a.S("id")); n != 0 {
		t.Fatalf("a guarded confirm still produced a run")
	}
}

// TestWorkflowAssistUnavailable covers the assist capability state: no provider wired is a typed 503,
// not a silent empty suggestion.
func TestWorkflowAssistUnavailable(t *testing.T) {
	f := setup(t)
	wid := reviewWorkflow(t, f)
	iss := f.call("POST", f.path("/issues"), core.Object{"title": "No assist"}, "wf-noassist-issue", 200).O("resource")
	it := workflowComment(t, f, wid, iss.S("id"), "wf-noassist-1", "configure")

	original := f.store.Assist
	t.Cleanup(func() { f.store.Assist = original })
	f.store.Assist = nil
	f.call("POST", assistPath(f, iss.S("id")), workflowAssistBody(it.S("targetId"), core.Object{}), "wf-noassist-a1", 503)
}
