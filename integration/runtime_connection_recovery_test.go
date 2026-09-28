package integration

import (
	"testing"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"

	"github.com/wanglongan587/cloud/internal/controlpb"
	"github.com/wanglongan587/cloud/internal/core"
)

// Restored transport is availability evidence, never a revival of the withdrawn page binding.
// specs/test-cases/cloud/controller-integration/fenced-runtime-control-delivery.md#stale-queued-commands-and-restored-connections-cannot-write-after-handoff
func TestNodeReconnectRestoresAvailabilityButNeverOldPageQualification(t *testing.T) {
	f := setup(t)
	created := f.create("reconnect")
	f.drain()
	wid := created.O("workspace").S("id")
	oldSession := f.controlSession(wid)
	runtime := controlpb.NewRuntimeControlServiceClient(f.controlConn)
	nodes := controlpb.NewNodeReportServiceClient(f.controlConn)
	ctx := asController(f.client.Subject)
	list, err := runtime.ListBindings(ctx, &controlpb.ListBindingsRequest{Epoch: f.controller.Epoch})
	must(t, err)
	bound := list.Bindings[0]
	nodeVersion := int64(f.scalar("SELECT version FROM node_instances WHERE id=$1", bound.NodeInstanceId))
	disconnected, err := nodes.ReportNodeStatus(ctx, &controlpb.ReportNodeStatusRequest{SubmissionId: uuid.NewString(), Epoch: f.controller.Epoch, NodeInstanceId: bound.NodeInstanceId, Version: nodeVersion, Connection: controlpb.NodeConnection_NODE_CONNECTION_DISCONNECTED, Initialized: true})
	must(t, err)
	if f.ws(wid).S("observedState") != "unavailable" {
		t.Fatal("disconnect did not withdraw availability")
	}
	_, err = nodes.ReportNodeStatus(ctx, &controlpb.ReportNodeStatusRequest{SubmissionId: uuid.NewString(), Epoch: f.controller.Epoch, NodeInstanceId: bound.NodeInstanceId, Version: disconnected.Node.Version, Connection: controlpb.NodeConnection_NODE_CONNECTION_CONNECTED, Initialized: true})
	must(t, err)
	if f.ws(wid).S("observedState") != "ready" {
		t.Fatal("verified reconnect did not restore known initialized runtime")
	}
	view := f.call("GET", f.path("/workspaces/"+wid+"/control"), nil, "", 200)
	if view.S("state") != "draining" {
		t.Fatal("reconnect revived old qualification", view)
	}
	f.call("POST", f.path("/workspaces/"+wid+"/control/renew"), core.Object{"version": view.N("version"), "sessionId": oldSession}, uuid.NewString(), 409)
	f.call("POST", f.path("/workspaces/"+wid+"/control/acquire"), core.Object{"version": view.N("version")}, uuid.NewString(), 409)
	f.acknowledgeSimulatorBindings()
	idle := f.call("GET", f.path("/workspaces/"+wid+"/control"), nil, "", 200)
	_, err = runtime.AcknowledgeBinding(ctx, &controlpb.AcknowledgeBindingRequest{SubmissionId: uuid.NewString(), Epoch: f.controller.Epoch, WorkspaceId: wid, NodeInstanceId: bound.NodeInstanceId, ControlEpoch: bound.ControlEpoch, ControlVersion: bound.ControlVersion, InputClosed: true})
	expectStatus(t, err, codes.Aborted, controlpb.ErrorCode_ERROR_CODE_CONFLICT)
	acquired := f.call("POST", f.path("/workspaces/"+wid+"/control/acquire"), core.Object{"version": idle.N("version")}, uuid.NewString(), 200)
	if acquired.N("controlEpoch") <= bound.ControlEpoch || acquired.S("sessionId") == oldSession {
		t.Fatal("handoff reused old binding")
	}
	f.acknowledgeSimulatorBindings()
	list, err = runtime.ListBindings(ctx, &controlpb.ListBindingsRequest{Epoch: f.controller.Epoch})
	must(t, err)
	fresh := list.Bindings[0]
	// An early conservative Node close overrides a still-future user deadline without granting work.
	_, err = runtime.AcknowledgeBinding(ctx, &controlpb.AcknowledgeBindingRequest{SubmissionId: uuid.NewString(), Epoch: f.controller.Epoch, WorkspaceId: wid, NodeInstanceId: fresh.NodeInstanceId, ControlEpoch: fresh.ControlEpoch, ControlVersion: fresh.ControlVersion, InputClosed: true})
	must(t, err)
	view = f.call("GET", f.path("/workspaces/"+wid+"/control"), nil, "", 200)
	if view.S("state") != "idle" {
		t.Fatal("closed and settled Node not reconciled", view)
	}
	f.call("POST", f.path("/workspaces/"+wid+"/control/renew"), core.Object{"version": view.N("version"), "sessionId": acquired.S("sessionId")}, uuid.NewString(), 409)
}
