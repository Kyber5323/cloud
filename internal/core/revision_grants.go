package core

import (
	"time"

	"github.com/wanglongan587/cloud/internal/objectstore"
)

// revisionGrants signs upload URLs for a delivery execution that has no result yet.
// Nothing about the URL is written down: the signature is returned to the caller and forgotten.
func revisionGrants(t *transaction, executionID string) Object {
	e := t.one("SELECT * FROM node_executions WHERE execution_id=$1 AND kind='deliver_revision'", executionID)
	require(e != nil, 404, "not_found")
	require(len(e.O("result")) == 0 && e["terminatedByForceStopId"] == nil, 409, "dispatch_conflict")
	require(t.objectStore != nil, 409, "object_store_unconfigured")
	input := e.O("input")
	keys := []string{input.S("bundleKey"), input.S("historyKey")}
	grants := make([]Object, 0, len(keys))
	for _, key := range keys {
		require(key != "", 409, "dispatch_conflict")
		signed, err := objectstore.PresignPUT(t.objectStore, key, time.Now())
		require(err == nil, 409, "object_store_unconfigured")
		grants = append(grants, Object{"objectKey": key, "url": signed.URL, "method": signed.Method, "headers": signed.Headers, "expiresAt": signed.Expires})
	}
	return Object{"grants": grants}
}
