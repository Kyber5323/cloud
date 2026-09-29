package integration

import (
	"context"
	"sync"
	"testing"

	"github.com/golang-jwt/jwt/v5"

	"github.com/wanglongan587/cloud/internal/controlpb"
	"github.com/wanglongan587/cloud/internal/core"
)

// The HTTP and gRPC paths share real PostgreSQL. Binding acknowledgement is injected Node
// evidence here; actual Rust Node acceptance and execution are verified separately in desktop.
func TestRuntimeControlRequiresAcknowledgementAndRetainsExpiredResponsibility(t *testing.T) {
	f := setup(t)
	created := f.create("controlled")
	f.drain()
	wid := created.O("workspace").S("id")
	api := controlpb.NewRuntimeControlServiceClient(f.controlConn)
	ctx := asController(f.client.Subject)
	list, err := api.ListBindings(ctx, &controlpb.ListBindingsRequest{Epoch: f.controller.Epoch})
	must(t, err)
	if len(list.Bindings) != 1 || !list.Bindings[0].InputClosed {
		t.Fatalf("creation must close its maintenance entrance: %v", list)
	}
	closeBinding := list.Bindings[0]
	leaseDeadline := int64(f.scalar("SELECT floor(extract(epoch FROM expires_at)*1000)::bigint FROM controller_leases WHERE name='global'"))
	if closeBinding.ExpiresAtMs > leaseDeadline || closeBinding.ExpiresAtMs <= closeBinding.IssuedAtMs {
		t.Fatal("Node binding outlived the Controller lease", closeBinding)
	}
	_, err = api.AcknowledgeBinding(ctx, &controlpb.AcknowledgeBindingRequest{SubmissionId: "close-create", Epoch: f.controller.Epoch, WorkspaceId: wid, NodeInstanceId: closeBinding.NodeInstanceId, ControlEpoch: closeBinding.ControlEpoch, ControlVersion: closeBinding.ControlVersion, InputClosed: true})
	must(t, err)
	view := f.call("GET", f.path("/workspaces/"+wid+"/control"), nil, "", 200)
	if view.S("state") != "idle" {
		t.Fatal(view)
	}
	acquired := f.call("POST", f.path("/workspaces/"+wid+"/control/acquire"), core.Object{"version": view.N("version")}, "page-one", 200)
	if acquired.S("state") != "acquiring" || acquired.S("sessionId") == "" {
		t.Fatal(acquired)
	}
	f.call("POST", f.path("/workspaces/"+wid+"/control/renew"), core.Object{"version": acquired.N("version"), "sessionId": acquired.S("sessionId")}, "early-renew", 409)
	list, err = api.ListBindings(ctx, &controlpb.ListBindingsRequest{Epoch: f.controller.Epoch})
	must(t, err)
	bound := list.Bindings[0]
	_, err = api.AcknowledgeBinding(ctx, &controlpb.AcknowledgeBindingRequest{SubmissionId: "bind-page", Epoch: f.controller.Epoch, WorkspaceId: wid, NodeInstanceId: bound.NodeInstanceId, ControlEpoch: bound.ControlEpoch, ControlVersion: bound.ControlVersion})
	must(t, err)
	held := f.call("GET", f.path("/workspaces/"+wid+"/control"), nil, "", 200)
	if held.S("state") != "held" {
		t.Fatal(held)
	}
	if _, exists := held["sessionId"]; exists {
		t.Fatal("overview disclosed the page binding")
	}
	f.call("POST", f.path("/workspaces/"+wid+"/control/acquire"), core.Object{"version": held.N("version")}, "page-two", 409)
	f.call("POST", f.path("/workspaces/"+wid+"/control/renew"), core.Object{"version": held.N("version"), "sessionId": bound.SessionId}, "renew", 200)
	_, err = f.store.Pool.Exec("UPDATE runtime_controls SET expires_at=clock_timestamp()-interval '1 second' WHERE workspace_id=$1", wid)
	must(t, err)
	expired := f.call("GET", f.path("/workspaces/"+wid+"/control"), nil, "", 200)
	if expired.S("state") != "draining" {
		t.Fatal(expired)
	}
	// Replaying the old successful renewal returns its historical response but cannot revive it.
	f.call("POST", f.path("/workspaces/"+wid+"/control/renew"), core.Object{"version": held.N("version"), "sessionId": bound.SessionId}, "renew", 200)
	f.call("POST", f.path("/workspaces/"+wid+"/control/renew"), core.Object{"version": expired.N("version"), "sessionId": bound.SessionId}, "late-renew", 409)
	f.call("POST", f.path("/workspaces/"+wid+"/control/acquire"), core.Object{"version": expired.N("version")}, "takeover-before-close", 409)
	list, err = api.ListBindings(ctx, &controlpb.ListBindingsRequest{Epoch: f.controller.Epoch})
	must(t, err)
	draining := list.Bindings[0]
	_, err = api.AcknowledgeBinding(ctx, &controlpb.AcknowledgeBindingRequest{SubmissionId: "close-busy", Epoch: f.controller.Epoch, WorkspaceId: wid, NodeInstanceId: draining.NodeInstanceId, ControlEpoch: draining.ControlEpoch, ControlVersion: draining.ControlVersion, InputClosed: true, UnfinishedExecutionIds: []string{"unknown-local-execution"}})
	must(t, err)
	f.call("POST", f.path("/workspaces/"+wid+"/control/acquire"), core.Object{"version": expired.N("version")}, "takeover-busy", 409)
	_, err = api.AcknowledgeBinding(ctx, &controlpb.AcknowledgeBindingRequest{SubmissionId: "close-idle", Epoch: f.controller.Epoch, WorkspaceId: wid, NodeInstanceId: draining.NodeInstanceId, ControlEpoch: draining.ControlEpoch, ControlVersion: draining.ControlVersion, InputClosed: true})
	must(t, err)
	idle := f.call("GET", f.path("/workspaces/"+wid+"/control"), nil, "", 200)
	next := f.call("POST", f.path("/workspaces/"+wid+"/control/acquire"), core.Object{"version": idle.N("version")}, "next-page", 200)
	if next.N("controlEpoch") <= acquired.N("controlEpoch") || next.S("sessionId") == acquired.S("sessionId") {
		t.Fatal("old binding revived", next)
	}
}

