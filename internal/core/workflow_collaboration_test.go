package core

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

// reviewRef is the formRef the tests resolve; any opaque token works, because the projection copies
// the ref through rather than deriving it.
const reviewRef = "44444444-4444-4444-8444-444444444444"

// descriptorFor projects a graph whose Start node declares `variables`, the way a stored document
// reaches the projection: through JSON, as the jsonb column hands it back.
func descriptorFor(t *testing.T, variables []any) FormDescriptor {
	t.Helper()
	return formDescriptorFromGraph(reviewRef, "Review flow", "Reviews a change", encodeGraph(t, Object{
		"nodes": []any{Object{
			"id": "start-1", "type": "workflow", "deletable": false,
			"position": Object{"x": 0, "y": 0},
			"data":     Object{"kind": "start", "title": "开始", "description": "", "inputVariables": variables},
		}},
	}))
}

// encodeGraph renders a graph to the bytes the column stores, so a test reads the document the way
// the projection does: every nested object decoded to a map, never a hand-built Object.
func encodeGraph(t *testing.T, graph Object) []byte {
	t.Helper()
	raw, err := json.Marshal(graph)
	if err != nil {
		t.Fatalf("marshal graph: %v", err)
	}
	return raw
}

// decodeGraph round-trips a graph through JSON, for tests that read the document themselves.
func decodeGraph(t *testing.T, graph Object) Object {
	t.Helper()
	decoded := Object{}
	if err := json.Unmarshal(encodeGraph(t, graph), &decoded); err != nil {
		t.Fatalf("unmarshal graph: %v", err)
	}
	return decoded
}

// fieldOf returns the projected field with `key`, or fails naming the keys that were projected.
func fieldOf(t *testing.T, d FormDescriptor, key string) FormField {
	t.Helper()
	for _, f := range d.Fields {
		if f.Key == key {
			return f
		}
	}
	keys := make([]string, 0, len(d.Fields))
	for _, f := range d.Fields {
		keys = append(keys, f.Key)
	}
	t.Fatalf("field %q was not projected (got %v)", key, keys)
	return FormField{}
}

// oneVariable projects a single variable and returns the control it produced.
func oneVariable(t *testing.T, declared Object) FormField {
	t.Helper()
	return fieldOf(t, descriptorFor(t, []any{declared}), "field")
}

// TestFormDescriptorProjectionCopiesWorkflowIdentity covers what the descriptor says about the
// workflow itself: the ref it was asked for, and the workflow's own name and description.
func TestFormDescriptorProjectionCopiesWorkflowIdentity(t *testing.T) {
	d := descriptorFor(t, nil)

	if d.FormRef != reviewRef || d.Title != "Review flow" || d.Description != "Reviews a change" {
		t.Fatalf("descriptor identity wrong: %+v", d)
	}
	if len(d.Fields) != 0 {
		t.Fatalf("a workflow with no Start variables publishes an empty form: %+v", d.Fields)
	}
}

// TestFormDescriptorProjectionMapsControls covers the control each declared Start variable renders as,
// including the controls Issues has no counterpart for and the legacy declarations that predate
// explicit form-control metadata.
func TestFormDescriptorProjectionMapsControls(t *testing.T) {
	cases := []struct {
		name      string
		fieldType string
		valueType string
		want      string
	}{
		{"text input", "text-input", "string", fieldText},
		{"paragraph", "paragraph", "string", fieldTextarea},
		{"number", "number", "number", fieldNumber},
		{"checkbox", "checkbox", "boolean", fieldBoolean},
		{"file degrades to a single line", "file", "file", fieldText},
		{"file list degrades to a textarea", "file-list", "array[file]", fieldTextarea},
		{"json degrades to a textarea", "json", "object", fieldTextarea},
		{"legacy number", "", "number", fieldNumber},
		{"legacy integer", "", "integer", fieldNumber},
		{"legacy boolean", "", "boolean", fieldBoolean},
		{"legacy file", "", "file", fieldText},
		{"legacy file list", "", "array[file]", fieldTextarea},
		{"legacy secret", "", "secret", fieldText},
		{"legacy object", "", "object", fieldTextarea},
		{"nothing declared at all", "", "", fieldText},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			declared := Object{"name": "field", "valueType": c.valueType}
			if c.fieldType != "" {
				declared["fieldType"] = c.fieldType
			}
			if got := oneVariable(t, declared).Type; got != c.want {
				t.Fatalf("control = %s, want %s", got, c.want)
			}
		})
	}
}

