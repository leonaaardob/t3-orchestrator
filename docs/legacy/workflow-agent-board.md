> **Legacy archive only — not active orchestration doctrine.**
> Active authority: `docs/internals/orchestration-instruction-authority.md` and
> the T3 Supervisor Contract/Playbook. Ignore tiny-fix allowances and
> `.t3/agent-board.json` Source Of Truth claims in this archive.

---

tracker:
kind: t3-local
board_file: .t3/agent-board.json
active_states: - Ready - Running - Diagnosing - Reviewing
terminal_states: - Done - Canceled
polling:
interval_ms: 15000
workspace:
root: .t3/workspaces
strategy: per-card
agent:
max_concurrent_agents: 1
max_turns: 20
max_retry_backoff_ms: 300000
max_repair_cycles: 3
review_agent: fresh
provider:

# Workers run through T3's provider-neutral runtime; no CLI or driver is

# pinned here. Execution presets (environment→project) select the model per

# operation: Simple (one ModelSelection for impl/review/repair) or Advanced

# ({implementation, review, repair} each ModelSelection). Environment default

# is `ServerSettings.agentExecutionPresets` (Simple: codex/gpt-5.6-sol); a

# project may override via `OrchestrationProject.agentExecutionPresets`

# (null = inherit). Legacy `runner.workerModelSelection` and

# `defaultModelSelection` synthesize Simple presets only when no modern

# preset exists at either level. Review independence is enforced: same

# instanceId+model for impl and review blocks review with Needs Decision.

# This front matter documents intent; .t3/agent-board.json is authoritative

# for the legacy board override field.

runtime: t3-provider-neutral
worker_model_selection_source: ServerSettings.agentExecutionPresets -> OrchestrationProject.agentExecutionPresets (inherit) -> legacy runner.workerModelSelection / defaultModelSelection only if no modern preset

---

# T3 Code Agent Board Workflow

> **Deprecated as the product orchestration control plane (ORCH-044).**
> Runtime boards, proof, workspaces, Supervisor Contract/Playbook, worker
> packets, and Fast Mode live in T3 server state and product code. See
> `docs/internals/orchestration-instruction-authority.md`. This file remains
> historical / fork-maintainer documentation; front matter paths like
> `.t3/agent-board.json` describe the **legacy** layout only (one-shot import).

Status: Deprecated (legacy reference) — was Draft v1

Purpose: historical description of the fork’s Symphony-shaped board workflow.
Do not treat this file as authoritative for Supervisor identity or end-user
project orchestration.

## Symphony Alignment

This workflow intentionally follows the OpenAI Symphony shape:

- `WORKFLOW.md` is the repository-owned policy and runtime contract.
- Front matter uses the Symphony top-level sections where possible:
  `tracker`, `polling`, `workspace`, `hooks`, `agent`, and `provider`.
- The board runner is the scheduler/orchestrator. It claims eligible work,
  creates or reuses isolated workspaces, launches the configured provider
  worker through T3's runtime, retries recoverable
  failures, reconciles state, and exposes operator-visible status.
- The prompt body below is the per-card task policy. Runtime behavior belongs
  in front matter; ticket/card handling rules belong in this Markdown body.

T3-specific behavior is an extension, not a replacement:

- `tracker.kind: t3-local` means the local `.t3/agent-board.json` file is the
  tracker instead of Linear.
- `tracker.board_file` is the project-local authoritative board path.
- `workspace.strategy: per-card` means workspace keys are derived from board
  card IDs instead of external issue identifiers.
- `agent.max_repair_cycles` and `agent.review_agent` define this fork's
  self-repair and fresh-review behavior.

Unknown future Symphony fields should be ignored unless this fork implements
them. Unknown T3 extension fields must be documented here before agents rely on
them.

## Source Of Truth

Agents and the board runner must treat these files as the control stack, in
this order:

1. `AGENTS.md`
2. `WORKFLOW.md`
3. `PROJECT.md`
4. `CONTEXT.md` or `CONTEXT-MAP.md`
5. `docs/agents/project-master-plan.md` when present
6. The relevant slice plan under `docs/agents/slices/` when present
7. The linked task record under `docs/agents/tasks/`
8. `.t3/agent-board.json`

