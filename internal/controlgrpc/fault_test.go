package controlgrpc

import (
	"errors"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/wanglongan587/cloud/internal/controlpb"
	"github.com/wanglongan587/cloud/internal/core"
)

// The status code and the ErrorDetail are decided together; a caller may branch on either.
func TestFaultMapping(t *testing.T) {
	cases := []struct {
		name   string
		err    error
		code   codes.Code
		detail controlpb.ErrorCode
	}{
		{"lease held", &core.Fault{Code: "lease_held", Status: 409}, codes.FailedPrecondition, controlpb.ErrorCode_ERROR_CODE_LEASE_HELD},
		{"stale controller", &core.Fault{Code: "stale_controller", Status: 409}, codes.FailedPrecondition, controlpb.ErrorCode_ERROR_CODE_STALE_CONTROLLER},
		{"stale operation", &core.Fault{Code: "stale_operation", Status: 409}, codes.FailedPrecondition, controlpb.ErrorCode_ERROR_CODE_STALE_CONTROLLER},
		{"other conflict", &core.Fault{Code: "reconcile_required", Status: 409}, codes.Aborted, controlpb.ErrorCode_ERROR_CODE_CONFLICT},
		{"invalid input", &core.Fault{Code: "invalid_effect_state", Status: 400}, codes.InvalidArgument, controlpb.ErrorCode_ERROR_CODE_INVALID_INPUT},
		{"forbidden", &core.Fault{Code: "service_forbidden", Status: 403}, codes.PermissionDenied, controlpb.ErrorCode_ERROR_CODE_SERVICE_FORBIDDEN},
		{"missing", &core.Fault{Code: "not_found", Status: 404}, codes.NotFound, controlpb.ErrorCode_ERROR_CODE_NOT_FOUND},
		{"database", errors.New("connection reset"), codes.Unavailable, controlpb.ErrorCode_ERROR_CODE_UNAVAILABLE},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			st := status.Convert(toStatus(c.err))
			if st.Code() != c.code {
				t.Fatalf("%s: code %s, want %s", c.name, st.Code(), c.code)
			}
			if got := detailOf(st); got != c.detail {
				t.Fatalf("%s: detail %s, want %s", c.name, got, c.detail)
			}
			if c.code == codes.Unavailable && st.Message() != "persistence unavailable" {
				t.Fatalf("%s: database detail leaked: %q", c.name, st.Message())
			}
		})
	}
}

func detailOf(st *status.Status) controlpb.ErrorCode {
	for _, d := range st.Details() {
		if typed, ok := d.(*controlpb.ErrorDetail); ok {
			return typed.GetCode()
		}
	}
	return controlpb.ErrorCode_ERROR_CODE_UNSPECIFIED
}
