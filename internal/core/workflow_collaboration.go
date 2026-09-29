package core

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Workflow-backed collaboration ports. The workflow domain owns the `workflows` document, so it is
// also the adapter that projects it into the two Issues-facing shapes: a `workflow` @ target, and the
// Form Mode descriptor that target advertises. Both read the same row, so they cannot disagree and no
// separate registration step exists.
//
// These are the production implementations of the ports declared in collaboration.go, wired by
// NewStore rather than by the development fixture gate: a deployment that never enables the Agent/Team
// fixtures still serves real workflow targets. Cloud has no Agent/Team backend, so this directory
// answers the `workflow` target type only — agent and team resolve to not-found, exactly as they do
// with no directory at all.

// WorkflowDirectory lists and resolves the tenant's live workflows as collaboration targets.
type WorkflowDirectory struct{ Pool *sql.DB }

// ListTargets returns the tenant's live workflows, newest name first, optionally filtered by a name
// substring. Archived workflows are never discoverable.
func (d WorkflowDirectory) ListTargets(ctx context.Context, tenantID, query string) ([]CollaborationTargetSummary, error) {
	q := "SELECT id, name, description FROM workflows WHERE tenant_id=$1 AND deleted_at IS NULL"
	args := []any{tenantID}
	if term := strings.TrimSpace(query); term != "" {
		args = append(args, likePattern(term))
		q += " AND name ILIKE $2"
	}
	q += " ORDER BY name, id"
	rows, err := d.Pool.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []CollaborationTargetSummary{}
	for rows.Next() {
		var id, name, description string
		if err := rows.Scan(&id, &name, &description); err != nil {
			return nil, err
		}
		out = append(out, workflowTarget(id, name, description))
	}
	return out, rows.Err()
}

// ResolveTarget resolves one live workflow in the tenant. A target type Cloud has no backend for is
// not-found, never an error: the caller turns it into the same 404 an unknown id produces.
func (d WorkflowDirectory) ResolveTarget(ctx context.Context, tenantID, targetType, targetID string) (CollaborationTargetSummary, bool, error) {
	if targetType != "workflow" || !validID(targetID) {
		return CollaborationTargetSummary{}, false, nil
	}
	var name, description string
	err := d.Pool.QueryRowContext(ctx, "SELECT name, description FROM workflows WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL", targetID, tenantID).Scan(&name, &description)
	if errors.Is(err, sql.ErrNoRows) {
		return CollaborationTargetSummary{}, false, nil
	}
	if err != nil {
		return CollaborationTargetSummary{}, false, err
	}
	return workflowTarget(targetID, name, description), true, nil
}

// workflowTarget is the frozen projection of one workflow (§37.2): Form Mode, no task required, and
// the workflow id as the opaque formRef. Deriving the ref from the id rather than storing one keeps
// the advertised ref and the resolvable workflow from ever drifting apart, and keeps it a valid
// opaque token without a second identifier to constrain.
func workflowTarget(id, name, description string) CollaborationTargetSummary {
	return CollaborationTargetSummary{
		Type:        "workflow",
		ID:          id,
		DisplayName: name,
		Description: description,
		InteractionDescriptor: InteractionDescriptor{
			Mode:         "form",
			RequiresTask: false,
			FormRef:      id,
		},
	}
}

// WorkflowFormDescriptors resolves the Form Mode descriptor of one workflow: the input form its Start
// node declares, projected onto the rendering controls Issues can draw (§38.5). It is deliberately
// not the workflow's canonical schema — the graph stays the authority and this is one projection of it.
type WorkflowFormDescriptors struct{ Pool *sql.DB }

