package controlgrpc

import (
	"context"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/wanglongan587/cloud/internal/controlpb"
	"github.com/wanglongan587/cloud/internal/core"
)

// deliveryService is the fenced runtime-control dispatch contract. It is a
// translation layer: the metadata interceptor has already named the caller,
// and that name is not a service identity. Store.Control refuses the action
// unless a deployment verifier set DeliveryAuthenticated, which this server
// never does.
type deliveryService struct {
	controlpb.UnimplementedRuntimeControlDeliveryServiceServer
	store *core.Store
}

func (s *deliveryService) RecordControlDispatch(ctx context.Context, req *controlpb.RecordControlDispatchRequest) (*controlpb.RecordControlDispatchResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid_dispatch")
	}
	body := core.Object{
		"epoch":              req.GetEpoch(),
		"executionId":        req.GetExecutionId(),
		"workspaceId":        req.GetWorkspaceId(),
		"controlEpoch":       req.GetControlEpoch(),
		"runtimeGeneration":  req.GetRuntimeGeneration(),
		"protocolGeneration": int64(req.GetProtocolGeneration()),
		"input":              dispatchInputObject(req.GetInput()),
	}
	out, e := s.store.Control(ctx, &core.ControlRequest{Action: "control_dispatch", SubmissionID: req.GetSubmissionId(), Body: body, Service: principal(ctx)})
	if e != nil {
		return nil, toStatus(e)
	}
	return &controlpb.RecordControlDispatchResponse{Dispatch: controlDispatchMessage(out)}, nil
}

// dispatchInputObject keeps a clone spec as the fixed input. Any other kind
// becomes an object the store rejects, so it cannot be recorded by default.
func dispatchInputObject(in *controlpb.ExecutionInput) core.Object {
	if in == nil || in.GetClone() == nil {
		return core.Object{"kind": "unsupported"}
	}
	clone := in.GetClone()
	return core.Object{"kind": "clone", "repositoryUrl": clone.GetRepository(), "branch": clone.GetBranch()}
}

func controlDispatchMessage(row core.Object) *controlpb.ControlDispatch {
	input := row.O("input")
	return &controlpb.ControlDispatch{
		ExecutionId:       row.S("executionId"),
		WorkspaceId:       row.S("workspaceId"),
		ControlEpoch:      row.N("controlEpoch"),
		RuntimeGeneration: row.N("runtimeGeneration"),
		Input: &controlpb.ExecutionInput{Spec: &controlpb.ExecutionInput_Clone{Clone: &controlpb.CloneSpec{
			Repository: input.S("repositoryUrl"),
			Branch:     input.S("branch"),
		}}},
	}
}
