package controlgrpc

import (
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/wanglongan587/cloud/internal/controlpb"
	"github.com/wanglongan587/cloud/internal/core"
)

// toStatus maps one Fault to the gRPC status the contract promises: the status code carries the
// primary classification and ErrorDetail refines it, both decided here so they never disagree.
// Database failures become UNAVAILABLE because nothing was committed and the same submission may
// be retried; their detail never reaches the caller.
func toStatus(err error) error {
	fault := core.ErrorCode(err)
	var code codes.Code
	var detail controlpb.ErrorCode
	switch {
	case fault.Code == "lease_held":
		code, detail = codes.FailedPrecondition, controlpb.ErrorCode_ERROR_CODE_LEASE_HELD
	case fault.Code == "stale_controller" || fault.Code == "stale_operation":
		code, detail = codes.FailedPrecondition, controlpb.ErrorCode_ERROR_CODE_STALE_CONTROLLER
	case fault.Status == 409:
		code, detail = codes.Aborted, controlpb.ErrorCode_ERROR_CODE_CONFLICT
	case fault.Status == 400:
		code, detail = codes.InvalidArgument, controlpb.ErrorCode_ERROR_CODE_INVALID_INPUT
	case fault.Status == 403:
		code, detail = codes.PermissionDenied, controlpb.ErrorCode_ERROR_CODE_SERVICE_FORBIDDEN
	case fault.Status == 404:
		code, detail = codes.NotFound, controlpb.ErrorCode_ERROR_CODE_NOT_FOUND
	default:
		code, detail = codes.Unavailable, controlpb.ErrorCode_ERROR_CODE_UNAVAILABLE
	}
	message := fault.Code
	if code == codes.Unavailable {
		message = "persistence unavailable"
	}
	withDetail, e := status.New(code, message).WithDetails(&controlpb.ErrorDetail{Code: detail})
	if e != nil {
		return status.Error(code, message)
	}
	return withDetail.Err()
}
