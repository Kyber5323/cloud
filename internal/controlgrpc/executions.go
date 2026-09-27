package controlgrpc

import (
	"context"
	"encoding/base64"
	"math"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/wanglongan587/cloud/internal/controlpb"
	"github.com/wanglongan587/cloud/internal/core"
)

// executionService is the execution registry of the clone loop. Each RPC is one clone_* control
// action; state-changing calls carry their submission identity so Cloud replays a recorded
// response instead of reapplying when the Controller retries after a lost reply.
type executionService struct {
	controlpb.UnimplementedExecutionServiceServer
	store *core.Store
}

func (s *executionService) ClaimWork(ctx context.Context, req *controlpb.ClaimWorkRequest) (*controlpb.ClaimWorkResponse, error) {
	out, e := s.control(ctx, "clone_claim", "", core.Object{"epoch": req.GetEpoch()})
	if e != nil {
		return nil, e
	}
	request := out.O("request")
	if len(request) == 0 {
		return &controlpb.ClaimWorkResponse{}, nil
	}
	return &controlpb.ClaimWorkResponse{Item: &controlpb.WorkItem{OperationId: request.S("id"), Input: input(core.Object{"repositoryUrl": request.S("repositoryUrl"), "branch": request.S("branch")})}}, nil
}

func (s *executionService) RecordDispatch(ctx context.Context, req *controlpb.RecordDispatchRequest) (*controlpb.RecordDispatchResponse, error) {
	in, e := inputObject(req.GetInput())
	if e != nil {
		return nil, e
	}
	body := core.Object{"epoch": req.GetEpoch(), "operationId": req.GetOperationId(), "executionId": req.GetExecutionId(), "nodeId": req.GetNodeId(), "input": in}
	out, e := s.control(ctx, "clone_dispatch", req.GetSubmissionId(), body)
	if e != nil {
		return nil, e
	}
	return &controlpb.RecordDispatchResponse{Record: record(out)}, nil
}

func (s *executionService) TakeOverNodeEvent(ctx context.Context, req *controlpb.TakeOverNodeEventRequest) (*controlpb.TakeOverNodeEventResponse, error) {
	res, e := resultObject(req.GetResult())
	if e != nil {
		return nil, e
	}
	sequence, ok := receiptSequence(req.GetSequence())
	if !ok || len(req.GetEvent()) == 0 {
		return nil, status.Error(codes.InvalidArgument, "invalid_receipt")
	}
	body := core.Object{"epoch": req.GetEpoch(), "operationId": req.GetOperationId(), "executionId": req.GetExecutionId(), "sequence": sequence, "result": res, "event": base64.StdEncoding.EncodeToString(req.GetEvent())}
	out, e := s.control(ctx, "clone_takeover", req.GetSubmissionId(), body)
	if e != nil {
		return nil, e
	}
	return &controlpb.TakeOverNodeEventResponse{Record: record(out)}, nil
}

func (s *executionService) RecordQueriedResult(ctx context.Context, req *controlpb.RecordQueriedResultRequest) (*controlpb.RecordQueriedResultResponse, error) {
	res, e := resultObject(req.GetResult())
	if e != nil {
		return nil, e
	}
	body := core.Object{"epoch": req.GetEpoch(), "operationId": req.GetOperationId(), "executionId": req.GetExecutionId(), "result": res}
	out, e := s.control(ctx, "clone_queried", req.GetSubmissionId(), body)
	if e != nil {
		return nil, e
	}
	return &controlpb.RecordQueriedResultResponse{Record: record(out)}, nil
}

func (s *executionService) GetDispatch(ctx context.Context, req *controlpb.GetDispatchRequest) (*controlpb.GetDispatchResponse, error) {
	out, e := s.control(ctx, "clone_get", "", core.Object{"executionId": req.GetExecutionId()})
	if e != nil {
		return nil, e
	}
	return &controlpb.GetDispatchResponse{Record: record(out)}, nil
}

func (s *executionService) ListPendingDispatches(ctx context.Context, req *controlpb.ListPendingDispatchesRequest) (*controlpb.ListPendingDispatchesResponse, error) {
	out, e := s.control(ctx, "clone_pending", "", core.Object{"nodeId": req.GetNodeId()})
	if e != nil {
		return nil, e
	}
	rows, _ := out["executions"].([]core.Object)
	records := make([]*controlpb.ExecutionRecord, 0, len(rows))
	for _, row := range rows {
		records = append(records, record(row))
	}
	return &controlpb.ListPendingDispatchesResponse{Records: records}, nil
}

