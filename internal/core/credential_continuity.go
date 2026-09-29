package core

import (
	"context"
	"strings"
)

// freezeMemberCredentials stops new remote use of the personal and unknown
// references tied to a member who is leaving. Team references stay available:
// the owner foreign key is not evidence that the credential is personal.
// Restoring membership does not clear the freeze.
func freezeMemberCredentials(t *transaction, tid, uid string) {
	t.exec(`UPDATE credential_refs
		SET availability='frozen', frozen_at=clock_timestamp(), freeze_reason='member_disabled', version=version+1
		WHERE tenant_id=$1 AND owner_user_id=$2 AND deleted_at IS NULL
		  AND scope_kind IN ('personal','unknown') AND availability='available'`, tid, uid)
}

func projectCredentialFrozen(t *transaction, projectID string) bool {
	row := t.one(`SELECT c.availability FROM projects p
		JOIN credential_refs c ON c.id=p.credential_ref_id
		WHERE p.id=$1 AND c.deleted_at IS NULL`, projectID)
	return row != nil && row.S("availability") == "frozen"
}

// submitCredentialVerification stores an administrator's candidate. Cloud
// does not receive a secret and does not contact the Git remote. The project
// binding stays on its current reference until a matching result is applied.
func submitCredentialVerification(t *transaction, r *PublicRequest, uid, hash string) Object {
	membership(t, r.TenantID, uid, true)
	p := project(t, r.TenantID, uid, r.ProjectID)
	require(p.S("lifecycle") != "deleted", 409, "resource_unavailable")
	version(p, r.Body.N("version"))
	capability := r.Body.S("capability")
	require(capability == "read" || capability == "write", 400, "invalid_input")
	refID := r.Body.S("credentialRefId")
	require(validID(refID), 400, "invalid_credential_ref")
	ref := t.one(`SELECT id, version, scope_kind, availability FROM credential_refs
		WHERE id=$1 AND tenant_id=$2 AND purpose='git' AND deleted_at IS NULL`, refID, r.TenantID)
	require(ref != nil, 404, "credential_ref_not_found")
	require(ref.S("scopeKind") == "team", 409, "credential_not_controlled")
	require(ref.S("availability") == "available", 409, "credential_unavailable")
	id := newID()
	t.exec(`INSERT INTO credential_verification_intents(
		id,tenant_id,project_id,initiator_user_id,candidate_ref_id,repository_url,capability,
		idempotency_key,request_hash,project_version,candidate_version,state)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')`,
		id, r.TenantID, p.S("id"), uid, refID, p.S("repositoryUrl"), capability, r.Key, hash, p.N("version"), ref.N("version"))
	return Object{"resource": presentCredentialVerification(t.one("SELECT * FROM credential_verification_intents WHERE id=$1", id))}
}

func presentCredentialVerification(row Object) Object {
	out := Object{
		"id":               row.S("id"),
		"tenantId":         row.S("tenantId"),
		"projectId":        row.S("projectId"),
		"initiatorUserId":  row.S("initiatorUserId"),
		"candidateRefId":   row.S("candidateRefId"),
		"repositoryUrl":    row.S("repositoryUrl"),
		"capability":       row.S("capability"),
		"state":            row.S("state"),
		"projectVersion":   row.N("projectVersion"),
		"candidateVersion": row.N("candidateVersion"),
		"version":          row.N("version"),
		"createdAt":        row.S("createdAt"),
		"updatedAt":        row.S("updatedAt"),
	}
	if row.S("verifiedCapability") != "" {
		out["verifiedCapability"] = row.S("verifiedCapability")
	}
	return out
}

// RecordCredentialVerification applies one scoped result to a stored intent.
// It is not exposed on the current controller HTTP API: that credential is
// not yet a fenced execution identity, and Cloud still does not dial Git.
// A result switches the project binding only while the candidate, its
// version, and the project version are still the ones that were submitted.
func (s *Store) RecordCredentialVerification(ctx context.Context, intentID, outcome, capability string) (Object, error) {
	return s.transact(ctx, func(t *transaction) Object {
		return recordCredentialVerification(t, intentID, outcome, capability)
	})
}

