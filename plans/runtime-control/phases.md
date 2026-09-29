# 运行时控制：Cloud 阶段交接

过程文档。位置是 `plans/runtime-control/`。本主题合并前删除整个目录，不要把本文移进 `docs/`。约定见 [plans/README.md](../README.md)。

English: working note for an open PR, not a specification. Delete `plans/runtime-control/` before that work merges. If this file disagrees with an ADR, follow the ADR.

本文只服务 `ora-space/cloud` 里分会话实现的控制面。规格在 specs，不在这里重写。冲突时以 ADR 为准，其次才是本文；聊天记录不能覆盖这两处。六份 ADR 仍是 `approved`，新保障的直接证据仍是 `Missing`。某一阶段的 PostgreSQL 测试通过后，只能把 Cloud 自己证明的义务标成 `Partial`，不能把 ADR 标成 `implemented`。

本地 `specs/` 若还在不含这些文件的 `main` 上，用下面的提交链接阅读，不要在 specs 里改决策。规格提交是 [`0ece5ce`](https://github.com/ora-space/specs/commit/0ece5ce52b58ea575e81d40216c2f4526c6440d0)。

## 权威文档

从 [Cloud 决策目录](https://github.com/ora-space/specs/blob/0ece5ce52b58ea575e81d40216c2f4526c6440d0/decisions/cloud/README.md) 进入。各阶段只读该阶段列出的 ADR，加上 [核心用例索引](https://github.com/ora-space/specs/blob/0ece5ce52b58ea575e81d40216c2f4526c6440d0/test-cases/cloud/README.md) 里同名用例的验证义务。

| 阶段要读的 ADR | 核心用例 |
| --- | --- |
| [使用权限](https://github.com/ora-space/specs/blob/0ece5ce52b58ea575e81d40216c2f4526c6440d0/decisions/cloud/workspace/20260927-runtime-workspace-use-permissions.md) | [使用权限与历史创建者](https://github.com/ora-space/specs/blob/0ece5ce52b58ea575e81d40216c2f4526c6440d0/test-cases/cloud/workspace/runtime-workspace-use-permissions.md) |
| [独占准入](https://github.com/ora-space/specs/blob/0ece5ce52b58ea575e81d40216c2f4526c6440d0/decisions/cloud/execution-admission/20260927-exclusive-runtime-control.md) | [独占与安全交接](https://github.com/ora-space/specs/blob/0ece5ce52b58ea575e81d40216c2f4526c6440d0/test-cases/cloud/execution-admission/exclusive-runtime-control.md) |
| [普通停止与强停](https://github.com/ora-space/specs/blob/0ece5ce52b58ea575e81d40216c2f4526c6440d0/decisions/cloud/operation/20260927-safe-stop-and-administrative-force-stop.md) | [普通停止与强停](https://github.com/ora-space/specs/blob/0ece5ce52b58ea575e81d40216c2f4526c6440d0/test-cases/cloud/operation/safe-stop-and-administrative-force-stop.md) |
| [跨进程交付](https://github.com/ora-space/specs/blob/0ece5ce52b58ea575e81d40216c2f4526c6440d0/decisions/cloud/controller-integration/20260927-fenced-runtime-control-delivery.md) | [跨进程执行约束](https://github.com/ora-space/specs/blob/0ece5ce52b58ea575e81d40216c2f4526c6440d0/test-cases/cloud/controller-integration/fenced-runtime-control-delivery.md) |
| [插件维护](https://github.com/ora-space/specs/blob/0ece5ce52b58ea575e81d40216c2f4526c6440d0/decisions/cloud/plugin-marketplace/20260927-admin-selection-and-idle-maintenance.md) | [管理员选择与维护等待](https://github.com/ora-space/specs/blob/0ece5ce52b58ea575e81d40216c2f4526c6440d0/test-cases/cloud/plugin-marketplace/admin-selection-and-idle-maintenance.md) |
| [凭据连续性](https://github.com/ora-space/specs/blob/0ece5ce52b58ea575e81d40216c2f4526c6440d0/decisions/cloud/project/20260927-repository-credential-continuity.md) | [凭据连续性](https://github.com/ora-space/specs/blob/0ece5ce52b58ea575e81d40216c2f4526c6440d0/test-cases/cloud/project/repository-credential-continuity.md) |

改代码前再读 [architecture.md](../../docs/development/agent/architecture.md)、[database.md](../../docs/development/agent/database.md) 和 [adding-features.md](../../docs/development/agent/adding-features.md)，确认现有事务、迁移和契约写法。

## 不在这些阶段里

Controller、Node、Substrate、cluster Compose、手写前端界面、成员授权表、授予/撤销接口、实时共同编辑、创建者转让、人工作业队列、minicloud，以及已退役的 Controller 过渡 JSON 监听。文件、终端、Agent、真实插件安装和真实 Git 凭据解析在执行端接上之前保持不可用。证书、双向 TLS 和管理/工作负载操作系统隔离属于部署配套；配套未完成时，新控制能力保持关闭，不能用自报的 ControllerId 当成已认证。

## 当前阶段

六个实现阶段都已完成。没有进行中的阶段。下一提交只删除 `plans/runtime-control/`，不再改行为。

## 已落地

`0018_runtime_control.sql` 已追加在 `0017_tenant_membership_and_join.sql` 之后，`0019_runtime_use_actor.sql` 接在 `0018` 之后，`0020_plugin_maintenance_and_credentials.sql` 接在 `0019` 之后，`0021_runtime_control_dispatch.sql` 接在 `0020` 之后。`0001`–`0017` 的已发布 SQL 没有改。创建本文时 Cloud `main` 为 `3123e3e`。再加迁移从 `0022` 起追加。

第 1 阶段只落地了表、列、约束和迁移测试。第 2 阶段接上了使用权限。第 3 阶段接上了独占会话。第 4 阶段接上了独立强停意图。下一阶段不要退回这些事实：

- 普通启动、停止、重启和删除已经要求使用权限和调用者当前持有的会话。`administrative_stop` 仍是管理员的活动保护停止。独立强停可以登记，但没有执行端终止确认，不能把运行时标成已停止。
- 项目删除在改任何运行时之前检查全部运行时：别人的未关闭会话、活动票据或未结束写返回冲突，不部分删除，也不自动强停。未确认的强停同样挡住项目删除和数据删除。
- 插件安装、移除和版本变更只接受当前管理员。忙、被占用或已停止时保存期望并等待，不整单失败，也不为装插件启动沙盒。派发前取得系统维护独占。Cloud 的计划或 effect 成功不能把插件标成已安装或已移除。
- 凭据引用区分团队、个人和未知。成员停用冻结其个人和未知引用的新远程操作；团队引用不因 owner 外键被停。恢复成员不解除冻结。管理员验证意图在结果的版本和能力匹配前不切换绑定。`credential_refs` 的 owner 外键未改，没有密钥列。Cloud 不连接 Git 远端。
- `internal/controlgrpc/server.go` 仍用调用者自报的 `x-ora-controller-id` 作为旧租约和提交持有者。该自报身份不是服务认证。`RuntimeControlDeliveryService` 只接受协议代次 2；未认证或旧协议不能登记新的控制派发。双向 TLS 未接入，所以这条新能力在 gRPC 和 `/internal/v1/runtime-control/dispatches` 上保持关闭。
- 新派发在短事务中核验当前许可后，才把执行身份、固定输入和控制代次写入 `runtime_control_dispatches`。旧的领取、计划 effect 和 clone 登记不写这张表。Cloud 记下的派发不表示 Node 已经执行。
- 准入和执行票据仍不要求控制会话。没有活动执行票据不等于空闲，租约到期也不表示进程已停止。获取中、收尾中和待对账不能被读成空闲。

## 阶段

每阶段结束前用真实 PostgreSQL 验收本阶段，并在同一次变更里更新「当前阶段」和「已落地」。后一阶段依赖前一阶段的权威状态。

### 1. 迁移

状态：已完成。

迁移是 `internal/core/migrations/0018_runtime_control.sql`。目录说明已同步中英文 README。新库与从 `0017` 升级都跑过：`TestMigration0018FreshDatabaseConstrainsRuntimeControl`、`TestMigration0018UpgradeFrom0017BackfillsCreatorsWithoutGuessing`，并复跑 `TestMigrationFullSequenceFreshDB`、`TestMigrationUpstream0007UpgradePath`、`TestMigration0016RetiresStorageAndWorktreeStepsKeepingHistory`、`TestMigrateFromPreviousSpaceSchemaPreservesCompatibleTenant`、`TestMigrateRejectsIncompatiblePreviousSpaceNames`。

已落库的权威状态：

- `workspaces` 的创建者与 `owner_user_id` 分开。孤立运行时只从唯一对应的 `create_workspace` 回填，main 只从唯一对应的 `create_project` 回填；缺失、冲突或无法绑定的历史创建者保持未知。迁移之后新插入的运行时仍是未知，本阶段没有改创建接口。
- `runtime_control_sessions` 保证同一运行时至多一个未关闭会话，控制代次只增。`runtime_write_activities` 保证同一运行时至多一个未结束的冲突写活动。
- `runtime_force_stop_intents` 是独立强停意图。`operations.kind` 仍包含 `administrative_stop`，没有 `force_stop`。
- `plugin_maintenance_waits` 可以在不占用项目唯一 operation 的情况下等待。升级不会改已有插件实例状态，也不会生成等待行。
- `credential_refs` 增加 `scope_kind`、`authority_basis`、`availability`、`frozen_at`、`freeze_reason`。历史引用是未知且可用。owner 外键未改，没有密钥列。

本阶段不能宣称使用权限、独占获取、强停接口、插件调度或成员停用冻结已经生效。六份 ADR 仍是 `approved`，核心用例证据仍是 `Missing`。HTTP 与 gRPC 行为未改。

### 2. 使用权限

状态：已完成。

没有新的授权表。迁移是 `internal/core/migrations/0019_runtime_use_actor.sql`：执行票据的发起者不再必须等于 `owner_user_id`。创建项目或独立运行时时，创建者写成该次已验证请求者，并指向对应的创建 operation；项目 `owner_user_id` 不改。历史未知创建者仍只给当前管理员使用。

读取、列表、operation 查询和重试、`access` / `admissions` 按当前 PostgreSQL 成员身份计算。概况含名称、创建者、生命周期和准入；`requestedRef` 与 `baseCommitId` 只给创建者或当前管理员。`scope=own` 是调用者自己创建的运行时，默认 `scope=all` 是项目内全部运行时。无使用权限是 `403 runtime_use_forbidden`，有权限但已有活动执行票据是 `409 resource_in_use`。成员停用后下一次 HTTP 与准入拒绝；管理员降为成员后，下一次校验失去他人运行时的内容权限，自己创建的运行时还在。空间事件在每次投递前重查成员身份，载荷仍只是刷新提示。

跑过 `TestRuntimeContentAccessRequiresCreatorOrCurrentAdmin`，并复跑 `go test ./integration`。

本阶段不能宣称独占获取、强停、插件调度、凭据冻结或内部契约已经生效。启动、停止、重启和删除仍未接到使用权限。六份 ADR 仍是 `approved`。specs 未改，核心用例证据仍是 `Missing`。

### 3. 独占

状态：已完成。

没有新迁移，会话和写活动表仍是 `0018_runtime_control.sql`。实现在 `internal/core/runtime_control.go`。获取、续期、释放和只读控制状态使用数据库时钟：租约 60 秒，成功的续期重置为 60 秒，约定的客户端续期间隔是 20 秒。同一运行时至多一个未关闭会话，代次只增。重复幂等键返回原结果，不恢复或延长已经失效的租约。同一会话至多一个未结束的冲突写活动，第二个是 `409 resource_in_use`，不产生文件、Git 或进程副作用。

普通启动、停止、重启和删除要求创建者或当前管理员，以及该调用者当前持有且未过期的会话。重启仍是停止后的 `start`，没有单独路由。缺少会话是 `409 control_required`，他人持有是 `409 resource_in_use`，无使用权限仍是 `403 runtime_use_forbidden`。成员停用会在同一事务里撤回其操作会话。已确认没有活动票据或未结束写活动时，获取成为持有；仍有活动票据时保持获取中，确认后才持有，代次不变。获取中、收尾中、待对账不会被读成空闲。租约到期不修改运行时的 `observed_state`。

跑过 `TestRuntimeControlLeaseIsExclusiveAndDatabaseTimed`、`TestControlStatesStayDistinctFromIdle`、`TestOneConflictingWriteAndLifecycleUseTheHeldSession`，并复跑 `go test ./integration`。

本阶段不能宣称强停、插件调度、凭据冻结或内部契约已经生效。文件、终端、Agent 和执行端确认控制绑定仍未交付。`administrative_stop` 语义未改。准入仍不要求控制会话。六份 ADR 仍是 `approved`。specs 未改，核心用例证据仍是 `Missing`。

### 4. 强停

状态：已完成。

没有新迁移。意图和关联仍是 `0018_runtime_control.sql` 的 `runtime_force_stop_intents`、`runtime_force_stop_links`。入口是 `POST .../workspaces/:wid/force-stop`，实现在 `internal/core/force_stop.go`。只接受当前租户管理员、目标运行时版本、幂等键和非空原因。同一键和正文返回原来的意图；同键不同原因或目标是 `409 idempotency_conflict`。接受时关闭新准入、撤回普通控制会话，并记下该运行时的在途 operation、执行票据和 effect；不删除这些行，不改写创建者、actor 或结果，也不新建 operation。状态保持 `requested`，不把 `observed_state` 写成 stopped。完成前获取、重启和删除数据是 `409 termination_unconfirmed`。另一个运行时的在途创建可以继续；目标自己的在途 create 或插件安装不会被标成成功，迟到的 sandbox 或插件派发被拒绝。`administrative_stop` 仍要活动空闲证据，kind 不变。发起人被停用后意图还在，且不能再发新强停。

跑过 `TestForceStopIntentIsAdminScoped`、`TestForceStopBlocksHandoffRestartAndDelete`、`TestForceStopDuringInflightWorkStaysOnOneRuntime`、`TestForceStopDuringPluginInstallDoesNotFinishThePlugin`，并复跑 `TestHTTPProjectLifecycleAndDurableRecovery`、`TestRuntimeControlLeaseIsExclusiveAndDatabaseTimed`、`TestControlStatesStayDistinctFromIdle`、`TestOneConflictingWriteAndLifecycleUseTheHeldSession`、`TestPluginInstallAPI`。

本阶段不能宣称执行端已经终止、意图已经 `stopped`、插件调度或凭据冻结已经生效，也不能宣称内部契约已经认证控制代次。文件、终端、Agent 和 Substrate 确认仍未交付。六份 ADR 仍是 `approved`。specs 未改，核心用例证据仍是 `Missing`。

### 5. 插件与凭据

状态：已完成。

迁移是 `internal/core/migrations/0020_plugin_maintenance_and_credentials.sql`：同一请求的维护等待可以按运行时展开，并新增 `credential_verification_intents`。实现在 `internal/core/plugin_maintenance.go` 和 `internal/core/credential_continuity.go`。

安装、移除和版本变更只接受当前租户管理员。成员被拒绝时不产生期望、operation 或 effect。忙、被人类会话占用或已停止时保存期望并等待，不整单失败，也不为装插件自行启动沙盒。人类释放、运行时启动或控制器再次认领后，调度继续处理原来的等待。派发前取得系统维护独占；维护持有时用户获取返回占用。Cloud 记录的 effect 成功只把实例留在进行中，不把空间插件标成已安装或已移除。真实执行器未接线，等待停在待对账，不新建第二条安装。

凭据引用使用已有的团队、个人、未知和冻结列。成员停用冻结其个人和未知引用，团队引用保持可用。恢复成员关系不解除冻结。尚未派发的 clone 在派发前重新检查；已开始的执行按原范围收尾。本地停止和重新启动不因远程凭据冻结被阻断。管理员只能提交已配置的团队引用作为候选，声明读或写能力。Cloud 不接收密钥，也不连接 Git 远端。只验证读取不能切换成可推送。候选、项目版本或冻结状态不再匹配时不切换绑定，也不改写 owner、创建者或任务发起者。结果写回还没有接到旧的控制器协议上。

跑过 `TestPluginSelectionIsAdminOnlyAndDoesNotReportInstalled`、`TestPluginMaintenanceWaitsForHumanRelease`、`TestPluginWaitLeavesADeletedRuntime`、`TestMemberDepartureFreezesPersonalCredentialsAndRejoinDoesNot`、`TestInFlightCloneRechecksFrozenCredential`、`TestCredentialVerificationDoesNotSwitchUntilTheResultMatches`、`TestMigration0020FanoutWaitAndVerificationIntent`，并复跑插件安装、生命周期、effect、并发安装、`TestForceStopDuringPluginInstallDoesNotFinishThePlugin` 和 `TestMigration0018UpgradeFrom0017BackfillsCreatorsWithoutGuessing`。

本阶段不能宣称真实插件已经安装、Node 已按引用解析凭据、执行端会拒绝静态回退，或内部契约已经认证控制代次。文件、终端、Agent 和 Substrate 确认仍未交付。六份 ADR 仍是 `approved`。specs 未改，核心用例证据仍是 `Missing`。

### 6. 内部契约

状态：已完成。

迁移是 `internal/core/migrations/0021_runtime_control_dispatch.sql`。契约是 `proto/ora/cloud/internal/v1/runtime_control.proto` 的 `RuntimeControlDeliveryService.RecordControlDispatch`，旧 JSON 入口是 `POST /internal/v1/runtime-control/dispatches`，两者进入 `internal/core/fenced_dispatch.go`。OpenAPI 与 `frontend/src/api` 由生成器更新，没有手改生成文件，也没有手写界面。

协议代次必须是 2。自报的 `x-ora-controller-id` 和已验证的 controller 服务 JWT 都不会把 `DeliveryAuthenticated` 设为真，因此 gRPC 和旧 HTTP 入口现在都拒绝新派发，并且不插入行。测试里的已认证调用者会在同一短事务中核验持有中的会话、使用权限、运行代次、写活动互斥、未确认强停和凭据可用性，然后保存执行身份、固定输入和控制代次。同执行同输入返回原记录。获取中不会被当成持有。旧的 claim、plan 和 clone 登记不写这张表。成功的记录不改变 `observed_state`，也不向 Node 派发。

跑过 `TestFencedDispatchPersistsIdentityInputAndEpoch`、`TestFencedDispatchRejectsUnauthenticatedOldProtocolAndStalePermission`、`TestMigration0021DispatchTableStartsEmpty`、`TestFaultMapping` 和 `TestPublishedOpenAPIIsValidAndCurrent`。

本阶段不能宣称双向 TLS 已接入、Controller 或 Node 已在执行入口核验控制代次、真实插件已经安装、或文件、终端、Agent 和 Substrate 确认已经交付。六份 ADR 仍是 `approved`。specs 未改，核心用例证据仍是 `Missing`。

## 阶段结束时改本文

- 把该阶段改成已完成，写上迁移编号、关键文件、跑过的测试，以及仍不能宣称完成的边界。
- 「当前阶段」只保留下一个未开始阶段。
- 六个阶段都完成后，在收尾提交里删除整个 `plans/runtime-control/`。不要在 `docs/` 留摘要。需要保留的行为已经在代码、测试和迁移里。
- 证据状态若要改，在 specs 仓库单独提交，只动 Cloud 已经直接证明的核心用例，保持 ADR 为 `approved`。

## 新会话提示词

把 `N` 换成「当前阶段」里的编号。不要在提示词里重写规则。

```text
阅读 cloud/plans/runtime-control/phases.md。
只实现其中的第 N 阶段。规则以该文档指向的 ADR 为准。
开始前核对文档里的「已落地」和仓库现状。不要实现其他阶段，不要改 desktop、cluster 或 specs 的决策，不要把过程笔记写进 docs/。
结束时更新该文档的阶段状态、已落地事实和下一阶段，然后停住。
```