`WORKFLOW.md` defines how agents work. `PROJECT.md` defines what the project is
trying to become. Task records define exact runnable scope. The board file
stores live orchestration state.

## Planning Stack Convention

T3 Code should support this project-local planning stack:

```text
WORKFLOW.md
PROJECT.md
CONTEXT.md or CONTEXT-MAP.md
docs/agents/project-master-plan.md
docs/agents/slices/*.md
docs/agents/tasks/*.md
.t3/agent-board.json
```

Only `WORKFLOW.md` is required for the runner contract. The other files are
recommended context anchors for fresh agents and larger projects.

## Supervisor-First Operating Model

The default agent role is Supervisor/Architect. The user may speak mostly to
this supervisor instead of manually managing the Kanban board.

The supervisor owns:

- architectural pass and request shaping
- board card creation and updates
- slice and task documentation
- dependency and parallelism decisions
- worker handoff packet generation
- review/audit coordination
- proof-of-done enforcement
- final board/task sync

The supervisor should not casually implement production code. For non-trivial
code changes, it should delegate implementation to fresh worker agents when
orchestration is available and authorized. Worker agents receive bounded
handoff packets and report back to the supervisor. The supervisor integrates
the result, updates docs, verifies proof, and decides whether the card can move
forward.

The Supervisor is a normal T3 thread with title `Project Supervisor`, pinned
via the existing `thread.pin` API and rendered with a `Supervisor` badge in the
thread list (see `apps/web/src/lib/supervisorThread.ts`). No orchestration
state is stored in `.t3/agent-board.json`.

Direct supervisor edits are acceptable for low-risk docs, board maintenance,
formatting, and tiny explicitly requested fixes. Any direct edit that changes
architecture, workflow, dependency truth, or public patch behavior must update
the relevant docs before closure.

## Architectural Pass

Before a non-trivial card becomes `Ready`, the supervisor should perform an
architectural pass:

1. Classify the request as idea, bug, feature, refactor, design change,
   research, future scope, or maintenance.
2. Place it in an `area` and `slice`.
3. Link or create the relevant slice plan and task record.
4. Define intent, desired outcome, acceptance criteria, constraints, non-goals,
   dependencies, parallelism safety, and allowed write scopes.
5. Identify open decisions that require the user.
6. Decide whether the work requires clarification, TDD, orchestration,
   team-audit, or future-scope parking.
7. Update `.t3/agent-board.json` so the visual board reflects the proof ledger.

If the request is unclear, the supervisor should ask intent or decision
questions before delegating coding work.

## Board States

Use these local board states:

- `Backlog`: captured work that is not eligible for pickup.
- `Draft`: generated or rough work that needs user acceptance or clarification.
- `Ready`: eligible for autonomous agent pickup.
- `Running`: claimed by an implementation agent.
- `Diagnosing`: implementation is being repaired or verified.
- `Reviewing`: a fresh review agent is evaluating or integrating the work.
- `Review`: work is complete enough for human visibility or final inspection.
- `Done`: proof, integration, and board/task updates are complete.
- `Blocked`: blocked by another task or missing external condition.
- `Needs Decision`: blocked by user intent or a decision the agent should not make.
- `Canceled`: intentionally stopped.

`Ready` is the only launch state. New cards must not default to `Ready`.

## Work Card Eligibility

A work card may enter `Ready` only when all are true:

- It has a title and intent brief.
- It links to a task record, or T3 Code can generate one before launch.
- Acceptance criteria or proof-of-done are specific enough to verify.
- Non-goals and scope guards are explicit for non-trivial work.
- Dependencies are listed.
- Parallelism metadata is present when the user wants concurrent execution.
- The card is not blocked by an owner decision.

If eligibility is missing, T3 Code should run the clarification flow instead of
starting implementation.

## Clarification Flow

T3 Code may interview the user one question at a time to create or refine a
task record. The resulting intent brief should capture:

- owner intent
- desired outcome
- acceptance criteria
- constraints
- non-goals
- dependencies
- relevant files or docs
- target status
- proof-of-done expectations
- open decisions
- parallelism plan

