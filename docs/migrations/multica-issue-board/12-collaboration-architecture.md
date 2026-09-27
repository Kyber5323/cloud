# Wave 3 — Issue Collaboration & Execution Foundation (architecture, rev. 2)

> Planning / implementation-prep document. **No code is written in this wave.** Rev. 2 revises the
> rev. 1 design around one structural principle:
>
> > **Issues owns Issue-domain state. Issues depends on external capabilities only through stable
> > contracts / ports.**
>
> Agent, Team, Workflow, Runtime/Execution, Notification, Realtime, Project Context, PR, and Logs are
> **not** issue-domain and are **not** owned by this module, even when their modules do not exist yet.
> Issue Detail is promoted from a demo nicety to the **core product surface** of Issue Collaboration.
>
> Audience: future agents implementing this wave, and reviewers checking that the design stays within
> Cloud's invariants. Doc-audience contract (unchanged):
> - **Migration docs** (this file + siblings) — *why* we migrate and *what* we decided.
> - **`docs/development/agent/`** — *how* agents should develop against the current code.
> - **`docs/development/onboarding/`** — *current* system state for new teammates.
>
> Source-truth rule: where a Multica detail below differs from its current source, the source wins and
> the difference is recorded here with its rationale — never a silent design change.

## 0. Current status (post-Wave 3B-1)

> Added after Wave 3A landed; updated after Wave 3B-1. Kept here so readers reconcile the frozen design
> with what actually happened. The sections below are the **frozen rev. 2 design** — see §36 for what
> diverged.

- **Wave 3A** (Step 2 — issue-owned foundation) is **IMPLEMENTED / REVIEWED** (migration `0007`).
- **Wave 3B-0 — Collaboration Architecture Alignment** is **DONE (docs only)**: the interaction model is
  frozen in **§37**, and the integration-port inventory is unified in **§6.4**. No code, no migration.
- **Wave 3B-1 — Collaboration Interaction Foundation** is **IMPLEMENTED** (migration `0008`): the
  consuming-side ports + in-memory fixtures + the first real end-to-end `@` Mention/Task/mock-execution/
  Timeline chain — no real Agent/Team/Workflow/Runtime.
- **Wave 3B-2 — Workflow Interaction Shell** (`FormDescriptor`, dynamic form, mock AI Assist) is
  **IMPLEMENTED + VERIFIED** (migration `0009`) — see **§38** (contract) and **§38.37** (what landed).
  `409 workflow_not_available` is **superseded**: a workflow target now records a `mode='form'`,
  `run_id=NULL` interaction, and only an explicit Confirm creates the run.
- **Wave 3C — Issue Detail & Collaboration UI** (Steps 5–9: projections + UI) is **PLANNED**; 3B-1
  delivered the first frontend slice (`@` picker, Mention Mode, Task Mode) — §37.14.
- **Real Agent/Team/Workflow integration is BLOCKED ON EXTERNAL DESIGN.** Issues does not define their
  internal design — Agent/Team/Workflow internal design = **UNKNOWN** — it only constrains the
  consuming-side contract (§6.2).
- **REVISION: the `0008` `sim_*` relational catalog is SUPERSEDED.** §9/§24 originally sketched a
  `0008_sim_collaboration_catalog.sql` with `sim_agents`/`sim_teams`/`sim_team_members` tables. That is
  no longer the plan: dev/demo fixtures are **in-memory adapters** implementing the same ports
  (`ExecutionDispatcher`, fake resolvers, …), not a new simulator relational schema. Issue core never
  gains `sim_*` tables; the run/assignee/timeline contract stays unchanged.

## Revision map (v1 § → v2 §)

| v1 § | v2 § | Topic | Change |
| --- | --- | --- | --- |
| 1 | 1 | Goal | Issue Detail + module boundaries added |
| 2 | 2 | Current Cloud state | minor |
| 3 | 3 | Multica behavior | minor |
| 4 | 4 | Gap | minor |
| 5 | 5 | Design principles | ports principle added |
| 6 | 8 | Actor model | split ActorRef vs CollaborationTargetRef |
| 7 | 9 | Agent model | refs only + temporary dev catalog |
| 8 | 9 | Team model | merged into §9 |
| 9 | 10 | Assignee | **Assign ≠ Execute** formalized |
| 10 | 11 | IssueRun | `executor_ref` polymorphic; opaque refs only |
| 11 | 12 | Run state machine | minor |
| 12 | 14 | Timeline | `seq` ordering **decided**; projection semantics |
| 13 | 16 | Mention | explicit resolved targets |
| 14 | 17 | Conversation continuation | ConversationTarget added |
| 15 | 21 | Project/Workspace context | Option D chosen |
| 16 | 22 | Simulator boundary | ExecutionDispatcher adapter seam |
| 17 | 24 | Database migrations | issue-owned vs sim catalog split |
| 18 | 25 | API changes | targets contract, no /workflows |
| 19 | 26 | Backward compatibility | minor |
| 20 | 27 | Tenant/security | resolver-based validation |
| 21 | 28 | Idempotency/version/soft-delete | minor |
| 22 | 29 | Testing | adapter/fake tests |
| 23 | 30 | Demo | Issue Detail |
| 24 | 31 | Documentation | minor |
| 25 | 32 | Deferred work | updated |
| 26 | 33 | Open questions | three resolved; remainder kept |
| 27 | 34 | Acceptance criteria | updated |
| 28 | 35 | Implementation order | 10-step port-first order |

New chapters in v2: §6 (Cross-Module Boundaries & Integration Ports), §7 (External capability states),
§13 (Issue Detail / Collaboration Surface), §15 (Timeline vs Execution Logs), §18 (Workflow Invocation
Model), §19 (Workflow Input Assistance), §20 (Sub-Issue Context Inheritance), §23 (PR / Logs boundary).

---

# Part I — Context & principles

## 1. Goal

Long-term: bring Multica's Issue **collaboration + execution** model into Ora Cloud so an issue is a
place where multiple actors collaborate and where work is **executed and observable** — with the
**Issues module owning only issue-domain state** and depending on everything else through ports.

This wave's target capabilities (planned, not built):

1. **Issue-owned domain** — Issue, IssueStatus, IssueComment, IssueRun, IssueActivity/Timeline
   projection, IssueContextRef, issue-level trigger provenance, and (later) IssueDependency /
   IssueAcceptanceCriteria / IssueReaction.