// TestFormDescriptorProjectionSelectOptions covers the one control that carries choices, and the
// degradation that keeps a select with nothing to choose from from failing validation closed.
func TestFormDescriptorProjectionSelectOptions(t *testing.T) {
	selectVar := Object{
		"name": "field", "valueType": "string", "fieldType": "select",
		"options": []any{"low", "high"},
	}
	field := oneVariable(t, selectVar)

	if field.Type != fieldSelect {
		t.Fatalf("control = %s, want %s", field.Type, fieldSelect)
	}
	if len(field.Options) != 2 || field.Options[0].Value != "low" || field.Options[0].Label != "low" {
		t.Fatalf("options wrong: %+v", field.Options)
	}
	// The projected descriptor is one Issues will render, so it must pass the same validation a
	// provider's output does.
	validateFormDescriptor(FormDescriptor{FormRef: reviewRef, Fields: []FormField{field}})

	// A select with no usable choice is a text field, not an invalid form.
	for _, declared := range []any{nil, []any{}, []any{"", 7}, []any{7, true}} {
		empty := Object{"name": "field", "valueType": "string", "fieldType": "select", "options": declared}
		if got := oneVariable(t, empty).Type; got != fieldText {
			t.Fatalf("an unusable select projected as %s, want %s", got, fieldText)
		}
	}

	// A repeated choice is one choice: a select with a single option is a valid form.
	deduped := oneVariable(t, Object{
		"name": "field", "valueType": "string", "fieldType": "select", "options": []any{"dup", "dup"},
	})
	if deduped.Type != fieldSelect || len(deduped.Options) != 1 {
		t.Fatalf("duplicate options were not collapsed: %+v", deduped)
	}
}

// TestFormDescriptorProjectionDropsUnrepresentableVariables covers the variables that cannot become a
// field: dropping one costs that field, while a malformed field would fail validation and cost the
// whole form.
func TestFormDescriptorProjectionDropsUnrepresentableVariables(t *testing.T) {
	long := strings.Repeat("x", 201)
	bad := []Object{
		{"name": "", "valueType": "string"},
		{"name": "has space", "valueType": "string"},
		{"name": "中文名", "valueType": "string"},
		{"name": "bad/slash", "valueType": "string"},
		{"name": strings.Repeat("n", 201), "valueType": "string"},
		{"name": "ok", "displayName": long, "valueType": "string"},
	}
	d := descriptorFor(t, []any{bad[0], bad[1], bad[2], bad[3], bad[4], bad[5]})
	if len(d.Fields) != 0 {
		t.Fatalf("unrepresentable variables leaked into the form: %+v", d.Fields)
	}

	// A good variable beside a bad one survives; the key is the name, never a sanitized variant.
	d = descriptorFor(t, []any{bad[1], Object{"name": "repository", "valueType": "string"}})
	if len(d.Fields) != 1 || d.Fields[0].Key != "repository" {
		t.Fatalf("a good variable was dropped with the bad ones: %+v", d.Fields)
	}
}

// TestFormDescriptorProjectionLabels covers the label and required flag: the display name is the
// label, the name is the fallback, and `required` is a boolean the variable may simply omit.
func TestFormDescriptorProjectionLabels(t *testing.T) {
	named := oneVariable(t, Object{"name": "field", "displayName": "Review scope", "valueType": "string", "required": true})
	if named.Label != "Review scope" || !named.Required {
		t.Fatalf("label/required wrong: %+v", named)
	}
	plain := oneVariable(t, Object{"name": "field", "valueType": "string"})
	if plain.Label != "field" || plain.Required {
		t.Fatalf("label/required wrong: %+v", plain)
	}
}

