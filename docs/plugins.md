# 插件市场:cloud 权威状态与 catalog 快照

> 对应 `plan.md`(功能设计)与 desktop 仓的插件契约(orax.toml / 目录条目 / 命名空间)。cloud 是插件
> **选择状态**与**市场目录快照**的唯一权威;Node 执行平面只下载与运行 cloud 快照出来的内容,
> 从不自行同步市场。安装由 Node 执行,不再经过 Substrate 的 `plugin_ensure`。

## 数据归属

- `plugin_sources`(0015):部署全局的市场源。默认源保留 `official` 命名空间,与 desktop 身份模型一致;
  `synced_at`/`sync_error` 记录新鲜度与最近一次失败,`enabled` 为将来多源预留。
- `plugin_catalog_entries`(0015):同步产物,主键 `(source_namespace, identifier)`。**目录读取永远不出网**
  —— API 只读这张表,等价于 desktop 的 cache-only 语义。一次成功同步在单事务内 DELETE+INSERT 整源
  替换,读者看不到中间态;失败保留上一版快照。
- `space_plugins`(0015):工作区插件选择状态(cloud 权威,与技能、智能体同级)。canonical identity =
  `(source_namespace, identifier)` 显式列,满足 execution-contract 的"显式版本化契约"要求。
  `desired_*` 是用户意图(安装时固定版本,D2),`observed_*` 是 fan-out 聚合事实,乐观 `version` 防并发。
- `workspace_plugin_instances`(0015):fan-out 执行事实,每个 live 运行时 workspace 一行,复合外键继承
  `(workspace_id, tenant_id, owner_user_id)` 与 `(workspace_id, project_id)`,防止跨租户引用。

## 同步(`internal/pluginmarket` + `cmd/server` 接线)

- go-git 纯 Go 传输(D3 选 ①):首次 clone 到临时目录再原子 rename;之后 fetch + checkout +
  `pull --ff-only`(go-git 只支持 fast-forward merge,非 ff 即报错,与 desktop gitlancer 同语义)。
- 单飞准入:并发 `Sync` 直接返回 `ErrSyncInFlight`(不排队,desktop "turn away" 语义)。
- 扫描镜像 desktop 校验:清单 ≤ 1 MiB、resolver=1、8 种 kind、标识符 slug 语法、title/description/
  license 文本策略、sha256 64 位 hex、url(S3 对象键或 https)/targets(agent/hook 专属、canonical
  三元组白名单、去重)互斥、pack 无 release、`marketplace_visible=false` 跳过;损坏条目单独跳过,
  同 canonical id 按路径序首个胜出;README 截断存储、logo 变体(universal/light/dark)记录组合而非字节。
- `RunSyncLoop`:启动立即同步一次,此后每 `plugins.sync_interval`(默认 5m)一次;ctx 取消退出
  (进程 WaitGroup 等待);失败只写 `sync_error` 与结构化日志,下个 tick 重试。
- 目录替换提交后向所有活跃 SSE 订阅广播 `plugins.catalog_updated`(MVP 内存 hub 的 `PublishAll`,
  多实例换 broker,边界不变)。

## 公开 API(router 白名单 + contract 生成物)

| 路由 | 语义 |
|---|---|
| `GET …/spaces/:spaceId/plugins/catalog` | 全量目录 + `syncedAt` 新鲜度(v1 全量下发,过滤在前端) |
| `GET …/spaces/:spaceId/plugins` | 该 space 的选择状态(desired/observed 徽章数据) |
| `POST …/spaces/:spaceId/plugins` | `{identifier, pluginVersion?}`;缺省固定目录当前版本;幂等(重复安装不重复 fan-out);pack v1 禁装 |
| `DELETE …/spaces/:spaceId/plugins` | `{identifier, version}`;乐观版本 428/409;移除 fan-out |

均为公开路由:双 JWT + space 成员门控 + 严格解码(未知字段 400 `unknown_field`)。`version` 字段名留给
乐观并发,插件版本用 `pluginVersion` 字符串。安装/移除是成员级操作(与 space 内创建 project 门控一致)。

## 安装链路(R4:先持久化 plan,再外部副作用)

1. POST 事务:upsert `space_plugins`(desired=installed、版本固定)→ 对每个 live 运行时 workspace
   upsert 实例行(pending)并创建 `install_plugin` operation(workspace 绑定)→ 提交后广播
   `space.plugins_updated`。目标 project 有在途 operation 时整个安装 409 `operation_in_progress`
   (`one_project_operation` 兜底);同一 project 多 workspace 时每次安装只放行一个 operation,
   其余实例保持 pending,由下次安装收敛。
2. 进入 `plugin` 步骤时,Cloud 把期望集合快照进 operation 的 `request.plugins`。
   create/start 取当时 Space 里 `desired_state = installed` 的全部插件;install/remove 只含该插件。
   每项仍是目录快照里的自包含载荷(canonical id、版本、url、sha256 或 targets),Node 不自己查市场。
   集合为空则这一步直接结束。快照之后新装的插件不进入本次集合。
3. Controller 用 `RecordDispatch` 登记一次 `InstallPlugins` 或 `RemovePlugins`,目标必须是该 Workspace
   当前 generation 的 Node,输入必须等于快照。Node 在安装前校验 SHA-256。
4. 接管逐项结果: `installed.version` 必须等于计划版本,否则整份结果以 400 `invalid_plugin_evidence` 拒绝;
   `failed.reason` 是有界错误码,写入实例的 `install_error`。单项失败不阻止 Workspace 就绪。
   执行整体失败(`interrupted` 等)按 clone 步骤的方式延期,并用新的执行重试。
5. 全部插件都有结果后步骤推进,同事务重算 Space 聚合。`kind = agent` 的插件在聚合变为 `installed` 时
   创建或恢复 `space_agents` 行;选择被移除时该行变为 `retired`,不删除。某个 Workspace 安装失败不会让
   已有 Agent 从列表消失。

聚合规则(纯函数,单测覆盖):任一实例 failed → failed;否则任一非终态 → installing/removing;
全部终态或没有 live workspace → installed/removed。

## SSE 事件(只带失效信息,R5)

- `space.plugins_updated`(spaceId/version):选择状态或执行回写提交后广播。
- `plugins.catalog_updated`(无 space 上下文):同步提交后 `PublishAll` 到所有订阅者。

前端 `use-space-events.ts` 按类型失效对应查询;目录查询 staleTime 对齐 5 分钟同步节奏。

## v1 边界与后续 phase

- 新建或启动 Workspace 时,`plugin` 步骤补装当时 Space 里期望安装的插件。用户之后的安装仍只 fan-out
  到已有的用户 Workspace,不打到 IssueRun 的运行 Workspace。
- pack v1 禁装(目录可列出);激活/停止/配置/日志属于 Node 运行时平面,不在本期。
- `plugin_ensure` / `plugin_delete` 不再新计划。历史行保留。Cloud 测试里的模拟 Controller 登记并回写
  Node 执行结果;真实安装由 desktop Node 执行。
