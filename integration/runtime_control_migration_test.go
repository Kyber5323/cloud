package integration

// Migration 0018 is the runtime-control authority schema.
// A workspace creator is backfilled only from the single create operation that
// corresponds to that workspace. Owner, administrative_stop, and the credential
// owner foreign key stay as they were. Rows created after the migration stay
// unknown until a later phase records the creator; nothing here guesses one.

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestMigration0018FreshDatabaseConstrainsRuntimeControl(t *testing.T) {
	pool, _ := testSchema(t, "test_rc_fresh_")
	store := newStoreOnSchema(t, pool)
	must(t, store.Migrate(context.Background()))
	must(t, store.Migrate(context.Background()))
	must(t, store.CheckSchema(context.Background()))

	for _, table := range []string{
		"runtime_control_sessions",
		"runtime_write_activities",
		"runtime_force_stop_intents",
		"runtime_force_stop_links",
		"plugin_maintenance_waits",
	} {
		if !tableExists(t, pool, table) {
			t.Fatalf("missing table %s", table)
		}
	}
	assertAdministrativeStopUnchanged(t, pool)
	assertCredentialShape(t, pool)

	fx := seedRuntimeControlFixture(t, pool)
	assertCreator(t, pool, fx.main, creatorFact{resolution: "unknown", reason: "missing", owner: fx.owner})
	withTx(t, pool, func(tx *sql.Tx) {
		insertOperation(t, tx, uuid.NewString(), fx.tenant, fx.owner, fx.project, fx.main, "create_project")
	})
	assertCreator(t, pool, fx.main, creatorFact{resolution: "unknown", reason: "missing", owner: fx.owner})
	mustRejectExec(t, pool, `UPDATE workspaces SET creator_resolution='known', creator_user_id=$2, creator_resolution_reason=NULL WHERE id=$1`, fx.main, fx.owner)

	held := uuid.NewString()
	withTx(t, pool, func(tx *sql.Tx) {
		insertControlSession(t, tx, held, fx, fx.main, fx.owner, "user", 1, "held")
	})
	mustRejectExec(t, pool, controlSessionSQL, uuid.NewString(), fx.tenant, fx.main, fx.owner, "user", 2, "acquiring", "second acquire")
	withTx(t, pool, func(tx *sql.Tx) {
		insertControlSession(t, tx, uuid.NewString(), fx, fx.main, fx.owner, "user", 2, "closed")
	})
	mustRejectExec(t, pool, controlSessionSQL, uuid.NewString(), fx.tenant, fx.main, fx.member, "user", 3, "acquiring", "acquire while held")
	mustRejectExec(t, pool, controlSessionSQL, uuid.NewString(), fx.tenant, fx.main, fx.owner, "user", 1, "closed", "replayed epoch")
	mustRejectExec(t, pool, controlSessionSQL, uuid.NewString(), fx.tenant, fx.isolated, sql.NullString{}, "user", 1, "held", "user without holder")
	mustRejectExec(t, pool, controlSessionSQL, uuid.NewString(), fx.tenant, fx.isolated, fx.owner, "system_maintenance", 1, "held", "maintenance with user")
	maintenance := uuid.NewString()
	withTx(t, pool, func(tx *sql.Tx) {
		insertControlSession(t, tx, maintenance, fx, fx.isolated, sql.NullString{}, "system_maintenance", 1, "held")
	})

	withTx(t, pool, func(tx *sql.Tx) {
		insertWriteActivity(t, tx, uuid.NewString(), fx, fx.main, held, fx.owner, "user", "finished")
		insertWriteActivity(t, tx, uuid.NewString(), fx, fx.main, held, fx.owner, "user", "active")
		insertWriteActivity(t, tx, uuid.NewString(), fx, fx.isolated, maintenance, sql.NullString{}, "system", "active")
	})
	mustRejectExec(t, pool, writeActivitySQL, uuid.NewString(), fx.tenant, fx.main, held, fx.owner, "user", "unknown")
	mustRejectExec(t, pool, writeActivitySQL, uuid.NewString(), fx.tenant, fx.isolated, maintenance, sql.NullString{}, "system", "active")

	firstStop := uuid.NewString()
	withTx(t, pool, func(tx *sql.Tx) {
		insertForceStop(t, tx, firstStop, fx, fx.main, "controller lost", "force-1")
	})
	mustRejectExec(t, pool, forceStopSQL, uuid.NewString(), fx.tenant, fx.main, fx.owner, "   ", "force-blank", "requested")
	mustRejectExec(t, pool, forceStopSQL, uuid.NewString(), fx.tenant, fx.main, fx.owner, "still running", "force-2", "requested")
	mustRejectExec(t, pool, forceStopSQL, uuid.NewString(), fx.tenant, fx.isolated, fx.owner, "other runtime", "force-1", "requested")
	withTx(t, pool, func(tx *sql.Tx) {
		_, err := tx.Exec(`UPDATE runtime_force_stop_intents SET state='stopped', updated_at=now() WHERE id=$1`, firstStop)
		must(t, err)
		insertForceStop(t, tx, uuid.NewString(), fx, fx.main, "again", "force-3")
		_, err = tx.Exec(`INSERT INTO runtime_force_stop_links(intent_id,target_kind,target_id) VALUES($1,'operation',$2)`, firstStop, uuid.NewString())
		must(t, err)
	})
	mustRejectExec(t, pool, `INSERT INTO runtime_force_stop_links(intent_id,target_kind,target_id) VALUES($1,'sandbox',$2)`, firstStop, uuid.NewString())

	withTx(t, pool, func(tx *sql.Tx) {
		insertPluginWait(t, tx, uuid.NewString(), fx, fx.main, "pending", "wait-1")
	})
	mustRejectExec(t, pool, pluginWaitSQL, uuid.NewString(), fx.tenant, fx.space, fx.project, fx.main, "executing", fx.owner, "wait-2")
	withTx(t, pool, func(tx *sql.Tx) {
		_, err := tx.Exec(`UPDATE plugin_maintenance_waits SET state='succeeded', updated_at=now() WHERE workspace_id=$1`, fx.main)
		must(t, err)
		insertPluginWait(t, tx, uuid.NewString(), fx, fx.main, "pending", "wait-3")
	})

	withTx(t, pool, func(tx *sql.Tx) {
		insertOperation(t, tx, uuid.NewString(), fx.tenant, fx.owner, fx.project, fx.main, "administrative_stop")
	})
	mustRejectExec(t, pool, `INSERT INTO operations(id,tenant_id,actor_user_id,project_id,workspace_id,kind,state,step,request,idempotency_key,request_hash)
		VALUES($1,$2,$3,$4,$5,'force_stop','succeeded','done','{}',$6,'hash')`,
		uuid.NewString(), fx.tenant, fx.owner, fx.project, fx.main, "force-kind-"+uuid.NewString())

	cred := uuid.NewString()
	withTx(t, pool, func(tx *sql.Tx) {
		_, err := tx.Exec(`INSERT INTO credential_refs(id,tenant_id,owner_user_id,purpose,secret_ref) VALUES($1,$2,$3,'git',$4)`,
			cred, fx.tenant, fx.owner, "infra/git/historical")
		must(t, err)
	})
	var scope, availability, secret, owner string
	var basis sql.NullString
	var frozen sql.NullTime
	must(t, pool.QueryRow(`SELECT scope_kind, availability, authority_basis, frozen_at, secret_ref, owner_user_id::text FROM credential_refs WHERE id=$1`, cred).
		Scan(&scope, &availability, &basis, &frozen, &secret, &owner))
	if scope != "unknown" || availability != "available" || basis.Valid || frozen.Valid || secret != "infra/git/historical" || owner != fx.owner {
		t.Fatalf("new credential shape = %s %s basis=%v frozen=%v secret=%s owner=%s", scope, availability, basis, frozen, secret, owner)
	}
	mustRejectExec(t, pool, `UPDATE credential_refs SET scope_kind='team' WHERE id=$1`, cred)
	mustRejectExec(t, pool, `UPDATE credential_refs SET authority_basis='ticket-9' WHERE id=$1`, cred)
	mustRejectExec(t, pool, `UPDATE credential_refs SET availability='frozen' WHERE id=$1`, cred)

	withTx(t, pool, func(tx *sql.Tx) {
		sandbox, node := uuid.NewString(), uuid.NewString()
		_, err := tx.Exec(`INSERT INTO sandbox_instances(id,workspace_id,generation,observed_state) VALUES($1,$2,1,'running')`, sandbox, fx.main)
		must(t, err)
		_, err = tx.Exec(`INSERT INTO node_instances(id,sandbox_instance_id,workspace_id,service_subject,connection_state,protocol_version) VALUES($1,$2,$3,'node-a','connected',1)`, node, sandbox, fx.main)
		must(t, err)
		for _, id := range []string{uuid.NewString(), uuid.NewString()} {
			_, err = tx.Exec(`INSERT INTO execution_tickets(id,workspace_id,tenant_id,node_instance_id,actor_user_id,admission_epoch,kind,state) VALUES($1,$2,$3,$4,$5,0,'task','active')`,
				id, fx.main, fx.tenant, node, fx.owner)
			must(t, err)
		}
	})
}

