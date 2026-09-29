package core

import "context"

// DirectoryPerson is the bounded result of a server-side Tianzhou lookup. Only
// its stable identifier and display name may be persisted by Cloud.
type DirectoryPerson struct {
	GlobalUserID   string `json:"globalUserId"`
	Name           string `json:"name"`
	EmployeeNumber string `json:"employeeNumber"`
	DepartmentName string `json:"departmentName"`
	Employed       bool   `json:"-"`
}

// AuthorizeTenantAdmin checks the current PostgreSQL role before any external
// directory call. The eventual write checks it again after that call.
func (s *Store) AuthorizeTenantAdmin(ctx context.Context, tid string, claims *Claims) error {
	_, err := s.transact(ctx, func(t *transaction) Object {
		u := identityWithAlias(t, claims)
		membership(t, tid, u.S("id"), true)
		return Object{}
	})
	return err
}

func addHuaweiMember(t *transaction, r *PublicRequest, _ string) Object {
	require(r.Person != nil && r.Person.Employed, 400, "person_not_employed")
	globalID := canonicalGlobalID(r.Person.GlobalUserID)
	require(globalID != "" && globalID == canonicalGlobalID(r.Body.S("globalUserId")), 400, "invalid_person")
	role := r.Body.S("role")
	if role == "" {
		role = "member"
	}
	require(role == "admin" || role == "member", 400, "invalid_member")
	name := validText(r.Person.Name, 200)
	u := t.one("SELECT u.* FROM users u JOIN user_identities i ON i.user_id=u.id WHERE i.source='huawei-global' AND i.subject=$1", globalID)
	if u == nil {
		id := newID()
		t.exec("INSERT INTO users(id,display_name,status) VALUES($1,$2,'active')", id, name)
		t.exec("INSERT INTO user_identities(user_id,source,subject) VALUES($1,'huawei-global',$2)", id, globalID)
		u = t.one("SELECT * FROM users WHERE id=$1", id)
	}
	require(u.S("status") == "active" && u["deletedAt"] == nil, 403, "user_disabled")
	member := addMembership(t, r.TenantID, u.S("id"), role)
	return Object{"tenantId": r.TenantID, "userId": u.S("id"), "role": member.S("role"), "status": member.S("status"), "version": member.N("version"), "displayName": u.S("displayName")}
}
