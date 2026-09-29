package integration

import (
	"context"
	"strings"
	"testing"

	"github.com/wanglongan587/cloud/internal/core"
)

func TestMemberDepartureFreezesPersonalCredentialsAndRejoinDoesNot(t *testing.T) {
	f := setup(t)
	bob, bobID := f.addUser(t, "bob", "Bob")
	personal := classifiedCredential(t, f, bobID, "infra/git/personal", "personal", "bob-authorization")
	unknown := classifiedCredential(t, f, bobID, "infra/git/unknown", "unknown", "")
	team := classifiedCredential(t, f, bobID, "infra/git/team", "team", "deployment-ticket")

	// The simulator can finish a create that has no credential. Bind the
	// reference afterwards so the freeze checks see a live project without
	// asking the fixture to clone through that reference.
	personalProject := callUser(t, f, bob, "POST", f.path("/projects"), core.Object{"name": "Personal", "repositoryUrl": "https://example.invalid/repo.git", "defaultBranch": "main"}, "bob-personal")
	f.drain()
	personalID := personalProject.O("resource").S("id")
	personalWorkspace := personalProject.O("workspace").S("id")
	if _, err := f.store.Pool.Exec("UPDATE projects SET credential_ref_id=$1 WHERE id=$2 AND owner_user_id=$3", personal, personalID, bobID); err != nil {
		t.Fatal(err)
	}
	var ownerBefore, creatorBefore string
	must(t, f.store.Pool.QueryRow("SELECT owner_user_id::text FROM projects WHERE id=$1", personalID).Scan(&ownerBefore))
	must(t, f.store.Pool.QueryRow("SELECT creator_user_id::text FROM workspaces WHERE id=$1", personalWorkspace).Scan(&creatorBefore))

	f.call("PUT", f.path("/members/"+bobID), core.Object{"role": "member", "status": "disabled", "version": 1}, "", 200)
	assertCredentialAvailability(t, f, personal, "frozen")
	assertCredentialAvailability(t, f, unknown, "frozen")
	assertCredentialAvailability(t, f, team, "available")
	if f.scalar("SELECT count(*) FROM projects WHERE id=$1 AND deleted_at IS NULL", personalID) != 1 {
		t.Fatal("freezing a credential deleted the project")
	}

	refused := f.call("POST", f.path("/projects/"+personalID+"/workspaces"), core.Object{"title": "again", "baseRef": "main"}, "alice-personal-workspace", 409)
	if refused.S("code") != "credential_unavailable" || strings.Contains(refused.S("code"), "infra/git") {
		t.Fatalf("frozen personal workspace: %v", refused)
	}
	if f.scalar("SELECT count(*) FROM workspaces WHERE project_id=$1 AND deleted_at IS NULL", personalID) != 1 {
		t.Fatal("refused workspace create still wrote a runtime")
	}
	session := f.hold(personalWorkspace, "hold-personal")
	current := f.ws(personalWorkspace)
	f.call("POST", f.path("/workspaces/"+personalWorkspace+"/stop"), core.Object{"version": current.N("version"), "sessionId": session}, "stop-personal", 202)
	f.drain()
	f.call("POST", f.path("/workspaces/"+personalWorkspace+"/start"), core.Object{"version": f.ws(personalWorkspace).N("version"), "sessionId": session}, "start-personal", 202)
	f.drain()
	if f.ws(personalWorkspace).S("observedState") != "ready" {
		t.Fatalf("restart without clone was blocked: %v", f.ws(personalWorkspace))
	}

	token := joinToken('q')
	f.call("POST", f.path("/invitations"), core.Object{"token": token}, "invite-bob", 201)
	joinCall(t, f, bob, "POST", "/api/v1/join/invitations/redeem", "rejoin-bob", core.Object{"token": token}, 200)
	assertCredentialAvailability(t, f, personal, "frozen")
	rejoiner, rejoinStatus := callUserStatus(t, f, bob, "POST", f.path("/projects"), core.Object{"name": "After", "repositoryUrl": "https://example.invalid/repo.git", "defaultBranch": "main", "credentialRefId": personal}, "bob-after")
	if rejoinStatus != 409 || rejoiner.S("code") != "credential_unavailable" {
		t.Fatalf("rejoin unfroze the personal reference: %d %v", rejoinStatus, rejoiner)
	}
	teamCreate, teamStatus := callUserStatus(t, f, bob, "POST", f.path("/projects"), core.Object{"name": "Team", "repositoryUrl": "https://example.invalid/repo.git", "defaultBranch": "main", "credentialRefId": team}, "bob-team")
	if teamStatus != 202 || teamCreate.O("resource").S("id") == "" {
		t.Fatalf("team reference was frozen with its owner: %d %v", teamStatus, teamCreate)
	}
	var ownerAfter, creatorAfter string
	must(t, f.store.Pool.QueryRow("SELECT owner_user_id::text FROM projects WHERE id=$1", personalID).Scan(&ownerAfter))
	must(t, f.store.Pool.QueryRow("SELECT creator_user_id::text FROM workspaces WHERE id=$1", personalWorkspace).Scan(&creatorAfter))
	if ownerAfter != ownerBefore || creatorAfter != creatorBefore {
		t.Fatalf("freeze rewrote owner %s or creator %s", ownerAfter, creatorAfter)
	}
}