func TestMigration0018UpgradeFrom0017BackfillsCreatorsWithoutGuessing(t *testing.T) {
	pool, _ := testSchema(t, "test_rc_upg_")
	applyMigrationsUpTo(t, pool, []string{
		"0001_core.sql", "0002_aggregate_guards.sql", "0003_resource_versions.sql",
		"0004_effect_intent_and_ticket_scope.sql", "0005_gateway_auth.sql",
		"0006_collab_spaces.sql", "0007_project_space_scope.sql", "0008_issues.sql",
		"0009_issue_extensions.sql", "0010_issue_collaboration.sql", "0011_issue_interactions.sql",
		"0012_issue_interaction_input.sql", "0013_project_space_optional.sql", "0014_clone_coordination.sql",
		"0015_plugins.sql", "0016_workspace_runtime_follows_node.sql", "0017_tenant_membership_and_join.sql",
	})
	seed := seedPreControlHistory(t, pool)

	store := newStoreOnSchema(t, pool)
	must(t, store.Migrate(context.Background()))
	must(t, store.Migrate(context.Background()))
	must(t, store.CheckSchema(context.Background()))

	for _, fact := range seed.creators {
		assertCreator(t, pool, fact.workspace, fact.want)
	}
	var secret, owner, scope, availability string
	must(t, pool.QueryRow(`SELECT secret_ref, owner_user_id::text, scope_kind, availability FROM credential_refs WHERE id=$1`, seed.credential).
		Scan(&secret, &owner, &scope, &availability))
	if secret != "infra/git/historical" || owner != seed.owner || scope != "unknown" || availability != "available" {
		t.Fatalf("credential upgrade changed stored reference: secret=%s owner=%s scope=%s availability=%s", secret, owner, scope, availability)
	}
	var stopKind, pluginState string
	must(t, pool.QueryRow(`SELECT kind FROM operations WHERE id=$1`, seed.administrativeStop).Scan(&stopKind))
	if stopKind != "administrative_stop" {
		t.Fatalf("administrative_stop became %s", stopKind)
	}
	must(t, pool.QueryRow(`SELECT observed_state FROM workspace_plugin_instances WHERE workspace_id=$1`, seed.pluginWorkspace).Scan(&pluginState))
	if pluginState != "installed" {
		t.Fatalf("plugin instance state changed to %s", pluginState)
	}
	for _, query := range []string{
		`SELECT count(*) FROM runtime_control_sessions`,
		`SELECT count(*) FROM runtime_write_activities`,
		`SELECT count(*) FROM runtime_force_stop_intents`,
		`SELECT count(*) FROM plugin_maintenance_waits`,
	} {
		var n int
		must(t, pool.QueryRow(query).Scan(&n))
		if n != 0 {
			t.Fatalf("%s gained %d rows during upgrade", query, n)
		}
	}
	assertAdministrativeStopUnchanged(t, pool)
	assertCredentialShape(t, pool)
}