2. **Actor model** — `ActorRef` (user/agent/team/system) for authors/assignees/activity actors, and
   `CollaborationTargetRef` (user/agent/team/**workflow**) for mentions/conversation/invocation.
3. **Polymorphic issue assignee** — user/agent/team, with **Assign ≠ Execute**.
4. **Issue → multiple Runs** — `issue_runs` issue-owned; executor referenced, not embedded.
5. **Execution process viewing** — run state + progress surfaced on Issue Detail.
6. **Conversation continuation** — a stable `ConversationTarget` keeps follow-ups flowing to the
   current executor without re-@mentioning.
7. **Explicit `@targets`** — mentions are resolved targets, not regex-sole triggers.
8. **Workflow invocation** — workflow as a *capability* (not an actor) with schema-driven input
   assistance and user confirmation.
9. **Unified Timeline** — one ordered, stable stream of comments + activities; a **projection**,
   not an event source.
10. **Simulator adapters now** — every external port has an Unavailable/Simulator/Real triple; the
    fake executor holds the execution side without an LLM.

Explicitly out of this wave: real LLM/runtime, Autopilot, production WebSocket, multi-agent
orchestration, any `internal/core` refactor, DB-framework swap, and **permanent ownership of
agent/team/workflow/notification/PR/logs modules** (§32).

Measured endpoint of this wave: **an approved architecture + first coding batch scoped**, not code.

## 2. Current Cloud state

As of migration `0006`:

- **Identity/tenancy** (`0001_core.sql`): `tenants`, `users`, `user_identities`,
  `tenant_memberships(role admin/member)`. `identity()` auto-provisions users; `membership()` gates.
- **Issue board** (`0005`/`0006`): `issues.assignee_user_id uuid REFERENCES users(id)` (bare user FK),
  `parent_issue_id` self-ref `ON DELETE SET NULL`, `status`/`priority` text checks, `position`,
  per-tenant `number`, untyped `properties`; `issue_comments.author_user_id` composite-FK to
  `tenant_memberships`, **no `parent_id`**, **no agent author columns**; `issue_statuses`, `labels`,
  `issue_subscribers`, `issue_views`.
- **Execution primitives that stay distinct**: `operations` (infra/node lifecycle),
  `execution_tickets` (effect/ticket scoping), and this wave's new **`issue_runs`** (AI work
  lifecycle). They never share columns or a state machine.
- **Store invariants**: single `core.Store.Public` → `transact` under global advisory lock
  `pg_advisory_xact_lock(67420911)` → raw SQL; `core.Object`/`Fault`; `version(o,v)` 428/409;
  `Idempotency-Key` on POST/DELETE; soft delete via `deleted_at`.
- **Simulator** (`internal/simulator`): no DB handle; polls internal HTTP claim
  (`/internal/v1/operations/claim`), advances state externally — the model for every fake adapter.
- **No** agent/team/workflow/run/timeline/mention/notification/realtime concept exists.

## 3. Relevant Multica behavior

Synthesized from four source audits. Only what drives Cloud's design is kept.

- **Actors**: Agent = workspace-scoped, no `version`, `status` = runtime state, enable/disable =
  `archived_at` soft delete. Squad = roster + **`leader_id NOT NULL REFERENCES agent`**; only the
  leader is executable; human members read-only; no-executable-agent → fail closed.
- **Run unit = `agent_task_queue`**: one row = one run; `agent_id` FK → agent (executor is *always*
  an agent — squad via `squad_id`+`is_leader_task`); trigger = free pair `trigger_evidence_kind` +
  `trigger_evidence_ref_id` (no FK); status transitions via **SQL `WHERE` guards**; **no
  `deleted_at`**; retry/chain via `attempt`, `parent_task_id`, `retry_of_task_id`, etc.
- **Polymorphic assignee at issue level**: `assignee_type ∈ {member,agent,squad}` + `assignee_id`
  (no FK); `validateAssigneePair`; assign/status triggers a run.
- **Timeline = two tables merged at read**: `activity_log` (pre-aggregated append-only events,
  `action` free-string + `details` jsonb + `actor_type/actor_id`) + `comment` (mutable content).
  Merge sorted `(created_at, id)`; per-list hardcap 2000, truncate-oldest-not-newest,
  thread-completion, `X-Timeline-Truncated`.
- **Mentions not stored** — parsed from markdown `mention://type/id`; explicit `@agent/@squad`
  enqueue a run and return per-target `CommentTriggerOutcome{queued/coalesced/deferred/blocked}`.
- **Agent's reply = a `comment` row** with `author_type='agent'` (not a chat row). Continuation =
  routing, not storage.
- **Field semantics**: `last_activity_at` monotonic `GREATEST`; `stage` (sub-issue barrier groups,
  orthogonal to status); `origin_*` provenance; `properties` typed+catalogued vs `metadata`
  schema-less; reactions; dormant `context_refs`/`acceptance_criteria`/`dependencies`.

## 4. Gap

Multica capability vs Cloud state, classified (preserved backlog):

**Already migrated:** core board, status catalog, comments (human-only), labels, subscribers, number,
untyped `properties`, search, batch, views, groups.

**Partially migrated:** assignee (human-only single FK → must become polymorphic); comments
(human-only, no threads/mentions/reactions/agent authors).

**Next (this wave's foundation):** issue-owned domain (§6) + integration ports (§6.2) + Issue Detail
(§13) + polymorphic assignee + `issue_runs` + timeline + explicit `@targets` + conversation target +
workflow invocation contract + context refs + simulator adapters.

**Later (needs this foundation):** Autopilot triggers, squad-leader fan-out, rich reply authorization,
usage accounting, real runtime/execution module.

**Requires foundation not yet present:** notifications/inbox, realtime, full-text/typed query engine,
files.

**Integration-dependent (external services):** PR linking + auto-close, chat origins (slack/lark/…),
Git providers.

**Deferred:** real LLM, real agent runtime, complex orchestration, production WebSocket, core refactor,
DB-framework swap (§32).

## 5. Design principles

1. **Additive first** — new migrations, new core files, new routes; no `internal/core` refactor, no
   DB-framework replacement, no edit of applied migrations `0001–0006`.
2. **Follow Cloud's architecture** — route allowlist → `core.Store.Public` → raw SQL in one
   advisory-locked transaction; `core.Object`/`Fault`; `validField`; OpenAPI generator.
3. **Preserve Cloud's persistence invariants** — tenant scope, `version`, `Idempotency-Key`,
   `deleted_at` soft delete.
4. **Own the domain, not the world** — Issues persists only refs to external actors/executors; every
   external capability is reached through a stable **port** with an Unavailable/Simulator/Real
   state. An Agent is not a user; a Team is not a user; a **Workflow is not an actor**.
5. **IssueRun is not an Operation** — `issue_runs` has its own table, state machine, lifecycle; it
   never touches `operations`/`execution_tickets`.
6. **Multica Workspace ≠ Cloud Workspace** — Cloud `workspace` stays a dev-environment worktree;
   Issue is a tenant-level object with an *optional* `project_ref`; real execution context is carried
   by the run, not by the issue being workspace-bound.
7. **Assign ≠ Execute** — changing responsibility never silently starts work; execution is an
   explicit, observable act (§10).
8. **Simulator adapters now, real modules later** — fake adapters implement the same port contracts
   as future real modules, so swapping the sender changes nothing downstream (§22).
9. **Re-implement, don't copy** — record deliberate divergences here and in `08-differences.md`.

---

# Part II — Cross-module architecture

## 6. Cross-Module Boundaries & Integration Ports

### 6.1 Ownership split

**Issues module owns** (issue-domain state and behavior):

- Issue, IssueStatus (catalog), IssueComment, IssueRun
- IssueActivity / Timeline projection
- IssueContextRef (issue-scoped references, incl. sub-issue context inheritance)
- Issue Dependency, Issue Acceptance Criteria, Issue Reaction (deferred but issue-domain)
- Issue-related collaboration references (assignee refs, `@target` provenance)
- Issue-level invocation / trigger provenance (who/what triggered a run, recorded as evidence)

**Issues module does NOT own** — even when the module does not exist yet:

- Agent domain, Team domain, Workflow domain
- Agent runtime, Node / Sandbox, Model provider
- Notification delivery, WebSocket connection
- PR provider, Git provider
- Execution-logs storage implementation

These are reached only through ports. Issues never takes *de facto* ownership of them by default.

### 6.2 Integration ports (conceptual contracts)

Ports are **concepts this wave — no Go interfaces are required yet**, but the responsibility and
minimal contract are frozen so real modules can implement them later and fake adapters can stand in
now. Interfaces will be defined at the consuming boundary (AGENTS.md: "accept interfaces at the
consuming boundary") during implementation. A future package layout is sketched in §35.

---

**ActorResolver**

- Issues needs (per ref): existence, active?, display name, can execute?.
- Returns: `ActorRef → ActorSummary{displayName, active, executable?}`.
- Issues must NOT know: agent model, runtime, provider, MCP, skills, API keys, internal team
  orchestration.
- States:
  - `Unavailable` → capability_unavailable (resolve returns unavailable)
  - `Simulator` → FakeActorResolver over in-memory dev fixtures (§9; the `sim_*` catalog is superseded)
  - `Real` → Agent/Team modules' resolver

**CollaborationTargetResolver**

- Issues needs (per target): is this a valid `CollaborationTargetRef` for this actor/tenant, and is it
  invocable at all? Returns a per-target outcome (`queued`/`blocked`/…) rather than a boolean.
- Issues must NOT know: how a target would be executed, what its internal model is, whether a team has
  a leader.
- This port was referenced by §9/§16 from rev. 2 onward but was missing from this catalogue; it is
  listed here so the inventory is complete (§6.4).
- States: `Unavailable` → every non-`user` target resolves `blocked`; `Simulator` → fixture directory
  answers; `Real` → Agent/Team/Workflow modules' resolvers.

**CollaborationDirectory** *(added by Wave 3B-0)*

- Answers one question for the Issues UI: **which collaboration targets may I select right now?**
- Returns a uniform `CollaborationTargetSummary[]`: `{type ∈ user|agent|team|workflow, id, displayName,
  description?, interactionDescriptor}`.
- It is a **consuming-side projection**, not a domain API: it never exposes Agent/Team/Workflow
  internals and Issues never takes ownership of them (§37.11, §25).
- States: `Unavailable` → the picker offers only `user` targets; `Simulator` → fixture directory;
  `Real` → aggregates the real User/Agent/Team/Workflow modules' adapters.

**InteractionDescriptor** *(added by Wave 3B-0)*

- Answers: **once this target is selected, what interaction mode does the Issues UI enter, and what
  input does it need?**
- Minimal shape: `{mode ∈ mention|task|form, requiresTask, formRef?}` — deliberately *not* a capability
  DSL (§37.6).
- Sourced per target, carried on `CollaborationTargetSummary`; the Issues UI never hard-codes a mode
  per target type beyond the defaults in §37.2.
- States: `Unavailable` → defaults derived from `target.type`; `Simulator` → fixture descriptors;
  `Real` → the owning module's descriptor.

**ContextBuilder** *(added by Wave 3B-0)*

- Builds the **invocation-time** execution context from `Issue + task + selected ContextRefs + target
  capability` (§37.11).
- Deterministic first implementation: issue title, description, recent comments, explicit context refs,
  task. Later replacements (relevance selection, summarization, retrieval, token budgeting) are
  internal to the port and do not change Issues.
- Issues does **not** implement a real AI context engine.
- States: `Unavailable` → raw refs are passed through unresolved; `Simulator` → deterministic builder;
  `Real` → future context/AI module.

**ExecutionDispatcher**

- Issues sends: `StartExecution / CancelExecution / ContinueExecution`.
- Minimal input: `{tenantId, issueId, issueRunId, executorRef, executionContextRef, triggerRef}`.
- Returns: `{accepted, externalExecutionId}`.
- Execution system later reports via stable events/callbacks: `started, progress, waiting, message,
  completed, failed, cancelled`.
- IssueRun stays issue-owned. Runtime/process/node/sandbox are not issue-domain.
- States:
  - `Unavailable` → `capability_unavailable`
  - `Simulator` → deterministic fake execution (§22)
  - `Real` → actual runtime implementation

**ExecutionObserver** *(added by Wave 3B-0; the inbound half of the execution seam)*

- Owns the **inbound** direction that `ExecutionDispatcher` deliberately does not: mapping an external
  execution's high-level lifecycle back onto Issues —
  `started / progress / waiting / message / completed / failed / cancelled` → `issue_runs` state +
  Timeline activities (+ a reply `Comment` for `message`, §37.4).
- Split from `ExecutionDispatcher` so the outbound "hand this request over" contract stays one-way and
  testable, and so a future real runtime can implement observation without owning dispatch.
- Issues core never polls runtime internals; observation enters only through this port (§12).
- States: `Unavailable` → runs stay `queued` (the Wave 3A behaviour); `Simulator` → mock adapter drives
  a deterministic lifecycle; `Real` → execution module callbacks/events.

**WorkflowResolver**

- Issues needs: `WorkflowSummary{id,name,description,inputSchema}`, `validateInputs`,
  `invoke(workflowRef, input, issueRef, runRef)`.
- Issues does NOT own workflow definitions or their execution logic.
- States: `Unavailable` → capability_unavailable; `Simulator` → FakeWorkflowResolver with canned
  schemas; `Real` → Workflow module.
- **Not used by Issues in Wave 3B-2.** The Issues-facing descriptor projection is
  `FormDescriptorProvider` (§38.17) and the execution handoff is `ExecutionDispatcher` (§38.24);
  `WorkflowResolver` remains the future *domain* port for schema/validate/invoke.

**InputAssistProvider** *(added by Wave 3B-0)*

- Serves **AI Assist** on a Workflow form: given `current form values + issue context + selected
  context refs + workflow target/descriptor`, return `suggested values` and `suggested context refs`.
- It may **only suggest**. Applying suggestions is a user action; execution stays a separate, explicit
  confirm (§37.7).
- Which module eventually owns it (Workflow, an AI service, Runtime, or another) is deliberately left
  open — this is a future integration concern, not an Issues concern (§37.17 Q6).
- States: `Unavailable` → no assist affordance in the form; `Simulator` → deterministic mock
  suggestions; `Real` → whatever module is chosen later.

**NotificationSink**

- Issues only produces: `{recipientRef, eventType, resourceRef, payload}`.
- Delivery (in-app, desktop, email, Slack, Lark…) is the notification module's.
- States: `Unavailable` → no-op sink (accepts and drops, logs); `Simulator` → records to a table/
  response for demo; `Real` → notification module.

**RealtimePublisher**

- Issues only emits stable domain events: `issue.updated`, `issue.timeline.appended`,
  `issue.run.updated`.
- Issues must NOT know WebSocket connection/session details.
- States: `Unavailable` → no-op publisher (HTTP refetch remains the transport); `Simulator` → emits
  to a local channel (used by demo polling); `Real` → event bus / WS gateway.

**ProjectContextResolver**

- Issues only fetches by ref: `project`, `workspace`, `repository`, `branch`, `execution context`
  summaries. No coupling to Project/Workspace internal schema.
- States: `Unavailable` → returns null refs (Issue Detail "Development" panel shows placeholders);
  `Simulator` → FakeProjectContextResolver with canned summaries; `Real` → Project/Workspace module.

**PullRequestResolver**

- Issues only gets/links: PR summary, URL, state, provider reference. No GitHub SDK logic in Issues.
- States: `Unavailable` → no PR panel; `Simulator` → fake PR summaries; `Real` → PR integration module.

**ExecutionLogProvider**

- Issues needs: `{executionId → logAvailability, logLink/ref, summary}`. Full
  stdout/stderr/PTY/tool logs are owned by the execution module.
- States: `Unavailable` → "logs unavailable"; `Simulator` → fake log refs + short summaries;
  `Real` → execution/logs module.

### 6.3 External capability states (one uniform model)

Every external module is described by a capability state; **no `if runtimeExists…`** inside issue
business code:

```
Unavailable  →  contract exists, capability returns capability_unavailable (HTTP 503-style or a
                typed fault) — UI shows an explicit "unavailable" state.
Simulator    →  deterministic fake adapter implements the same port (fake actors/team/workflow/
                executor/project/PR/logs) for demo and tests.
Real         →  actual module implements the same port; Issues core, IssueRun, Timeline, and UI
                contract do not change.
```

Adapters are swapped at the wiring boundary (router/simulator construction), never in issue-domain
code.

### 6.4 Canonical port inventory (unified by Wave 3B-0)

This is the **single authoritative list** of integration ports. Other docs (`docs/development/agent/
architecture.md`, `docs/development/onboarding/progress.md`) must reference this table instead of
repeating their own list — the three lists had drifted (some omitted `PullRequestResolver`, others
added `ExecutionObserver`/`CapabilityDescriptor`, and `CollaborationTargetResolver` was missing from
this document's own catalogues).

| Port | Direction | Responsibility (one line) | Added by |
| --- | --- | --- | --- |
| `ActorResolver` | out | Resolve an author/assignee/activity `ActorRef` → `ActorSummary{displayName, active, executable?}`. | rev. 2 |
| `CollaborationTargetResolver` | out | Validate a `CollaborationTargetRef` for this tenant/actor → per-target outcome, never a raw boolean. | rev. 2 (§9/§16); catalogued in 3B-0 |
| `CollaborationDirectory` | out | List the targets the Issues UI may currently select → `CollaborationTargetSummary[]`. | 3B-0 |
| `FormDescriptorProvider` | out | Resolve the Issues-facing `FormDescriptor` for a `formRef` (rendering projection only — never a Workflow schema). **Implemented (3B-2).** | 3B-2 (§38.2/§38.17) |
| `InteractionDescriptor` | out | Tell the UI which mode a selected target enters (`mention`/`task`/`form`) and what input it needs. | 3B-0 |
| `ContextBuilder` | out | Build the invocation-time execution context from issue + task + selected context refs. | 3B-0 |
| `ExecutionDispatcher` | out | Hand a prepared execution request to an external executor → `{accepted, externalExecutionId}`. | rev. 2 |
| `ExecutionObserver` | in | Map external execution lifecycle/result/reply back onto run state + Timeline. | 3B-0 |
| `WorkflowResolver` | out | `WorkflowSummary` + `validateInputs` + `invoke`. **Future domain port — not used by Issues in 3B-2** (§38.24). | rev. 2 |
| `InputAssistProvider` | out | Suggest (never apply) form values / context refs for AI Assist. **Implemented (3B-2); a real provider stays BLOCKED ON EXTERNAL DESIGN.** | 3B-0 |
| `NotificationSink` | out | Accept `{recipientRef, eventType, resourceRef, payload}`; delivery is not Issues'. | rev. 2 |
| `RealtimePublisher` | out | Emit stable domain events; transport is not Issues'. | rev. 2 |
| `ProjectContextResolver` | out | Resolve `project`/`workspace`/`repository`/`branch`/execution-context summaries. | rev. 2 |
| `PullRequestResolver` | out | PR summary/URL/state/provider ref only. | rev. 2 |
| `ExecutionLogProvider` | out | `{executionId → logAvailability, logLink/ref, summary}`; raw logs are not Issues'. | rev. 2 |

**`CapabilityDescriptor`** appears only in `progress.md` (line 69) and **is not a port in this
design** — Workflow capability is expressed by `WorkflowSummary` + `InteractionDescriptor`. Treat the
`progress.md` mention as a stale synonym and remove it there.

Every port carries the same `Unavailable / Simulator / Real` triple (§6.3). **Status:** Wave 3B-1
landed the Go interfaces for `CollaborationDirectory`, `ContextBuilder`, `ExecutionDispatcher` and
`ExecutionObserver`; Wave 3B-2 added `FormDescriptorProvider` and `InputAssistProvider`
(`internal/core/collaboration.go`, §38.37). The remaining ports (`ActorResolver`,
`CollaborationTargetResolver`, `WorkflowResolver`, `NotificationSink`, `RealtimePublisher`,
`ProjectContextResolver`, `PullRequestResolver`, `ExecutionLogProvider`) are still concepts, not code.

## 7. External capability states

See §6.3 for the model and per-port tables. The rule is restated here as an architectural invariant:

> Issue core code never branches on "which backend exists". It calls a port. The port's adapter is
> chosen at wiring time (Unavailable / Simulator / Real). Everything issue-owned keeps a single code
> path.

## 8. Actor model: ActorRef vs CollaborationTargetRef

Two distinct reference types, **not** one:

```
ActorRef                    CollaborationTargetRef
- user                      - user
- agent                     - agent
- team                      - team
- system                    - workflow     ← a capability, NOT an actor
```

**ActorRef** — who authored / who is assigned / who is the activity actor:
- `author`, `assignee`, `issue_activities.actor`. `system` covers synthetic/system events.

**CollaborationTargetRef** — what a mention / conversation / invocation addresses:
- `@target`, conversation target, invocation target.
- **Workflow is not an ActorRef.** A workflow is an invocable capability with an input schema, not a
  personified collaborator; forcing it into the actor model would leak execution semantics into
  authorship/assignment. (Multica has no workflow-actor either — its actor types are
  member/agent/system; Cloud adds `team` to the actor side and workflow only to the target side.)

Storage: both are `type` + `id` pairs, validated through the relevant resolver. No FK (spans modules).

## 9. Agent / Team references — ownership boundary (dev fixtures supersede the sim catalog)

**Rev. 1 planned `agents` / `teams` / `team_members` as issue-owned tables. Rev. 2 does not.** The
issue schema stores **references only**:

```
issues.assignee_type/assignee_id     (ActorRef → user|agent|team)
issue_runs.executor_ref              (see §11)
comments.author_type/author_id       (ActorRef → user|agent|system; team authors rare, allowed)
comments.targets[].{type,id}         (CollaborationTargetRef)
```

Validation goes through `ActorResolver`/`CollaborationTargetResolver` — never direct `SELECT agents…`
in issue core.

**Temporary dev catalog** (for demo/test until real Agent/Team modules exist):

> **SUPERSEDED (post-Wave 3A).** The `sim_agents`/`sim_teams`/`sim_team_members` relational catalog and
> its `0008_sim_collaboration_catalog.sql` migration are **dropped from the plan** (see §0). Replacement:
> **in-memory dev fixtures** implementing the same ports — no new simulator relational schema, no `sim_*`
> tables in issue core.

- *(Superseded bullet, retained for history.)* Originally: a simulator-owned catalog `sim_agents`,
  `sim_teams`, `sim_team_members` in a migration `0008_sim_collaboration_catalog.sql`, read by
  `FakeActorResolver`/`FakeTeamResolver`; issue core never touches it.

**Replacement plan (recorded, not hypothetical):**

| Concern | Statement |
| --- | --- |
| Fixture ownership | The dev fixture set (in-memory `CollaborationDirectory`/`ExecutionDispatcher`/`ContextBuilder` adapters, §37.13) belongs to the simulator/dev adapter, not Issues. **No `sim_*` tables exist or will exist.** |
| Migration strategy | ~~Landed in its own migration `0008`~~ — **SUPERSEDED**: no `sim_*` migration; in-memory fixtures implement the same ports instead. |
| Replacement boundary | Real Agent/Team modules land; they own their tables; fake resolvers are swapped at wiring; no `sim_*` tables to drop. |
| What remains stable | Issue columns (`assignee_type/assignee_id`), `issue_runs.executor_ref`, Timeline, UI contract. |
| What is removed/reused | Fixture adapters replaced; port contracts reused verbatim by the real modules. |

## 10. Issue assignee & Assign ≠ Execute

**Today:** `issues.assignee_user_id uuid REFERENCES users(id)` (bare FK).

**Target (additive, backward compatible):**

```
assignee_type text NOT NULL DEFAULT 'user'  CHECK IN ('user','agent','team')
assignee_id   uuid                          (no FK; resolved by type via ActorResolver)
```

- Backfill `assignee_type='user', assignee_id=assignee_user_id`; keep `assignee_user_id` readable
  (mirror-written when type=user) for one or two releases, dropped later — not this wave.
- Validation: `user`→active user; `agent`→resolvable+active via ActorResolver; `team`→resolvable+
  executable leader. Cross-tenant/missing → typed 404, never a partial assignment.

**Assign ≠ Execute (formal semantics, replaces rev. 1's "deferred automatic run"):**

- `Assign Agent` only changes **responsibility**. It does **not** imply execution.
- Execution is triggered explicitly by: **manual run · `@agent`/`@team` · conversation continuation ·
  `@workflow` invocation · retry**.
- Future (explicitly two behaviors, designed but not this wave): `Assign` vs `Assign and Start` —
  a caller-chosen variant, never a silent default.

The `trigger_evidence` on a run records which of these caused it (assign can still be recorded as
*context*, but assigning alone enqueues nothing).

## 11. IssueRun model

`issue_runs` — issue-owned AI work-lifecycle unit (**not** `operations`, **not** `execution_tickets`).

**Executor — final decision: stable polymorphic `executor_ref`, not Multica's `agent_id`.**

Two candidates were compared:

| | A — Multica style (`agent_id`, `team_id` nullable, `workflow_invocation_id`) | B — **chosen**: `executor_type` + `executor_id` (one polymorphic pair) |
| --- | --- | --- |
| Future module ownership | couples IssueRun columns to external modules' shapes | external refs only, no coupling |
| Workflow support | awkward (a third nullable column) | `executor_type ∈ {agent, team, workflow}` natively |
| External adapters | per-type columns leak into issue domain | one pair, resolved via resolver/dispatcher |
| DB referential integrity | FKs to tables we don't own | none (external domain); app-layer validation |
| Migration simplicity | more columns/alterations later | one pair now |
| UI contract stability | shape changes when types grow | stable `{type,id}` forever |

Multica's agent-only executor is a consequence of Multica having only agents today; Cloud does not
mechanically copy it.

**Forbidden in `issue_runs`** — execution-system internals (unless genuinely opaque external refs):
`runtime_id`, `sandbox_id`, `node_id`, `model_id`, `provider_id`, `pty_session_id`. Only opaque
external refs are allowed: `externalExecutionId` (from ExecutionDispatcher), `executionContextRef`,
`workflowInvocationRef`.

**Columns:**

| Column | Notes |
| --- | --- |
| `tenant_id, id, version, created_at, updated_at, deleted_at` | Cloud conventions; see §28 for `deleted_at` semantics. |
| `issue_id uuid NOT NULL` | `REFERENCES issues ON DELETE CASCADE`. |
| `executor_type` / `executor_id` | `CHECK IN ('agent','team','workflow')`; no FK; resolved via ports. |
| `external_execution_id` / `execution_context_ref` / `workflow_invocation_ref` | Opaque external refs. |
| `trigger_evidence_kind` / `trigger_evidence_ref_id` | Free pair, no FK (assign/manual/mention/continuation/workflow/retry). |
| `status` | enum per §12, `CHECK` + `WHERE`-guarded. |
| `parent_run_id`, `retry_of_run_id`, `rerun_of_run_id`, `delegated_from_run_id`, `attempt`/`max_attempts` | run chains + retries. |
| `input jsonb`, `result jsonb`, `error text`, `failure_reason text`, `trigger_summary text` | payload + outcome. |
| `queued_at`, `dispatched_at`, `started_at`, `completed_at`, `fire_at`, `lease_expires_at` | lifecycle. |

**Divergences vs Multica (recorded):** executor polymorphic (B); `deleted_at` present but
`terminal status ≠ deleted` (§28); no `waiting_local_directory` state (§12); run rows kept forever
as history.

## 12. Run state machine

States: `queued, dispatched, running, completed, failed, cancelled, deferred`.
(`waiting_local_directory` — a Multica artifact with no Cloud equivalent — is **omitted**.)

- Non-terminal: `queued, dispatched, running, deferred`. Terminal: `completed, failed, cancelled`.
- Transitions are **SQL `WHERE status=…` guards**, not a central validator:

```
queued     → dispatched  (claim:   WHERE status='queued')
dispatched → running     (start:   WHERE status='dispatched')
running    → completed   (complete:WHERE status='running')
running    → failed      (fail:    WHERE status='running')
queued/dispatched → cancelled (WHERE status IN ('queued','dispatched'))
deferred   → queued      (promote: WHERE status='deferred' AND fire_at <= now())
```

- `deferred` = future `fire_at` (scheduled). Pending dedup: at most one `queued|dispatched` per
  `(issue_id, executor_ref)`.
- Execution-state feedback (`started/progress/message/completed/…`) enters via the
  **ExecutionDispatcher** port's event/callback contract and is projected into the run + Timeline;
  Issue core never polls runtime internals.

---

# Part IV — Collaboration surface

## 13. Issue Detail / Collaboration Surface

**Issue Detail is the core product surface of Issue Collaboration** — the page a user lands on when
clicking an issue from the board. It is a first-class target of the API projections and the demo, not
a demo sidebar.

Target layout (v1 UI target):

```
┌──────────────────────────────────────────────────┐
│ Issue title / identifier / status                │
├──────────────────────────────┬───────────────────┤
│                              │ Properties        │
│ Activity / Conversation      │   Status          │
│                              │   Assignee        │
│ Human messages               │   Project         │
│ Agent messages               │   Created / Updated│
│ Team responses               │   Last Activity   │
│ Workflow invocation          │                   │
│ Run progress                 │ Development       │
│ System events                │   Repo/Workspace  │
│                              │   Branch / PRs    │
├──────────────────────────────┤   Latest Commit   │
│ message / @target input      │ Execution         │
│ (Continue with: …)           │   Current Run     │
│                              │   Runs · Logs     │
├──────────────────────────────┤                   │
│ + Create Subtask             │   + context refs  │
└──────────────────────────────┴───────────────────┘
```

**Left — Activity (product name) / Timeline (internal model):** ordered stream of human comment,
agent message, team response, workflow invocation, run started/progress/completed/failed,
assignment changed, status changed, PR linked, child issue created, system activity (§14).

**Right — Properties:** Status, Priority, Assignee, Project, Parent Issue, Created At, Updated At,
Last Activity (all issue-owned today except Project, which is a `project_ref` via
ProjectContextResolver).

**Right — Development (future):** Repository, Workspace, Branch, Pull Requests, Latest Commit — all
via ProjectContextResolver / PullRequestResolver; show explicit "unavailable" when the capability is
Unavailable (§6.2).

**Right — Execution:** Current Executor, Current Run, Run Count, Execution Context, Execution Logs
via ExecutionLogProvider (§15). `issue_runs` is issue-owned; logs are not.

**Bottom input:** message + explicit `@target` + current `ConversationTarget` indicator
("Continue with: BackendAgent") + Workflow → "Configure Workflow" input mode (§17, §18).

## 14. Timeline model (projection + ordering — decided)

**Two-table read-merge, as v1** (`issue_activities` pre-aggregated append-only events + `issue_comments`
mutable content) — with ordering **decided, not open**:

- **Per-issue `seq` shared by both tables.** Add `seq bigint` to `issue_comments` **and**
  `issue_activities`, both `UNIQUE(issue_id, seq)`. A single per-issue counter allocates the next
  value inside the advisory-locked transaction (`COALESCE(MAX(seq),0)+1` — the same race-free pattern
  as issue `number`).
- **Timeline ordering = `ORDER BY seq`.** `created_at` is display-only. Random UUIDs do **not**
  participate in ordering. No UUID-v2 migration, no tenant-global sequence.
- Comment list ordering becomes `seq` too (identical to creation order under the lock — a pure
  improvement over today's `created_at, id`).
- Hardcap per list (e.g. 2000 + 2000), probe at cap+1, **truncate-oldest-not-newest**,
  thread-completion (no orphan replies), `X-Timeline-Truncated` marker.

**Projection, not event source:**

- `Issue`, `Comment`, `IssueRun` … remain **authoritative state**.
- `issue_activities` is an **append-only projection / audit surface**; no business state is ever
  rebuilt by replaying the timeline.
- Recovery for a failed activity write (projection lag) is **Deferred** (§32): the semantic is that
  a missed activity may never be retroactively inserted into the user-visible `seq` order; a
  reconciler (if added later) must not reorder existing `seq` values.

## 15. Timeline vs Execution Logs (strictly separate)

```
Timeline        = human-readable issue activity   (issue-owned projection)
Execution Logs  = low-level execution/debug data  (execution module owns storage)
```

- Timeline may show: "Started execution", "Reading repository", "Tests failed", "Agent responded",
  "Run completed" — coarse, human-readable entries.
- Execution Logs may contain: PTY, stdout, stderr, tool calls, command logs, runtime diagnostics —
  low-level, owned by the execution module.
- Issue Detail's Execution panel offers **"View execution logs"** which goes through
  **ExecutionLogProvider** (`{executionId → logAvailability, logLink/ref, summary}`). Issues never
  stores or renders full logs.

## 16. Mention model (explicit resolved targets)

Rev. 1 (and Multica) used **markdown-regex-as-protocol**. Rev. 2 makes the contract **explicit
resolved targets**:

```json
POST /issues/:iid/comments
{
  "body": "@SecurityAgent review this",
  "targets": [
    { "type": "agent",   "id": "..." },
    { "type": "workflow","id": "..." }
  ]
}
```

- `body` is for display; **`targets` carry the business semantics**.
- The server **validates each target** via CollaborationTargetResolver (exists, active,
  invocable-for-this-actor); invalid/unresolvable targets → per-target `blocked` outcome.
- The markdown `mention://type/id` link remains only a **UI serialization compatibility** format —
  rendering, not trigger authority.
- Rationale for explicit-over-parse: regex-sole triggers make invocation depend on string matching
  (fragile, spoofable in body text, untyped); resolved targets give a typed, validated, replayable
  contract and align with `CollaborationTargetRef` (§8) and trigger provenance (§16 end).
- Each comment's response returns `triggerOutcomes: [{targetType, targetId, status ∈
  queued/coalesced/deferred/blocked, reasonCode}]` so the UI can say "posted, 1 of 2 targets
  triggered".

## 17. Conversation continuation & ConversationTarget

- **Agent/team replies are `comment` rows** (`author_type='agent'`, `author_agent_id=…`), never chat
  rows.
- **ConversationTarget** — a per-issue-detail, per-actor current target
  `{type ∈ agent|team|workflow, id, displayName}`:
  - Plain follow-up ("继续采用方案 B。") **continues the current target** without re-@mentioning.
  - An explicit `@X` **introduces/switches** the participant (or starts a parallel thread).
  - A workflow target switches the input area to **"Configure Workflow"** mode (§18) instead of chat.
- Server-side: continuation routes a no-`targets` reply to the current target (enqueue/merge via
  `(issue_id, executor_ref)` pending dedup), with reply-authorization scoped to the triggering
  thread. `trigger_evidence` records `conversation_continuation`.

## 18. Workflow Invocation Model

**Workflow = specialized executable capability, not an ordinary agent, not an actor.**

- Characteristics: focused function; typed input schema; **cannot be blindly executed on `@`** —
  schema must be resolved first, inputs auto-filled from Issue context, required-but-missing inputs
  requested, and the final input shown/confirmed before an invocation/run is produced.
- **WorkflowSummary** (via WorkflowResolver): `{id, name, description, inputSchema}`.
- **Invocation** (issue-adjacent, recorded on the run): `{workflowRef, issueRef, runRef, input,
  status}`; `workflow_invocation_ref` is an opaque external ref on `issue_runs`.
- UI flow on `@SecurityReviewWorkflow`:

```
Review scope            [ Current issue changes ]   ← autofill from Issue context
Review depth            [ Standard ]
Include dependencies    [ yes ]
Additional instructions [ ... ]

                          [ Run Workflow ]
```

- Issue core does not own workflow definitions/execution; it calls `WorkflowResolver.invoke` and
  projects the result back onto the run + Timeline.

> **Reconciled by Wave 3B-2 (§38).** The `WorkflowSummary.inputSchema` above is the *provider-side*
> schema; Issues never consumes it — the adapter projects it into an Issues-facing `FormDescriptor`
> (§38.2/§38.5), served by the new **`FormDescriptorProvider`** port (§6.4). And the handoff to
> execution is **not** a separate `WorkflowResolver.invoke` call in the first version: it goes through
> the unified `ExecutionDispatcher` with `executor_type='workflow'` (§38.24). `WorkflowResolver`
> therefore stays a **future domain port**; Issues' 3B-2 contract needs only
> `FormDescriptorProvider` + `ExecutionDispatcher` + `ExecutionObserver`.

## 19. Workflow Input Assistance

Three layers (this wave: **contract only**, no intelligent assistance):

1. **Context autofill** — prefill from issue context: `issue, project, workspace, PR, current run,
   acceptance criteria, selected messages` (via `issue_context_refs`, §20, and resolvers).
2. **Missing-input prompt** — if the schema requires `environment` but issue context has none, the UI
   explicitly asks the user to choose.
3. **Assisted suggestion (future)** — an agent may *suggest* scope/depth/files, but the user must
   always see and confirm the final input.

Design goal: user-visible, confirmable final input before any invocation/run is produced.

## 20. Sub-Issue Context Inheritance

Issue Detail supports **Create Sub-Issue** (`parent_issue_id = current issue`). Principle:
**reference context, don't duplicate it.**

- New table `issue_context_refs` (issue-owned): `tenant_id, issue_id, ref_type, ref_id, created_at`.
  `ref_type` covers `parent_issue`, `run`, `timeline_message`, `pull_request`, `project`,
  `workspace`, `acceptance_criteria`, and other external resources; `ref_id` is opaque (no FK),
  resolved through the appropriate port.
- A sub-issue starts with context refs (not copies) to: parent issue, selected run (if any), selected
  timeline message (if any), PR/project/workspace/acceptance criteria as applicable.
- Rev. 1 note: Multica's `context_refs` is a dormant JSONB column with no consumer; Cloud uses a real,
  queryable issue-owned table instead — a deliberate divergence, not a copy.
- v1 implementation = minimal schema (table + a few ref types), not the full assistance UX.

---

# Part V — Context & integration boundaries

## 21. Project / Workspace / PR execution context

Rev. 1 said "future work, not designed here"; **that is revised** — a minimal stable boundary is
defined now (while still not mapping Multica Workspace → Cloud Workspace).

**Option comparison:**

| | Option | Verdict |
| --- | --- | --- |
| A | `issues.project_id` (single column) | Couples Issue to Project schema; doesn't cover workspace/branch/context. |
| B | `issue_context_refs` for project | Good for *references*, not enough as the issue's primary project display field. |
| C | `issue_runs.execution_context_ref` only | Right for *execution*, but Issue Detail needs a project display without a run. |
| D | **Issue optional `project_ref` + Run `execution_context_ref`** | **Chosen.** |

**Decision — Option D:**

- `issues.project_ref uuid` **nullable** — display ("belongs to project") via
  ProjectContextResolver; a tenant-level Issue is allowed to have no project. Resolved against Cloud's
  existing `projects` (dev-environment repositories) — semantically "which repository context", not a
  re-mapping of Multica Workspace.
- `issue_runs.execution_context_ref` — the concrete execution context (Project/Workspace/Repository/
  Branch) known to the execution module at run time; opaque to Issues, resolved via
  ProjectContextResolver.
- PR display/linking via PullRequestResolver (summaries/URL/state only) — §23.

## 22. Simulator boundary & fake adapter seam

The **Fake Executor implements the `ExecutionDispatcher` port**, it is not a bespoke runtime API:

```
Issue Core → ExecutionDispatcher → Simulator Adapter   (now)
Issue Core → ExecutionDispatcher → Real Runtime Adapter (future)
IssueRun / Timeline / API contract: unchanged across both.
```

- Simulator Adapter copies `internal/simulator`'s shape: **no DB handle**, polls the internal HTTP
  control API for a claimable run (`POST /internal/v1/issue-runs/claim`, service JWT,
  `role=node/controller`), then reports `started/progress/completed/failed` back through the port's
  callback path.
- Same for the other ports: `FakeActorResolver`, `FakeTeamResolver`, `FakeWorkflowResolver`,
  `FakeProjectContextResolver`, `FakePullRequestResolver`, `FakeExecutionLogProvider`, plus
  no-op NotificationSink / RealtimePublisher adapters — all stand-ins behind the identical contract.
- No `if runtimeExists…` anywhere in issue core (§6.3).

## 23. PR / Logs boundary

- **PullRequestResolver**: Issues may list/link PR summaries (title, URL, state, provider ref) on
  Issue Detail; GitHub/Git SDK logic lives in the PR module, never in Issues.
- **ExecutionLogProvider**: Issues surfaces log availability/links/summaries per run; raw
  stdout/stderr/PTY/tool logs live in the execution/logs module (§15).
- Both are `Unavailable → Simulator → Real` triple-state (§6.2); when Unavailable the Issue Detail
  panels render explicit "unavailable" placeholders instead of hiding the feature.

---

# Part VI — Implementation surface

## 24. Proposed database migrations

Two migrations this wave — the split itself encodes the ownership boundary:

- **`0007_issue_collaboration.sql`** (issue-owned, additive; edit nothing older):
  - `issues` ALTERs: `assignee_type`/`assignee_id` (+ backfill), `project_ref uuid` (nullable).
  - `issue_comments` ALTERs: `parent_id uuid REFERENCES issue_comments` (threading),
    `author_type`/`author_agent_id`/`author_team_id` (nullable; human authors keep
    `author_user_id`), `seq bigint` (`UNIQUE(issue_id, seq)`).
  - New tables: `issue_runs` (§11 columns + `seq` not needed), `issue_activities`
    (`tenant_id, issue_id, actor_type, actor_id, action, details jsonb, seq, created_at`),
    `issue_context_refs` (§20).
- ~~**`0008_sim_collaboration_catalog.sql`** (temporary, simulator-owned dev catalog): `sim_agents`,
  `sim_teams`, `sim_team_members`.~~ **SUPERSEDED** (see §0): no `sim_*` tables; in-memory dev fixtures
  implement the same ports.

No `operations`/`execution_tickets`/`users`/`tenant_memberships` semantic changes. Agents/teams are
**not** principals.

## 25. Proposed API changes

New public routes (tenant-scoped; `adding-features.md` 8-step sequence; recall the two OpenAPI traps:
insert resource branches before `Contains(path,"/issues")`, and add any non-string body field to
`validField`):

- **Assignee (existing issues):** `POST/PUT /issues` accept `assigneeType`/`assigneeId` (legacy
  `assigneeUserId` honored).
- **Runs:** `GET /issues/:iid/runs`, `GET /issues/:iid/runs/:rid`; `POST /issues/:iid/runs` (manual
  run, returns `{resource: IssueRun}`).
- **Timeline:** `GET /issues/:iid/timeline` (merged comments+activities, `ORDER BY seq`,
  `X-Timeline-Truncated`).
- **Comments:** existing routes gain `parentId` (threading) + `targets[]` (explicit resolved targets,
  §16); response returns `triggerOutcomes`. Agent authors allowed for fake-executor replies.
- **Context refs:** `GET/POST/DELETE /issues/:iid/context-refs` (minimal, §20).

**No** `/agents`, `/teams`, `/workflows` endpoints in the issue API — those belong to their future
modules. Issue Detail's agent/team/workflow data is rendered from `executor_ref`/`workflow_invocation`
resolved via ports, not from issue-owned CRUD.

> **Clarified by Wave 3B-0 — these are two different things and must not be conflated:**
>
> | | Verdict |
> | --- | --- |
> | Agent / Team / Workflow **domain APIs** (`GET /agents`, `POST /teams`, workflow CRUD…) | **Never** in the issue API. Not planned, not deferred — simply not ours. |
> | Issues-facing **unified collaboration projection** (`CollaborationDirectory` → "which targets may I `@`?", served to the `@` picker) | **Planned**, as a read-only projection over ports. |
>
> The projection is *not* an Agent API, a Team API, or a Workflow API: it exposes only
> `CollaborationTargetSummary{type, id, displayName, description?, interactionDescriptor}` (§6.2) and
> carries no domain fields, no CRUD, and no mutation. Today a fixture adapter can serve it; later it
> aggregates the real modules' adapters. See §37.11.

OpenAPI: add `IssueRun`, `IssueActivity`, `TimelineEntry`, `ContextRef`, `CollaborationTarget`,
`TriggerOutcome`, `WorkflowInvocationRef` schemas; extend `Issue` (`assigneeType`/`assigneeId`/
`projectRef`), `Comment` (`parentId`, `targets`, author-actor fields, `seq`). Regenerate
`api/openapi.json`.

## 26. Backward compatibility

- Existing issue/comment endpoints keep their shapes; new fields/routes are additive.
- `assigneeUserId` keeps working; `author_user_id` keeps working for human authors.
- No applied migration edited; `0007` purely additive (the `0008` sim catalog is superseded — §0); no
  existing route removed/re-tokenized.
- `operations`/`execution_tickets`/simulator unchanged.
- Contract test keeps `additionalProperties:false`; only new/extended resources add fields.

## 27. Tenant / security rules

- Every new table/query filters `tenant_id=$…`; cross-tenant resolution → 404, never a leak.
- `membership()` gates human actions. Agents/teams are **not** authenticated principals; agent/team
  authored content or runs can only be produced via (a) the public API as an authorized member, or
  (b) the internal control API as the simulator/execution adapter with a service JWT
  (`role=node/controller`).
- **Resolver validation is authoritative**: every `assignee_ref`/`executor_ref`/`target` is resolved
  through the port and fail-closed (typed 404/`blocked`), never trusted raw.
- **No target-catalogue mutation route exists.** The `sim_*` catalog is superseded (§0), so there is no
  catalog to guard; dev fixtures are wired, not mutated over HTTP. When real Agent/Team modules land
  they own their own authorization, and the Issues-facing `CollaborationDirectory` stays read-only.

## 28. Idempotency / version / soft-delete rules

- **Idempotency:** POST (agents/teams via their modules, runs, comments, context refs) require
  `Idempotency-Key`; run-enqueue dedup `(issue_id, executor_ref)` pending is a second layer.
- **Version:** `issue_runs` (mutable fields), `comments` carry `version` + `version(o,v)` 428/409 on
  PUT/PATCH. `issue_activities`, `issue_context_refs`, `team_members` are append/join-like — no
  version column.
- **Soft delete:**
  - `comments` soft-delete with tombstone for replies (thread completeness).
  - `issue_activities` append-only (no delete).
  - `agents`/`teams` (future modules) soft-delete; **no `sim_*` catalog rows exist** (§0).
  - **`issue_runs.deleted_at` — terminal status ≠ deleted (final).** `completed`/`failed`/`cancelled`
    are **normal history records**. `deleted_at` exists only for explicit **hide/archive/admin
    cleanup** and there is **no delete-Run API this wave**. The rev. 1 phrase "terminal status =
    operational delete" is retracted.

## 29. Testing plan

- **Integration** (`integration/issue_collaboration_test.go`): polymorphic assignee (user/agent/team,
  invalid/foreign → 404); run lifecycle (enqueue→claim→complete via the fake executor; cancel;
  pending dedup); timeline merge + `seq` ordering + truncation; explicit `@targets` + `triggerOutcomes`;
  conversation continuation; context-refs CRUD.
- **Ports/adapter tests:** fake adapters implement the port contract; a harness drives
  claim/advance over the internal HTTP API (like simulator tests), asserting the no-DB-handle
  boundary and the Unavailable/Simulator/Real switching.
- **Contract:** regenerated `api/openapi.json` byte-verified.
- **Regression:** `go test ./internal/... ./cmd/...` + full integration suite green; migration list
  in `integration/cloud_test.go` bumped to include `0007` (**no `0008`** — the sim catalog is
  superseded, §0).

## 30. Demo plan

Extend `cmd/demo-issue-board-web/` to the **Issue Detail surface** (§13):

- Config endpoint seeds a dev catalog (via the simulator adapter path) with a demo agent, demo team
  (leader agent), and a demo workflow.
- Issue Detail: left Activity/Timeline (comments + events, `@targets` input, "Continue with: …"),
  right Properties/Development/Execution panels; run enqueue + progress via the fake executor
  (polling); "View execution logs" → fake log summary; Create Sub-Issue with context refs.
- Everything stays on the real router (dual-JWT, idempotency, advisory-locked transactions).

## 31. Documentation updates

- This file (rev. 2) + `00-overview.md`/`06-implementation-log.md`/`08-differences.md` updates (when
  implemented).
- `08-differences.md` — append rev. 2 divergences: polymorphic `executor_ref` vs agent-only;
  `terminal ≠ deleted`; `seq` ordering; explicit targets vs regex mentions; temporary `sim_*` catalog;
  `context_refs` table vs Multica's dormant column.
- `docs/development/onboarding/progress.md` — Wave 3 stays **Planning**, scope updated (§34→§35 sync).
- `docs/development/agent/` — minimal "planned" pointer only; no fabricated API in "Where things are".

## 32. Deferred work

| Deferred | Why / when |
| --- | --- |
| Real LLM / real agent runtime / real execution module | Simulator adapters first; real modules implement the same ports later. |
| Real Agent / Team / Workflow domain tables & CRUD | Future modules; in-memory fake resolvers stand in (§9 — `sim_*` catalog superseded, §0). |
| Autopilot (schedule/manual/webhook triggers, rule versions) | Needs runs + trigger engine + runtime first. |
| Multi-agent orchestration / squad-leader fan-out | Single-executor runs first. |
| Production WebSocket / event bus | HTTP refetch + polling now. |
| Notifications/inbox, `@user` delivery | NotificationSink port exists; delivery deferred to the notification module. |
| Realtime delivery | RealtimePublisher port exists; no WS yet. |
| Activity-write failure recovery (projection reconciler) | Semantics fixed (§14); implementation deferred. |
| `Assign and Start` variant | Contract decided (§10); behavior not built. |
| `stage` (sub-issue barriers), reactions, dependencies, acceptance criteria | Orthogonal / dormant in Multica; post-foundation. |
| PR linking + `close_intent`, chat origins, files/attachments | External integration / no file storage. |
| `internal/core` refactor / DB-framework swap | Forbidden by principles. |

## 33. Risks / open questions

**Resolved this round** (no longer open):
1. Timeline ordering — per-issue `seq` shared by comments + activities, `ORDER BY seq` (§14).
2. Assign → Run — formal `Assign ≠ Execute` (§10).
3. `issue_runs.deleted_at` — terminal status ≠ deleted (§28).

**Remaining open:**
1. **Port wiring mechanism.** How adapters are selected at construction (config flags vs a small
   registry in the router/simulator wiring) — decide at Step 3/4 of implementation; must not leak
   into issue core.
2. **NotificationSink / RealtimePublisher consumers.** Contracts frozen but no consumer yet; when a
   notification/realtime module lands, verify the payload shapes (`recipientRef`, domain events)
   still fit.
3. **`project_ref` resolution details.** Cloud `projects` are dev-environment repositories with a
   lifecycle; pinning exact semantics of "belongs to project" (which states are valid for display,
   and how `execution_context_ref` maps to Project/Workspace/Repository) needs the Project module's
   input. Issue stays tenant-level with nullable `project_ref` meanwhile.
4. **Timeline truncation UX.** With two capped lists, where the truncated marker appears and how the
   UI loads earlier pages is unspecified (design in Step 5, not this wave).

**Added by Wave 3B-0** — the interaction-model questions are tracked separately in **§37.17**; Q1
above (port wiring) is answered as "config-flag + fixture adapters, production default off" in §37.13
but the concrete mechanism is still chosen in 3B-1.

## 34. Acceptance criteria

This wave (rev. 2) is complete when:

1. `12-collaboration-architecture.md` reflects: Issues-owns-the-domain + ports-only external access
   (§6), ActorRef vs CollaborationTargetRef (§8), temporary sim catalog with replacement plan (§9),
   Assign ≠ Execute (§10), polymorphic executor_ref (§11), Issue Detail surface (§13), decided `seq`
   ordering + projection (§14), explicit targets (§16), ConversationTarget (§17), Workflow model
   (§18–19), Sub-Issue context (§20), Option-D execution context (§21), port-first implementation
   order (§35).
2. `progress.md` marks Wave 3 **Planning** with the expanded scope, nothing listed as implemented.
3. `docs/development/agent/` carries only the minimal planned pointer, no fabricated API.
4. The first coding batch below is **scoped and agreed, not started**.
5. No code, migration, or applied-file change is made in this wave.

## 35. Recommended implementation order

Port-first (order respects "stabilize Issue-owned domain + ports before fake external modules"):

| Step | Focus |
| --- | --- |
| 1 | **Architecture / contracts frozen** (this doc; get the 4 open questions' owners). |
| 2 | **Issue-owned foundation** — target refs (`assignee_type/assignee_id`, comment author-actor,
      `project_ref`), `issue_runs`, `issue_activities` + `seq` ordering, `issue_context_refs`,
      migration `0007`, `PublicRequest`/`router`/`validField`/OpenAPI spine. |
| 3 | **Integration ports** — Go interfaces at the consuming boundary: `ActorResolver`,
      `ExecutionDispatcher`, `WorkflowResolver`, `ProjectContextResolver`, `NotificationSink`,
      `RealtimePublisher`, `ExecutionLogProvider` (+ `PullRequestResolver` interface-only).
      Wire points chosen here (see open Q1). |
| 4 | **Simulator adapters** — in-memory `FakeActorResolver`/`FakeWorkflowResolver`/
      `FakeProjectContextResolver`/fake executor + no-op sinks. **(`0008` sim catalog superseded — no
      `sim_*` tables.)** |
| 5 | **Issue Detail API projections** — timeline endpoint, runs endpoints, panels' projections
      (unavailable states honored). |
| 6 | **Conversation + explicit `@targets`** — target validation, `triggerOutcomes`,
      ConversationTarget routing. |
| 7 | **Workflow invocation** — schema resolve → autofill → missing-input → confirm → invoke → run. |
| 8 | **Sub-Issue context** — Create Sub-Issue + `issue_context_refs` population. |
| 9 | **Demo** — Issue Detail UI. |
| 10 | **Docs / tests / acceptance** — update migration + agent + onboarding docs, full gate
      (`task check`), acceptance review. |

In Cloud's monolith, Steps 2–3 may land in one change (ports are small and issue-owned code needs
them immediately); the ordering rule that must hold is: **issue-owned domain first, then ports, then
fake external adapters, then projections/UI** — never a real external module shipped by this team,
and never `agents`/`teams` CRUD pretending to be issue domain.

### 35.1 Mapping to the Wave 3B sub-waves (added by Wave 3B-0)

The 10 steps above stay the frozen order; the remaining ones are grouped into shippable sub-waves so
each can be reviewed and verified on its own (§37.16):

| Sub-wave | Steps | Contents |
| --- | --- | --- |
| **3B-1** — Collaboration Interaction Foundation | 3 (part), 4 (part), 5 (part), 6 | `CollaborationTargetRef`, `CollaborationDirectory`, `InteractionDescriptor`, `ContextBuilder` interface + deterministic impl, `ExecutionDispatcher` interface + mock adapter, `ExecutionObserver`, collaboration-target projection API, interaction API spine, Mention Mode, Agent/Team Task Mode, IssueRun lifecycle, fixed reply → `Comment`, Timeline read API, `@` picker + Mention/Task Mode UI. |
| **3B-2** — Workflow Interaction Shell | 3 (rest), 4 (rest), 5 (rest), 7 | `FormDescriptor`, dynamic form renderer, `InputAssistProvider`, mock AI Assist, context suggestions, review/apply/confirm, mock workflow execution. |
| **3B-3 / later** | 8, 9, 10 and the deferred table (§32) | Real Agent/Team/Workflow/Runtime/Notification/Realtime, integrated through the same adapters when the external designs land. |

## 36. Wave 3A implementation notes (Step 2 landed)

The rev. 2 design is frozen. Step 2 (Issue-owned foundation) has now been implemented as **Wave 3A**
(`migration 0007` + the persistence/API-contract spine). This section records the concrete divergences
between the frozen doc and what landed, so later waves (ports → adapters → projections) work from the
code, not from a stale §.

1. **Comment author ActorRef is a single `{type,id}` pair.** §8/§14 and the rev.-1 draft referenced
   per-actor columns (`author_agent_id`/`author_team_id`). Wave 3A uses the uniform
   `author_type ∈ {user,agent,team,system}` + `author_id` shape instead — the same shape as
   `assignee_type/assignee_id` and `issue_activities.actor_type/actor_id`. `author_user_id` is kept and
   mirror-written for `user` authors (backward-compatible read path). No per-actor columns exist.
2. **`issue_runs.issue_id` has no `ON DELETE CASCADE`.** §11/§24 showed a cascade; the migration uses a
   plain `REFERENCES issues(id)`. Runs are retained history, and issues soft-delete anyway, so a hard
   cascade is both unreachable and destructive.
3. **Timeline `seq` is Option C** — a shared per-issue namespace allocated as
   `GREATEST(MAX(issue_comments.seq), MAX(issue_activities.seq)) + 1` inside the advisory-locked tx,
   rather than a `timeline_seq` column on `issues` (which would leak through `SELECT * FROM issues`
   into the `additionalProperties:false` OpenAPI contract). Comments list `ORDER BY seq, id`.
4. **Terminal run status ≠ deleted.** `completed`/`failed`/`cancelled` are history; there is no
   delete-run API; `deleted_at` on `issue_runs` is reserved for future hide/archive. The state guard
   stays in SQL `WHERE`, not a central validator.
5. **`project_ref` is shape-only.** A nullable `uuid` with no existence check (no
   `ProjectContextResolver` yet). Same for `assignee`/`executor`/`actor` refs of non-`user` type —
   opaque UUIDs, unresolved this wave.
6. **Scope held.** No `agents`/`teams`/`workflows`/`sim_*`/`runtime`/`notifications`/`websocket`/PR/logs
   schema or code landed. No `ActorResolver`/`ExecutionDispatcher`/port interfaces yet — those are
   Step 3. This wave is the issue-owned persistence + contract spine only, and it stops here.

---

## 37. Wave 3B-0 — Collaboration Interaction Model (frozen)

> **Status: FROZEN product semantics, added by Wave 3B-0 (docs only — no code, no migration).**
>
> This section is the authoritative statement of *how collaboration interactions work* in Issues. A
> coding agent implementing Wave 3B-1 must implement **from this section** and must not re-derive
> product semantics from scratch, from Multica's behaviour, or from any earlier sketch. Where this
> section and an earlier section of this document disagree about interaction semantics, **§37 wins**;
> the port *contracts* remain §6.2 + the inventory in §6.4.
>
> Everything here is a **contract for the consuming side**. Issues still does not define the internal
> design of Agent, Team, Workflow, Runtime, Notification, or Realtime — those remain
> **BLOCKED ON EXTERNAL DESIGN**.

### 37.1 `@` is collaboration target selection — never execution

```
@  =  Collaboration Target Selection
```

`@` selects **who/what the interaction is addressed to**. `@` itself is **not** an execution trigger.

Once a target is selected, the target's **interaction descriptor / capability** decides what happens
next (§6.2 `InteractionDescriptor`). Execution — if any — is a separate, explicit act (§10,
`Assign ≠ Execute`).

**Markdown `@xxx` / `mention://type/id` is display/compatibility only.** It is *not* an authoritative
business routing protocol: business semantics come from the typed target + the interaction request,
never from parsing body text (§16). A body containing `@BackendAgent` with no `targets` entry triggers
nothing.

### 37.2 The four target modes

| Target type | Mode | Produces an `IssueRun`? |
| --- | --- | --- |
| `user` | **Mention Mode** | **No** |
| `agent` | **Task Mode** | Yes — an executable interaction |
| `team` | **Task Mode** | Yes — an executable interaction |
| `workflow` | **Configure / Form Mode** | Yes — but only after a confirmed form submission |

`@Alice @BackendAgent @SecurityTeam` in one comment is therefore a **mixed-mode** request: one mention,
two task interactions, zero or more runs (§37.8).

### 37.3 Human Mention Mode

```
@Human → Mention Mode
```

- The user explicitly marks that a person should **look at / handle** this piece of content.
- The mentioned human is **visibly shown** in the Timeline/Comment (rendered from the typed target,
  not from body text).
- **A human mention produces no `IssueRun`.** `@Human → IssueRun` is **forbidden**.
- Notification is a **future module**'s responsibility (via `NotificationSink`, §6.2); a future
  notification must be able to **deep-link back to this issue + context**.
- **Notification is not implemented today.** Mention Mode in 3B-1 persists the typed target and
  renders it; it does not deliver anything.

### 37.4 Agent Task Mode

```
@Agent → Task Mode
```

- An agent interaction **must carry an explicit task**. The conceptual request is:

  ```
  target
  task
  context
  ```

- **`Comment.body` and the interaction's `task` are two different protocol fields.**

  ```
  Comment.body  !=  Interaction.task
  ```

  The UI may *initialize* the task from the user's natural-language input, but the task is an
  independent **execution intent** — it is the thing the executor is asked to do, and it survives
  independently of how the comment body is later rendered or edited.

- The agent's **internal model, database, runtime, LLM, and execution architecture are UNKNOWN**.
  Issues makes **no assumption** about any of them; it sends `target + task + context` and receives
  lifecycle/result back through `ExecutionObserver` (§6.2).
- A fixed/mock agent reply arrives as an **`IssueComment`** with `author_type='agent'` — never a chat
  row (§17).

### 37.5 Team Task Mode

```
@Team → Task Mode
```

- The Issues-facing interaction for a Team is **identical to Agent Task Mode**: `target + task +
  context`.
- Issues **must not assume** any of: leader, member model, delegation, fan-out, internal
  orchestration, runtime topology. A Team is, in the current Issues contract, **just a task-capable
  collaboration target**.
- The future real Team design plugs in behind the same `CollaborationDirectory` /
  `ExecutionDispatcher` / `ExecutionObserver` adapters without changing the Issues contract.

### 37.6 Workflow Configure / Form Mode

```
@Workflow → Configure / Form Mode
```

> **Extended by Wave 3B-2 → see §38 (IMPLEMENTED + VERIFIED, §38.37).** §38 freezes the Issues-facing
> contract: the `FormDescriptor` shape, field types, `formRef` loading, the Confirm boundary, draft
> persistence, AI Assist authority, validation layering, the API surface, the `0009` migration, and the
> workflow Timeline/actor representation. This subsection keeps only the boundary statement.

- Workflow is **not** an agent: it can require **structured inputs**, so it cannot be blindly executed
  on `@` (§18).
- The frontend will render a **dynamic form** from an `InteractionDescriptor` / `FormDescriptor`
  (§6.2). It must **not** hard-code any workflow's fields into the Issues domain schema.
- Issues **does not prescribe** how a workflow's schema is expressed internally — JSON Schema, a DSL,
  protobuf, a database schema, or code-defined schema are all acceptable to the Workflow module.
- The **Workflow adapter's only obligation** is to convert whatever it uses into an **Issues-facing
  `FormDescriptor`**.

### 37.7 AI Assist

A Workflow form may offer **AI Assist**.

```
input   : current form values, issue context, selected context refs, workflow target/descriptor
output  : suggested values, suggested context refs
```

The required flow is:

```
AI Assist → Suggest → User Review → Apply → Confirm → Execute
```

**`AI Assist → automatically execute workflow` is forbidden.** Assist may only propose; applying is a
user action and execution stays a separate explicit confirm.

3B-0 records the contract/design only. **No AI is implemented.**

### 37.8 `Comment` ≠ `Interaction` ≠ `IssueRun`

```
Comment      ≠   Interaction   ≠   IssueRun
```

| Cardinality | Rule |
| --- | --- |
| one `Comment` → interactions | **0..N** |
| one executable interaction → `IssueRun` | **0..1** initial run |
| therefore one `Comment` → `IssueRun`s | **0..N** |

Worked example — `@Alice @BackendAgent @SecurityTeam` in a single comment:

```
Alice          → Mention interaction      → no Run
BackendAgent   → Task interaction         → Run A
SecurityTeam   → Task interaction         → Run B
```

**Do not introduce `Comment.run_id`.** A 1:1 comment↔run column is explicitly rejected: it cannot
express a mention (0 runs), cannot express two targets in one comment (2 runs), and would freeze the
interaction model into the comment table.

The existing `issue_runs.trigger_evidence_kind` + `trigger_evidence_ref_id` pair (§11, and already in
migration `0007`) is the **provenance seam** for `Comment → Run`: it is a free pair with no FK, so
recording `kind='comment'` + the comment id needs **no migration**. If the interaction itself ever
needs to be a first-class row, it is added additively next to the comment — never by widening
`issue_comments`.

### 37.9 Timeline

```
Timeline  =  Comment + IssueActivity, as one high-level projection
```

- Timeline is the **high-level, human-readable projection** over `issue_comments` +
  `issue_activities`. It stays **strictly separate** from **Execution Logs** (§15): PTY/stdout/tool
  logs belong to the execution module and are reached only through `ExecutionLogProvider`.
- Wave 3B-1 **may add a public Timeline read API** (`GET /issues/:iid/timeline`, §25). Today the
  projection is persisted but **not exposed**: `issue_activities` has **no public read endpoint** and
  there is no `/timeline` route.
- The target interleaving — all sharing the **one per-issue `seq` namespace** (§14) — is:

```
User Comment
Run Enqueued Activity
Run Started Activity
Agent Reply Comment
Run Completed Activity
```

- Ordering is `ORDER BY seq`; `created_at` is display-only. An agent/team reply is a **Comment row**
  with `author_type ∈ agent|team` (§37.4), so it participates in the same ordering instead of needing
  a separate stream.

### 37.10 Pending-run constraint (current implementation fact)

Recorded here because it bounds multi-target interactions (§37.8):

```
at most ONE pending Run per (issue_id, executor_type, executor_id)
while status ∈ ('queued','dispatched')
```

- Enforced today by the partial unique index `issue_run_pending_uniq` in migration `0007`, surfaced as
  `409 pending_run_exists`.
- **Wave 3B keeps this constraint unchanged. Do not modify the migration.** Two targets in one comment
  produce two runs because they differ in `executor_id`; the *same* target twice does not produce two
  concurrent runs.
- If a future real executor needs several concurrent tasks on the same Issue + executor, that is a
  **separate forward migration** with its own decision — not a Wave 3B change.

### 37.11 CollaborationDirectory and the target API boundary

`CollaborationDirectory` answers one question for the Issues UI:

> Which collaboration targets may I select right now?

It returns a uniform **`CollaborationTargetSummary`**, minimally expressing:

```
type                 user | agent | team | workflow
id
displayName
description          (optional)
interaction/capability descriptor
```

It defines **no** Agent/Team/Workflow internal schema.

**Boundary (resolves the §25 tension):**

| | Verdict |
| --- | --- |
| Agent / Team / Workflow **domain APIs** | Still **not** provided. Issues does not expose `GET /agents`, `POST /teams`, workflow CRUD, etc. (§25.) |
| **Issues-facing unified collaboration projection** — conceptually `GET collaboration targets` | **Allowed and planned.** It is `CollaborationDirectory → Issues-facing target projection → @ Picker`. |

The projection is a **read-only view over ports**, not a domain API: it carries no domain fields and
offers no mutation. Today it can be served by a **fixture adapter**; later it aggregates the real
Agent/Team/Workflow/User adapters. Any doc wording that conflates "Issues exposes a target picker"
with "Issues exposes Agent/Team/Workflow APIs" is wrong and has been corrected (§25).

### 37.12 Context persistence

Three distinct things, deliberately not merged:

```
IssueContextRef  =  a stable explicit reference          (persisted, issue-owned)
ContextBuilder   =  invocation-time context construction (not persisted)
IssueRun.input   =  the effective execution-time input/context snapshot (persisted on the run)
```

Purpose: it must later be possible to understand **what a given run actually received as input**.

`ContextBundle` must **not** become a new permanent external-domain object. The first
`ContextBuilder` implementation is deterministic and may use only:

```
issue title
issue description
recent comments
explicit context refs
task
```

Later it may be replaced by AI relevance selection / summarization / retrieval / token budgeting —
that is an internal change behind the port. **Issues does not implement a real AI context engine.**

### 37.13 Fixture / mock strategy

The next step is **not** a relational simulator. The following are **deleted from the active design**
and remain only as history:

```
0008_sim_collaboration_catalog.sql   ·  sim_agents  ·  sim_teams  ·  sim_team_members
```

The current direction is a **fixture/mock adapter set**:

```
FixtureCollaborationDirectory
MockExecutionDispatcher
Deterministic ContextBuilder
Mock InputAssistProvider
```

Wave 3B-2 adds `FixtureFormDescriptorProvider` and `MockInputAssistProvider` to this set (§38.32,
landed) and reuses `MockExecutionDispatcher` with `executor_type="workflow"`.

Constraints on this set:

| Constraint | Rule |
| --- | --- |
| Where it lives | **development/demo configuration only** |
| Production | **default OFF** |
| Domain tables | **none** — no mock domain tables, no `sim_*` tables (§0, §9) |
| Issue core | no `if fixtureExists…` branch; the adapter is chosen at wiring (§6.3) |
| Removability | deleting the fixture wiring + adapters must leave Issues core untouched |

### 37.14 Frontend interaction model

```
Composer
   ↓  @
Target Picker            (fed by CollaborationDirectory)
   ↓
Interaction Mode         (from InteractionDescriptor)
   ├── Human     → Mention Composer
   ├── Agent     → Task Composer
   ├── Team      → Task Composer
   └── Workflow  → Dynamic Form Composer
```

- **Agent/Team Task Composer** supports: `Task`, `Context`.
- **Workflow Dynamic Form Composer** supports: `AI Assist`, `Context refs`, `Review`, `Confirm`.
- The frontend must **not** encode assumptions about real Agent/Team/Workflow implementations — it
  renders whatever the descriptor declares and sends `target + task/form values + context refs`.

Current frontend reality (Wave 3A state, for the implementer): the comment composer posts
`{body}` only, has no `@` affordance and does not even send `parentId`; there is no search UI; runs
are list-only and the create-run button is **disabled** ([13-frontend-migration.md](13-frontend-migration.md)).

### 37.15 ConversationTarget — design only

`ConversationTarget` (§17) stays **DESIGN ONLY / OPEN QUESTION**. 3B-0 deliberately does **not**
freeze:

```
per issue · per user · per session · server persisted · client derived
```

Wave 3B-1's first version triggers a new interaction only via an **explicit `@`**. **Implicit
continuation is not implemented.** The no-`targets` "continue with the current target" behaviour
described in §17 is deferred until this is decided.

### 37.16 Wave 3B roadmap

**Wave 3B-1 — Collaboration Interaction Foundation**

```
CollaborationTargetRef
CollaborationDirectory
InteractionDescriptor
fixture directory adapter
collaboration target API
interaction API spine
Human Mention Mode
Agent/Team Task Mode
ContextBuilder interface
deterministic context builder
ExecutionDispatcher interface
mock execution adapter
IssueRun lifecycle
fixed Agent/Team reply → IssueComment
Timeline read API
frontend @ Picker
frontend Mention Mode
frontend Task Mode
```

**Wave 3B-2 — Workflow Interaction Shell**

```
FormDescriptor
Dynamic Form Renderer
InputAssistProvider
Mock AI Assist
Context suggestions
Review / Apply / Confirm
Mock Workflow execution
```

> **Implemented 2026-09-20 → §38 / §38.37.** The contract (descriptor shape, Confirm boundary, AI
> Assist authority, draft decision, API surface, `0009`) is settled and the shell has landed, been
> tested and been verified end-to-end. Real Workflow / AI providers remain BLOCKED ON EXTERNAL DESIGN.

**Wave 3B-3 / later** — real `Agent`, `Team`, `Workflow`, `Runtime`, `Notification`, `Realtime`,
integrated through the same adapters once their external designs are approved.

### 37.17 Open questions left by Wave 3B-0

| # | Question | Why it is still open |
| --- | --- | --- |
| Q1 | Where do mention candidates come from if `/agents` etc. stay forbidden? | §37.11 fixes the *boundary* (a read-only Issues-facing projection) but not the *source*: an in-Cloud fixture, or supplied by the desktop/agent modules. |
| Q2 | Is a Team a target with its own `executor_id`, or a fan-out to members? | Explicitly **not** assumed (§37.5). Resolved only when the real Team design lands. |
| Q3 | Is `Interaction.task` a new field/row, or does it ride on `issue_runs.input`? | §37.8 forbids `Comment.run_id` but does not yet fix where the interaction record lives. |
| Q4 | Is "one pending run per `(issue_id, executor_type, executor_id)`" the intended cap for multi-target interactions? | Current DB fact (§37.10 / migration `0007` partial unique index); retained as-is for 3B. |
| Q5 | Who owns the authoritative workflow input schema? | Desktop has `WorkflowSummary.inputSchema`; Cloud has no workflow module (§37.6). |
| Q6 | Who computes AI Assist suggestions, given Cloud has no LLM/runtime? | `InputAssistProvider` ownership is deliberately undecided (§6.2). |
| Q7 | Is `ContextBundle` computed on demand or snapshotted? | §37.12 fixes that `IssueRun.input` is the snapshot, but not the bundle's own lifecycle. |
| Q8 | `ConversationTarget` scope and persistence. | Deliberately unfrozen (§37.15). |

**Partially resolved by the Wave 3B-2 design pass (§38):** Q5 stays OPEN for the *canonical* schema
owner but the Issues-facing contract is now frozen — Issues consumes a `FormDescriptor` and never the
Workflow schema (§38.2/§38.5). Q6 stays OPEN for *ownership* but the port contract and its
suggest-only authority are frozen (§38.11/§38.12). Q7 stays OPEN for the `ContextBundle` lifecycle but
§38.9 fixes that the Confirm-time snapshot lands in `IssueRun.input` and the descriptor is never run
input. Q3 is resolved: the interaction record lives in `issue_interactions` with a generic `input`
column (§38.30).

---

## 38. Wave 3B-2 — Workflow Interaction Design (FROZEN → IMPLEMENTED)

> **Status: IMPLEMENTED + VERIFIED (2026-09-20).** Design frozen earlier the same day; the shell was
> then implemented, tested and verified end-to-end. See **§38.37** for what landed, the deviations, and
> the verification evidence. Everything below (38.1–38.36) remains the authoritative contract.
>
> This section is the authoritative **Issues-facing** contract for Workflow interaction. A coding agent
> implementing Wave 3B-2 implements **from this section**; it must not re-derive product semantics and
> must not design Workflow internals. Where this section and an earlier section disagree about
> interaction semantics, **§38 wins**; port *contracts* remain §6.2 + the inventory in §6.4.
>
> **Workflow internal architecture stays UNKNOWN and BLOCKED ON EXTERNAL DESIGN** (§0, §9). Issues
> defines only *what it needs from* the Workflow capability, never how a workflow is stored, versioned,
> or executed.

### 38.1 Top-level UX (frozen)

```
@Workflow
  → select CollaborationTarget            (Issues: CollaborationDirectory)
  → InteractionDescriptor.mode = form
  → load FormDescriptor                   (Issues-facing projection)
  → render dynamic form
  → user fills / edits fields
  → optional AI Assist                    (suggestions only)
  → user reviews / applies suggestions
  → user explicitly Confirms              ← the ONLY execution boundary
  → IssueRun                              (ExecutionDispatcher → ExecutionObserver)
```

Two equivalences are **frozen and must not be collapsed**:

```
selecting a Workflow  ≠  executing a Workflow
AI Assist             ≠  execution
```

There is exactly **one** execution boundary: an explicit human **Confirm** (§38.7, §38.22).

### 38.2 `FormDescriptor` — responsibility

`FormDescriptor` answers one question, and only this one:

> What input controls should the Issues frontend render for this Workflow interaction, and what is the
> most basic client-side interaction/validation for them?

It is an **Issues-facing rendering descriptor**, carried over a port. It is **not** a Workflow schema.

### 38.3 Proposed minimal `FormDescriptor` shape

```
FormDescriptor
  formRef      string        opaque, provider-scoped, stable identifier (echoed from formRef)
  title        string?       optional heading
  description  string?       optional helper text
  fields       FormField[]   ordered; array order IS the display order

FormField
  key          string        stable machine key — the key in the form-value map
  label        string
  type         FieldType     see §38.4
  required     bool
  description  string?       optional per-field help
  defaultValue Value?        optional; MUST match `type` (and be within `options` for select/multi_select)
  placeholder  string?       optional
  options      Option[]?     REQUIRED for select / multi_select; each {value, label}
```

Invariants on a descriptor: `key` is unique within `fields`; `options` present iff the type needs them;
`defaultValue` is type-consistent. A descriptor violating these is **invalid** and surfaces as
`invalid_form_descriptor` (§38.18) — Issues never renders a partially-valid form.

### 38.4 Supported initial field types

| `type` | Value shape | Client validation |
| --- | --- | --- |
| `text` | string | required, max length |
| `textarea` | string | required, max length |
| `number` | number | required, numeric, optional min/max via `options`-free bounds |
| `boolean` | boolean | required |
| `select` | string ∈ `options` | required, value ∈ `options` |
| `multi_select` | string[] ⊆ `options` | required, each ∈ `options` |

**Deferred (OPEN QUESTION, §38.31):** a dedicated `context_ref` / repository / branch *selector* field
type. First version represents such inputs as `text` (optionally autofilled from issue context, §19).
Adding a field type later is an **additive** descriptor change.

### 38.5 What `FormDescriptor` is NOT

**Not** a Workflow canonical schema, and **not** bound to any schema technology (§6, §37.6). The future
Workflow module may express its schema as JSON Schema, a DSL, protobuf, a database schema, a
code-defined schema, or an external service contract. Issues **does not decide** this. The adapter's
only obligation:

```
Workflow internal schema  ──adapter──▶  Issues-facing FormDescriptor
```

`FormDescriptor` therefore carries **no** schema-technology constructs: no `$ref`, no `oneOf`/`allOf`,
no JSON-Schema keywords, no protobuf descriptors, no expression syntax.

**Not a capability DSL** (§7). The following are explicitly **FUTURE / OPEN**, not frozen now:

```
conditional visibility (visibleIf / dependsOn)
computed or derived fields
cross-field expressions / validation expressions
repeating or nested field groups
arbitrary JSON Schema semantics
form scripting / expression evaluation
```

If a real Workflow needs one of these, that is a **new decision with its own ADR**, not a 3B-2
extension.

### 38.6 Interaction lifecycle & Issue-owned state

```
Comment ──▶ Workflow Interaction ──▶ configuration (form values) ──▶ Confirm ──▶ IssueRun
```

**Decision — no new interaction status column.** The Issue-owned lifecycle is expressed with what
already exists:

| Situation | Issue-owned representation |
| --- | --- |
| Workflow addressed, not yet confirmed | interaction row exists, `mode='form'`, `run_id IS NULL` |
| Confirmed | `run_id IS NOT NULL` — the initial run exists |
| Executing / done / failed | `issue_runs.status` (the run owns its own state machine, §12) |

Explicitly **not** added: `draft` / `ready` / `confirmed` / `executing` enum column. Rationale:
`run_id IS NULL` already separates "not executable" from "executable", and `issue_runs.status` already
owns execution progress. A parallel interaction state machine would duplicate both and could drift.

`run_id` is therefore overloaded deliberately and is documented as: **the interaction's confirm
marker + initial-run reference** (§38.14).

### 38.7 Confirm boundary (frozen)

```
Confirm = the user accepts the current effective workflow input and authorizes creating
          an execution intent (IssueRun).
```

- `form editing`, `AI Assist`, `apply suggestions`, `draft save` **never** create a Run.
- Only an explicit `Confirm` may reach `ExecutionDispatcher`.
- Confirm re-validates server-side (§38.14) and is the **only** transition that sets
  `issue_interactions.run_id`.

### 38.8 Draft persistence — decision

**Decision: Option A — frontend-only draft.** Unconfirmed form values are **not** persisted
server-side in the first version.

| Option | Verdict |
| --- | --- |
| **A — frontend-only draft** | **CHOSEN.** No server state, no endpoint, no migration; refresh loses the draft. |
| B — draft on `issue_interactions` | Rejected for v1: every keystroke would need a persisted PATCH + version column, for a value the user may abandon. |
| C — dedicated draft resource | Rejected: a new resource for a transient value; violates "no new resource by default". |

Why A is acceptable: the interaction itself is already persisted (the comment + interaction row exist),
so *what was addressed* survives a refresh; only *unsaved field values* are lost. Refresh → the form
re-renders from the descriptor's `defaultValue`s and the user re-enters. Multi-device / partial
completion / audit are explicitly **not** requirements for the first version.

Recorded as **technical debt** (OPEN QUESTION §38.31): if partial-completion becomes a product
requirement, Option B (an `input` PATCH + `version` guard on the interaction) is the additive path —
the `input` column in §38.29 is already the natural carrier.

### 38.9 Effective execution input (frozen)

At Confirm, the effective input is built and snapshotted. It is **not** the `FormDescriptor`:

```
effective input  =  target + form values + Issue context + selected ContextRefs + trigger provenance
```

`IssueRun.input` remains the **execution-time snapshot** (§37.12) — "what this run actually received".
`FormDescriptor` is never persisted as run input.

### 38.10 `ContextBuilder` relationship

**Reuse the existing single `ContextBuilder` seam.** Do **not** create `WorkflowContextBuilder` /
`AgentContextBuilder` / `TeamContextBuilder` — that would fork one abstraction into parallel systems.

The existing `ContextInput` concept is extended additively with the interaction's form values:

```
ContextInput
  IssueTitle, IssueDescription
  Task                 (Task Mode)
  InteractionValues    (Form Mode — NEW, empty for mention/task)
  TargetType, TargetID
  RecentComments
  ContextRefs
```

One invocation-time seam, one builder, one snapshot location. A Workflow-specific adapter, if ever
needed, lives **in the adapter layer** (`internal/collab` / a future workflow adapter), never in issue
core.

### 38.11 `InputAssistProvider` contract (consuming-side)

```
InputAssistProvider
  Build(ctx, AssistInput) (AssistSuggestion, error)

AssistInput
  Target        {type, id}
  FormDescriptor
  CurrentValues   form-value map (§38.15)
  IssueContext    title / description / recent comments
  ContextRefs     the issue's selected refs

AssistSuggestion
  Values          partial map: field key → suggested value   (field-level patch, §38.12)
  ContextRefs     suggested refs                              (suggestions only, §38.13)
  Explanations?   optional per-key rationale (human-readable)
```

It is a **suggestion-only** port (§37.7). Ownership of a real implementation stays OPEN (§38.31).

### 38.12 AI Assist authority boundary (frozen)

```
AI Assist → suggest → user review → apply → confirm → execute
```

**Forbidden for AI Assist:** creating an `IssueRun`; dispatching execution; changing issue/run status;
sending a notification; mutating any external system. The provider returns data; it has no side
effects on Issues.

### 38.13 Suggestion merge semantics (frozen)

Assist returns a **field-level patch**, not a full form:

```
{ "values": { "scope": "current-issue", "severity": "high" } }
```

Rules:

- Fields **not** present in the patch keep the user's current value — untouched.
- Assist must **not** clear a user-entered value unless it explicitly suggests an empty value for that
  key (and the UI shows that as a change).
- The user sees **current vs suggested** before applying (§38.26).
- Applying is a user action; `Ignore` leaves the current value.

### 38.14 Suggested context refs (frozen)

```
suggested context ref  ≠  automatically persisted context ref
```

- Applying a suggested ref makes it part of **this interaction's confirm payload** → it lands in the
  run's effective input snapshot.
- AI Assist must **not** create a permanent `IssueContextRef` row. Creating an issue-level ref stays an
  explicit user action through the existing context-refs API.
- This is why `Confirm` may carry `contextRefs[]` (§38.19): it is how "applied suggestion" is expressed
  without polluting the persistent ref table.

### 38.15 Validation responsibilities (layered)

| Layer | Validates |
| --- | --- |
| Frontend | `required`, basic type, value ∈ `options`, basic length/range — **UX only** |
| **Issues API (authoritative)** | `required`, known field keys, basic types, allowed values — re-validated on Confirm against the **current** descriptor |
| Future Workflow service | its own domain-level validation (semantics only it knows) |

The frontend is never trusted. Issues validation is *interaction* validation, not *domain* validation —
Issues does not know whether a given scope string is meaningful to the workflow.

### 38.16 Form value representation (frozen)

A plain **object keyed by field `key`**:

```json
{
  "repository": "ora-space/cloud",
  "branch": "main",
  "scope": "current-issue",
  "severity": "high",
  "includeDependencies": true
}
```

- Values are JSON scalars or string arrays — never nested objects.
- **No Workflow-specific columns.** `security_review_scope` / `security_review_severity` must **never**
  appear as Issue-domain columns; they exist only as keys inside this map.
- Unknown keys are rejected (§38.18).

### 38.17 FormDescriptor loading — decision

**Decision: Option B — `formRef` on the descriptor, fetched separately.**

```
InteractionDescriptor { mode: "form", requiresTask: false, formRef: "<opaque>" }
                                   ↓ (on selection)
GET /api/v1/tenants/{tid}/collaboration/forms/{formRef}   →  FormDescriptor
```

| | Verdict |
| --- | --- |
| A — embed the full `FormDescriptor` in every `CollaborationTargetSummary` | Rejected: forces the directory to resolve **every** workflow's schema on **every** picker open (a real Workflow module may be remote/slow), and bloats the uniform target projection. |
| **B — `formRef` + a dedicated read-only fetch** | **CHOSEN.** Keeps the picker projection thin and uniform, defers descriptor cost to selection time, gives a natural cache/refresh point, and matches §6.2, which already freezes `InteractionDescriptor{..., formRef?}`. |

`formRef` is **opaque** to Issues, tenant-scoped, and must be resolved server-side through the
provider (§38.30). It appears in a path segment, so it is constrained to a safe token pattern.

### 38.18 Descriptor versioning — decision

**Decision: no `descriptorVersion` field in the first version.**

- `formRef` is opaque and **may** encode a provider-side version (e.g. `security-review@3`); Issues
  never interprets it.
- On Confirm, Issues re-resolves the descriptor and validates against the **current** descriptor. If
  the provider changed it incompatibly, the user gets a validation error and re-configures.
- Recorded as **technical debt** (§38.31): a stale-form optimistic guard would need a provider-supplied
  version token compared at Confirm. Not designed now — Issues will not build a Workflow versioning
  system (§38.5).

### 38.19 Unavailable / error semantics (minimal)

Distinguish the four failure kinds without proliferating codes:

| Situation | Surface |
| --- | --- |
| Workflow capability not wired in this deployment | picker offers no workflow targets; a workflow interaction cannot be created |
| Provider wired but temporarily failing | `503 form_descriptor_unavailable` |
| `formRef` unknown to the provider | `404 form_descriptor_not_found` |
| Provider returned a malformed descriptor | `500 invalid_form_descriptor` (provider bug, fail closed) |

**`workflow_not_available` (409, shipped by 3B-1) is SUPERSEDED by this section — and is now gone.**
The target became configurable when 3B-2 landed; the unwired case is expressed by the table above
(`form_descriptor_unavailable`).

### 38.20 Interaction API surface (design only — do not implement this round)

Three new routes, all under the existing collaboration projection / issue-interaction boundary:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/tenants/{tid}/collaboration/forms/{formRef}` | Load the `FormDescriptor` projection |
| POST 🔑 | `/api/v1/tenants/{tid}/issues/{iid}/interactions/{ixid}/assist` | Request AI Assist suggestions for the interaction's current values |
| POST 🔑 | `/api/v1/tenants/{tid}/issues/{iid}/interactions/{ixid}/confirm` | Confirm → validate → build input → enqueue + dispatch the run |

Plus one **behaviour change** on an existing route: `POST /issues/{iid}/comments` with
`targets:[{type:"workflow", id}]` now **creates** the `mode='form'`, `run_id=NULL` interaction instead
of returning `409 workflow_not_available`.

Notes for the implementer (Cloud conventions that will bite):

- `values` / `contextRefs` are new **non-string** body fields → they must be added to `validField`
  (object / array-of-object arms) or they 400.
- `ixid` and `formRef` are **new path params** → add to `Route` + `PublicRequest` (`router.go` +
  `public.go`) in the same change.
- `/collaboration/forms/…` must be dispatched **before** the `Contains(path, "/issues")` /
  `/collaboration/targets` branches in `readPublic`/`openapi.go` (the two known traps, §25).
- No `/workflows/*` route may be added (§38.21).

### 38.21 Public API ownership boundary (frozen)

Issues **may** expose: collaboration target projection · interaction descriptor projection · form
descriptor projection · Issue interaction state · assist suggestions · confirm execution.

Issues **must never** expose: Workflow CRUD · Workflow publish · Workflow version management ·
Workflow graph/DAG · Workflow node mutation · Workflow execution internals.

### 38.22 Idempotency & concurrency (frozen design)

**Idempotency** (Cloud rules, §28):

```
POST /interactions/{ixid}/confirm   requires Idempotency-Key
same key + same request   → replay the stored response (no second run)
same key + different body → 409 idempotency_conflict
```

**Concurrent confirm** — two tabs confirming the same interaction must not create two initial runs.
Resolution reuses the existing transaction convention; **no distributed lock**:

1. The global advisory-locked transaction already serializes the two confirms.
2. Confirm performs a **compare-and-set**: `UPDATE issue_interactions SET run_id=$1 WHERE id=$2 AND
   run_id IS NULL`; **0 rows affected ⇒ already confirmed ⇒ `409 interaction_already_confirmed`.**
3. The existing `issue_run_pending_uniq` partial index (§37.10) remains a second layer for the same
   executor.

Because step 2 keys on `run_id IS NULL`, no interaction `version` column is required (§38.29).

### 38.23 Run creation timing (frozen)

```
Run is created ONLY after explicit Confirm.
```

Not on target selection. Not on AI Assist. Not on draft save. Not on form edit.

### 38.24 `ExecutionDispatcher` / `ExecutionObserver` reuse (frozen)

**Reuse both — do not create `WorkflowDispatcher` or a workflow-specific lifecycle.**
`executor_type='workflow'` already exists (§11); a future real adapter switches on
`target.type='workflow'` and forwards to the Workflow service. Issues core never learns the execution
mechanism (§29, §30).

Observer mapping for workflow:

```
started    → run.status=running          + activity run.started
progress   → activity run.progress       (message in details)   ← additive, §38.25
message    → activity run.message        (NOT a comment, §38.26)
completed  → run.status=completed        + activity run.completed
failed     → run.status=failed           + activity run.failed
cancelled  → run.status=cancelled        + activity run.cancelled
```

`ObserveProgress` is an **additive** method on `ExecutionObserver` (FROZEN DESIGN, implemented in 3B-2);
the existing methods and their 3B-1 semantics are unchanged.

### 38.25 Workflow result in the Timeline (frozen)

Timeline shows **coarse, human-readable** entries only:

```
Comment (user)  @Security Review Workflow
Activity        run.enqueued     — workflow queued
Activity        run.started      — workflow started
Activity        run.progress     — high-level progress (optional, may repeat)
Activity        run.message      — human-readable result / note
Activity        run.completed    — workflow completed
```

**Never** in the Timeline: node-by-node logs, raw execution logs, runtime stdout/stderr, tool debug
output. Those stay behind `ExecutionLogProvider` (§15). The Timeline/Logs boundary is unchanged.

### 38.26 Workflow message ActorRef (frozen)

**A Workflow is not an Actor** (§8: `ActorRef ∈ user|agent|team|system`; workflow exists only on the
*CollaborationTargetRef* side). Two candidates were compared:

| | A — reply `IssueComment` with `author_type='system'` | B — `IssueActivity` with `actor_type='system'` + workflow provenance in `details` |
| --- | --- | --- |
| ActorRef integrity | OK (system is a valid actor) | OK |
| Provenance | A comment has **no metadata field** → cannot record *which workflow* produced it without a migration | `details{runId, executorType:"workflow", executorId, message}` carries it natively |
| Schema change | needs a comment metadata carrier | **none** |
| Product framing | implies the workflow is a chat participant | keeps the workflow a capability, not a collaborator (§33) |

**CHOSEN: B.** Workflow human-readable output lands as an **`IssueActivity`** (`run.message` /
`run.result`) authored by `actor_type='system'`, with the workflow identity in `details`. **`workflow`
is NOT added to `ActorRef`.** Agent/Team replies stay `IssueComment` rows — the asymmetry is
intentional: an agent/team is a conversational collaborator, a workflow is not.

If a future product decision wants workflows to appear as conversational participants, Option A is the
additive path and requires a comment-provenance carrier first — recorded as OPEN (§38.31).

### 38.27 Frontend component architecture (frozen)

```
TargetPicker
   ↓ mode = form
WorkflowInteractionComposer
   ├── DynamicFormRenderer      ← renders from FormDescriptor ONLY
   │      └── FormFieldRenderer ← one control per field type
   ├── AssistSuggestions        ← current vs suggested, Apply / Ignore
   ├── ContextSelector          ← REUSE the existing issue context-refs UI
   └── ConfirmReview            ← target + values + context → Back / Confirm
```

**Hard rule:** `DynamicFormRenderer` renders **only** what the descriptor declares. This is forbidden:

```
if (workflow.id === "security-review") render <SecurityReviewForm/>
```

Minimal component boundary: `WorkflowInteractionComposer`, `DynamicFormRenderer`,
`FormFieldRenderer`, `AssistSuggestions`, `ConfirmReview`. No further decomposition in v1.

### 38.28 Review / Confirm UI behavior (frozen)

- A distinct **Review** step precedes Confirm. It shows: the workflow target, the effective form
  values, the selected context refs, and which values came from applied suggestions.
- Actions: **Back / Edit** and **Confirm**. Nothing else commits.
- A field change is **never** treated as an execution trigger — not even the last field's change.

### 38.29 Persistence map (frozen)

| Artifact | Where |
| --- | --- |
| `FormDescriptor` | **Not persisted** — provider projection, fetched per selection (§38.17) |
| Draft form values | **Not persisted** — frontend-only (§38.8) |
| Applied suggestions | **Not persisted separately** — merged into the confirmed values / confirm payload |
| Confirmed form values | `issue_interactions.input` (new generic jsonb column, §38.30) |
| Effective execution snapshot | `issue_runs.input` (existing, §37.12) |
| Persistent issue context | `issue_context_refs` (existing; **not** written by AI Assist) |

### 38.30 Does 3B-2 need a migration? — yes, one additive column

**Yes — a minimal additive `0009_issue_interaction_input.sql`:**

```sql
ALTER TABLE issue_interactions
  ADD COLUMN input jsonb NOT NULL DEFAULT '{}'
  CHECK (jsonb_typeof(input) = 'object');
```

That is the whole migration. Deliberately **not** included:

| Rejected | Why |
| --- | --- |
| interaction `version` | Confirm is a compare-and-set on `run_id IS NULL` (§38.22); no other mutation exists. |
| interaction `status` enum | Derivable from `run_id` + `issue_runs.status` (§38.6). |
| `confirmed_at` | Duplicates the run's `queued_at`. |
| a separate `interaction_inputs` table | 1:1 with the interaction — an extra table and join for no benefit. |
| Workflow-specific columns | Forbidden (§38.16). |

**`0008_issue_interactions.sql` is not modified.** The column is **generic** (any interaction mode may
carry configuration), so it is not a Workflow-only field.

### 38.31 Security invariants (frozen)

1. A client **cannot invent target capabilities** — every target/descriptor/mode is resolved
   server-side through `CollaborationDirectory` / the descriptor provider.
2. A client **cannot set `mode`** — it is derived server-side (§37.2 `modeForType` + the descriptor);
   the client never sends it.
3. A client **cannot bypass form validation** — Confirm re-validates against the current descriptor.
4. A client **cannot confirm another tenant's interaction** — interaction lookup is tenant- and
   issue-scoped; foreign/missing → 404.
5. A client **cannot forge an external execution result** — `ExecutionObserver` is not an HTTP route
   (verified in 3B-1: no `Observe*` route is registered).
6. A client **cannot forge a Workflow descriptor** — descriptors come only from the provider; the
   frontend descriptor is a **rendering hint, never an authorization source**.
7. `formRef` resolution is tenant-scoped and provider-backed; an unknown ref is a 404, never a leak.

### 38.32 Fixture / mock strategy (extends §37.13)

Additions to the existing fixture set — same constraints (dev/demo only, production default OFF, no
`sim_*` tables, no mock domain tables, removable without touching issue core):

```
FixtureFormDescriptorProvider   → the Security Review Workflow's demo descriptor
MockInputAssistProvider         → deterministic suggestions (no LLM, no AI)
MockExecutionDispatcher         → REUSED unchanged, executor_type="workflow"
```

The mock workflow must still travel the real chain:

```
interaction → Confirm → IssueRun → ExecutionDispatcher → ExecutionObserver → Timeline
```

### 38.33 Example fixture (demo only — NOT a real Workflow schema)

The `Security Review Workflow` fixture's descriptor may declare, for demo purposes:

| key | type | required |
| --- | --- | --- |
| `repository` | `text` | yes |
| `branch` | `text` | no |
| `scope` | `select` (`current-issue` / `full-repo` / `changed-files`) | yes |
| `severity` | `select` (`low` / `medium` / `high`) | yes |
| `includeDependencies` | `boolean` | no |
| `additionalInstructions` | `textarea` | no |

These field names live **only** in the fixture adapter. The frontend must not hard-code them (§38.27).

### 38.34 Open questions left by Wave 3B-2

| # | Question | Why still open |
| --- | --- | --- |
| W1 | Who owns the real `InputAssistProvider` implementation? | Cloud has no LLM/runtime (§37.17 Q6). Unchanged. |
| W2 | Who owns the real Workflow service behind the descriptor provider? | BLOCKED ON EXTERNAL DESIGN (§0, §9). |
| W3 | Is draft persistence ever needed? | v1 chooses frontend-only (§38.8); the `input` column is the additive path. |
| W4 | Should the descriptor carry a version token for stale-form detection? | v1 has no versioning (§38.18); `formRef` may encode a provider-side version. |
| W5 | Is a per-interaction context-ref *subset* selection needed? | v1 uses the issue's `issue_context_refs` wholesale, exactly like Task Mode. |
| W6 | Do workflows ever need to author conversational `Comment`s? | v1 uses activities (§38.26); Option A needs a comment-provenance carrier. |
| W7 | A `context_ref` field type (repository/branch picker)? | Deferred; `text` + autofill covers v1 (§38.4). |
| W8 | Conditional/computed/repeating form semantics? | Explicitly out of scope; a future ADR, not a 3B-2 extension (§38.5). |

### 38.35 Out of scope for Wave 3B-2

Real Workflow engine · Workflow database/domain model · Workflow versioning · execution engine · DAG ·
nodes · scheduler · real AI Assist / LLM calls · real Runtime · Notification · Realtime · PR
integration · Execution logs · `ConversationTarget` persistence · implicit continuation · any
`/workflows/*` API.

### 38.36 Recommended implementation order (3B-2)

| Step | Focus |
| --- | --- |
| 1 | `FormDescriptor` types + `FormDescriptorProvider` port (+ fixture) in `internal/core` / `internal/collab`. |
| 2 | Migration `0009` (one column) + `ContextInput.InteractionValues`. |
| 3 | `GET /collaboration/forms/{formRef}` (+ `validField`/`PublicRequest`/OpenAPI branches). |
| 4 | Comment path: workflow target creates a `mode='form'`, `run_id=NULL` interaction (supersedes `workflow_not_available`). |
| 5 | `POST /interactions/{ixid}/confirm` — validate → build input → CAS `run_id` → enqueue → dispatch. |
| 6 | `InputAssistProvider` port + `POST /interactions/{ixid}/assist` (+ mock). |
| 7 | `ObserveProgress` + `run.message`/`run.progress` activities (workflow output, system actor). |
| 8 | Frontend: `WorkflowInteractionComposer` → `DynamicFormRenderer` → `AssistSuggestions` → `ConfirmReview`. |
| 9 | Demo + integration tests + docs sync (this section → IMPLEMENTED). |

### 38.37 Implementation record (2026-09-20) — IMPLEMENTED + VERIFIED

All nine steps landed. Migration `0009_issue_interaction_input.sql` added the single generic
`issue_interactions.input jsonb NOT NULL DEFAULT '{}'` column exactly as designed; `0007`/`0008` were
not touched.

| Area | What landed |
| --- | --- |
| Ports | `FormDescriptorProvider` + `InputAssistProvider` (new, `internal/core/collaboration.go`); `Store.Forms` / `Store.Assist` (nil = Unavailable, 503). |
| Descriptor | `FormDescriptor`/`FormField`/`FormOption` + `validateFormDescriptor` + `validFieldValue` + `formDescriptorObject` (`internal/core/form_descriptor.go`). Field types: `text`/`textarea`/`number`/`boolean`/`select`/`multi_select`. |
| Interaction descriptor | `InteractionDescriptor.FormRef` (additive); the picker projection carries it, never the descriptor itself. |
| API | `GET /collaboration/forms/{formRef}`; `POST /issues/{iid}/interactions/{ixid}/assist`; `POST /issues/{iid}/interactions/{ixid}/confirm`. New path params `:formRef` (non-UUID, token-constrained) and `:ixid`; `values`/`contextRefs` added to `validField`. |
| Comment path | A `workflow` target now inserts a `mode='form'`, `run_id=NULL` interaction; **no run, no dispatch** — `409 workflow_not_available` is gone. |
| Confirm | Re-resolves target + descriptor, re-validates values, persists `interaction.input`, enqueues the run with `trigger_evidence_kind='interaction'`, then claims via `UPDATE … WHERE run_id IS NULL` (0 rows ⇒ `409 interaction_already_confirmed`). Dispatch stays post-commit. |
| Assist | Side-effect free: never writes `interaction.input`, never creates a run, never persists a context ref. Suggestions are filtered against the current descriptor before leaving the server. |
| Observer | `ObserveProgress` added → `run.progress` activity (no status change). `ObserveMessage` branches: a workflow run's message becomes a `system` activity with `details{runId,executorType,executorId,message}`; agent/team replies remain comments. |
| Run activities | `activityActor()` maps a workflow run's activities to `system` (a workflow is not an ActorRef); `runActivityDetails()` carries the executor identity in `details`. |
| Fixtures | `FixtureFormDescriptorProvider` (Security Review, 6 fields) + `MockInputAssistProvider` (deterministic, no LLM, no randomness); `MockExecutionDispatcher` gained the workflow branch (progress + simulated result that states no real scan ran). Wired only in `cmd/ora-web` + the integration harness. |
| Frontend | `WorkflowInteractionComposer`, `DynamicFormRenderer`, `FormFieldRenderer`, `AssistSuggestions`, `ConfirmReview`; the `@` picker now offers workflow targets (the 3B-1 "本阶段不可用" state is gone); the Activity panel opens the composer for the newest unconfirmed form interaction and shows confirmed ones as `已确认 · 运行 <status>`. |

**Revision — the workflow fixtures retired (migration `0014`).** The `workflow` half of the fixture set
was always a placeholder for a module that did not exist yet. Once the Workflow module landed,
`SecurityReviewWorkflowID`, `ReleaseWorkflowID` and `FixtureFormDescriptorProvider` were **deleted**:
`core.WorkflowDirectory` + `core.WorkflowFormDescriptors` (`internal/core/workflow_collaboration.go`) are
production adapters wired by `core.NewStore` in **every** deployment, and
`collab.WireDevelopmentFixtures` now *layers* the agent/team fixtures in front of that directory
(`FallbackDirectory`) rather than replacing it. A workflow's descriptor is projected from its own Start
node's input variables, and `formRef` **is** the workflow id, so the advertised ref and the resolvable
row cannot drift. Consequence: `@`-ing a workflow now means a real user-authored workflow, and the
`Security Review Workflow` the design text above describes exists only as a test fixture created through
the public API (`integration/workflow_interaction_test.go`). `MockInputAssistProvider` and
`MockExecutionDispatcher` remain fixtures.

**Revision — the form is a draft (§38.37a).** The first shipped build created the comment + interaction
the moment a workflow target was selected, and hung Assist/Confirm off that interaction. Product review
rejected that: selecting a workflow must leave **no trace** in the Timeline, and each target needs its
own message box and its own submit button. The shipped model is therefore:

| | Shipped behaviour |
| --- | --- |
| Selection | Stages the target **client-side only** — no comment, no interaction, no run. |
| Form | A **draft**: descriptor + values + suggestions live in React state. |
| AI Assist | `POST /issues/{iid}/collaboration/assist` — **stateless**, keyed by `targetId`; works with no interaction and writes nothing. |
| Confirm | The first write: posts the comment (creating the `mode='form'`, `run_id=NULL` interaction) and immediately confirms it → run. |
| Abandoning | Removes the draft; nothing was ever sent. |
| Per-target submit | Human mention / Agent task / Team task each carry their own message box + 提交 button; only that button records the comment + interaction. |

Consequence: a `mode='form'`, `run_id=NULL` interaction now exists only transiently (between the
comment POST and the confirm POST), so it is **not** a durable "continue later" state — §38.6's
`run_id IS NULL` marker remains the schema semantics, but the UI no longer surfaces it. The
interaction-scoped `POST /interactions/{ixid}/assist` route was removed with this revision.

**Deviations from the approved §38 design — two, both additive:**

1. **`409 interaction_not_confirmable`** was added to the error set (§38.19 listed nine codes). Confirming
   or assisting a non-`form` interaction (e.g. a mention) is a distinct resource-state conflict, not an
   input error, so it needed its own code rather than being folded into `invalid_interaction_input`.
2. **503 responses are now declared in the OpenAPI contract for every route.** The document previously
   listed only 400/401/403/404/409/428/500; a port-backed route can legitimately answer 503
   (`form_descriptor_unavailable`, `assist_unavailable`), and the integration contract-validating
   transport rejects undeclared statuses.

Nothing else diverged: the descriptor is never persisted, drafts stay frontend-only, no
`WorkflowDispatcher`/`WorkflowContextBuilder` was created, no `/workflows/*` route exists, and
`ActorRef` was not widened.

**Verification evidence:**

- `go build ./...`, `go vet ./...`, `go test ./internal/... ./cmd/...` — PASS; `go run ./cmd/openapi`
  idempotent + `internal/contract` byte-check PASS; `gofumpt -l -extra` clean on every touched file.
- Full integration suite against real PostgreSQL — PASS, including the 8 new
  `integration/workflow_interaction_test.go` tests (unconfirmed interaction/no run; descriptor
  projection + 404s; provider 503 / malformed 500; assist determinism + zero side effects; confirm
  validation ×5, exactly one run, `interaction.input`, run snapshot, provenance, timeline shape,
  strictly increasing `seq`; idempotent replay + `409`; scope/mode guards; assist unavailable) and the
  updated 3B-1 `TestCollaborationTargetValidation`.
- Frontend under Node 24.21.0: `typecheck` PASS, `test` PASS (29 files / 85 tests, incl. 6 new
  composer tests and 4 new Activity-panel workflow tests), `build` PASS, `check:modules` / `check:docs`
  / `check:dead` / `check:dup` PASS. `lint` and `format:check` remain red **only** on the pre-existing
  debt in untouched files — this wave adds **zero** new lint/prettier violations.
- Live demo smoke through `cmd/ora-web` + real PostgreSQL: target advertises `formRef` → descriptor
  loads → comment creates the interaction with **0 runs** → assist returns deterministic suggestions
  with **no** run/input/ref side effects → three invalid confirms rejected 400 → confirm creates
  **exactly one** completed run with `provenance=interaction:<ixid>` and a full `interactionValues`
  snapshot → timeline `comment, run.enqueued(user), run.started/progress/message/completed(system)` →
  double confirm `409` → same-key replay returns the same run → 0 workflow-authored entries. Foundation
  regression re-checked live: mention produces no run, agent/team tasks still produce comments, shared
  `seq` ordering intact, `authorType` impersonation still 400.