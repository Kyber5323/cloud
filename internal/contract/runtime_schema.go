package contract

// addRuntimeCreator publishes the creator columns added by migration 0018.
// Public reads may omit code identity, so those properties are not required.
// Controller snapshots always select the row, including a null creator.
func addRuntimeCreator(s obj, name string, public bool) {
	p := properties(s, name)
	p["creatorUserId"] = optional(uuid())
	p["creatorResolution"] = enumeration("known", "unknown")
	p["creatorResolutionReason"] = optional(enumeration("missing", "conflict", "unprovable"))
	p["creatorSource"] = optional(enumeration("create_project_operation", "create_workspace_operation"))
	p["creatorSourceOperationId"] = optional(uuid())
	schema := asObject(s[name])
	required := append([]string{}, schema["required"].([]string)...)
	required = append(required, "creatorUserId", "creatorResolution", "creatorResolutionReason")
	if public {
		p["contentAllowed"] = boolean()
		// Embedded operation snapshots reuse Workspace and predate this flag.
		if name == "WorkspaceListItem" {
			required = append(required, "contentAllowed")
		}
		schema["required"] = required
		dropRequired(schema, "requestedRef", "baseCommitId", "branchName")
		return
	}
	required = append(required, "creatorSource", "creatorSourceOperationId")
	schema["required"] = required
}

func dropRequired(schema obj, names ...string) {
	skip := map[string]bool{}
	for _, name := range names {
		skip[name] = true
	}
	raw := schema["required"].([]string)
	next := make([]string, 0, len(raw))
	for _, name := range raw {
		if !skip[name] {
			next = append(next, name)
		}
	}
	schema["required"] = next
}
