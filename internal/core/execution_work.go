package core

import (
	"context"
	"time"
)

// EnqueueExecutionWork releases one Agent session or Revision delivery for Controllers to claim.
// Repeating the same unregistered input returns the original item. A different input conflicts.
func (s *Store) EnqueueExecutionWork(ctx context.Context, runID, kind string, input, target Object, availableAt time.Time) (Object, error) {
	return s.transact(ctx, func(t *transaction) Object {
		return enqueueExecutionWork(t, runID, kind, input, target, availableAt)
	})
}

func enqueueExecutionWork(t *transaction, runID, kind string, input, target Object, availableAt time.Time) Object {
	require(validID(runID), 400, "invalid_dispatch")
	require(t.one("SELECT id FROM issue_runs WHERE id=$1 AND deleted_at IS NULL", runID) != nil, 404, "not_found")
	require(kind == "agent_session" || kind == "deliver_revision", 400, "invalid_dispatch")
	require(input.S("kind") == kind, 400, "invalid_dispatch")
	require(target.S("workspaceId") != "" && target.S("sandboxInstanceId") != "" && target.S("nodeId") != "", 400, "invalid_dispatch")
	if existing := t.one("SELECT * FROM execution_work WHERE run_id=$1 AND execution_id IS NULL", runID); existing != nil {
		require(existing.S("kind") == kind && jsonText(existing.O("input")) == jsonText(input) && jsonText(existing.O("target")) == jsonText(target), 409, "dispatch_conflict")
		return existing
	}
	id := newID()
	if availableAt.IsZero() {
		t.exec("INSERT INTO execution_work(id,run_id,kind,input,target) VALUES($1,$2,$3,$4,$5)", id, runID, kind, jsonText(input), jsonText(target))
	} else {
		t.exec("INSERT INTO execution_work(id,run_id,kind,input,target,available_at) VALUES($1,$2,$3,$4,$5,$6)", id, runID, kind, jsonText(input), jsonText(target), availableAt)
	}
	t.workSignals = append(t.workSignals, runID)
	return t.one("SELECT * FROM execution_work WHERE id=$1", id)
}

// claimWorkItem is the pure read behind ClaimWork: the older of a queued tenant clone and an
// unregistered session or delivery. Ownership moves only when the dispatch is recorded.
func claimWorkItem(t *transaction) Object {
	var request Object
	if t.legacyCloneFixture {
		request = t.one("SELECT * FROM clone_requests WHERE state='queued' ORDER BY created_at,id LIMIT 1")
	} else if t.one("SELECT id FROM clone_requests WHERE state='queued'") != nil {
		reject(410, "runtime_scope_required")
	}
	work := t.one("SELECT * FROM execution_work WHERE execution_id IS NULL AND available_at<=clock_timestamp() ORDER BY created_at,id LIMIT 1")
	if work != nil && (request == nil || work.S("createdAt") < request.S("createdAt")) {
		return Object{"work": work}
	}
	return Object{"request": request}
}