func TestInFlightCloneRechecksFrozenCredential(t *testing.T) {
	f := setup(t)
	bob, bobID := f.addUser(t, "bob", "Bob")
	personal := classifiedCredential(t, f, bobID, "infra/git/inflight", "personal", "bob-authorization")
	callUser(t, f, bob, "POST", f.path("/projects"), core.Object{"name": "In flight", "repositoryUrl": "https://example.invalid/repo.git", "defaultBranch": "main", "credentialRefId": personal}, "bob-inflight")
	f.call("PUT", f.path("/members/"+bobID), core.Object{"role": "member", "status": "disabled", "version": 1}, "", 200)
	err := f.controller.Drain(context.Background())
	if err == nil || !strings.Contains(err.Error(), "credential_unavailable") || strings.Contains(err.Error(), "infra/git") {
		t.Fatalf("late clone dispatch: %v", err)
	}
	var lifecycle, state string
	must(t, f.store.Pool.QueryRow("SELECT lifecycle FROM projects WHERE name='In flight'").Scan(&lifecycle))
	must(t, f.store.Pool.QueryRow("SELECT state FROM operations WHERE kind='create_project' ORDER BY created_at DESC LIMIT 1").Scan(&state))
	if lifecycle == "deleted" || state == "succeeded" {
		t.Fatalf("frozen clone deleted the project or reported success: %s %s", lifecycle, state)
	}
}

