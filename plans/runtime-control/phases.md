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

下一会话只做第 3 阶段。没有进行中的阶段。

## 已落地

`0018_runtime_control.sql` 已追加在 `0017_tenant_membership_and_join.sql` 之后，`0019_runtime_use_actor.sql` 接在 `0018` 之后。`0001`–`0017` 的已发布 SQL 没有改。创建本文时 Cloud `main` 为 `3123e3e`。再加迁移从 `0020` 起追加。

第 1 阶段只落地了表、列、约束和迁移测试。第 2 阶段接上了使用权限。下列行为仍然不是目标规则：

- `internal/core/public.go` 的 `workspaceAction` 仍按活动租户成员启动、停止、重启和删除，并把带活动保护的停止记成 `administrative_stop`。使用权限和当前会话还没接到这些动作上。
- `internal/core/plugins.go` 允许成员安装和移除；项目忙时整单冲突。
- `internal/core/migrations/0001_core.sql` 的 `credential_refs` 只有 owner 外键。冻结和新远程操作还没生效。
- `internal/controlgrpc/server.go` 使用调用者自报的 `x-ora-controller-id`。
- 没有 `runtime_control_sessions` 的获取、续期或释放。没有活动执行票据不等于空闲，也不表示进程已停止。

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

状态：未开始。

实现获取、续期、释放和只读控制状态。有效期 60 秒，续期间隔 20 秒，时间用数据库时钟。同一运行时至多一个有效操作会话，同一会话至多一个冲突写活动。普通启动、停止、重启、删除接到使用权限和当前会话。获取中、收尾中、待对账不能被读成空闲。到期不是进程已停止。

必读：独占准入 ADR 与其核心用例。

### 4. 强停

状态：未开始。

新增独立强停意图。保留 `administrative_stop` 的现有语义。强停只接受当前管理员、目标版本、幂等键和非空原因；可以在其他生命周期进行中登记，但只覆盖目标运行时，完成前不可接管、不可重启、不可删数据。项目删除检查全部运行时的占用和活动，不自动强停。

必读：普通停止与强停 ADR 与其核心用例。

### 5. 插件与凭据

状态：未开始。

插件安装、移除和版本变更仅当前管理员可写；忙或被占用时保存期望并等待，不整单失败。维护派发前取得系统维护独占。Cloud 里的计划成功不能标成插件已安装。凭据引用增加团队、个人、未知和冻结状态。成员停用时冻结其个人和未知引用的新远程操作，团队引用不因 owner 外键被误停。管理员验证意图在结果匹配前不切换绑定。Cloud 不接收密钥，也不连接 Git 远端。

必读：插件维护 ADR、凭据连续性 ADR，以及两份核心用例。

### 6. 内部契约

状态：未开始。

新派发在短事务中核验当前许可，并持久化执行身份、固定输入和控制代次。未认证或旧协议不能使用新控制能力。旧内部入口复用同一授权，或关闭。同步 proto、OpenAPI 和 `frontend/src/api` 生成物，不手改生成文件，不交付手写界面。

必读：跨进程交付 ADR 与其核心用例。Controller 和 Node 的执行点不在本阶段实现。

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