// ResolveFormDescriptor resolves `formRef`, which is a workflow id. A ref that is not an id, or names
// no live workflow in this tenant, is not-found. `issue` tailors the form to the issue it was opened
// from; its zero value projects the graph exactly as it would be projected without any issue at all.
//
//nolint:gocritic // value-typed issue context mirrors the FormDescriptorProvider port this provider satisfies
func (p WorkflowFormDescriptors) ResolveFormDescriptor(ctx context.Context, tenantID, formRef string, issue IssueFormContext) (FormDescriptor, bool, error) {
	if !validID(formRef) {
		return FormDescriptor{}, false, nil
	}
	var name, description string
	var graph []byte
	err := p.Pool.QueryRowContext(ctx, "SELECT name, description, graph FROM workflows WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL", formRef, tenantID).Scan(&name, &description, &graph)
	if errors.Is(err, sql.ErrNoRows) {
		return FormDescriptor{}, false, nil
	}
	if err != nil {
		return FormDescriptor{}, false, err
	}
	source := workflowFormSource{Ref: formRef, Title: name, Description: description, Graph: graph}
	// Only an issue-scoped form carries the launch fields, so only it pays for the second query: a
	// caller with no issue context gets the same single lookup it always did.
	if issue.IssueID != "" {
		source.Snapshots, err = p.snapshots(ctx, tenantID, formRef)
		if err != nil {
			return FormDescriptor{}, false, err
		}
	}
	return formDescriptorFromGraph(&source, &issue), true, nil
}

// snapshots lists the workflow's published versions, newest first, capped at the number of options a
// descriptor may carry: a workflow published more than a hundred times would otherwise build a
// descriptor that fails validation closed and takes every confirm down with it.
//
// Snapshots are immutable and never deleted — the table has no `deleted_at` — so there is no
// soft-delete filter, and the ordering is the one the existing list index already serves.
func (p WorkflowFormDescriptors) snapshots(ctx context.Context, tenantID, workflowID string) ([]Object, error) {
	rows, err := p.Pool.QueryContext(ctx, "SELECT id, version, name FROM workflow_snapshots WHERE tenant_id=$1 AND workflow_id=$2 ORDER BY version DESC LIMIT $3", tenantID, workflowID, maxFormOptions)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []Object{}
	for rows.Next() {
		var id, name string
		var version int64
		if err := rows.Scan(&id, &version, &name); err != nil {
			return nil, err
		}
		// Scanned straight into int64 rather than read back as a decoded number: `version` is a
		// bigint, and everything that comes through a JSON round-trip arrives as a float64.
		out = append(out, Object{"id": id, "version": version, "name": name})
	}
	return out, rows.Err()
}

// workflowFormSource is everything one descriptor projection reads: the workflow's own identity and
// document, plus the published versions the launch fields offer. Bundled rather than passed one by
// one so the projection keeps a single argument that grows with the form.
type workflowFormSource struct {
	Ref         string
	Title       string
	Description string
	Graph       []byte
	Snapshots   []Object
}

// formDescriptorFromGraph projects a stored graph onto a form descriptor. Title and description are
// the workflow's own, clipped to the lengths the descriptor contract accepts: a workflow description
// is free text with no length rule of its own, and a descriptor that fails validation is a 500.
//
// The fields come out in three bands, in this order: the platform's, then the author's Start
// variables, then the graph's global variables. The platform fields are injected only when there is an
// issue to inject them for: a caller with no issue context gets the author's own form, byte for byte
// what it was before the fields existed.
func formDescriptorFromGraph(source *workflowFormSource, issue *IssueFormContext) FormDescriptor {
	graph := Object{}
	// The column is a NOT NULL jsonb object, so a decode failure means the row was not written by the
	// workflow API. An unreadable graph yields an empty form rather than a failed request.
	_ = json.Unmarshal(source.Graph, &graph)
	fields := []FormField{}
	for _, variable := range workflowStartVariables(graph) {
		if len(fields) == maxFormFields {
			break
		}
		if field, ok := startInputField(variable); ok {
			fields = append(fields, field)
		}
	}
	fields = appendGlobalVariableFields(fields, graph)
	if issue.IssueID != "" {
		fields = injectPlatformFields(fields, issue, workflowStartPrompt(graph), source.Snapshots, launchFieldsFromGraph(graph))
	}
	return FormDescriptor{
		FormRef:     source.Ref,
		Title:       clip(source.Title, 200),
		Description: clip(source.Description, 2000),
		Fields:      fields,
	}
}

// Reserved keys of the fields the platform injects into every workflow form (§38.37b, §38.37c). They
// are reserved in the sense that a workflow declaring a variable under one of these names keeps its own
// declaration — see injectPlatformFields. `context_refs` is reserved in a second sense: the Issues
// surface reads it back out of the values and turns it into the run's context references, so a
// workflow that declares that name takes over a key the platform also interprets.
const (
	fieldKeyPrompt      = "prompt"
	fieldKeyRepository  = "repository"
	fieldKeyBranch      = "branch"
	fieldKeyVersion     = "version"
	fieldKeyContextRefs = "context_refs"
)

