# 开发进度（新员工向）

> 本文是历史过程记录，不是产品契约。它留在 `docs/` 里是既有写法，新的 PR 协作笔记不要再加到这里，
> 放到仓库根目录的 [`plans/<主题>/`](../../../plans/README.md)，并在该项工作合并前删除。

一眼看清 Ora Cloud 目前**做到哪了、在进行什么、刻意没做什么**。更新于 **Wave 3B-2 Workflow
Interaction Shell 实现并验证 + User Registration 落地 + Project Workspace Sharing（Step 3）+
Workspace Member Management & Onboarding（Step 3A）**之后：`@` 协作链路
（Mention / Task / **Workflow Form Mode**）已端到端
打通——`@Workflow → FormDescriptor → 动态表单 → 可选 AI Assist → Review → Confirm → IssueRun → mock
执行 → Timeline`；**Project 已按 Workspace 共享**（同 Workspace 成员互见/互访共享项目，删除需
creator 或 owner/admin）；**Workspace foundation 已收口**（0-Workspace onboarding + 可选创建；成员
角色 owner-only、owner immutable；移除 owner-only 且仅移除成员资格）。契约与实现记录见
[12-collab §38 / §38.37](../../migrations/multica-issue-board/12-collaboration-architecture.md#38-wave-3b-2--workflow-interaction-design-frozen)，
下一步是 3C（Issue Detail & Collaboration UI）与 Issue Workspace Scoping。

> **2026-09-21 — Workspace Integration Stage A**：`origin/main`（含 `cmd/gateway`、`0005_gateway_auth`）已受控融合进
> `workspace合并`（main 只读、SHA 不变）；Issues 迁移前移重编号 **0005→0006 … 0009→0010** 以保持上游编号稳定；
> 前端认证/会话基座 = ora-web cookie 会话（决策 D-Auth=A）。记录见
> [workspace-integration-stage-a.md](../../migrations/workspace-integration-stage-a.md)。
>
> **2026-09-23 — 922GithubAuth ← main 会话架构合入**：feature 分支 `922GithubAuth` 合并 main 的
> **gateway-会话架构**（已合并提交 `9e887d4`，待人工测试验收）。前端会话/路由采用 main：`SessionProvider`/`useSession`/
> `RequireSession`、`/onboarding` + `/w/:workspaceSlug` 路由、onboarding 独立页（`useCreateTenant` /
> `useCreateSpace`）；删除 feature 的 zustand 商店（`auth-store`/`demo-auth-store`）；保留 Step 3A 能力
> （members owner-immutable UI、`canDeleteProject = creator OR owner/admin`、issues 接真实后端）。
> 开发拓扑 = **双入口**（ora-web :8080 DEV-only + gateway :8081 生产规范）；项目模型 = **混合/optional
> space**（`space_id` 可空，默认空间；reconciliation 后由 upstream `0007` + `0013_project_space_optional`
> 承载：`0007` 绑定既有项目，`0013` 恢复可空、不解绑）。注册 UI 移除（见
> [user-registration.md](../../migrations/user-registration.md) 合并注记）。
>
> **2026-09-21 — User Registration**：登录页「注册」入口落地 —— `POST /auth/register` 创建 User Identity
> （姓名 + 邮箱），邮箱 trim + lowercase 大小写不敏感唯一，重复 `409 user_already_exists`，注册成功直接进入
> 既有 current-user 流程；**AUTHENTICATION NOT FULLY IMPLEMENTED · PROJECT SHARING NOT
> IMPLEMENTED**。ADR：`specs/decisions/cloud/identity-access/0-user-registration.md`；记录见
> [user-registration.md](../../migrations/user-registration.md)。
>
> **2026-09-21 — Workspace Add Member**：Workspace 管理界面「添加成员」落地 —— owner/admin 用 email 把
> **已注册用户**添加为普通成员（`POST /spaces/:sid/members`），原子双写（同一事务 ensure 租户成员 +
> 空间成员），新成员固定 `member`、重复添加幂等返回 existing、未知邮箱 `404 user_not_registered`；
> 新成员 refresh/re-enter 后能在 selector 看到并切换该 Workspace，但 **Project 访问仍 owner-only**
> （当前实现，migration pending；旧 SD6「Workspace Membership ≠ Project Access」已被取代）。
> **PROJECT SHARING / EMAIL INVITATION NOT IMPLEMENTED**。ADR：
> `specs/decisions/cloud/collaboration-workspace/20260921-workspace-add-member.md`；记录见
> [workspace-membership.md](../../migrations/workspace-membership.md)。
>
> **2026-09-21 — Workspace Sharing Model（Step 2B）**：模型对齐（非资源迁移）—— **Workspace 冻结为
> 资源共享边界**（member 最终可访问 Workspace 共享资源：Projects/Issues/Agents/Teams/Workflows/MCPs/
> Skills），**禁止逐资源 membership**（`project_members` 等不设计）；统一删除规则
> `CanDeleteWorkspaceResource = creator OR owner/admin`；落地最小谓词 `IsWorkspaceMember` /
> `IsWorkspaceAdmin` / `CanDeleteWorkspaceResource`（无通用 RBAC engine）。旧 D1 owner-isolation
> **产品规则已取代**：owner-only Project 访问降级为**当前实现**，project workspace-sharing migration
> pending（下一步）。ADR：`specs/decisions/cloud/collaboration-workspace/20260921-workspace-sharing-model.md`；
> 记录见 [workspace-sharing-model.md](../../migrations/workspace-sharing-model.md)。
>
> **2026-09-21 — Project Workspace Sharing（Step 3）**：实施真正的项目共享迁移 —— `project()` /
> `workspace()` / 空间项目列表从 owner-only 切换为 **workspace-shared**（`CanAccessProject =
> space_id 归属 + Workspace 成员资格`；unscoped `space_id=NULL` 保持 owner-only）；运行时 Workspace
> 继承父 Project 访问；删除规则 `creator OR Workspace owner/admin` 接入真实资源（member 删他人 →
> `403 space_role_required`，非成员 → 404 隐藏）；tenant 级 `/projects` 列表保持 owner 过滤；
> **前端零改动**。Issue / Agent / Team / Workflow / MCP / Skill 作用域仍未实施。ADR：
> `specs/decisions/cloud/collaboration-workspace/20260921-project-workspace-sharing.md`；记录见
> [project-workspace-sharing.md](../../migrations/project-workspace-sharing.md)。
>
> **2026-09-22 — Workspace Member Management & Onboarding（Step 3A）**：Workspace foundation 收口 ——
> 注册用户 0 Workspace 是**合法状态**：前端 onboarding 空态（「创建工作区」复用 `POST /spaces`，creator
> 自动成为 owner，或「请工作区所有者通过邮箱添加你」），不再只是退出登录死胡同；成员角色管理 **owner-only**
> （`PUT /members/:uid` 收紧，admin↔member；**owner 角色 immutable** —— 任何所有权转移 →
> `409 ownership_transfer_not_supported`）；新增 **owner-only** `DELETE /members/:uid` 硬删成员（owner
> 行不可移除 → `409 cannot_remove_workspace_owner`；移除 = 仅移除工作区成员资格，账号/租户成员/资源保留，
> 访问自然撤销）；Project delete UI 对齐后端 `creator OR owner/admin`。**PROJECT WORKSPACE SHARING:
> UNCHANGED**；Issue / Agent / Team / Workflow / MCP / Skill 作用域仍未实施。ADR：
> `specs/decisions/cloud/collaboration-workspace/20260922-workspace-member-management.md`；记录见
> [workspace-member-management.md](../../migrations/workspace-member-management.md)。

图例：✅ 已完成 · 🚧 进行中 · 🧭 规划中（仅架构方案，未编码） · ⏸️ 刻意暂缓 · ❌ 未开始

## 平台核心

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 租户 / 用户 / 成员 | ✅ | 含角色（admin/member）、最后管理员保护 |
| 身份认证（双 JWT） | ✅ | service + user 两层凭证 |
| 项目（project） | ✅ | 绑定 Git 仓库，生命周期管理 |
| 工作区（workspace） | ✅ | main / isolated，Git worktree |
| 异步操作（operation） | ✅ | 持久化、可重试、分步推进 |
| 幂等 + 乐观并发 | ✅ | Idempotency-Key + version |
| 真实节点 / 沙箱 / 存储 | ⏸️ | 目前用内存模拟器（`internal/simulator`）；生产 Substrate 是后续阶段 |

## 身份与会话 — User Registration ✅ IMPLEMENTED

注册 = **创建 User Identity**（姓名 + 邮箱 → 会话 → 进入既有 current-user 流程），不是密码认证系统。
ADR：`specs/decisions/cloud/identity-access/0-user-registration.md`（SD1–SD5）；记录见
[user-registration.md](../../migrations/user-registration.md)。

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| `POST /auth/register`（ora-web 边界） | ✅ | `{name, email}` → 建 user + identity + 租户普通成员 → 设置 `ora_subject` cookie → 返回登录同构响应 |
| 邮箱规范化 / 大小写不敏感唯一 | ✅ | trim + lowercase；`Alice@Example.com` == `alice@example.com`；`user_identities(PK(source,subject))` 兜底 |
| 重复邮箱 | ✅ | 稳定 `409 user_already_exists`（精确 + 大小写变体），不静默复用 |
| 非法邮箱 / 空姓名 | ✅ | `400 invalid_email` / `400 name_required`（轻量门：非 @ 结构 / 空名） |
| 前端注册模式 | ✅/⚠️ | 原 Step 描述：既有 Login 页加「注册」切换，成功进 `/default/projects`。**合并 main 后已变**：前端 Login 页为 provider-button 形态（gateway 会话），**无 register 模式**；`POST /auth/register` 仅保留为 ora-web 开发边界 API（浏览器经 ora-web :8080 注册仍可用）；合并后注册成功经 `/onboarding` + `/w/:slug` 进入（见 [[user-registration]] 合并注记） |
| 测试 | ✅ | 后端集成 6 用例 + 前端 5 用例全通过；HTTP smoke 通过 |
| **AUTHENTICATION** | ❌ **NOT FULLY IMPLEMENTED** | `/auth/login` 仍是「任意 email 即登录」，无密码/凭据/OAuth/SSO |
| **PROJECT SHARING** | ❌ **NOT IMPLEMENTED** | 无项目分享 |

## Workspace Add Member — 用 email 添加已注册用户 ✅ IMPLEMENTED

owner/admin 在 Workspace 管理界面用 email 把**已注册用户**添加为普通成员；成员列表立即出现该用户，
该用户 refresh/re-enter 后能在 Workspace selector 看到并切换。**当前：Project 按 Workspace 共享**
（Step 3 已实施项目共享 —— 新成员可见/可切换 Workspace，并能访问该 Workspace 内的共享 Project 及其
运行时 Workspace；旧「Workspace Membership ≠ Project Access」产品语义已被
[workspace-sharing-model.md](../../migrations/workspace-sharing-model.md) 取代）。
ADR：`specs/decisions/cloud/collaboration-workspace/20260921-workspace-add-member.md`（SD1–SD6）；
记录见 [workspace-membership.md](../../migrations/workspace-membership.md)。

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| `POST /spaces/:sid/members`（email 添加） | ✅ | `{email}` → 严格 `users JOIN user_identities`（source=调用者身份源、subject=normalizeEmail）解析；未知/非 active → `404 user_not_registered`（不建号、不邀请、无 pending） |
| 原子双写 | ✅ | 同一事务先 ensure 租户成员（`ON CONFLICT DO NOTHING` 保留原角色）再建空间成员，无半状态 |
| 角色门 | ✅ | 业务级强制（后端检查，非仅隐藏按钮）：owner/admin 可添加；member → `403 space_role_required` |
| 新成员固定 `member` | ✅ | request 不接受 owner/admin；角色调整仍走既有 `PUT /members/:uid` |
| 重复添加幂等 | ✅ | 返回 existing membership（200，不改 role/status/version，count 仍 1） |
| Idempotency-Key | ✅ | POST 自动继承；前端 mutation 生成/复用 key 防重放 |
| 前端添加成员 Dialog | ✅ | 邮箱输入 + 本地校验（空/非法提示）+ 服务端 `user_not_registered` →「该邮箱尚未注册，请先完成注册。」；成功关 dialog + 列表刷新；触发器仅 owner/admin 可见 |
| Selector 反射新 Workspace | ✅ | refresh/re-enter = 新页面加载 → 内存缓存重取 `/spaces`，selector 出现并可切换；未重写 Current Workspace provider |
| **CURRENT PROJECT ACCESS** | ✅ **WORKSPACE MEMBERSHIP** | B 加入 W 后可访问 W 内共享 Project：`/spaces/:sid/projects` 含全部活跃项目、`/projects/:pid` 200、`/workspaces/:wid` 200；unscoped `space_id=NULL` 项目保持 owner-only（无 scope widening） |
| 测试 | ✅ | 后端集成 8 用例 + 前端 7 用例全通过；HTTP smoke 通过（A/B 双用户）；Step 2B 的两个 owner-only 回归已改写为 Step 3 共享断言（`TestScopedProjectSharedWithWorkspaceMembers` / `TestRuntimeWorkspaceInheritsProjectAccess`） |
| **PROJECT WORKSPACE SHARING** | ✅ **IMPLEMENTED** | 项目共享已实施（Step 3）：访问 = `space_id` 归属 + Workspace 成员资格；删除 = creator 或 owner/admin（member 删他人 `403 space_role_required`，非成员 404 隐藏）；无 `project_members` |
| **EMAIL INVITATION** | ❌ **NOT IMPLEMENTED** | 只接受已注册用户，无邀请邮件/pending/自动建号 |
| **WORKSPACE MEMBER AUTO-PROJECT ACCESS** | ✅ **IMPLEMENTED** | 空间成员身份派生共享 Project 的可见/访问/运行时继承（Step 3） |

## Workspace Resource Sharing Model — Workspace 资源共享边界 ✅ IMPLEMENTED（Step 2B 对齐）

**Workspace = resource sharing boundary**（资源共享模型对齐，非资源迁移）：Workspace 成员最终可访问
该 Workspace 内共享的资源（Projects / Issues / Agents / Teams / Workflows / MCPs / Skills）；
**禁止**逐资源 membership（`project_members` / `issue_members` / `agent_members` / `team_members`
不设计）。统一删除规则：**`CanDeleteWorkspaceResource = creator OR workspace owner/admin`**。旧 D1
owner-isolation 产品规则已**取代**（记录为历史，不删除）；owner-only Project 访问是**当前实现**，
migration pending。ADR：`specs/decisions/cloud/collaboration-workspace/20260921-workspace-sharing-model.md`
（SS1–SS5）；记录见 [workspace-sharing-model.md](../../migrations/workspace-sharing-model.md)。

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| `IsWorkspaceMember(uid, sid)` | ✅ | Store 方法 `(bool, error)`；活跃成员（复用 `spaceMember` join，非 panic） |
| `IsWorkspaceAdmin(uid, sid)` | ✅ | **owner OR admin** |
| `CanDeleteWorkspaceResource(uid, sid, creator)` | ✅ | `uid == creator` 或 owner/admin；普通 member 不能删他人，非成员无权限 |
| 事务内 `workspaceRole(t, sid, uid)` | ✅ | 非 panic 谓词，供未来 delete-authorization 在同一 `transact` 内复用 |
| 无通用 RBAC engine | ✅ | 只落地最小谓词 foundation，不建 RBAC 框架 |
| 测试 | ✅ | `integration/space_permission_test.go` 8+1 用例全通过（真实 PG） |
| **Workspace Membership** | ✅ **IMPLEMENTED** | Step 2 能力原样保留（添加/幂等/角色门/可见性） |
| **Project Workspace Scoping** | ✅ **IMPLEMENTED（Step 3）** | Project list/detail/runtime 访问已切换为 workspace-shared；删除 = creator 或 owner/admin；unscoped 保持 owner-only。见 [project-workspace-sharing.md](../../migrations/project-workspace-sharing.md) |
| **Issue Workspace Scoping** | ❌ **NOT IMPLEMENTED** | `issues.space_id` 未引入 |
| **Agent / Team / Workflow / MCP / Skill Workspace Scoping** | ❌ **NOT IMPLEMENTED** | 各资源仍无 Workspace 共享 |

## Workspace Member Management & Onboarding — Step 3A ✅ IMPLEMENTED

Workspace foundation 收口：**0-Workspace 是合法状态**（注册用户可选创建自己的 Workspace，或等待被添加）；
成员角色管理 **owner-only**（owner 角色经 member API **immutable**，禁止所有权转移）；移除成员
**owner-only 硬删**（仅移除工作区成员资格，不删账号/租户成员/资源，访问自然撤销）；Project delete UI
对齐后端 `creator OR owner/admin`。ADR：`specs/decisions/cloud/collaboration-workspace/20260922-workspace-member-management.md`
（MM1–MM9）；记录见 [workspace-member-management.md](../../migrations/workspace-member-management.md)。

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 0-Workspace onboarding | ✅ | 注册后无 W：前端空态「你还没有加入任何工作区」+「创建工作区」（复用 `POST /spaces`，creator 自动成为 owner）或「请工作区所有者通过邮箱添加你」；不 crash / 白屏 / redirect / fake workspace；新注册用户不自动加入 default space |
| 角色变更 = owner-only | ✅ | `PUT /members/:uid` actor 收紧为 owner；admin 保留 Add Member，不扩大为改角色/删成员 |
| owner 角色 immutable | ✅ | 任何所有权转移（member→owner、admin→owner、owner 自降）→ `409 ownership_transfer_not_supported`；last-owner 死分支删除 |
| Remove member | ✅ | 新增 `DELETE /members/:uid`（owner-only、Idempotency-Key + version、硬删）；owner 行不可移除 → `409 cannot_remove_workspace_owner`（含 owner 自移除） |
| 移除语义 = membership-only | ✅ | 只删 `collab_workspace_members` 行；用户账号、租户成员关系、`projects.owner_user_id`（creator 身份）与 W 内资源均保留；其余成员仍可访问 |
| 访问自然撤销 | ✅ | 移除后 `listSpaces`/`spaceMember`/`workspaceRole` 无活跃行 → W / P / Runtime 自动隐藏；被移除 creator 不能绕过成员资格（scoped 授权先满足活跃成员） |
| 能力矩阵 | ✅ | Owner {Add ✓, Change role ✓, Remove ✓}；Admin {Add ✓, Change role ✕, Remove ✕}；Member {全 ✕}；前端 UI 与后端独立强制一致 |
| Project delete UI 对齐 | ✅ | `canDeleteProject = owner/admin OR currentUser == project.ownerUserId`（member+creator 可见；后端 Project delete 授权 UNCHANGED） |
| 前端成员管理 UI | ✅ | 角色 Select 仅 owner 显示且无 owner 项；Remove AlertDialog（「从工作区移除「{name}」？」+ membership-only 文案）；owner 行只读 |
| 测试 | ✅ | 后端集成 8 用例（注册三态 / owner 增升降删 / 移除撤销+资源保留 / 授权矩阵 / owner 保护 / 跨 tenant 无泄漏）+ 3 个既有测试改写；前端 18/18（onboarding / members owner-only / project delete UI）；HTTP smoke 通过 |
| **PROJECT WORKSPACE SHARING** | ✅ **UNCHANGED** | 后端共享模型（Step 3）未动，仅前端删除按钮门对齐 |
| **ISSUE WORKSPACE SCOPING** | ❌ **NOT IMPLEMENTED — NEXT STEP** | `issues.space_id` 未引入 |
| **AGENT/TEAM/WORKFLOW/MCP/SKILL WORKSPACE SCOPING** | ❌ **NOT IMPLEMENTED** | 各资源仍无 Workspace 共享 |

## Issue 看板（迁移自 Multica）

### 第一波 — 核心看板 ✅

| 功能 | 状态 |
| --- | --- |
| 7 个标准看板列 | ✅ |
| 5 级优先级 | ✅ |
| 标题 / 描述 / 负责人 / 创建人 / 父子任务 | ✅ |
| 拖拽排序（分数 position） | ✅ |
| 增删改查 + 跨列移动 | ✅ |

### 第二波 — 看板周边 ✅

| 功能 | 状态 | 备注 |
| --- | --- | --- |
| 自定义状态列（状态目录） | ✅ | 惰性播种 7 列，可加列、归档 |
| 卡片编号 `#42` | ✅ | 每租户递增 |
| 自定义字段 `properties` | ✅ | 无模式 jsonb |
| 评论 | ✅ | 增删改查 |
| 标签 | ✅ | 含挂/摘、软删复用名 |
| 订阅/关注 | ✅ | 存关系，暂无通知 |
| 搜索 `?q=` | ✅ | 标题/描述子串匹配 |
| 批量操作 | ✅ | 一次改多卡状态/优先级/负责人 |
| 保存视图 | ✅ | 存 filter，暂未在服务端执行 |
| 分组视图 | ✅ | 按状态/优先级/负责人分桶 |

### 第三波 — Issue 协作地基

架构方案见 [12-collaboration-architecture.md](../../migrations/multica-issue-board/12-collaboration-architecture.md)
（rev. 2：Issues 只拥有 Issue 域，外部能力一律走稳定 port；**§37 是交互模型的权威定义**，§6.4 是
端口的权威清单）。已落地 **3A — issue-owned 地基**（migration `0008` + 持久化/API-contract 脊柱）与
**3B-0 — 协作架构对齐**（仅文档）、**3B-1 — 协作交互地基**（migration `0009`）与 **3B-2 — Workflow
Interaction Shell**（migration `0010`）；其余为 3C 待编码。
（注：workspace integration Stage A 将 Issues 迁移 0005→0006 … 0009→0010 重编号，见
[workspace-integration-stage-a.md](../../migrations/workspace-integration-stage-a.md)。）

#### 3A — issue-owned 地基 ✅ IMPLEMENTED / REVIEWED

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 多态 assignee（Assign ≠ Execute） | ✅ | `assignee_type ∈ user/agent/team` + `assignee_id`，`user` 镜像写 `assignee_user_id`；agent/team 为 opaque ref |
| 评论线程 + author ActorRef | ✅ | `parent_id`（同 issue 校验）+ 统一 `author_type/author_id`（user/agent/team/system）；无 per-actor 列 |
| IssueRun（Issue 拥有） | ✅ | `issue_runs`：`executor_type/executor_id` 多态（agent/team/workflow）+ opaque 外引用；≠ operation/execution_ticket |
| Run 状态机 | ✅ | 7 态；SQL WHERE 守卫（非中心校验器）；terminal ≠ deleted，无 delete-run API |
| Timeline（Projection） | ✅ / ⚠️ | **持久化已实现**：`issue_activities` + 评论共享 per-issue `seq`（Option-C `GREATEST(MAX,MAX)+1`），投影非事件源；**公开 timeline 读接口未实现**（无 `/timeline` 路由） |
| 评论作者 actor | ⚠️ schema-ready | `author_type` CHECK 允许 `user/agent/team/system`，但 API 只写 `user`（尚无 agent/system 评论写入路径） |
| Sub-Issue context | ✅ | `issue_context_refs`（引用而非复制，硬删） |
| 迁移 / API-contract 脊柱 | ✅ | `0008` + `PublicRequest`/`router`/`validField`/OpenAPI（`IssueRun`/`ContextRef` schema） |

#### 3B-0 — Collaboration Architecture Alignment ✅ DONE（仅文档，无代码）

把交互模型正式冻结进 [12-collab §37](../../migrations/multica-issue-board/12-collaboration-architecture.md#37-wave-3b-0--collaboration-interaction-model-frozen)，
端口清单统一到 §6.4。**未改 production code、未建 migration、未改前端。**

冻结的核心语义（实现时直接照抄，不要重新推导）：

- `@` = **Collaboration Target Selection**，本身不等于执行；markdown `@xxx` 只是展示格式。
- `user` → **Mention Mode**（**不产生 IssueRun**）· `agent`/`team` → **Task Mode**（需显式 task）·
  `workflow` → **Configure / Form Mode**（动态表单，绝不自动执行）。
- `Comment ≠ Interaction ≠ IssueRun`：1 条评论 → 0..N interaction → 0..N run；**禁止 `Comment.run_id`**。
- AI Assist：Suggest → Review → Apply → Confirm → Execute。
- Context：`IssueContextRef`（显式引用）≠ `ContextBuilder`（调用期构造）≠ `IssueRun.input`（执行期快照）。
- Timeline = Comment + IssueActivity 的高层投影，与 Execution Logs 严格分离。

#### 3B-1 — Collaboration Interaction Foundation ✅ IMPLEMENTED（migration `0009`）

第一条真实端到端 `@` 协作链路（**无真实 Agent/Team/Workflow/Runtime**）：`Collaboration Directory →
@ Picker → Human Mention / Agent Task / Team Task → Context → Mock Execution → IssueRun / Activity /
Reply Comment → Timeline`。语义照抄 [12-collab §37](../../migrations/multica-issue-board/12-collaboration-architecture.md#37-wave-3b-0--collaboration-interaction-model-frozen)。

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 端口接口（consuming-side seams） | ✅ | `CollaborationDirectory` / `ContextBuilder` / `ExecutionDispatcher` / `ExecutionObserver` 等 port 已落到 Go 接口；权威清单见 [12-collab §6.4](../../migrations/multica-issue-board/12-collaboration-architecture.md#64-canonical-port-inventory-unified-by-wave-3b-0) |
| CollaborationTargetRef / Directory / InteractionDescriptor | ✅ | `GET /collaboration/targets?q=` 只读投影（members + 目录 fixture，**不是** Agent/Team/Workflow domain API） |
| Human Mention Mode | ✅ | 持久化 typed target，**不产生 Run**、无假回复、不重解析 markdown；通知留给未来模块 |
| Agent / Team Task Mode | ✅ | 共享 `target + task + context`；task 必填（缺 → 400 `task_required`）；`body ≠ task`；**不假设** leader/member/delegation/fan-out |
| ContextBuilder（确定性实现） | ✅ | issue 标题/描述/近期评论（≤10）/显式 context refs/task；**无 AI** |
| ExecutionDispatcher + ExecutionObserver + mock 执行适配器 | ✅ | 内存 fixture（`FixtureCollaborationDirectory`/`DeterministicContextBuilder`/`MockExecutionDispatcher`）实现同一 port；仅 dev/demo 配置，**生产默认关闭**；**不建 `sim_*` 表、不建 mock domain 表** |
| IssueRun lifecycle + 固定回复 → IssueComment | ✅ | `queued → dispatched → running → completed(/failed)` 走真实 Issue API→IssueRun→Dispatcher→adapter→observer→Activity/Comment；agent/team 回复落 `author_type='agent'/'team'` 评论（内部路径，无公开冒充） |
| Timeline 读 API | ✅ | `GET /issues/:iid/timeline`（Comment + Activity 按共享 `seq` 合并） |
| Interaction spine 读 API | ✅ | `GET /issues/:iid/interactions`（`issue_interactions` 表，migration `0009`） |
| 前端 `@` Picker + Mention/Task Mode | ✅ | Composer → Target Picker → Interaction Mode；workflow 目标显示「本阶段不可用」 |

> **封板前复核（2026-09-20）**：后端 `go build` / 单元测试 / 契约测试（OpenAPI 逐字节）/ 真实 PostgreSQL
> 集成套件全绿；前端在仓库要求的 Node 24 下跑完 `typecheck` / `test`(76) / `build` / `check:modules` /
> `check:docs` / `check:dead` / `check:dup`，全部通过。`lint` 与 `format:check` 仍为红，但**全部来自
> 既有欠债**（16 个 prettier、9 个 oxlint，均在本次未触碰的文件里，已用 HEAD 版本比对确认），Wave 3B-1
> 自身新增违规为 0。

#### 3B-2 — Workflow Interaction Shell ✅ IMPLEMENTED + VERIFIED（migration `0010`）

Issues-facing 契约与实现记录见 [12-collab §38 / §38.37](../../migrations/multica-issue-board/12-collaboration-architecture.md#38-wave-3b-2--workflow-interaction-design-frozen)：
`@Workflow → FormDescriptor → 动态表单 → 可选 AI Assist → Review → Confirm → IssueRun → mock 执行 → Timeline`
已端到端打通。**Workflow 内部架构仍 UNKNOWN**（真实 provider BLOCKED ON EXTERNAL DESIGN）。

| 决策 | 结论 |
| --- | --- |
| `@Workflow` UX | select → `mode=form` → 载入 FormDescriptor → 动态表单 → 可选 AI Assist → **显式 Confirm** → IssueRun。`选择 ≠ 执行`、`AI Assist ≠ 执行` |
| FormDescriptor | Issues-facing **渲染描述符**（`formRef/title/description/fields[]`），**不是** Workflow canonical schema，不绑定 JSON Schema/DSL/protobuf 等任何技术；无 conditions/表达式/嵌套组（那些是 FUTURE/OPEN） |
| 字段类型（首版） | `text` / `textarea` / `number` / `boolean` / `select` / `multi_select`；`context_ref` 选择器延后 |
| Descriptor 加载 | `InteractionDescriptor.formRef` + 单独只读 `GET /collaboration/forms/{formRef}`（不内嵌进 picker 投影） |
| 版本 | 首版**不做** descriptor 版本；`formRef` 对 Issues 不透明，Confirm 时按**当前** descriptor 重新校验 |
| Interaction 状态 | **不新增 status 列**：`run_id IS NULL` = 未确认，`run_id != NULL` = 已确认（+ `issue_runs.status` 管执行） |
| 草稿持久化 | ✅ **仅前端**：选中 workflow 后表单是纯 draft，服务端零写入；只有「确认执行」才创建 comment + interaction + run |
| 每个目标独立提交 | ✅ 用户 / Agent / Team 各自有留言框 + 「提交」按钮，点了才落库；未提交的草稿不进入操作历史 |
| Confirm 语义 | 唯一执行边界；校验 → 构建 effective input → 建 Run。编辑/Assist/存草稿都不建 Run |
| 幂等 / 并发 | 需 `Idempotency-Key`；同 key 同请求重放、同 key 异请求 409；并发 Confirm 用 `UPDATE … WHERE run_id IS NULL` 的 CAS（0 行 → 409 `interaction_already_confirmed`），复用现有事务约定，**不加分布式锁** |
| AI Assist | `InputAssistProvider` 只返回 **field-level patch** + suggested refs；只建议，不建 Run/不改状态/不写通知/不建永久 `IssueContextRef` |
| 校验分层 | 前端仅 UX；**Issues API 权威重校验**（Confirm 时按当前 descriptor）；Workflow 域校验归未来 Workflow service |
| 表单值表示 | `{fieldKey: scalar | string[]}` 的普通对象；**禁止**把 workflow 字段做成 Issue 列 |
| Workflow 输出 | 落 **`IssueActivity`**（`actor_type='system'` + `details` 带 run/executor/message），**不给 ActorRef 加 `workflow`**；node/raw log 不进 Timeline |
| Dispatcher / Observer | **复用**，不建 `WorkflowDispatcher`；新增 `ObserveProgress` → `run.progress` activity |
| 前端结构 | `WorkflowInteractionComposer → DynamicFormRenderer → FormFieldRenderer / AssistSuggestions / ConfirmReview`；**禁止** `if workflow.id == ...` 硬编码表单 |
| 迁移 | 需要 **一个** additive `0010`：`issue_interactions.input jsonb NOT NULL DEFAULT '{}'`（generic，非 workflow 专用）；不改 0009 |
| API | ✅ 已实现：`GET /collaboration/forms/{formRef}`、`POST /issues/{iid}/collaboration/assist`（**无状态**，未确认前即可用）、`POST /issues/{iid}/interactions/{ixid}/confirm`；`409 workflow_not_available` 已 **SUPERSEDED** |
| fixture | ✅ `FixtureFormDescriptorProvider`、`MockInputAssistProvider`、`MockExecutionDispatcher`（workflow 分支）；仍 dev/demo only、生产默认关闭、无 mock domain 表 |
| Workflow 输出 | ✅ 落 `IssueActivity`（`actor_type='system'` + `details{runId,executorType,executorId,message}`）；`ObserveProgress` → `run.progress`；**ActorRef 未加 `workflow`** |
| 前端 | ✅ `WorkflowInteractionComposer` → `DynamicFormRenderer`/`FormFieldRenderer`/`AssistSuggestions`/`ConfirmReview`；picker 不再禁用 workflow 目标；已确认的 interaction 只显示状态、不再给第二次确认 |

> 本轮新增的**唯一** deviation：多了一个 `409 interaction_not_confirmable`（对非 form interaction 调用
> confirm/assist），以及 OpenAPI 为所有路由补上 503 声明（端口 Unavailable 时 `form_descriptor_unavailable`
> / `assist_unavailable`）。其余与冻结设计一致。

#### 3C — Issue Detail & Collaboration UI 🧭（待编码）

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| Issue Detail（协作产品面） | 🧭 | 左栏 Activity/Timeline + 右栏 Properties/Development/Execution（投影 + UI） |
| Timeline 分页/truncation、执行日志、PR、通知、实时 | 🧭⏸️ | 依赖 3B 端口 + 外部模块（logs/PR/通知/实时均非 issue-domain） |

#### 3B-3 / later — 真实 Agent / Team / Workflow 集成 — 🚫 BLOCKED ON EXTERNAL DESIGN

Issues **不定义** Agent / Team / Workflow 的**内部实现**（三者 internal design = **UNKNOWN**）。
真实 Agent/Team/Workflow 模块、Runtime/LLM、通知/实时/PR/日志的后端一律 **BLOCKED ON EXTERNAL
DESIGN** —— 只在未来这些模块落地时通过 3B-1 的同一 port 接入；Issues 只约束 consuming-side contract。

#### 尚未冻结（3B-0 明确留下的开放问题）

mention 候选来源 · Team 是否自持 executor · pending run 并发上限 · workflow **canonical** schema 归属 ·
AI Assist **由谁实现** · `ContextBundle` 生命周期 · `ConversationTarget` 作用域
—— 详见 [12-collab §37.17](../../migrations/multica-issue-board/12-collaboration-architecture.md#3717-open-questions-left-by-wave-3b-0)
与 [§38.34](../../migrations/multica-issue-board/12-collaboration-architecture.md#3834-open-questions-left-by-wave-3b-2)。

> `Interaction.task` 的落点**已解决**（3B-1 落在 `issue_interactions`；3B-2 为其加 generic `input` 列，§38.30）；
> workflow 的 **Issues-facing** 契约、AI Assist 的**权限边界**、Confirm 边界、草稿策略也已随 §38 冻结。

### 刻意暂缓（本期不做）

| 功能 | 状态 | 原因 |
| --- | --- | --- |
| 附件 / 文件上传 | ⏸️ | Cloud 无文件存储 |
| 卡片绑定 project | ⏸️ | Cloud 的 project 语义不同（开发环境，非轻量分组） |
| 关联 Pull Request | ⏸️ | 需接外部 Git 服务 |
| 实时推送（WebSocket） | ⏸️ | 无事件总线 |
| 机器人 / 小组负责人 / Workflow / Autopilot | 🧭⏸️ | agent/team 走 3B-1 的 port + fixture 适配器，workflow 走 3B-2 的 `FormDescriptorProvider`/`InputAssistProvider` + fixture（**真实模块与真实 AI 仍 BLOCKED ON EXTERNAL DESIGN**）；Autopilot 本体暂缓 |
| 富表格 / 图形视图 | ⏸️ | 分组视图已是一等端点，任意视图引擎未做 |

## Web 前端（正式）

正式前端在 [`frontend/`](../../frontend/README.md)（React 19 + TS + Vite + Tailwind 4 + TanStack
Query），从参考项目 `cloud前端/` 迁移而来，API 层由 orval 从 `api/openapi.json` 生成。合并 main 后
采用 **gateway-会话架构**：`SessionProvider`/`useSession`/`RequireSession` 管会话（`GET /api/v1/me`
探测 + 401 策略），路由为 `/onboarding` + `/w/:workspaceSlug/*`。**开发拓扑 = 双入口**：ora-web :8080
（DEV-only 本地演示边界：email login/register + 进程内 API 代理注入双 JWT + 托管构建后 SPA）与
gateway :8081（生产规范入口：provider 协议 `/auth/providers`、GitHub/dev login、PostgreSQL 会话，
vite 代理 `/auth,/api,/healthz` → :8081）。与 `cmd/demo-issue-board-web`（单文件看板演示，仅手工
验证接口）并存、互不替代。

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 看板（列 / 卡片 / 拖拽移动） | ✅ | 走真实 `/issues` + `/move`，分数 position |
| Issue 详情 | ✅ | 左 Activity/评论 + 右属性/执行占位 |
| 状态 / 优先级 / 负责人 / 描述 | ✅ | 真实接口；agent/team 负责人暂不可用 |
| 评论 / 标签 / 订阅 / 批量 / 视图 | ✅ | 对应第二波后端接口 |
| 评论线程回复 | ⚠️ | `CommentItem` 能渲染 `parentId` 缩进，但**输入框从不发 `parentId`**，UI 无法创建线程回复 |
| 搜索 | ⚠️ | `useIssues(tid, q?)` 支持 `q`，但**无调用方传参**、无搜索框 |
| `@` / target picker / Mention / Task / **Form Mode** | ✅ | Composer 内置 Target Picker（`GET /collaboration/targets`）：Mention 无 task、Agent/Team 需 task、Workflow 进入 `WorkflowInteractionComposer`（动态表单 + AI Assist + Review + Confirm）；评论携带 `targets[]` |
| IssueRun（运行） | ⚠️ 仅列表 | 详情页只渲染 runs 列表；「运行」按钮是 **disabled 占位**，`useCreateRun` 已定义但**前端无调用方**——即**没有**创建运行的入口 |
| ContextRef（上下文引用） | ✅ | 仅列表/增/删，不智能解析 |
| projectRef / agent / team / 执行 / 实时 / PR / 日志 | 🧭⏸️ | 后端无对应能力，前端给「暂不可用 / Coming later」占位 |
| 前端门禁（lint/typecheck/test/build） | ✅ | 需 Node >= 24；CI 与 `task frontend:check` 同门禁 |

## 已知限制

- 看板列表不分页（一次返回整个租户的所有卡片）。
- 搜索只是标题/描述的子串匹配，没有全文索引，也不搜标签/编号。
- 保存视图的 `filter` 只存不执行（由客户端解释）。
- 订阅只是存了关系，没有通知管线。
- 全局 advisory 锁是明确的吞吐上限。

## 里程碑时间线

| 时间 | 里程碑 |
| --- | --- |
| 阶段一 | Cloud 核心 + 模拟器（tenants/projects/workspaces/operations） |
| — | Issue 看板 第一波（核心看板，migration 0005） |
| 最近 | Issue 看板 第二波（周边功能，migration 0006）+ 文档体系 |
| — | Issue 协作地基 3A（issue-owned 地基，migration 0007） |
| 最近 | 正式前端迁移（`frontend/`，从 `cloud前端/` 迁入） |
| 最近 | **Wave 3B-0 协作架构对齐**（仅文档：交互模型冻结 + 端口清单统一） |
| 最近 | **Wave 3B-1 协作交互地基**（migration `0008`：`@` 协作端到端链路 + mock 执行） |
| 最近 | **Wave 3B-2 设计冻结**（仅文档：§38 Issues-facing 契约 + 规划 `0009`） |
| 最近 | **Wave 3B-2 Workflow Interaction Shell 实现**（migration `0009`：FormDescriptor + 动态表单 + AI Assist + Confirm → IssueRun + Timeline） |
| 最近 | **User Registration**（`POST /auth/register` 创建 User Identity + 会话） |
| 最近 | **Workspace Add Member**（email 添加已注册用户到协作空间；Project 访问 owner-only —— 当前实现） |
| 最近 | **Workspace Sharing Model（Step 2B 对齐）**（Workspace=资源共享边界；统一删除规则 creator OR owner/admin；最小谓词 foundation；旧 D1 产品规则 superseded） |
| 最近 | **Project Workspace Sharing（Step 3）**（项目访问切换为 workspace-shared：list/detail/runtime 继承；删除 = creator 或 owner/admin；unscoped 保持 owner-only；前端零改动） |
| 最近 | **Workspace Member Management & Onboarding（Step 3A）**（0-Workspace onboarding + 可选创建；成员角色 owner-only + owner immutable；移除 owner-only 硬删、membership-only；Project delete UI 对齐） |
| 最近 | **922GithubAuth ← main 会话架构合入**（`SessionProvider`/`useSession`/`/w/:slug` 路由 + `/onboarding`；删除 zustand 商店；保留 Step 3A 前端能力；双入口开发拓扑 ora-web + gateway；混合项目模型 optional space） |
| 下一步 | **3C**（Issue Detail & Collaboration UI）；**Issue Workspace Scoping**（`issues.space_id`）；Agent / Team / Workflow / MCP / Skill Workspace Scoping；生产 Substrate / 看板分页与全文搜索 / 实时推送；真实 Agent/Team/Workflow/AI provider（BLOCKED ON EXTERNAL DESIGN） |

> 想看每个功能对应的接口和表，去 [../agent/api-reference.md](../agent/api-reference.md) 和
> [../agent/database.md](../agent/database.md)。想看迁移的完整决策记录，去
> [../../migrations/multica-issue-board/](../../migrations/multica-issue-board/)。
