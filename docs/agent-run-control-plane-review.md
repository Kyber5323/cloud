# Agent 控制面范围核对（cloud#41）

本 PR 实现并修复 A 的执行、Thread、插件与运行 Workspace 控制接缝；**尚未完成完整 A，也不能单独关闭 cluster#5 或 #7**。成功 Revision 的对象读取、校验、登记与交付业务转换仍属于 M3，当前相关 ADR 为 proposed，cluster#5 明确要求批准后进入该里程碑。

依据：[specs#58](https://github.com/ora-space/specs/pull/58) 的 A–D 分工、[cluster#5](https://github.com/ora-space/cluster/issues/5) 的接缝和 M1–M4、[cluster#7](https://github.com/ora-space/cluster/issues/7) 的 Node/Controller 后续工作；决策与证据以 specs 仓库最新 main 为基线。

## A 的逐项范围

| 要求 | 当前行为 | 验收边界 |
|---|---|---|
| proto 与生成物 | 已合并 cloud#35；本 PR 实现映射，生成与兼容性检查通过 | 保留 v1 已发布方法和字段 |
| internal/controlgrpc、通用执行协调 | 插件、会话、交付的登记、恢复读取、接管、租约围栏 | 目标绑定运行 Workspace 当前 Node/sandbox；跨 clone/新执行表 ID 冲突拒绝 |
| Thread 接管、命令、上传授权 | 连续序号、批次原子、终态排序、持久命令和幂等投递；授权不持久化 | 业务投影由 B 的同事务钩子负责；Cloud 测试不能替代生产 Node ACK/日志验收 |
| ObjectStore 与 Revision | 服务端可配置 S3 私网/公网 endpoint、region、bucket、寻址模式、凭据文件与短期 PUT 授权 | **Partial**：缺对象下载、checksum/git bundle/JSONL 校验、revisions 登记。revision_delivered/unchanged 返回 revision_verification_required，不留下终态或 ACK 收据 |
| plugin 步骤与 Space Agent | clone 后固定插件输入，结果完整接管后开放准入；单项失败不阻止 ready；安装/移除只收 Node 证据 | M1 还需真实 Node 安装文件、Compose 挂载与运行时能力；模拟器不证明真实下载或落盘 |
| Go Controller + Node 模拟器 | 磁盘 echo 会话、追加消息、结束、命令去重与 Controller 重启恢复；每个 Step 处理运行消息避免 quiesce 饿死 | **Partial**：delivery 显式 upload_failed；真实 Agent 和 Revision 上传留待 M3/M4 |

## 与两个 issue 的关系

cluster#5 是四仓协作总验收，并非 A 单仓清单。M1 依赖 A/C/D，M2 的 IssueRun phase、Thread 记录/API/SSE 与 Git 身份由 B 补齐，真实 Controller/Node 的 relay 与日志由 C 验收，M3 的 Cloud verifier 仍缺，M4 的真实 Agent 由 D 完成。cluster#7 记录 Node/Controller 工作；本 PR 提供其 Cloud 接口、持久登记和许可，但不能证明 desktop/cluster 已满足真实端到端要求。

## 本轮审核修复

规范轴：业务钩子传入调用方 context/sql.Tx，收据、水位及业务写同提交；新增前向迁移而不改旧 SQL；S3 签名修正非 ASCII/百分号路径、虚拟主机 bucket 和 TTL；同步双语模块说明及 specs 证据。

需求轴：拒绝重复/不完整/错误种类的插件结果；Agent 行支持空 Space、固定 release 及目录消失后的移除；执行身份跨表唯一、目标 sandbox 校验、每运行一生一个会话；已结束执行拒绝新终态而允许旧事件重放；命令接受次序独立于同事务时间戳和随机 UUID；插件与运行执行获得有效 runtime permit；运行初始化后保留独立 maintenance binding，不占 Project operation。

运行 actor 取自同租户同 Issue 的 run.enqueued 用户证据并固定到 Workspace creator；缺失或歧义拒绝，不猜测 Issue 创建者。Project durable owner 继续满足历史复合外键；specs 中“owner 为触发用户”应按现有 creator/权限模型理解。

## A/B 接缝

core 包内的 enqueueExecutionWork/enqueueThreadCommand/createRunWorkspace/deleteRunWorkspace 使用调用方 transaction；对外 Store 方法仅是独立请求包装。B 实现五个命名钩子：runWorkspaceSettled、threadEventsTakenOver、sessionEnded、deliverySettled、runWorkspaceDeleted，使用传入事务写业务表。不得在钩子内再次调用开启事务的 Store 方法；不得做网络或文件操作。Nil 适配器为协作期间的 no-op，不能据此宣称 IssueRun 编排已实现。deliverySettled 目前只接 failed；成功必须等 M3 verified Revision 已登记。

## 验证与剩余证据

后端格式、lint、完整真实 PostgreSQL race 测试及命令构建；proto lint、breaking 和生成漂移检查。新增回归覆盖业务写/收据共同回滚、插件集合及版本、当前 sandbox、跨表身份、运行 permit 与权限撤销、同事务命令顺序、echo 重启/结束/删除调度，以及真实 0024→当前 schema 的重复升级。

specs 的 Covered/Partial 仅根据直接证据填写；尚未直接覆盖的非空插件 start 故障、快照后 Space 选择改变、带旧插件 effect 的升级、另四个 hook 的失败回滚及真实端到端恢复仍保留缺口。M3/M4 不计入本 PR 已完成范围。