Cards created from rough user input start in `Backlog` or `Draft`. Moving a
card to `Ready` is the deliberate start-work signal.

## Task Records And Board Sync

Task records are durable planning documents. Board cards are operational
control handles.

Planning fields may sync between a card and its task record:

- title
- intent
- acceptance criteria
- constraints
- non-goals
- dependencies
- priority
- agent eligibility
- allowed write scopes
- parallelism plan

Runtime state belongs in `.t3/agent-board.json`:

- board state
- workspace path
- branch name
- agent run IDs
- attempt count
- heartbeat
- current error
- review status

Proof and implementation history belong in the task record:

- implementation summary
- changed files
- verification results
- review findings
- proof-of-done
- remaining gaps
- decisions made

## Dependency Graph Sync

The Planning dependency graph is a generated view over `.t3/agent-board.json`.
Agents must update structured board fields whenever they update planning
markdown:

- `area` defines the larger sub-project grouping.
- `slice` defines the smaller vertical chunk.
- `dependencies` lists prerequisite card IDs, one edge per dependency.
- `slicePlanPath` links the card to its slice plan.
- `taskRecordPath` links the card to its runnable task record.

Markdown task records and slice plans may explain why dependencies exist, but
they must not become the only source of dependency truth. If an agent discovers
that one card blocks another, it should update the dependent card's
`dependencies` array and mention the reason in the task or slice markdown.

Dependency edges mean hard execution blockers only. Use this vocabulary in task
records and slice plans so agents do not turn every relationship into a blocking
dependency:

- `depends on`: the card cannot be completed or verified until the referenced
  card is done. Add the referenced card ID to `dependencies`.
- `connects to`: the cards must coordinate, but they may run in parallel when
  their contract is documented.
- `shares contract with`: the cards meet at an API, schema, event, route, data
  shape, permission rule, or UI state. Document the contract in the slice/task
  markdown.
- `conflicts with`: the cards should not run in parallel because they touch the
  same files, migrations, state model, or user workflow. Put this in the
  parallelism plan instead of `dependencies`.
- `enables`: the referenced work makes this card usable or demonstrable, but is
  not required to implement the card.

Examples:

- Backend auth endpoint `shares contract with` frontend login form.
- Frontend login form `shares contract with` backend auth endpoint.
- End-to-end login flow `depends on` backend auth endpoint and frontend login
  form.
- Admin user management `connects to` authorization roles and `shares contract
with` the user/permission schema.

Recommended task/slice metadata when useful:

```md
Area: `Backend`
Slice group: `Estimate engine`
Depends on:

- `TASK-...`
  Board card: `TASK-...`
  Connects to:

- `TASK-...`
  Shares contract with:

- `API: POST /auth/login`
- `Schema: AuthSession`
  Conflicts with:

- `TASK-...`
```

## Autonomous Delivery Loop

When a card enters `Ready`, the board runner should:

1. Claim the card and move it to `Running`.
2. Create or reuse an isolated card workspace.
3. Launch the implementation agent in the card workspace.
4. Provide the agent with the workflow, project context, linked task record,
   relevant slice plan, and current attempt history.
5. Run focused verification requested by the task record.
6. Self-diagnose and repair routine failures.
7. Spawn a fresh review agent with no implementation-thread context
   (new thread, same `.t3/workspaces/<card-id>` worktree, review prompt built
   from task record + acceptance criteria + proof + diff via
   `buildAgentBoardReviewPrompt`, model selection via `resolveWorkerModelSelection`).
8. Let the fresh review agent evaluate: `REVIEW: PASS` → `Review`/`Done`,
   `REVIEW: FAIL` routine → `Diagnosing` → repair turn on the implementation
   thread (`buildAgentBoardRepairPrompt`) → next `Reviewing`; capped at
   `agent.max_repair_cycles` (default 3) → `Needs Decision`; intent questions
   (`NEEDS_DECISION:`) → `Needs Decision` immediately. Append review/repair
   proof to the task record when it exists.
9. Update the board card (`runtime.reviewRunId`, `currentError`,
   `currentDecisionQuestion`, `lastHeartbeatAt`) and task record with proof.