func TestStoppedRuntimeControlConcurrentAcquireAndPageSeparation(t *testing.T) {
	f := setup(t)
	created := f.create("concurrent-control")
	f.drain()
	wid := created.O("workspace").S("id")
	f.call("POST", f.path("/workspaces/"+wid+"/stop"), f.lifecycleBody(wid, f.scalar("SELECT version FROM workspaces WHERE id=$1", wid)), "stop", 202)
	f.drain()
	view := f.call("GET", f.path("/workspaces/"+wid+"/control"), nil, "", 200)
	gateway := core.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "gateway-a"}}
	var wait sync.WaitGroup
	type result struct {
		code int
		body core.Object
		err  error
	}
	responses := make(chan result, 2)
	for _, key := range []string{"page-a", "page-b"} {
		wait.Add(1)
		go func(key string) {
			defer wait.Done()
			body, code, err := f.client.Call(context.Background(), "POST", f.path("/workspaces/"+wid+"/control/acquire"), "gateway", gateway, &f.user, key, core.Object{"version": view.N("version")})
			responses <- result{code, body, err}
		}(key)
	}
	wait.Wait()
	close(responses)
	accepted, refused := 0, 0
	for r := range responses {
		must(t, r.err)
		switch r.code {
		case 200:
			accepted++
			if r.body.S("state") != "held" {
				t.Fatal(r.body)
			}
		case 409:
			refused++
		default:
			t.Fatal(r)
		}
	}
	if accepted != 1 || refused != 1 {
		t.Fatal("multiple page holders", accepted, refused)
	}
}
