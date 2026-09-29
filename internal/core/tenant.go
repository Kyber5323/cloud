package core

import "strings"

// Tenants are the isolation boundary every other resource hangs from. Each
// tenant has exactly one visible collaboration space. Two provisioning paths
// share one transaction shape:
//
//   - Bootstrap (cloudctl) provisions a tenant for a deployment with a space
//     whose generated slug is globally unique.
//   - POST /api/v1/tenants lets a signed-in user provision a tenant for
//     themselves with a chosen global slug.
//
// Both paths make the actor the tenant's first administrator in the same
// transaction, so a tenant never exists without an administrator or space.

// provisionTenant inserts a tenant, its first administrator, and sole space.
// Callers validate every input first; this owns the atomic write order.
func provisionTenant(t *transaction, uid, name, slug string) (tenant, space Object) {
	tid := newID()
	require(t.one("SELECT id FROM collab_workspaces WHERE slug=$1", slug) == nil, 409, "space_slug_conflict")
	t.exec("INSERT INTO tenants(id,name,status) VALUES($1,$2,'active')", tid, name)
	t.exec("INSERT INTO tenant_memberships(tenant_id,user_id,role,status) VALUES($1,$2,'admin','active')", tid, uid)
	sid := newID()
	t.exec("INSERT INTO collab_workspaces(id,tenant_id,name,slug,created_by) VALUES($1,$2,$3,$4,$5)", sid, tid, name, slug, uid)
	return t.one("SELECT t.id,t.name,t.status,m.role FROM tenants t JOIN tenant_memberships m ON m.tenant_id=t.id WHERE t.id=$1 AND m.user_id=$2", tid, uid),
		t.one("SELECT * FROM collab_workspaces WHERE id=$1", sid)
}

// createTenant serves POST /api/v1/tenants: the signed-in user provisions a
// tenant named after the space they are creating and becomes its first
// administrator.
//
// Idempotency records are keyed by tenant, and no tenant exists before this
// call succeeds, so replay is matched on (user, key) across the tenants the
// user belongs to and the record is stored under the tenant the call created.
// The request hash still rejects a reused key with a different body.
func createTenant(t *transaction, r *PublicRequest, uid string) (out Object, status int) {
	name := validText(r.Body.S("name"), 128)
	slug := strings.ToLower(strings.TrimSpace(r.Body.S("slug")))
	require(validSlug(slug), 400, "invalid_slug")
	require(r.Key != "" && len(r.Key) <= 200, 400, "idempotency_key_required")
	hash := requestHash(r.Method, r.Path, r.Body)
	if old := t.one("SELECT * FROM idempotency_records WHERE user_id=$1 AND key=$2", uid, r.Key); old != nil {
		require(old.S("requestHash") == hash, 409, "idempotency_conflict")
		return old.O("response"), int(old.N("status"))
	}
	tenant, space := provisionTenant(t, uid, name, slug)
	out = Object{"tenant": tenant, "space": space}
	t.exec("INSERT INTO idempotency_records(tenant_id,user_id,key,request_hash,response,status) VALUES($1,$2,$3,$4,$5,$6)", tenant.S("id"), uid, r.Key, hash, jsonText(out), 201)
	return out, 201
}
