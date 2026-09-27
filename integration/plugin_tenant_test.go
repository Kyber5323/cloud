package integration

import "github.com/wanglongan587/cloud/internal/core"

// createPluginTenant exercises the public provisioning flow because a second
// plugin selection boundary is now a second tenant, never a nested space.
func (f *fixture) createPluginTenant(name, slug, key string) core.Object {
	f.t.Helper()
	return f.call("POST", "/api/v1/tenants", core.Object{"name": name, "slug": slug}, key, 201).O("space")
}

// pluginSpacePath derives each fixture space's tenant without mutating shared
// fixture state; concurrent installations must retain distinct tenant scopes.
func (f *fixture) pluginSpacePath(sid string) string {
	f.t.Helper()
	var tid string
	must(f.t, f.store.Pool.QueryRow("SELECT tenant_id FROM collab_workspaces WHERE id=$1", sid).Scan(&tid))
	return "/api/v1/tenants/" + tid + "/spaces/" + sid
}
