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

下一会话只做第 1 阶段。没有进行中的阶段。

## 已落地

无。创建本文时 Cloud `main` 为 `3123e3e`，最新已发布迁移是 `0017_tenant_membership_and_join.sql`。新迁移从 `0018` 起追加，不改已发布 SQL。

下列是当时的代码位置，供开工前核对，不是目标规则：

- `internal/core/store.go` 的 `workspace` 按活动租户成员放行。
- `internal/core/public.go` 的 `insertWorkspace` 把项目 `owner_user_id` 写入运行时；创建请求者在 operation 的 actor 上。
- `internal/core/node.go` 的 `access` 可以留下多张活动 `execution_tickets`。
- `internal/core/public.go` 的 `workspaceAction` 把带活动保护的停止记成 `administrative_stop`。
- `internal/core/plugins.go` 允许成员安装和移除；项目忙时整单冲突。
- `internal/core/migrations/0001_core.sql` 的 `credential_refs` 只有 owner 外键。
- `internal/controlgrpc/server.go` 使用调用者自报的 `x-ora-controller-id`。

## 阶段

每阶段结束前用真实 PostgreSQL 验收本阶段，并在同一次变更里更新「当前阶段」和「已落地」。后一阶段依赖前一阶段的权威状态。

### 1. 迁移

状态：未开始。

只增加表、列和约束，以及新库和从 `0017` 升级的测试。同步 [迁移目录说明](../../internal/core/migrations/README.md) 及其英文版。覆盖创建者回填、独占会话、写活动、强停意图、插件等待、凭据引用分类与冻结。创建者与 `owner_user_id` 分开；无法唯一证明的历史创建者保持未知。强停意图不改变 `administrative_stop`。历史凭据标为未知，不改 owner 外键，不存密钥。

必读：六份 ADR 里关于持久化、迁移和状态的段落，加上 [database.md](../../docs/development/agent/database.md)。不要接 HTTP 行为，不要改 desktop 或 cluster。

### 2. 使用权限

状态：未开始。

把概况与内容权限接到运行时读取、operation 查询、事件投递和 `access`。列表能区分调用者自己的运行时和管理员可见的全部运行时。无使用权限与被占用使用不同错误。成员停用或管理员降级后，下一次校验生效。不建授权表。

必读：使用权限 ADR 与其核心用例。

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