10. Move the card to `Review`, `Done`, or `Needs Decision`.
11. Continue to the next eligible `Ready` card.

The first implementation turn should receive the full rendered card prompt:
workflow, project context, linked task record, linked slice plan, board card
fields, and attempt history. Continuation turns should send only continuation
guidance and the current board/task delta; do not resend the full prompt unless
the prior thread cannot be resumed.

Routine implementation failures should stay inside the autonomous loop:

- test failure
- lint failure
- typecheck failure
- incomplete implementation
- review-agent bug finding
- merge or patch conflict that can be repaired safely

The card moves to `Needs Decision` only when the blocker is about intent,
scope, risk, missing credentials, cost/rate limits, destructive actions, or a
materially different direction.

After three failed repair cycles, the card moves to `Needs Decision` with a
summary of what was tried, what failed, likely cause, and the exact question for
the user.

## Polling, Claiming, Retry, And Reconciliation

The server starts the board scheduler automatically. Every 15 seconds it
reconciles all project boards before claiming eligible `Ready` cards through
the shared runner; the Planning UI does not need to be open.

1. Load and validate `WORKFLOW.md`.
2. Reconcile `Running`/`Reviewing`/`Diagnosing` cards before dispatch.
3. Read `.t3/agent-board.json`.
4. Select candidate cards from `tracker.active_states`.
5. Skip cards already claimed, running, terminal, blocked by dependencies, or
   missing the `Ready` eligibility bar.
6. Sort candidates by priority, then oldest created/updated timestamp, then
   stable card ID.
7. Claim up to `agent.max_concurrent_agents` cards.
8. Dispatch each claimed card into its isolated workspace.
9. Record status, attempt count, workspace path, heartbeat, and latest error
   back to `.t3/agent-board.json`.

Retry behavior:

- A completed implementation turn moves the card to `Reviewing` with a fresh
  review thread (same worktree, new thread, `runtime.reviewRunId` persisted);
  it never moves directly to `Review` or `Done`. The review prompt is built
  server-side from task intent, acceptance criteria, and workspace context via
  the shared `agentBoardPrompt` resolver and `runner.workerModelSelection`.
- Failed or interrupted implementation turns, dead sessions, stale heartbeats,
  and missing implementation threads are retried as short continuation turns
  on the same implementation thread. Backoff is exponential, starts at a few
  seconds, and is capped by `agent.max_retry_backoff_ms`.
- `Reviewing` cards are polled via `ProjectionSnapshotQuery.getThreadShellById(reviewRunId)`
  and `getThreadDetailById(reviewRunId)`; the review result is parsed from
  `REVIEW: PASS` / `REVIEW: FAIL - reason` / `NEEDS_DECISION: question` markers:
  `PASS` → `Review` (human) with proof appended to the task record,
  `FAIL` routine → `Diagnosing` → repair turn on the implementation thread
  (same worktree/thread) → next `Reviewing` with a new review thread,
  `NEEDS_DECISION` or intent question → `Needs Decision` immediately.
- `Diagnosing` cards wait for the repair turn to complete, then launch a new
  review thread and move to `Reviewing`.
- `runtime.attemptCount` persists and caps full review/repair cycles at
  `runner.repairCycles` (default 3); exhausted cards move to `Needs Decision`
  with a summary of attempts, last failure, and (for intent) the exact
  question for the user.
- Backoff deadlines are intentionally in-memory scheduler state. Restarting
  may discard a pending delay, but durable attempt metadata still prevents an
  unbounded retry loop.

Reconciliation behavior:

- If a running/reviewing/diagnosing card is moved to `Done`, `Canceled`,
  `Blocked`, or `Needs Decision`, stop its active worker(s) safely
  (implementation and review threads).
- If a running card loses eligibility, release the claim and preserve the
  workspace unless cleanup is explicitly safe.
- If the runner restarts, recover from `.t3/agent-board.json` and existing
  workspaces. Exact in-memory scheduler state does not need to survive restart.
- If a user moves a card out of `Running`/`Reviewing`/`Diagnosing`, interrupt
  its active turn(s) and do not relaunch them.
- Invalid workflow reloads must not crash an active session. Keep using the
  last known good workflow and surface the validation error.

