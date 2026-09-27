package main

import (
	"context"
	"testing"

	"go.uber.org/zap"

	"github.com/wanglongan587/cloud/internal/collab"
	"github.com/wanglongan587/cloud/internal/core"
)

// TestConfigureCollaborationDefaultOff guards the cmd/server composition gate: with the development
// flag off (the production default) every collaboration port stays nil, so the @ target discovery
// API serves only human targets and no development Agent/Team/Workflow fixture is exposed. This is
// the regression class that previously let core/integration tests pass while the real cmd/server
// entry served only users.
func TestConfigureCollaborationDefaultOff(t *testing.T) {
	store := &core.Store{}
	configureCollaboration(store, false, zap.NewNop())
	if store.Directory != nil || store.Context != nil || store.Dispatcher != nil || store.Forms != nil || store.Assist != nil {
		t.Fatalf("development fixtures must be OFF by default; got Directory=%v Context=%v Dispatcher=%v Forms=%v Assist=%v",
			store.Directory, store.Context, store.Dispatcher, store.Forms, store.Assist)
	}
}

// TestConfigureCollaborationDevelopmentOn asserts that the explicit development flag installs the
// fixture set: the four fixture collaboration ports become available, and the target discovery API
// (through the installed directory) returns agent + team — never users, which always come from real
// tenant memberships, and never workflows, which are real in every deployment.
func TestConfigureCollaborationDevelopmentOn(t *testing.T) {
	store := &core.Store{}
	configureCollaboration(store, true, zap.NewNop())
	if store.Directory == nil || store.Context == nil || store.Dispatcher == nil || store.Assist == nil {
		t.Fatalf("development fixtures must install all four fixture collaboration ports (Directory/Context/Dispatcher/Assist)")
	}
	targets, err := store.Directory.ListTargets(context.Background(), "", "")
	if err != nil {
		t.Fatalf("ListTargets: %v", err)
	}
	byType := map[string]int{}
	for _, s := range targets {
		byType[s.Type]++
	}
	if byType["agent"] != 2 || byType["team"] != 1 {
		t.Fatalf("unexpected fixture target mix (want 2 agent/1 team): %v", byType)
	}
	if byType["user"] != 0 || byType["workflow"] != 0 {
		t.Fatalf("the fixtures own agent/team only: %v", byType)
	}
	// Stable fixture IDs so demo/dev data is reproducible across restarts.
	stable := []string{collab.BackendAgentID, collab.ReviewAgentID, collab.PlatformTeamID}
	seen := map[string]bool{}
	for _, s := range targets {
		seen[s.ID] = true
	}
	for _, id := range stable {
		if !seen[id] {
			t.Fatalf("stable fixture ID missing from discovery: %s", id)
		}
	}
}
