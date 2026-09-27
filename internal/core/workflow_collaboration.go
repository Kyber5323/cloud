package core

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
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
// no live workflow in this tenant, is not-found.
func (p WorkflowFormDescriptors) ResolveFormDescriptor(ctx context.Context, tenantID, formRef string) (FormDescriptor, bool, error) {
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
	return formDescriptorFromGraph(formRef, name, description, graph), true, nil
}

// formDescriptorFromGraph projects a stored graph onto a form descriptor. Title and description are
// the workflow's own, clipped to the lengths the descriptor contract accepts: a workflow description
// is free text with no length rule of its own, and a descriptor that fails validation is a 500.
func formDescriptorFromGraph(ref, title, description string, raw []byte) FormDescriptor {
	graph := Object{}
	// The column is a NOT NULL jsonb object, so a decode failure means the row was not written by the
	// workflow API. An unreadable graph yields an empty form rather than a failed request.
	_ = json.Unmarshal(raw, &graph)
	fields := []FormField{}
	for _, variable := range workflowStartVariables(graph) {
		if len(fields) == maxFormFields {
			break
		}
		if field, ok := startInputField(variable); ok {
			fields = append(fields, field)
		}
	}
	return FormDescriptor{
		FormRef:     ref,
		Title:       clip(title, 200),
		Description: clip(description, 2000),
		Fields:      fields,
	}
}

// workflowStartVariables reads the input variables the Start node declares. The graph is a document
// the API never interprets, so its shape is read defensively: anything unexpected contributes no
// variables rather than failing the request. The first Start node wins, matching the editor, which
// allows at most one.
func workflowStartVariables(graph Object) []Object {
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
		declared, _ := data["inputVariables"].([]any)
		out := []Object{}
		for _, item := range declared {
			if variable, ok := item.(map[string]any); ok {
				out = append(out, Object(variable))
			}
		}
		return out
	}
	return nil
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