func TestCredentialVerificationDoesNotSwitchUntilTheResultMatches(t *testing.T) {
	f := setup(t)
	bob, bobID := f.addUser(t, "bob", "Bob")
	personal := classifiedCredential(t, f, bobID, "infra/git/bound", "personal", "bob-authorization")
	team := classifiedCredential(t, f, bobID, "infra/git/candidate", "team", "deployment-ticket")
	created := callUser(t, f, bob, "POST", f.path("/projects"), core.Object{"name": "Bound", "repositoryUrl": "https://example.invalid/repo.git", "defaultBranch": "main"}, "bob-bound")
	f.drain()
	pid := created.O("resource").S("id")
	if _, err := f.store.Pool.Exec("UPDATE projects SET credential_ref_id=$1 WHERE id=$2 AND owner_user_id=$3", personal, pid, bobID); err != nil {
		t.Fatal(err)
	}
	var owner, creator string
	must(t, f.store.Pool.QueryRow("SELECT p.owner_user_id::text, w.creator_user_id::text FROM projects p JOIN workspaces w ON w.project_id=p.id WHERE p.id=$1", pid).Scan(&owner, &creator))

	denied, status := callUserStatus(t, f, bob, "POST", f.path("/projects/"+pid+"/credential-verifications"), core.Object{"credentialRefId": team, "capability": "write", "version": projectVersion(t, f, pid)}, "bob-verify")
	if status != 403 || denied.S("code") != "admin_required" || f.scalar("SELECT count(*) FROM credential_verification_intents") != 0 {
		t.Fatalf("member verification: %d %v", status, denied)
	}
	secret := f.call("POST", f.path("/projects/"+pid+"/credential-verifications"), core.Object{"credentialRefId": team, "capability": "write", "version": projectVersion(t, f, pid), "password": "nope"}, "secret-verify", 400)
	if secret.S("code") != "unknown_field" {
		t.Fatalf("secret field: %v", secret)
	}
	personalIntent := f.call("POST", f.path("/projects/"+pid+"/credential-verifications"), core.Object{"credentialRefId": personal, "capability": "write", "version": projectVersion(t, f, pid)}, "personal-verify", 409)
	if personalIntent.S("code") != "credential_not_controlled" || f.scalar("SELECT count(*) FROM credential_verification_intents") != 0 {
		t.Fatalf("personal candidate: %v", personalIntent)
	}

	first := f.call("POST", f.path("/projects/"+pid+"/credential-verifications"), core.Object{"credentialRefId": team, "capability": "write", "version": projectVersion(t, f, pid)}, "verify-1", 200)
	if first.O("resource").S("state") != "pending" || projectCredential(t, f, pid) != personal {
		t.Fatalf("intent switched early: %v credential %s", first, projectCredential(t, f, pid))
	}
	replay := f.call("POST", f.path("/projects/"+pid+"/credential-verifications"), core.Object{"credentialRefId": team, "capability": "write", "version": projectVersion(t, f, pid)}, "verify-1", 200)
	if replay.O("resource").S("id") != first.O("resource").S("id") {
		t.Fatalf("replay created another intent: %v", replay)
	}
	readOnly, err := f.store.RecordCredentialVerification(context.Background(), first.O("resource").S("id"), "succeeded", "read")
	must(t, err)
	if readOnly.O("resource").S("state") != "failed" || projectCredential(t, f, pid) != personal {
		t.Fatalf("read result granted push: %v", readOnly)
	}

	second := f.call("POST", f.path("/projects/"+pid+"/credential-verifications"), core.Object{"credentialRefId": team, "capability": "write", "version": projectVersion(t, f, pid)}, "verify-2", 200)
	f.call("PATCH", f.path("/projects/"+pid), core.Object{"name": "Renamed", "version": projectVersion(t, f, pid)}, "", 200)
	late, err := f.store.RecordCredentialVerification(context.Background(), second.O("resource").S("id"), "succeeded", "write")
	must(t, err)
	if late.O("resource").S("state") != "failed" || projectCredential(t, f, pid) != personal {
		t.Fatalf("late result switched the binding: %v", late)
	}

	third := f.call("POST", f.path("/projects/"+pid+"/credential-verifications"), core.Object{"credentialRefId": team, "capability": "write", "version": projectVersion(t, f, pid)}, "verify-3", 200)
	before := projectVersion(t, f, pid)
	switched, err := f.store.RecordCredentialVerification(context.Background(), third.O("resource").S("id"), "succeeded", "write")
	must(t, err)
	again, err := f.store.RecordCredentialVerification(context.Background(), third.O("resource").S("id"), "succeeded", "write")
	must(t, err)
	var ownerAfter, creatorAfter string
	must(t, f.store.Pool.QueryRow("SELECT p.owner_user_id::text, w.creator_user_id::text FROM projects p JOIN workspaces w ON w.project_id=p.id AND w.kind='main' WHERE p.id=$1", pid).Scan(&ownerAfter, &creatorAfter))
	if switched.O("resource").S("state") != "succeeded" || again.O("resource").S("id") != third.O("resource").S("id") || projectCredential(t, f, pid) != team || projectVersion(t, f, pid) != before+1 || ownerAfter != owner || creatorAfter != creator {
		t.Fatalf("switch = %v again %v credential %s version %d owner %s creator %s", switched, again, projectCredential(t, f, pid), projectVersion(t, f, pid), ownerAfter, creatorAfter)
	}
}

func classifiedCredential(t *testing.T, f *fixture, owner, ref, scope, basis string) string {
	t.Helper()
	var out core.Object
	var err error
	if scope == "unknown" {
		out, err = f.store.ConfigureCredential(context.Background(), f.tid, owner, ref)
	} else {
		out, err = f.store.ConfigureClassifiedCredential(context.Background(), f.tid, owner, ref, scope, basis)
	}
	must(t, err)
	if out.S("scopeKind") != scope || out.S("id") == "" {
		t.Fatalf("credential class: %v", out)
	}
	return out.S("id")
}

func assertCredentialAvailability(t *testing.T, f *fixture, id, want string) {
	t.Helper()
	var availability, reason string
	var frozen bool
	must(t, f.store.Pool.QueryRow("SELECT availability, coalesce(freeze_reason,''), frozen_at IS NOT NULL FROM credential_refs WHERE id=$1", id).Scan(&availability, &reason, &frozen))
	if availability != want || (want == "frozen" && (reason != "member_disabled" || !frozen)) || (want == "available" && frozen) {
		t.Fatalf("credential %s availability %s reason %s frozen %v", id, availability, reason, frozen)
	}
}

func projectVersion(t *testing.T, f *fixture, pid string) int64 {
	t.Helper()
	var version int64
	must(t, f.store.Pool.QueryRow("SELECT version FROM projects WHERE id=$1", pid).Scan(&version))
	return version
}

func projectCredential(t *testing.T, f *fixture, pid string) string {
	t.Helper()
	var id string
	must(t, f.store.Pool.QueryRow("SELECT credential_ref_id::text FROM projects WHERE id=$1", pid).Scan(&id))
	return id
}