// control runs one clone action for the verified principal and maps its Fault.
func (s *executionService) control(ctx context.Context, action, submission string, body core.Object) (core.Object, error) {
	out, e := s.store.Control(ctx, &core.ControlRequest{Action: action, SubmissionID: submission, Body: body, Service: principal(ctx)})
	if e != nil {
		return nil, toStatus(e)
	}
	return out, nil
}

// receiptSequence narrows the wire sequence to the bigint column; anything larger is not a Node
// sequence this contract can store and is rejected instead of wrapping.
func receiptSequence(sequence uint64) (int64, bool) {
	if sequence > math.MaxInt64 {
		return 0, false
	}
	return int64(sequence), true // #nosec G115 -- bounded above.
}

// The JSON shapes below are the durable form of the contract messages; they are what
// clone_executions.input / result hold and what conflicts are compared against.

func inputObject(in *controlpb.ExecutionInput) (core.Object, error) {
	clone := in.GetClone()
	if clone == nil || clone.GetRepository() == "" || clone.GetBranch() == "" {
		return nil, status.Error(codes.InvalidArgument, "invalid_dispatch")
	}
	return core.Object{"kind": "clone", "repositoryUrl": clone.GetRepository(), "branch": clone.GetBranch()}, nil
}

func input(o core.Object) *controlpb.ExecutionInput {
	return &controlpb.ExecutionInput{Spec: &controlpb.ExecutionInput_Clone{Clone: &controlpb.CloneSpec{Repository: o.S("repositoryUrl"), Branch: o.S("branch")}}}
}

func resultObject(res *controlpb.ExecutionResult) (core.Object, error) {
	node := res.GetNode()
	if node == nil || node.GetNodeId() == "" || node.GetNodeIncarnationId() == "" {
		return nil, status.Error(codes.InvalidArgument, "invalid_result")
	}
	out := core.Object{"node": core.Object{"nodeId": node.GetNodeId(), "nodeIncarnationId": node.GetNodeIncarnationId()}}
	switch outcome := res.GetOutcome().(type) {
	case *controlpb.ExecutionResult_CloneReady:
		out["outcome"], out["path"], out["commit"] = "clone_ready", outcome.CloneReady.GetPath(), outcome.CloneReady.GetCommit()
	case *controlpb.ExecutionResult_CloneFailed:
		out["outcome"], out["reason"] = "clone_failed", outcome.CloneFailed.GetReason().String()
		if outcome.CloneFailed.RetainedPath != nil {
			out["retainedPath"] = outcome.CloneFailed.GetRetainedPath()
		}
	default:
		return nil, status.Error(codes.InvalidArgument, "invalid_result")
	}
	return out, nil
}

func result(o core.Object) *controlpb.ExecutionResult {
	node := o.O("node")
	out := &controlpb.ExecutionResult{Node: &controlpb.NodeIdentity{NodeId: node.S("nodeId"), NodeIncarnationId: node.S("nodeIncarnationId")}}
	if o.S("outcome") == "clone_ready" {
		out.Outcome = &controlpb.ExecutionResult_CloneReady{CloneReady: &controlpb.CloneReady{Path: o.S("path"), Commit: o.S("commit")}}
		return out
	}
	failed := &controlpb.CloneFailed{Reason: controlpb.CloneFailureReason(controlpb.CloneFailureReason_value[o.S("reason")])}
	if retained, ok := o["retainedPath"].(string); ok {
		failed.RetainedPath = &retained
	}
	out.Outcome = &controlpb.ExecutionResult_CloneFailed{CloneFailed: failed}
	return out
}

func record(row core.Object) *controlpb.ExecutionRecord {
	out := &controlpb.ExecutionRecord{OperationId: row.S("operationId"), ExecutionId: row.S("executionId"), NodeId: row.S("nodeId"), Input: input(row.O("input"))}
	if res := row.O("result"); len(res) > 0 {
		out.Result = result(res)
	}
	return out
}
