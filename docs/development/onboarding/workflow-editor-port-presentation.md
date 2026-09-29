# 工作流编辑器 Cloud 移植工程 · 演示大纲

> 汇报对象：以项目交付/阶段性汇报为主的演示；中英术语保留原文。每节末尾的 【口播】 是给汇报人的提示，素材可直接搬进 PPT。

---

## 一、背景与目标

Cloud 左侧「工作」栏只有 **任务 / 项目**，缺「工作流」；Cloud 此前**没有工作流概念**——workflow 仅作为 @ 提及目标类型存在，只有两个写死在内存夹具里的示例。

**目标**：把 desktop 的完整工作流体验搬进 Cloud 浏览器端，真实后端持久化。

**四个已确认决策**：

| 决策点 | 选择 |
| --- | --- |
| 数据层 | 真实后端持久化（PostgreSQL + Go + 契约），非前端 mock |
| 与 @ 提及 | 打通——@ 列表读新表，夹具示例工作流退役 |
| 移植范围 | 完整移植（10 种节点 + 发布/导入导出/撤销重做/全局变量/结构化输出/Tiptap） |
| 运行查看器 | 一并移植（Overview 只读画布 + 只读检视） |
| i18n | 保留双语（引入 i18next） |

【口播】先讲「为什么做、做多大」，给听众量级认知再进细节。

---

## 二、工程规模与三项硬性适配

来源：desktop 约 **34,000 行**源文件 + 对应测试（workflow-editor ~15,000、workflow-run ~14,400、runtime ~4,400、mock ~2,600、契约 ~212）。

**不能直接复制粘贴**——cloud 门禁远比 desktop 严：lint 上限 800 行/文件、100 行/函数、复杂度 ≤15、JSX 深度 ≤8；全局测试覆盖率 ≥80%；jscpd 8 行/60 token 克隆即失败。desktop 单文件最大 2,853 行 → **每个大文件都必须按职责拆分**。

**三项硬性适配（不能绕）**：

1. **zustand 不引入** → 编辑器会话语态全用 React state + context（刻意移除过 zustand，历史锁文件损坏 3 次；服务端状态归 TanStack Query）
2. **UI 组件库换血** → `@ora/ui` + tabler 换成 cloud 的 shadcn + lucide（两套原语并存会被克隆检测与「跨模块只走 `@/`」规则同时踩中）
3. **文件拆分** → 2853 行的 workflow-editor.tsx、1475 行的 node-details 等按「一个模块一个变更理由」重划边界

【口播】解释「为什么不是秒级完成」——不是搬运，是重写。

---

## 三、路线图总览

| # | 阶段 | 交付物 |
| --- | --- | --- |
| 0 | 依赖与可行性验证 | @xyflow/react / i18next 等装齐，静态画布渲染 |
| 1 | 纯逻辑层移植 | 运行 types/definition/graph-codec/container-layout |
| 2 | 后端数据层 | 表 + CRUD + 路由 + 契约 + 集成测试 |
| 3 | 前端列表 + 导航 + i18n | api 层 / 列表页 / 侧边栏 / 路由 / i18next 双语 |
| 4 | 画布编辑器核心 | 3 种节点 + 防抖自动保存 + 检视栏 |
| 5 | @ 提及打通 | 真表目录 + 表单描述符，夹具退役 |
| 6 | 其余节点 + Iteration 区域 | 7 种节点面板 + 复合区域框架/拖拽/折叠 |
| 7 | 编辑器高级功能 | 发布/导入导出/撤销重做/全局变量/Start 变量/结构化输出/Tiptap |
| 8 | 运行查看器 | 后端 workflow_runs + 仿真执行器 + Overview + 只读检视 |

【口播】这张是「电梯图」，后面的节逐段展开。

---

## 四、阶段 0–2 · 地基（纯逻辑 + 后端数据层）

### 阶段 0–1 · 可行性验证与纯逻辑层

- 先验证 React Flow 与 Vite 8 + React 19 + Tailwind 4 兼容，避免后期返工
- `workflow-runtime` 全量落地：types / definition / graph-codec / container-layout / variable-value / node-catalog 等，12 个测试文件 117 条用例；零 UI 依赖，复用率最高
- 偏离点：节点面板是 6 种而非 10 种（desktop 本就只允许 6 种可拖拽）；目录标签存 i18n key 而非已解析文案

### 阶段 2 · 后端数据层

- 迁移 **0014_workflows** / **0015_workflow_snapshots** / **0016_workflow_runs**（一个迁移只承载一个变更理由）
- `core/workflow.go` / `workflow_run.go`：版本前置校验、软删、`updated_at=now()`、租户隔离
- 路由：5 条 workflow + 3 条 snapshot + 3 条 run；契约 + orval 生成客户端
- **关键修复**：`public.go` 的 case 顺序——workflow-runs 分支必须插在通用 `/runs` 之前，否则被打到 404
- 集成测试覆盖 创建/冲突/版本/软删/跨租户隔离/发布/回滚/run 生命周期

【口播】这两阶段是「干净的地基」——UI 未动之前先把语义层搬稳；数据层 = 表 + 路由 + 契约 + 集成四件套。

---

## 五、阶段 3–5 · 可用闭环（列表 / i18n / 画布 / @ 提及）

**阶段 3 · 前端清单与 i18n 骨架**：i18next（locale / resource-bundle / i18n-instance，合成即校验）+ 工作流列表页三态 + 详情只读预览 + 语言开关。

**阶段 4 · 画布编辑器核心**：Start / Agent / Output 三种可编排节点；防抖自动保存（clean/dirty/saving/error 状态机，卸载补写）；检视面板（双击重命名 / 字段编辑）；React state 会话、非 zustand。6 个测试文件 77 条用例。第一次「可交互」里程碑——能建、能编、刷新不丢。

