package controlgrpc

import (
	"context"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/wanglongan587/cloud/internal/controlpb"
	"github.com/wanglongan587/cloud/internal/core"
)

// leaseService exposes the global coordination lease. Each RPC is the same Store.Control action the
// JSON internal API runs (lease_acquire / lease_renew / lease_release); the holder identity is the
// verified service subject, never a request field.
type leaseService struct {
	controlpb.UnimplementedControllerLeaseServiceServer
	store *core.Store
}

func (s *leaseService) AcquireLease(ctx context.Context, _ *controlpb.AcquireLeaseRequest) (*controlpb.AcquireLeaseResponse, error) {
	lease, e := s.control(ctx, "lease_acquire", core.Object{})
	if e != nil {
		return nil, e
	}
	return &controlpb.AcquireLeaseResponse{Lease: lease}, nil
}

func (s *leaseService) RenewLease(ctx context.Context, req *controlpb.RenewLeaseRequest) (*controlpb.RenewLeaseResponse, error) {
	lease, e := s.control(ctx, "lease_renew", core.Object{"epoch": req.GetEpoch()})
	if e != nil {
		return nil, e
	}
	return &controlpb.RenewLeaseResponse{Lease: lease}, nil
}

func (s *leaseService) ReleaseLease(ctx context.Context, req *controlpb.ReleaseLeaseRequest) (*controlpb.ReleaseLeaseResponse, error) {
	lease, e := s.control(ctx, "lease_release", core.Object{"epoch": req.GetEpoch()})
	if e != nil {
		return nil, e
	}
	return &controlpb.ReleaseLeaseResponse{Lease: lease}, nil
}

// control runs one lease action in the shared control transaction and projects the durable row.
func (s *leaseService) control(ctx context.Context, action string, body core.Object) (*controlpb.Lease, error) {
	row, e := s.store.Control(ctx, &core.ControlRequest{Action: action, Body: body, Service: principal(ctx)})
	if e != nil {
		return nil, toStatus(e)
	}
	return lease(row)
}

// lease projects the controller_leases row; expiry is the database clock's timestamptz.
func lease(row core.Object) (*controlpb.Lease, error) {
	expires, e := time.Parse(time.RFC3339Nano, row.S("expiresAt"))
	if e != nil {
		return nil, toStatus(e)
	}
	return &controlpb.Lease{HolderId: row.S("holderId"), Epoch: row.N("epoch"), ExpiresAt: timestamppb.New(expires)}, nil
}