// launchFieldKeys is every key the platform injects, and the only set a workflow's `launchFields`
// declaration may name: a declaration cannot conjure a field the catalog does not have, so an
// unrecognized key is dropped rather than remembered. The order the fields are *injected* in lives in
// the catalog below, where each field is actually built.
var launchFieldKeys = []string{fieldKeyRepository, fieldKeyBranch, fieldKeyVersion, fieldKeyPrompt, fieldKeyContextRefs}

// launchFieldOverride is one entry of a workflow's `launchFields` declaration (§38.37d): whether the
// form asks for that field, and whether it insists on an answer.
type launchFieldOverride struct {
	Enabled bool
	// Required is nil when the author said nothing, which keeps the catalog's own answer rather than
	// defaulting to false — "optional" and "unstated" are different, and only the author may pick the
	// former.
	Required *bool
}

// launchFieldsFromGraph reads the workflow's declaration of which launch fields its form asks for.
//
// The declaration is read *per key*: one it does not mention keeps the catalog's own answer. That is
// what makes a field added to the catalog later appear for every workflow without re-saving one, and
// what keeps a workflow written before this declaration existed rendering exactly the form it always
// did. An unreadable entry contributes nothing rather than failing the request, the way the globals
// projection reads the same document.
func launchFieldsFromGraph(graph Object) map[string]launchFieldOverride {
	declared, _ := graph["launchFields"].([]any)
	out := map[string]launchFieldOverride{}
	for _, item := range declared {
		raw, ok := item.(map[string]any)
		if !ok {
			continue
		}
		entry := Object(raw)
		key := entry.S("key")
		if !isLaunchFieldKey(key) {
			continue
		}
		override := launchFieldOverride{Enabled: true}
		if enabled, ok := entry["enabled"].(bool); ok {
			override.Enabled = enabled
		}
		if required, ok := entry["required"].(bool); ok {
			override.Required = &required
		}
		out[key] = override
	}
	return out
}

func isLaunchFieldKey(key string) bool {
	for _, candidate := range launchFieldKeys {
		if candidate == key {
			return true
		}
	}
	return false
}

// launchFieldEnabled reports whether the form asks for a field. Silence means yes: only an explicit
// `enabled: false` removes one.
func launchFieldEnabled(declaration map[string]launchFieldOverride, key string) bool {
	override, ok := declaration[key]
	return !ok || override.Enabled
}

// launchFieldRequired resolves a field's requiredness: the author's answer when they gave one, the
// catalog's otherwise.
func launchFieldRequired(declaration map[string]launchFieldOverride, key string, fallback bool) bool {
	if override, ok := declaration[key]; ok && override.Required != nil {
		return *override.Required
	}
	return fallback
}

// platformFormFields is the ordered catalog of fields every workflow form carries once it is opened
// for an issue: what this run is *about*. It answers, in order, which repository, which branch of it,
// which published version of the workflow, what prompt, and which extra context travels with it.
//
// Repository and branch are required — a run with no repository has nothing to work on — while the
// rest are optional, because leaving them empty is a meaningful choice: an empty prompt means the
// workflow's own Start prompt, and no extra references means exactly the issue's own.
//
// The version and context-reference fields are omitted outright when they have nothing to offer rather
// than injected empty. A select with no options fails descriptor validation closed, and the contract
// admits no other way to say "no choice available"; the same reasoning that keeps an over-long author
// form from being appended to.
//
// Labels are Chinese because this descriptor is rendered by the Issues surface, which is Chinese
// throughout; author-declared labels arrive in whatever language their author wrote them in.
//
// Each entry also carries whether the platform can *offer* that field at all: a field with nothing to
// offer is dropped even when the author asked for it, because the contract has no way to express a
// select with no choices (§38.37c).
//
// This is the catalog rather than the form. A workflow's declaration narrows it in
// injectPlatformFields, and only there, because a key the author declared in their own Start node is
// not the platform's to withdraw (§38.37d).
func platformFormFields(issue *IssueFormContext, startPrompt string, snapshots []Object) []FormField {
	version, hasVersion := versionField(snapshots)
	refs, hasRefs := contextRefsField(issue)
	catalog := []struct {
		field   FormField
		offered bool
	}{
		{
			FormField{
				Key:          fieldKeyRepository,
				Label:        "仓库地址",
				Type:         fieldText,
				Required:     true,
				DefaultValue: platformDefault(issue.RepositoryURL),
			},
			true,
		},
		{
			FormField{
				Key:          fieldKeyBranch,
				Label:        "分支",
				Type:         fieldText,
				Required:     true,
				DefaultValue: platformDefault(issue.DefaultBranch),
			},
			true,
		},
		{version, hasVersion},
		{
			FormField{
				Key:          fieldKeyPrompt,
				Label:        "提示词",
				Type:         fieldTextarea,
				Required:     false,
				DefaultValue: platformDefault(startPrompt),
			},
			true,
		},
		{refs, hasRefs},
	}
	fields := []FormField{}
	for i := range catalog {
		if !catalog[i].offered {
			continue
		}
		fields = append(fields, catalog[i].field)
	}
	return fields
}