// TestFormDescriptorProjectionDefaults covers the declared default: it survives only when the value is
// legal for the control the variable became, so a stale default cannot make the descriptor invalid.
func TestFormDescriptorProjectionDefaults(t *testing.T) {
	cases := []struct {
		name      string
		declared  Object
		wantValue any
	}{
		{"text", Object{"name": "field", "valueType": "string", "value": "main"}, "main"},
		// Numbers arrive from the column as JSON numbers, so the projection sees a float64.
		{"number", Object{"name": "field", "valueType": "number", "value": 10}, float64(10)},
		{"boolean false", Object{"name": "field", "valueType": "boolean", "value": false}, false},
		{
			"select value inside the options",
			Object{"name": "field", "valueType": "string", "fieldType": "select", "options": []any{"low"}, "value": "low"},
			"low",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := oneVariable(t, c.declared).DefaultValue; got != c.wantValue {
				t.Fatalf("default = %v, want %v", got, c.wantValue)
			}
		})
	}

	rejected := []struct {
		name     string
		declared Object
	}{
		{"select value outside the options", Object{"name": "field", "valueType": "string", "fieldType": "select", "options": []any{"low"}, "value": "high"}},
		{"number given a string", Object{"name": "field", "valueType": "number", "value": "ten"}},
		{"boolean given a string", Object{"name": "field", "valueType": "boolean", "value": "yes"}},
		{"text longer than a form value", Object{"name": "field", "valueType": "string", "value": strings.Repeat("x", maxFieldValueLength+1)}},
	}
	for _, c := range rejected {
		t.Run(c.name, func(t *testing.T) {
			if got := oneVariable(t, c.declared).DefaultValue; got != nil {
				t.Fatalf("an illegal default survived: %v", got)
			}
		})
	}
}

// TestFormDescriptorProjectionBounds covers the caps that keep a pathological graph from producing a
// descriptor Issues refuses: the field count, and the workflow's own name and description, which are
// free text with no length rule of their own.
func TestFormDescriptorProjectionBounds(t *testing.T) {
	declared := []any{}
	for i := range maxFormFields + 5 {
		declared = append(declared, Object{"name": "field" + itoa(i), "valueType": "string"})
	}
	d := descriptorFor(t, declared)
	if len(d.Fields) != maxFormFields {
		t.Fatalf("field count = %d, want %d", len(d.Fields), maxFormFields)
	}
	validateFormDescriptor(d)

	// A select cannot declare more choices than a descriptor may carry either.
	options := []any{}
	for i := range maxFormOptions + 5 {
		options = append(options, "option-"+itoa(i))
	}
	wide := oneVariable(t, Object{"name": "field", "valueType": "string", "fieldType": "select", "options": options})
	if len(wide.Options) != maxFormOptions {
		t.Fatalf("option count = %d, want %d", len(wide.Options), maxFormOptions)
	}

	raw := encodeGraph(t, Object{"nodes": []any{Object{
		"id":   "start-1",
		"data": Object{"kind": "start", "inputVariables": []any{Object{"name": "field", "valueType": "string"}}},
	}}})
	// The name column is capped at 200 by the schema; the description is not capped anywhere.
	long := formDescriptorFromGraph(reviewRef, strings.Repeat("好", 100), strings.Repeat("好", 1000), raw)
	if len(long.Title) > 200 || len(long.Description) > 2000 {
		t.Fatalf("descriptor identity was not clipped: title=%d description=%d", len(long.Title), len(long.Description))
	}
	if !utf8.ValidString(long.Title) || !utf8.ValidString(long.Description) {
		t.Fatalf("clipping split a UTF-8 sequence: %+v", long)
	}
}