## Workspace Rules

Each runnable card gets an isolated card workspace. Agents must not work
directly in the main project folder unless the workflow explicitly allows it for
a low-risk documentation task.

The board runner should record each card's workspace path, branch name when
applicable, and current run IDs in `.t3/agent-board.json`.

Workspace keys should be deterministic and safe for filesystem use. Derive the
key from the stable board card ID by replacing any character outside
`[A-Za-z0-9._-]` with `_`, then create the card workspace under
`workspace.root`.

Workspaces are reused across retries for the same card. Successful runs do not
delete workspaces automatically. Cleanup is allowed only when the card is in a
terminal state and no active review, merge, or human inspection still needs the
workspace.

If workspace hooks are added later, use the Symphony hook names and semantics:

- `hooks.after_create`: run only when a workspace is newly created; failure
  aborts the attempt.
- `hooks.before_run`: run before each implementation/review attempt; failure
  aborts the attempt.
- `hooks.after_run`: run after success, failure, timeout, or cancellation;
  failure is logged but does not overwrite the run result.
- `hooks.before_remove`: run before deleting a workspace; failure is logged and
  cleanup may continue only when the workflow explicitly allows it.

## Parallelism Rules

Default concurrency is one running card per project.

Parallel execution is allowed only when the planning metadata says it is safe.
The parallelism plan should document:

- whether concurrent execution is safe
- why it is safe
- dependencies
- cards or scopes it conflicts with
- allowed write scopes

The runner should not infer parallel safety from user impatience alone.

## Board Views

Kanban is the primary control view.

T3 Code should also support:

- list/table view for dense filtering, sorting, and bulk editing
- expanded board view for planning sessions
- execution path view for dependency lines, node-style sequencing, or
  Microsoft Project-style timeline visualization

All views render the same work cards and task records. Alternate views must not
create a separate planning system.

## Handoff Rules

Before a card becomes `Done`, T3 Code or the active agents must update:

- board runtime state
- linked task record proof
- changed file summary
- verification result
- review-agent result
- remaining gaps
- next recommended card when known

If the work changes project language, workflow rules, architecture direction, or
planning status, update the relevant context, workflow, project, slice, or task
documents before closing the card.

## Workpad And Proof Ledger

Symphony's Linear workflow uses one persistent workpad comment per issue. This
fork mirrors that idea with one persistent task record per board card.

For each runnable card:

- Find or create the linked task record before implementation.
- Treat that task record as the persistent workpad and proof ledger.
- Keep plan, acceptance criteria, validation, notes, blockers, and final proof
  updated in that one record.
- Do not scatter progress across unrelated comments, chat turns, or ad hoc
  markdown files.
- Keep `.t3/agent-board.json` synchronized with task-record state so the
  visual board reflects the proof ledger.

Before moving to `Review` or `Done`, the task record must show:

- completed plan checklist
- completed acceptance criteria
- validation commands/results
- changed files summary
- review-agent result
- unresolved gaps or explicit statement that none remain

## Installable Planning Stack

The planning stack should remain portable so it can be installed into another
T3 Code fork or another project folder with minimal spread.

Installable assets should stay concentrated in:

- `WORKFLOW.md`
- `PROJECT.md`
- `CONTEXT.md` or `CONTEXT-MAP.md`
- `docs/agents/project-master-plan.md`
- `docs/agents/slices/`
- `docs/agents/tasks/`
- `docs/agents/templates/`
- `.t3/agent-board.json`

Core code changes should attach through small, documented integration points.
Do not require users to hunt through unrelated files to understand or repair
the planning system.

## Patch Tracking

This project is intended to remain publishable as a public T3 Code modification
while upstream T3 Code continues to evolve. Keep `PATCH.md` current whenever
the planning system changes.

`PATCH.md` should list:

- fork-specific files and integration points
- core upstream files touched
- data contracts added or changed
- UI entry points added or changed
- server/RPC entry points added or changed
- known upstream break risks
- reinstall or repair notes

When an upstream update breaks this fork, future agents should start from
`PATCH.md`, then verify `AGENTS.md`, `WORKFLOW.md`, contracts, server board
services, and the Planning UI attachment points.
