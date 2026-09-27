package integration

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"

	"github.com/wanglongan587/cloud/internal/api/router"
	"github.com/wanglongan587/cloud/internal/core"
	"github.com/wanglongan587/cloud/internal/simulator"
)

type changingDirectory struct{ searches int }

func (d *changingDirectory) Search(_ context.Context, _ string) ([]core.DirectoryPerson, error) {
	d.searches++
	if d.searches == 1 {
		return []core.DirectoryPerson{{GlobalUserID: "205045249610656", Name: "Employee", EmployeeNumber: "00934887", Employed: true}}, nil
	}
	return nil, nil // The person left employment before the add command.
}

func huaweiClaims(uuid, globalID string) core.Claims {
	return core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: uuid}, Source: "huawei-corp", GlobalUserID: globalID, DisplayName: "New IDaaS name"}
}

func TestHuaweiGlobalIdentityBindsPreAddedMemberAcrossEmployeeNumberChange(t *testing.T) {
	f := setup(t)
	person := core.DirectoryPerson{GlobalUserID: "205045249610656", Name: "严霜洲", EmployeeNumber: "00934887", DepartmentName: "研发", Employed: true}
	added, status, err := f.store.Public(context.Background(), &core.PublicRequest{
		Method: "POST", Path: f.path("/members/huawei"), TenantID: f.tid, Key: "pre-add", Identity: &f.user,
		Body: core.Object{"keyword": "严霜洲", "globalUserId": person.GlobalUserID, "role": "member"}, Person: &person,
	})
	must(t, err)
	if status != 200 || added.S("userId") == "" {
		t.Fatalf("pre-add failed: %d %v", status, added)
	}
	person.EmployeeNumber = "00112233"
	other, status, err := f.store.Public(context.Background(), &core.PublicRequest{
		Method: "POST", Path: f.path("/members/huawei"), TenantID: f.tid, Key: "pre-add-new-number", Identity: &f.user,
		Body: core.Object{"keyword": "严霜洲", "globalUserId": person.GlobalUserID, "role": "member"}, Person: &person,
	})
	must(t, err)
	if status != 200 || other.S("userId") != added.S("userId") {
		t.Fatalf("employee number change split identity: %d %v", status, other)
	}
	project := f.create("huawei-shared-project")
	f.drain()
	controller := core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: f.client.Subject}}
	login := huaweiClaims("idaas-uuid-1", person.GlobalUserID)
	access, status, err := f.client.Call(context.Background(), "POST", "/internal/v1/access", "controller", controller, &login, "", core.Object{"tenantId": f.tid, "workspaceId": project.O("workspace").S("id"), "action": "read"})
	must(t, err)
	if status != 200 || access.S("userId") != added.S("userId") {
		t.Fatalf("first verified access did not bind the preadded identity: %d %v", status, access)
	}
	loggedIn := joinCall(t, f, huaweiClaims("idaas-uuid-1", person.GlobalUserID), "GET", "/api/v1/me", "", nil, 200)
	if loggedIn.S("id") != added.S("userId") {
		t.Fatalf("first IDaaS login did not bind preadded member: %v", loggedIn)
	}
	joinCall(t, f, huaweiClaims("idaas-uuid-1", person.GlobalUserID), "GET", f.path("/spaces"), "", nil, 200)
	if f.scalar("SELECT count(*) FROM user_identities WHERE user_id=$1 AND source IN ('huawei-corp','huawei-global')", added.S("userId")) != 2 {
		t.Fatal("verified UUID and global ID were not bound to one user")
	}
}

func TestHuaweiIdentityConflictAndInactiveEmployeeAreRejected(t *testing.T) {
	f := setup(t)
	first := joinCall(t, f, huaweiClaims("uuid-a", "1001"), "GET", "/api/v1/me", "", nil, 200)
	second := joinCall(t, f, huaweiClaims("uuid-b", "1002"), "GET", "/api/v1/me", "", nil, 200)
	if first.S("id") == second.S("id") {
		t.Fatal("separate verified identities merged")
	}
	joinCall(t, f, huaweiClaims("uuid-a", "1002"), "GET", "/api/v1/me", "", nil, 409)
	if f.scalar("SELECT count(*) FROM user_identities WHERE source='huawei-global' AND subject='1002' AND user_id=$1", second.S("id")) != 1 {
		t.Fatal("identity conflict changed the global binding")
	}
	person := core.DirectoryPerson{GlobalUserID: "1003", Name: "Former employee", Employed: false}
	_, _, err := f.store.Public(context.Background(), &core.PublicRequest{Method: "POST", Path: f.path("/members/huawei"), TenantID: f.tid, Key: "inactive", Identity: &f.user, Body: core.Object{"globalUserId": "1003"}, Person: &person})
	if core.ErrorCode(err).Code != "person_not_employed" {
		t.Fatalf("inactive employee should not join: %v", err)
	}
}

func TestHuaweiMemberAddRechecksDirectoryAfterSearch(t *testing.T) {
	f := setup(t)
	auth, err := core.NewAuthenticator("ora-cloud", f.client.Credentials.Trust)
	must(t, err)
	directory := &changingDirectory{}
	server := httptest.NewServer(router.New(f.store, auth, zap.NewNop(), directory))
	t.Cleanup(server.Close)
	client := &simulator.Client{URL: server.URL, Credentials: f.client.Credentials, HTTP: f.client.HTTP}
	gw := core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "gateway-a"}}
	_, status, err := client.Call(context.Background(), "POST", f.path("/invitations"), "gateway", gw, &f.user, "internal-invite", core.Object{"token": joinToken('x')})
	must(t, err)
	if status != 404 {
		t.Fatalf("corporate deployment exposed private links: %d", status)
	}
	result, status, err := client.Call(context.Background(), "GET", f.path("/people")+"?keyword=Employee", "gateway", gw, &f.user, "", nil)
	must(t, err)
	if status != 200 || len(result["items"].([]any)) != 1 {
		t.Fatalf("initial employed search: %d %v", status, result)
	}
	_, status, err = client.Call(context.Background(), "POST", f.path("/members/huawei"), "gateway", gw, &f.user, "fresh-employment", core.Object{"keyword": "Employee", "globalUserId": "205045249610656", "role": "member"})
	must(t, err)
	if status != 404 || directory.searches != 2 {
		t.Fatalf("add must recheck the directory: status=%d searches=%d", status, directory.searches)
	}
	if f.scalar("SELECT count(*) FROM user_identities WHERE source='huawei-global' AND subject='205045249610656'") != 0 {
		t.Fatal("inactive selection created an identity")
	}
}
