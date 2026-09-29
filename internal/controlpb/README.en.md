# internal/controlpb: generated code of the internal control contract

[中文](README.md) | [English](README.en.md)

`internal/controlpb` is the Go output generated from the `ora.cloud.internal.v1` contract under
[`proto/`](../../proto/README.en.md): message types plus server stubs and clients of
`ControllerLeaseService` / `ExecutionService` / `WorkspaceOperationService` / `NodeReportService` /
`AgentRunService` / `ControlSignalService` / `RuntimeControlDeliveryService`. Cloud is the server of these
services; the client types exist for in-process tests and doubles.

## Boundaries and invariants

- **Read-only**: everything here is generated; never edit by hand. Behavior changes only through editing
  `proto/` and regenerating.
- **No business semantics**: types map one-to-one to the contract; tenant, user and membership concepts do
  not appear here. Service implementations live in the packages that use them.
- **No drift**: `task proto:check` and CI regenerate with pinned plugins and compare; any difference from
  `proto/` fails.