**阶段 5 · @ 提及打通**：工作流目标与表单描述符从内存夹具换成**真表**；`WorkflowDirectory` / `WorkflowFormDescriptors` 落在 `internal/core`（与表同层）；**formRef = workflow id**——广告的 ref 与可解析行不可能漂移；Start 变量 → FormField 映射 **降级不排除**（file→text、file-list/json→textarea，8 种控件对 6 种）；Security Review / Release 两个写死工作流从 @ 列表消失，@ 列表 = 用户自建工作流。

【口播】阶段 4 是第一次可交互里程碑；阶段 5 是「数据层打通」的直接兑现，@ 提及是最直观的体感。

---

## 六、阶段 6–7 · 节点面板、Iteration 区域与高级功能

### 阶段 6 · 其余节点 + Iteration 复合区域

- **6a/6b**：7 种可配置节点拿到真编辑面板——condition（IF/ELIF、AND/OR、身份比较）、tool / junction / human / loop / subflow（策略下拉、参数行、审批说明）、iteration（迭代源 / 收集目标 / errorStrategy / 上限）。顺带修掉两个真 bug：trigger 显示原始 value 而非翻译、loop 初值 no-base-to-string
- **6c/6d**：Iteration 复合区域真正上线——框架渲染、区域内成员包含约束、区域边界边投影、入口接缝插成员、折叠/展开、手动缩放、删除级联确认。纯逻辑（投影/包含/布局）先行带测试，再上 React

### 阶段 7 · 高级功能七连

| 子项 | 要点 |
| --- | --- |
| 版本发布 | 快照冻结、发布不 bump、回滚是普通编辑 + 乐观守卫 409 |
| 导入导出 | `.reactflow.json` 便携文件、拖拽、导入即发布、超限/非法 JSON 分线报错 |
| 撤销重做 | 纯函数历史引擎、50 步上限、500ms 合并窗口、拖拽事务、Ctrl+Z/Y |
| 全局变量 | 系统变量只读、带点号声明才提交、类型校验 |
| Start 变量 | 8 种控件声明、初值/最大长度/选项校验、必填开关 |
| 结构化输出 | 可视化字段树 + JSON 双模式、嵌套 object/array[object] |
| Tiptap 提示词 | 真实 Markdown 表面、`{{#变量#}}` chip、`/` 插入菜单、字数/复制/展开 |

【口播】阶段 6 是「与 desktop 的视觉 parity」；阶段 7 工作量最重，按「一个子功能一个演示」讲。

---

## 七、阶段 8 · 运行查看器

- **诚实方案**：Cloud 无执行引擎 → 后端持久化 run 行 + **dev 仿真执行器**（文案带「模拟」标注，绝不声称真跑过）；需已发布快照（无快照 → `workflow_no_published_snapshot`，同 desktop 错误语义）
- **后端**：`workflow_runs` 表 + `WorkflowRunSimulator` 端口 + 创建/列表/详情端点
- **前端**：工具栏「运行/运行历史」入口、run 详情页（状态徽标 + Overview 只读画布 + 只读检视）
- Overview 卡片与编辑器卡片抽共享 `NodeIdentity`——两表面不漂移
- Theatre / HITL / focus 位移**明确不搬**（需要执行引擎，搬了是死代码）

【口播】演示重头戏——发布 → 点运行 → 看状态着色。

---

## 八、质量门禁、当前状态与后续方向

### 质量门禁与验证

- **前端** `npm run check` 全绿：format / lint（type-aware）/ typecheck（tsc -b）/ test / check:modules / check:docs / knip / jscpd / build
- **最终数字**：99 个测试文件 **805 条用例**全绿——覆盖率 Statements 88.9% / Branches 80.2% / Functions 86.7% / Lines 89.8%；jscpd **0 克隆**；check:modules 3 个模块通过
- **后端**：`go build` / `go vet` 干净；`go test` 仅剩一条 Windows 注定失败的 POSIX 权限断言
- **集成套件**：Docker PG（REQUIRE_POSTGRES=1）0 FAIL，含 workflow CRUD / snapshot / run 生命周期 / 跨租户隔离
- **测试基建**（同时喂 80% 覆盖率与 0 克隆）：`src/test/viewport.ts`（jsdom 布局桩）｜ `src/test/run-snapshot.ts`（快照 fixture）｜ `editor/node-identity.tsx`（双卡共用）
- 技术债清零示例：MSW LIFO（handler 后注册者胜出的 mock 契约）、oxlint type-aware 拦下 `Promise<T> | T` 冗余联合/窄化断言/UncheckedIndexedAccess、modern V8 `JSON.parse` 不再报 “at position N” → 导入对话框补兜底文案

### 当前状态

- **全部 9 个阶段完成**，无剩余主项；dev 端已就绪（迁移 0014/0015/0016 已应用、API :8080 已重启、路由已注册）
- 待人工确认（浏览器手测）：打开工作流 → 发布 → 工具栏「运行」可用 → run 详情 Overview 节点着色、只读检视出配置/输出 → 刷新不丢 → 另一租户拉 run 404
- 已知边界：`cmd/ora-web` demo 库无工作流行时 @ 列表只有 agent/team 夹具

### 后续可选方向（不紧急）

明确不搬：只读 Theatre、HITL/会话/断点重跑、overview focus 位移、loop round 投影——全部需要真实执行引擎。若未来引入引擎按需回搬；`WorkflowRunSimulator` 端口就是为真执行器预留的替换点。

【口播】收尾页——报数字之前先说明门禁是工程硬性要求，数字才有分量；诚实边界 + 让人可执行的下一步。