// versionField offers the workflow's published versions, newest first and newest by default. The value
// is the snapshot id rather than the version number: the id is what a run is created from, and it
// keeps pointing at the same frozen document. The version number rides in the label, where it is read
// rather than consumed.
//
// A workflow that has never been published has nothing to offer, and an option-less select would fail
// descriptor validation, so the field is dropped rather than injected empty.
func versionField(snapshots []Object) (FormField, bool) {
	options := []FormOption{}
	for _, snapshot := range snapshots {
		id := snapshot.S("id")
		if !validID(id) {
			continue
		}
		label := "v" + strconv.FormatInt(snapshot.N("version"), 10) + " · " + snapshot.S("name")
		options = append(options, FormOption{Value: id, Label: clip(label, 200)})
	}
	if len(options) == 0 {
		return FormField{}, false
	}
	return FormField{
		Key:          fieldKeyVersion,
		Label:        "运行版本",
		Type:         fieldSelect,
		Required:     false,
		DefaultValue: options[0].Value,
		Options:      options,
	}, true
}

// contextRefsField offers the references this run may carry *in addition to* the issue's own. It is
// additive by construction rather than a picker over what to keep: the issue's persisted references
// are already on every run it starts, so a checkbox that appeared to remove one would be lying.
//
// Only the two references an issue can name for itself are offered — its project and its parent —
// because a picker over arbitrary issues, pull requests and files does not exist yet. An issue that
// can name neither gets no field at all.
func contextRefsField(issue *IssueFormContext) (FormField, bool) {
	options := []FormOption{}
	if validID(issue.ProjectID) {
		options = append(options, FormOption{Value: contextRefValue("project", issue.ProjectID), Label: "本项目"})
	}
	if validID(issue.ParentIssueID) {
		options = append(options, FormOption{Value: contextRefValue("parent_issue", issue.ParentIssueID), Label: "父任务"})
	}
	if len(options) == 0 {
		return FormField{}, false
	}
	return FormField{
		Key:         fieldKeyContextRefs,
		Label:       "补充上下文引用",
		Type:        fieldMultiSelect,
		Required:    false,
		Description: "本 issue 自己的引用已经包含在内；这里勾选的会额外带上。",
		Options:     options,
	}, true
}

// contextRefValue is the wire form of one context-reference option: the `refType:refId` pair the
// Issues surface splits back into a reference. Kept in one place so the format the descriptor emits
// and the format the surface parses cannot drift apart.
func contextRefValue(refType, refID string) string {
	return refType + ":" + refID
}

// platformDefault turns an optional context value into a field default. An empty value contributes no
// default rather than an empty one: the contract omits absent defaults, and a required field with no
// default is what asks the user to fill it in.
func platformDefault(value string) any {
	if value == "" {
		return nil
	}
	return clip(value, maxFieldValueLength)
}