func recordCredentialVerification(t *transaction, intentID, outcome, capability string) Object {
	require(validID(intentID), 404, "not_found")
	require(outcome == "succeeded" || outcome == "failed" || outcome == "unknown", 400, "invalid_input")
	if outcome == "succeeded" {
		require(capability == "read" || capability == "write", 400, "invalid_input")
	} else {
		require(capability == "", 400, "invalid_input")
	}
	t.exec("SELECT id FROM credential_verification_intents WHERE id=$1 FOR UPDATE", intentID)
	intent := t.one("SELECT * FROM credential_verification_intents WHERE id=$1", intentID)
	require(intent != nil, 404, "not_found")
	if intent.S("state") != "pending" {
		require(intent.S("state") == outcome && intent.S("verifiedCapability") == capability, 409, "verification_conflict")
		return Object{"resource": presentCredentialVerification(intent)}
	}
	t.exec("SELECT id FROM projects WHERE id=$1 FOR UPDATE", intent.S("projectId"))
	if outcome != "succeeded" || !credentialResultMatches(t, intent, capability) {
		// A succeeded report that no longer matches is a failed verification.
		// Leaving it pending would let a later change revive the stale result.
		next := outcome
		if outcome == "succeeded" {
			next = "failed"
		}
		t.exec(`UPDATE credential_verification_intents SET state=$2, verified_capability=NULL, version=version+1, updated_at=now() WHERE id=$1 AND state='pending'`, intentID, next)
		return Object{"resource": presentCredentialVerification(t.one("SELECT * FROM credential_verification_intents WHERE id=$1", intentID))}
	}
	// The owner, creator and historical actor stay on their own rows. Only
	// the live project reference moves, and only with the version captured
	// when the candidate was accepted.
	n := t.execRows("UPDATE projects SET credential_ref_id=$2, version=version+1 WHERE id=$1 AND version=$3", intent.S("projectId"), intent.S("candidateRefId"), intent.N("projectVersion"))
	require(n == 1, 409, "verification_conflict")
	t.exec(`UPDATE credential_verification_intents SET state='succeeded', verified_capability=$2, version=version+1, updated_at=now() WHERE id=$1 AND state='pending'`, intentID, capability)
	return Object{"resource": presentCredentialVerification(t.one("SELECT * FROM credential_verification_intents WHERE id=$1", intentID))}
}

func credentialResultMatches(t *transaction, intent Object, capability string) bool {
	if !capabilitySatisfies(intent.S("capability"), capability) {
		return false
	}
	project := t.one("SELECT version, lifecycle FROM projects WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL", intent.S("projectId"), intent.S("tenantId"))
	if project == nil || project.N("version") != intent.N("projectVersion") || project.S("lifecycle") == "deleted" {
		return false
	}
	ref := t.one(`SELECT version, scope_kind, availability, tenant_id FROM credential_refs WHERE id=$1 AND deleted_at IS NULL`, intent.S("candidateRefId"))
	if ref == nil || ref.S("tenantId") != intent.S("tenantId") {
		return false
	}
	return ref.N("version") == intent.N("candidateVersion") && ref.S("scopeKind") == "team" && ref.S("availability") == "available"
}

func capabilitySatisfies(requested, verified string) bool {
	if requested == "read" {
		return verified == "read" || verified == "write"
	}
	return requested == "write" && verified == "write"
}

// ConfigureClassifiedCredential records an infrastructure reference and its
// audited class. The value is a deployment reference, never a secret, and
// unknown history is not relabeled as team.
func (s *Store) ConfigureClassifiedCredential(ctx context.Context, tid, owner, ref, scope, basis string) (Object, error) {
	return s.transact(ctx, func(t *transaction) Object {
		membership(t, tid, owner, false)
		require(strings.TrimSpace(ref) != "" && len(ref) <= 1024, 400, "invalid_secret_ref")
		require(!strings.Contains(ref, "\n") && !strings.Contains(ref, "BEGIN "), 400, "invalid_secret_ref")
		var basisValue any
		switch scope {
		case "unknown":
			require(strings.TrimSpace(basis) == "", 400, "invalid_input")
		case "team", "personal":
			basisValue = validText(basis, 200)
		default:
			reject(400, "invalid_input")
		}
		id := newID()
		t.exec(`INSERT INTO credential_refs(id,tenant_id,owner_user_id,purpose,secret_ref,scope_kind,authority_basis)
			VALUES($1,$2,$3,'git',$4,$5,$6)`, id, tid, owner, ref, scope, basisValue)
		return Object{"id": id, "tenantId": tid, "ownerUserId": owner, "purpose": "git", "scopeKind": scope}
	})
}