// TestWorkflowStartVariablesReadsTheDocument covers the defensive read of a document the API never
// interprets: anything unexpected contributes no variables rather than failing the request.
func TestWorkflowStartVariablesReadsTheDocument(t *testing.T) {
	start := func(variables any) Object {
		return Object{"nodes": []any{
			Object{"id": "agent-1", "data": Object{"kind": "agent"}},
			Object{"id": "start-1", "data": Object{"kind": "start", "inputVariables": variables}},
			Object{"id": "start-2", "data": Object{"kind": "start", "inputVariables": []any{Object{"name": "second"}}}},
		}}
	}

	// The first Start node wins, matching the editor, which allows at most one.
	got := workflowStartVariables(decodeGraph(t, start([]any{Object{"name": "first"}})))
	if len(got) != 1 || got[0].S("name") != "first" {
		t.Fatalf("variables wrong: %+v", got)
	}
	none := decodeGraph(t, Object{"nodes": []any{Object{"id": "agent-1", "data": Object{"kind": "agent"}}}})
	if len(workflowStartVariables(none)) != 0 {
		t.Fatal("a graph with no Start node has no variables")
	}

	// Every shape a hand-edited or older document can take.
	malformed := []Object{
		{},
		{"nodes": "not a list"},
		{"nodes": []any{"not an object"}},
		{"nodes": []any{Object{"data": "not an object"}}},
		{"nodes": []any{Object{"data": Object{"kind": "start", "inputVariables": "not a list"}}}},
		{"nodes": []any{Object{"data": Object{"kind": "start", "inputVariables": []any{"not an object", 7}}}}},
	}
	for _, graph := range malformed {
		if got := workflowStartVariables(decodeGraph(t, graph)); len(got) != 0 {
			t.Fatalf("malformed graph %v produced variables: %+v", graph, got)
		}
	}

	// An unreadable column value is an empty form, not a failed request.
	if d := formDescriptorFromGraph(reviewRef, "Review flow", "", []byte("not json")); len(d.Fields) != 0 {
		t.Fatalf("an unreadable graph produced fields: %+v", d.Fields)
	}
}

// TestClipShortensWithoutSplittingRunes covers the truncation the descriptor's own limits rely on.
func TestClipShortensWithoutSplittingRunes(t *testing.T) {
	if got := clip("short", 200); got != "short" {
		t.Fatalf("clip shortened a short string: %q", got)
	}
	wide := strings.Repeat("好", 100)
	got := clip(wide, 200)
	if len(got) != 198 || !utf8.ValidString(got) || !strings.HasPrefix(wide, got) {
		t.Fatalf("clip(%d bytes of 好, 200) = %d bytes, valid=%v", len(wide), len(got), utf8.ValidString(got))
	}
	if got := clip("abc", 0); got != "" {
		t.Fatalf("clip to nothing = %q", got)
	}
}

// TestWorkflowTargetIsFormMode covers the frozen projection the @ picker reads: Form Mode, no task,
// and the workflow id as the opaque formRef.
func TestWorkflowTargetIsFormMode(t *testing.T) {
	target := workflowTarget(reviewRef, "Review flow", "Reviews a change")

	if target.Type != "workflow" || target.ID != reviewRef || target.DisplayName != "Review flow" {
		t.Fatalf("target identity wrong: %+v", target)
	}
	mode, requiresTask := modeForType("workflow")
	if target.InteractionDescriptor.Mode != mode || target.InteractionDescriptor.RequiresTask != requiresTask {
		t.Fatalf("target disagrees with the frozen default: %+v", target.InteractionDescriptor)
	}
	if target.InteractionDescriptor.FormRef != reviewRef || !validOpaqueToken(target.InteractionDescriptor.FormRef) {
		t.Fatalf("formRef is not a usable opaque token: %q", target.InteractionDescriptor.FormRef)
	}
}