// injectPlatformFields puts the platform fields in front of the author's own. They come first because
// they say what the run is *about* — which repository, which branch, which version, which prompt,
// which extra context — while the author's variables are its parameters.
//
// A key the author already declared wins outright: their control, label and requiredness are kept, and
// the platform only supplies the default the author left empty, and only when that default is a legal
// value for the author's control. Collisions are a real case rather than a hypothetical one — a
// workflow whose Start node declares a `repository` variable is how one would have expressed this
// before the platform field existed — and so is an *illegal* default: the same URL is not a legal
// value for a `repository` the author declared as a select that does not offer it.
//
// The workflow's declaration (§38.37d) is applied here, and only to the fields the platform is
// *adding*. A field the author asked for in their own Start node is asked for because they asked for
// it, so no declaration withdraws it: for that key the declaration is inert, control and requiredness
// alike, and the platform contributes nothing but the default.
func injectPlatformFields(fields []FormField, issue *IssueFormContext, startPrompt string, snapshots []Object, declaration map[string]launchFieldOverride) []FormField {
	declared := map[string]int{}
	for i := range fields {
		declared[fields[i].Key] = i
	}
	offered := platformFormFields(issue, startPrompt, snapshots)
	platform := []FormField{}
	for i := range offered {
		field := &offered[i]
		if i, ok := declared[field.Key]; ok {
			fillDefault(&fields[i], field)
			continue
		}
		if !launchFieldEnabled(declaration, field.Key) {
			continue
		}
		field.Required = launchFieldRequired(declaration, field.Key, field.Required)
		// The author's form already fills the descriptor. Appending past the limit would make the
		// descriptor invalid and turn every confirm into a 500, so the author's form is served instead.
		if len(fields)+len(platform) >= maxFormFields {
			break
		}
		platform = append(platform, *field)
	}
	if len(platform) == 0 {
		return fields
	}
	return append(platform, fields...)
}

// appendGlobalVariableFields projects the graph's global variables onto the form, after the author's
// own Start variables: those are the parameters of one run, while a global is a workflow-wide constant
// this invocation may override. Each keeps its declared value as its default, so leaving a field
// untouched runs the workflow with exactly the constant it declares.
//
// A global name always contains a dot — the editor's own guard, mirrored here — which is what keeps
// these keys from colliding with a Start variable or a platform field key. Names that are not valid
// field keys are dropped rather than sanitized: the confirmed values reach the workflow keyed by name,
// so a rewritten key would feed the run the wrong variable.
func appendGlobalVariableFields(fields []FormField, graph Object) []FormField {
	declared, _ := graph["globalVariables"].([]any)
	seen := map[string]bool{}
	for i := range fields {
		seen[fields[i].Key] = true
	}
	for _, item := range declared {
		if len(fields) == maxFormFields {
			break
		}
		raw, ok := item.(map[string]any)
		if !ok {
			continue
		}
		variable := Object(raw)
		name := variable.S("name")
		if !strings.Contains(name, ".") || seen[name] {
			continue
		}
		if field, ok := globalVariableField(variable); ok {
			seen[name] = true
			fields = append(fields, field)
		}
	}
	return fields
}

// globalVariableField maps one global variable onto a control. The mapping mirrors the Start variables'
// own, and a type Issues has no control for degrades to a textarea holding JSON rather than dropping
// the variable: a missing field would silently run the workflow with its declared constant instead of
// the value the user meant to set, which is the one outcome worse than an awkward control.
func globalVariableField(variable Object) (FormField, bool) {
	key := variable.S("name")
	if !validOpaqueToken(key) {
		return FormField{}, false
	}
	field := FormField{Key: key, Label: key, Required: false}
	switch variable.S("valueType") {
	case "number", "integer":
		field.Type = fieldNumber
	case "boolean":
		field.Type = fieldBoolean
	case "string", "secret":
		field.Type = fieldText
	default:
		field.Type = fieldTextarea
	}
	if value, ok := variable["value"]; ok && value != nil && validFieldValue(&field, value) {
		field.DefaultValue = value
	}
	return field, true
}

// fillDefault hands the platform default to an author-declared field, but only when the author left the
// value empty and the default is legal for *their* control.
func fillDefault(field, platform *FormField) {
	if field.DefaultValue != nil || platform.DefaultValue == nil {
		return
	}
	if validFieldValue(field, platform.DefaultValue) {
		field.DefaultValue = platform.DefaultValue
	}
}

