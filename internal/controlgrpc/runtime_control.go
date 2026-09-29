package controlgrpc

import (
	"context"

	"github.com/wanglongan587/cloud/internal/controlpb"
	"github.com/wanglongan587/cloud/internal/core"
)

type runtimeControlService struct {
	controlpb.UnimplementedRuntimeControlServiceServer
	store *core.Store
}

func (s *runtimeControlService) command(ctx context.Context, action, submission string, body core.Object) (core.Object, error) {
	out, err := s.store.Control(ctx, &core.ControlRequest{Action: action, SubmissionID: submission, Body: body, Service: principal(ctx)})
	if err != nil {
		return nil, toStatus(err)
	}
	return out, nil
}

func (s *runtimeControlService) ListBindings(ctx context.Context, r *controlpb.ListBindingsRequest) (*controlpb.ListBindingsResponse, error) {
	out, err := s.command(ctx, "runtime_pending", "", core.Object{"epoch": r.GetEpoch()})
	if err != nil {
		return nil, err
	}
	response := &controlpb.ListBindingsResponse{}
	rows, _ := out["bindings"].([]core.Object)
	for _, row := range rows {
		response.Bindings = append(response.Bindings, binding(row, r.GetEpoch()))
	}
	return response, nil
}

func (s *runtimeControlService) AcknowledgeBinding(ctx context.Context, r *controlpb.AcknowledgeBindingRequest) (*controlpb.AcknowledgeBindingResponse, error) {
	ids := make([]any, len(r.GetUnfinishedExecutionIds()))
	for i, id := range r.GetUnfinishedExecutionIds() {
		ids[i] = id
	}
	_, err := s.command(ctx, "runtime_ack", r.GetSubmissionId(), core.Object{"epoch": r.GetEpoch(), "workspaceId": r.GetWorkspaceId(), "nodeInstanceId": r.GetNodeInstanceId(), "controlEpoch": r.GetControlEpoch(), "controlVersion": r.GetControlVersion(), "inputClosed": r.GetInputClosed(), "unfinishedExecutionIds": ids})
	if err != nil {
		return nil, err
	}
	return &controlpb.AcknowledgeBindingResponse{}, nil
}

func (s *runtimeControlService) GetExecutionPermit(ctx context.Context, r *controlpb.GetExecutionPermitRequest) (*controlpb.GetExecutionPermitResponse, error) {
	out, err := s.command(ctx, "runtime_permit", "", core.Object{"epoch": r.GetEpoch(), "workspaceId": r.GetWorkspaceId(), "nodeInstanceId": r.GetNodeInstanceId(), "controlEpoch": r.GetControlEpoch(), "executionId": r.GetExecutionId()})
	if err != nil {
		return nil, err
	}
	return &controlpb.GetExecutionPermitResponse{Binding: binding(out, r.GetEpoch())}, nil
}

func binding(o core.Object, epoch int64) *controlpb.RuntimeBinding {
	return &controlpb.RuntimeBinding{TenantId: o.S("tenantId"), WorkspaceId: o.S("workspaceId"), SandboxId: o.S("sandboxId"), RuntimeGeneration: o.N("runtimeGeneration"), NodeId: o.S("nodeId"), NodeIncarnationId: o.S("nodeIncarnationId"), NodeInstanceId: o.S("nodeInstanceId"), ControllerEpoch: epoch, ControlEpoch: o.N("controlEpoch"), ControlVersion: o.N("controlVersion"), SessionId: o.S("sessionId"), ActorUserId: o.S("actorUserId"), OperationId: o.S("operationId"), NodeOperationId: o.S("nodeOperationId"), ExecutionId: o.S("executionId"), InputClosed: o.B("inputClosed"), IssuedAtMs: o.N("issuedAtMs"), ExpiresAtMs: o.N("expiresAtMs")}
}

func (s *runtimeControlService) GetEffectPermit(ctx context.Context, r *controlpb.GetEffectPermitRequest) (*controlpb.GetEffectPermitResponse, error) {
	out, err := s.store.Control(ctx, &core.ControlRequest{Action: "effect_permit", EffectID: r.GetEffectId(), Body: core.Object{"epoch": r.GetEpoch(), "forceStopId": r.GetForceStopId()}, Service: principal(ctx)})
	if err != nil {
		return nil, toStatus(err)
	}
	return &controlpb.GetEffectPermitResponse{Permit: &controlpb.RuntimeEffectPermit{TenantId: out.S("tenantId"), WorkspaceId: out.S("workspaceId"), SandboxId: out.S("sandboxId"), RuntimeGeneration: out.N("runtimeGeneration"), ControllerEpoch: out.N("controllerEpoch"), ControlEpoch: out.N("controlEpoch"), IssuedAtMs: out.N("issuedAtMs"), ExpiresAtMs: out.N("expiresAtMs")}}, nil
}

func (s *runtimeControlService) ListForceStops(ctx context.Context, r *controlpb.ListForceStopsRequest) (*controlpb.ListForceStopsResponse, error) {
	out, err := s.command(ctx, "force_pending", "", core.Object{"epoch": r.GetEpoch()})
	if err != nil {
		return nil, err
	}
	response := &controlpb.ListForceStopsResponse{}
	for _, plan := range rows(out["plans"]) {
		f := plan.O("forceStop")
		p := &controlpb.RuntimeForceStopPlan{Id: f.S("id"), Version: f.N("version"), WorkspaceId: f.S("workspaceId")}
		for _, e := range rows(plan["effects"]) {
			p.Effects = append(p.Effects, effect(e))
		}
		response.Plans = append(response.Plans, p)
	}
	return response, nil
}

func (s *runtimeControlService) ConfirmForceStop(ctx context.Context, r *controlpb.ConfirmForceStopRequest) (*controlpb.ConfirmForceStopResponse, error) {
	out, err := s.command(ctx, "force_confirm", r.GetSubmissionId(), core.Object{"epoch": r.GetEpoch(), "forceStopId": r.GetForceStopId(), "version": r.GetVersion(), "effectId": r.GetEffectId(), "terminated": r.GetTerminated(), "lateEnsureFenced": r.GetLateEnsureFenced()})
	if err != nil {
		return nil, err
	}
	return &controlpb.ConfirmForceStopResponse{Version: out.N("version"), Completed: out.S("state") == "succeeded"}, nil
}