func assertAdministrativeStopUnchanged(t *testing.T, pool *sql.DB) {
	t.Helper()
	var def string
	must(t, pool.QueryRow(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='operations_kind_check'`).Scan(&def))
	if !strings.Contains(def, "administrative_stop") || strings.Contains(def, "force_stop") {
		t.Fatalf("operations.kind check changed: %s", def)
	}
}

func assertCredentialShape(t *testing.T, pool *sql.DB) {
	t.Helper()
	var fks string
	must(t, pool.QueryRow(`SELECT coalesce(string_agg(pg_get_constraintdef(oid), ' '), '') FROM pg_constraint WHERE conrelid='credential_refs'::regclass AND contype='f'`).Scan(&fks))
	if !strings.Contains(fks, "owner_user_id") || !strings.Contains(fks, "tenant_memberships") {
		t.Fatalf("credential owner foreign key changed: %s", fks)
	}
	var secrets int
	must(t, pool.QueryRow(`SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='credential_refs' AND column_name IN ('password','token','private_key','secret_value','access_token')`).Scan(&secrets))
	if secrets != 0 {
		t.Fatalf("credential table stores %d secret columns", secrets)
	}
}

type rcFixture struct {
	tenant, space, owner, member, project, main, isolated string
}

type creatorFact struct {
	resolution, reason, source, user, operation, owner string
}

type creatorCase struct {
	workspace string
	want      creatorFact
}

type seededHistory struct {
	owner, credential, administrativeStop, pluginWorkspace string
	creators                                               []creatorCase
}

func assertCreator(t *testing.T, pool *sql.DB, workspace string, want creatorFact) {
	t.Helper()
	var got creatorFact
	var reason, source, user, operation sql.NullString
	must(t, pool.QueryRow(`SELECT creator_resolution, creator_resolution_reason, creator_source, creator_user_id::text, creator_source_operation_id::text, owner_user_id::text FROM workspaces WHERE id=$1`, workspace).
		Scan(&got.resolution, &reason, &source, &user, &operation, &got.owner))
	got.reason, got.source, got.user, got.operation = reason.String, source.String, user.String, operation.String
	if got != want {
		t.Fatalf("creator of %s = %+v, want %+v", workspace, got, want)
	}
}

func seedRuntimeControlFixture(t *testing.T, pool *sql.DB) rcFixture {
	t.Helper()
	fx := rcFixture{
		tenant: uuid.NewString(), space: uuid.NewString(), owner: uuid.NewString(), member: uuid.NewString(),
		project: uuid.NewString(), main: uuid.NewString(), isolated: uuid.NewString(),
	}
	withTx(t, pool, func(tx *sql.Tx) {
		insertUser(t, tx, fx.owner, "Owner")
		insertUser(t, tx, fx.member, "Member")
		mustExec(t, tx, `INSERT INTO tenants(id,name,status) VALUES($1,'Runtime','active')`, fx.tenant)
		mustExec(t, tx, `INSERT INTO tenant_memberships(tenant_id,user_id,role,status) VALUES($1,$2,'admin','active')`, fx.tenant, fx.owner)
		mustExec(t, tx, `INSERT INTO tenant_memberships(tenant_id,user_id,role,status) VALUES($1,$2,'member','active')`, fx.tenant, fx.member)
		mustExec(t, tx, `INSERT INTO collab_workspaces(id,tenant_id,name,slug,created_by) VALUES($1,$2,'Runtime',$3,$4)`, fx.space, fx.tenant, slugOf(fx.space), fx.owner)
		mustExec(t, tx, `INSERT INTO projects(id,tenant_id,owner_user_id,space_id,name,repository_url,default_branch,lifecycle) VALUES($1,$2,$3,$4,'Fresh','https://example.invalid/fresh.git','main','active')`,
			fx.project, fx.tenant, fx.owner, fx.space)
		insertWorkspace(t, tx, fx.main, fx.tenant, fx.owner, fx.project, "main")
		insertWorkspace(t, tx, fx.isolated, fx.tenant, fx.owner, fx.project, "isolated")
	})
	return fx
}

func seedPreControlHistory(t *testing.T, pool *sql.DB) seededHistory {
	t.Helper()
	owner, memberB, memberC, later, decoyAdmin := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	tenant, space := uuid.NewString(), uuid.NewString()
	withTx(t, pool, func(tx *sql.Tx) {
		insertUser(t, tx, owner, "Owner")
		insertUser(t, tx, memberB, "Member B")
		insertUser(t, tx, memberC, "Member C")
		insertUser(t, tx, later, "Later actor")
		insertUser(t, tx, decoyAdmin, "Decoy admin")
		mustExec(t, tx, `INSERT INTO tenants(id,name,status) VALUES($1,'Runtime','active')`, tenant)
		for _, user := range []struct{ id, role string }{
			{owner, "admin"}, {memberB, "member"}, {memberC, "member"}, {later, "member"}, {decoyAdmin, "admin"},
		} {
			mustExec(t, tx, `INSERT INTO tenant_memberships(tenant_id,user_id,role,status) VALUES($1,$2,$3,'active')`, tenant, user.id, user.role)
		}
		mustExec(t, tx, `INSERT INTO collab_workspaces(id,tenant_id,name,slug,created_by) VALUES($1,$2,'Runtime',$3,$4)`, space, tenant, slugOf(space), owner)
	})

	provenProject, provenMain := insertProject(t, pool, tenant, space, owner, "Proven")
	provenCreate := uuid.NewString()
	provenIsolated := uuid.NewString()
	isolatedCreate := uuid.NewString()
	withTx(t, pool, func(tx *sql.Tx) {
		insertOperation(t, tx, provenCreate, tenant, memberB, provenProject, provenMain, "create_project")
		insertOperation(t, tx, uuid.NewString(), tenant, later, provenProject, provenMain, "start")
		insertWorkspace(t, tx, provenIsolated, tenant, owner, provenProject, "isolated")
		insertOperation(t, tx, isolatedCreate, tenant, memberC, provenProject, provenIsolated, "create_workspace")
		insertOperation(t, tx, uuid.NewString(), tenant, owner, provenProject, provenIsolated, "stop")
	})

	missingProject, missingMain := insertProject(t, pool, tenant, space, owner, "Missing")
	missingIsolated := uuid.NewString()
	withTx(t, pool, func(tx *sql.Tx) {
		insertOperation(t, tx, uuid.NewString(), tenant, later, missingProject, missingMain, "start")
		insertWorkspace(t, tx, missingIsolated, tenant, owner, missingProject, "isolated")
		insertOperation(t, tx, uuid.NewString(), tenant, later, missingProject, missingIsolated, "stop")
	})

	conflictProject, conflictMain := insertProject(t, pool, tenant, space, owner, "Conflict")
	conflictIsolated := uuid.NewString()
	withTx(t, pool, func(tx *sql.Tx) {
		insertOperation(t, tx, uuid.NewString(), tenant, memberB, conflictProject, conflictMain, "create_project")
		insertOperation(t, tx, uuid.NewString(), tenant, memberC, conflictProject, conflictMain, "create_project")
		insertWorkspace(t, tx, conflictIsolated, tenant, owner, conflictProject, "isolated")
		insertOperation(t, tx, uuid.NewString(), tenant, memberB, conflictProject, conflictIsolated, "create_workspace")
		insertOperation(t, tx, uuid.NewString(), tenant, memberB, conflictProject, conflictIsolated, "create_workspace")
	})

	unprovableProject, unprovableMain := insertProject(t, pool, tenant, space, owner, "Unprovable")
	mispointed := uuid.NewString()
	otherIsolated := uuid.NewString()
	withTx(t, pool, func(tx *sql.Tx) {
		insertWorkspace(t, tx, mispointed, tenant, owner, unprovableProject, "isolated")
		insertWorkspace(t, tx, otherIsolated, tenant, owner, unprovableProject, "isolated")
		insertOperation(t, tx, uuid.NewString(), tenant, memberB, unprovableProject, mispointed, "create_project")
		insertOperation(t, tx, uuid.NewString(), tenant, memberC, unprovableProject, "", "create_workspace")
	})

	nullProject, nullMain := insertProject(t, pool, tenant, space, owner, "Null workspace")
	nullCreate := uuid.NewString()
	withTx(t, pool, func(tx *sql.Tx) {
		insertOperation(t, tx, nullCreate, tenant, memberC, nullProject, "", "create_project")
	})

	credential := uuid.NewString()
	stop := uuid.NewString()
	withTx(t, pool, func(tx *sql.Tx) {
		mustExec(t, tx, `INSERT INTO credential_refs(id,tenant_id,owner_user_id,purpose,secret_ref) VALUES($1,$2,$3,'git','infra/git/historical')`, credential, tenant, owner)
		mustExec(t, tx, `UPDATE projects SET credential_ref_id=$2 WHERE id=$1`, provenProject, credential)
		insertOperation(t, tx, stop, tenant, owner, provenProject, provenIsolated, "administrative_stop")
		mustExec(t, tx, `INSERT INTO workspace_plugin_instances(workspace_id,tenant_id,owner_user_id,project_id,source_namespace,identifier,observed_state,observed_version) VALUES($1,$2,$3,$4,'official','git','installed','1.0.0')`,
			provenIsolated, tenant, owner, provenProject)
	})

	unknown := func(workspace string, reason string) creatorCase {
		return creatorCase{workspace: workspace, want: creatorFact{resolution: "unknown", reason: reason, owner: owner}}
	}
	known := func(workspace, user, operation, source string) creatorCase {
		return creatorCase{workspace: workspace, want: creatorFact{
			resolution: "known", source: source, user: user, operation: operation, owner: owner,
		}}
	}
	return seededHistory{
		owner: owner, credential: credential, administrativeStop: stop, pluginWorkspace: provenIsolated,
		creators: []creatorCase{
			known(provenMain, memberB, provenCreate, "create_project_operation"),
			known(provenIsolated, memberC, isolatedCreate, "create_workspace_operation"),
			unknown(missingMain, "missing"),
			unknown(missingIsolated, "missing"),
			unknown(conflictMain, "conflict"),
			unknown(conflictIsolated, "conflict"),
			unknown(unprovableMain, "unprovable"),
			unknown(mispointed, "unprovable"),
			unknown(otherIsolated, "unprovable"),
			known(nullMain, memberC, nullCreate, "create_project_operation"),
		},
	}
}

func insertProject(t *testing.T, pool *sql.DB, tenant, space, owner, name string) (string, string) {
	t.Helper()
	project, main := uuid.NewString(), uuid.NewString()
	withTx(t, pool, func(tx *sql.Tx) {
		mustExec(t, tx, `INSERT INTO projects(id,tenant_id,owner_user_id,space_id,name,repository_url,default_branch,lifecycle) VALUES($1,$2,$3,$4,$5,'https://example.invalid/repo.git','main','active')`,
			project, tenant, owner, space, name)
		insertWorkspace(t, tx, main, tenant, owner, project, "main")
	})
	return project, main
}

func insertUser(t *testing.T, tx *sql.Tx, id, name string) {
	t.Helper()
	mustExec(t, tx, `INSERT INTO users(id,display_name,status) VALUES($1,$2,'active')`, id, name)
}

func insertWorkspace(t *testing.T, tx *sql.Tx, id, tenant, owner, project, kind string) {
	t.Helper()
	mustExec(t, tx, `INSERT INTO workspaces(id,tenant_id,owner_user_id,project_id,kind,desired_state,observed_state,requested_ref) VALUES($1,$2,$3,$4,$5,'running','ready','main')`,
		id, tenant, owner, project, kind)
	if kind == "isolated" {
		mustExec(t, tx, `INSERT INTO tasks(id,workspace_id,title) VALUES($1,$2,'Task')`, uuid.NewString(), id)
	}
}

func insertOperation(t *testing.T, tx *sql.Tx, id, tenant, actor, project, workspace, kind string) {
	t.Helper()
	var ws any
	if workspace != "" {
		ws = workspace
	}
	mustExec(t, tx, `INSERT INTO operations(id,tenant_id,actor_user_id,project_id,workspace_id,kind,state,step,request,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,'succeeded','done','{}',$7,'hash')`,
		id, tenant, actor, project, ws, kind, "key-"+id)
}

const controlSessionSQL = `INSERT INTO runtime_control_sessions(id,tenant_id,workspace_id,holder_user_id,holder_kind,control_epoch,state,expires_at,change_reason,closed_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '60 seconds',$8,CASE WHEN $7='closed' THEN now() END)`

func insertControlSession(t *testing.T, tx *sql.Tx, id string, fx rcFixture, workspace string, holder any, holderKind string, epoch int, state string) {
	t.Helper()
	change := "acquire"
	if state == "closed" {
		change = "closed"
	}
	mustExec(t, tx, controlSessionSQL, id, fx.tenant, workspace, holder, holderKind, epoch, state, change)
}

const writeActivitySQL = `INSERT INTO runtime_write_activities(id,tenant_id,workspace_id,session_id,actor_user_id,actor_kind,state,finished_at) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $7='finished' THEN now() END)`

func insertWriteActivity(t *testing.T, tx *sql.Tx, id string, fx rcFixture, workspace, session string, actor any, actorKind, state string) {
	t.Helper()
	mustExec(t, tx, writeActivitySQL, id, fx.tenant, workspace, session, actor, actorKind, state)
}

const forceStopSQL = `INSERT INTO runtime_force_stop_intents(id,tenant_id,workspace_id,initiator_user_id,target_runtime_generation,reason,idempotency_key,request_hash,state) VALUES($1,$2,$3,$4,0,$5,$6,'hash',$7)`

func insertForceStop(t *testing.T, tx *sql.Tx, id string, fx rcFixture, workspace, reason, key string) {
	t.Helper()
	mustExec(t, tx, forceStopSQL, id, fx.tenant, workspace, fx.owner, reason, key, "requested")
}

const pluginWaitSQL = `INSERT INTO plugin_maintenance_waits(id,tenant_id,space_id,project_id,workspace_id,source_namespace,identifier,desired_action,desired_version,state,initiator_user_id,idempotency_key) VALUES($1,$2,$3,$4,$5,'official','git','install','1.0.0',$6,$7,$8)`

func insertPluginWait(t *testing.T, tx *sql.Tx, id string, fx rcFixture, workspace, state, key string) {
	t.Helper()
	mustExec(t, tx, pluginWaitSQL, id, fx.tenant, fx.space, fx.project, workspace, state, fx.owner, key)
}

func withTx(t *testing.T, pool *sql.DB, fn func(*sql.Tx)) {
	t.Helper()
	tx, err := pool.Begin()
	must(t, err)
	defer func() { _ = tx.Rollback() }()
	fn(tx)
	must(t, tx.Commit())
}

func mustExec(t *testing.T, tx *sql.Tx, query string, args ...any) {
	t.Helper()
	if _, err := tx.Exec(query, args...); err != nil {
		t.Fatalf("exec %s: %v", query, err)
	}
}

func mustRejectExec(t *testing.T, pool *sql.DB, query string, args ...any) {
	t.Helper()
	tx, err := pool.Begin()
	must(t, err)
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.Exec(query, args...); err == nil {
		t.Fatalf("expected rejection for %s", query)
	}
}

func slugOf(id string) string {
	compact := strings.ReplaceAll(id, "-", "")
	return "rc" + compact[:12]
}