// workflowStartNode returns the `data` of the graph's first Start node. The graph is a document the API
// never interprets, so its shape is read defensively: anything unexpected contributes nothing rather
// than failing the request. The first Start node wins, matching the editor, which allows at most one.
//
// Reading the prompt and the variables through this one lookup is what keeps them from ever coming
// from two different nodes in a graph that somehow carries more than one.
func workflowStartNode(graph Object) Object {
	nodes, _ := graph["nodes"].([]any)
	for _, raw := range nodes {
		node, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		data, ok := node["data"].(map[string]any)
		if !ok || data["kind"] != "start" {
			continue
		}
		return Object(data)
	}
	return nil
}

// workflowStartVariables reads the input variables the Start node declares.
func workflowStartVariables(graph Object) []Object {
	data := workflowStartNode(graph)
	if data == nil {
		return nil
	}
	declared, _ := data["inputVariables"].([]any)
	out := []Object{}
	for _, item := range declared {
		if variable, ok := item.(map[string]any); ok {
			out = append(out, Object(variable))
		}
	}
	return out
}

// workflowStartPrompt reads the kickoff prompt the Start node carries — the editor's 初始提示词, stored
// as `data.input`. It is the default the platform's prompt field offers, so an empty or whitespace-only
// prompt contributes no default: a field prefilled with blank space would look answered when it is not.
func workflowStartPrompt(graph Object) string {
	data := workflowStartNode(graph)
	if data == nil {
		return ""
	}
	prompt, _ := data["input"].(string)
	return strings.TrimSpace(prompt)
}

// startInputField maps one Start variable onto the control Issues renders. The second result is false
// when the variable cannot be expressed as a valid field at all, which drops it from the form: a
// malformed field would fail descriptor validation closed and take the whole form with it.
//
// The key is the variable's own name, never a derived one: the confirmed values are handed to the
// workflow keyed by name, so a renamed key would silently feed the run the wrong input.
func startInputField(variable Object) (FormField, bool) {
	key := variable.S("name")
	if !validOpaqueToken(key) {
		return FormField{}, false
	}
	label := variable.S("displayName")
	if label == "" {
		label = key
	}
	if len(label) > 200 {
		return FormField{}, false
	}
	field := FormField{Key: key, Label: label, Required: variable.B("required")}
	switch inputFieldType(variable) {
	case "paragraph":
		field.Type = fieldTextarea
	case "number":
		field.Type = fieldNumber
	case "checkbox":
		field.Type = fieldBoolean
	case "select":
		options := inputOptions(variable)
		if len(options) == 0 {
			// A select with nothing to choose from would fail validation closed; a text field keeps the
			// form usable instead of making the workflow unconfirmable.
			field.Type = fieldText
			break
		}
		field.Type = fieldSelect
		field.Options = options
	case "file-list", "json":
		// Issues has no upload or structured-value control. A textarea collects the reference or the
		// document as text, which is what the workflow receives either way.
		field.Type = fieldTextarea
	default:
		// text-input, file, and every control Cloud has no counterpart for degrade to a single line.
		field.Type = fieldText
	}
	if value, ok := variable["value"]; ok && value != nil && validFieldValue(&field, value) {
		field.DefaultValue = value
	}
	return field, true
}

// inputFieldType resolves the control a variable declares, falling back to the one its variable-pool
// type implies. Declarations that predate explicit form-control metadata carry no fieldType, and the
// editor resolves them the same way, so an older graph renders the form it always did.
func inputFieldType(variable Object) string {
	if declared := variable.S("fieldType"); declared != "" {
		return declared
	}
	switch variable.S("valueType") {
	case "number", "integer":
		return "number"
	case "boolean":
		return "checkbox"
	case "file":
		return "file"
	case "array[file]":
		return "file-list"
	case "string", "secret", "":
		return "text-input"
	default:
		return "json"
	}
}

// inputOptions reads a select's choices. The label is the value: a Start variable declares choices as
// plain strings, and the editor offers no separate label to carry.
func inputOptions(variable Object) []FormOption {
	declared, _ := variable["options"].([]any)
	out := []FormOption{}
	seen := map[string]bool{}
	for _, item := range declared {
		value, ok := item.(string)
		if !ok || value == "" || len(value) > 200 || seen[value] || len(out) == maxFormOptions {
			continue
		}
		seen[value] = true
		out = append(out, FormOption{Value: value, Label: value})
	}
	return out
}

// clip shortens s to at most n bytes without splitting a UTF-8 sequence.
func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}
