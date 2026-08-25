# T3 Code Authoritative Agent Board Master Plan

Last updated: 2026-05-05

This is the canonical implementation plan for the authoritative agent board.
It breaks the product direction from `PROJECT.md` into slices that can become
task records and board cards.

## North Star

T3 Code should let users manage autonomous agent work through project-local
planning docs and a right-side board panel. The board is the source of truth for
which cards are ready, running, blocked, reviewing, or done.

## Symphony-Ready Board

### Ready For Agent

| Slice | Target | Task | Scope guard |
| ----- | ------ | ---- | ----------- |
| None  | -      | -    | -           |

### Backlog

| Slice                   | Reason                                               |
| ----------------------- | ---------------------------------------------------- |
| Board runner MVP        | Needs board persistence and workspace creation path. |
| Fresh review agent loop | Needs runner MVP and proof update path.              |
| Advanced board views    | Needs stable dependency and slice metadata.          |

### Needs Decision

| Topic                     | Required decision                                                       |
| ------------------------- | ----------------------------------------------------------------------- |
| Board persistence backend | Start with JSON, or use SQLite with JSON export from the beginning.     |
| Workspace integration     | Merge worktree branches, apply patches, or create review threads first. |

## Slices

### Slice 1: Durable Planning Stack And Board Contract

Status: `done`

Purpose:

- Establish the project-local file structure and typed board file contract that
  later UI and runner slices can build on.

Proof:

- `WORKFLOW.md`, `PROJECT.md`, context docs, slice docs, task records, and
  `.t3/agent-board.json` exist.
- `packages/contracts` exports an `AgentBoardFile` schema.
- Focused contract tests decode expected board files and reject title-only ready
  cards.
- `bun run test --filter @t3tools/contracts -- agentBoard`, `bun fmt`,
  `bun lint`, and `bun typecheck` passed.

### Slice 2: Board File Service

Status: `done`

Purpose:

- Add server-side read/write operations for `.t3/agent-board.json` scoped to a
  project root.

Proof:

- Server can load, validate, create, and update a project board file without
  touching unrelated project folders.
- `packages/contracts` exports board load/save RPC contracts.
- Web environment APIs expose typed `projects.loadAgentBoard` and
  `projects.saveAgentBoard` calls.
- Focused service tests cover create, missing file, save, and invalid Ready card
  paths.
- `bun run test --filter t3 -- AgentBoardFileSystem`, `bun fmt`, `bun lint`,
  and `bun typecheck` passed.

### Slice 3: Right-Side Board Panel

Status: `done`

Purpose:

- Add a collapsible board panel that renders the project board and card detail.

Proof:

- Users can view columns, create cards, edit planning fields, and move eligible
  cards to `Ready`.
- Added `AgentBoardPanel` using existing right-side panel affordances.
- The panel loads or creates `.t3/agent-board.json`, shows cards by state, adds
  draft cards, refreshes, and persists state moves through the board RPC API.
- `bun fmt`, `bun lint`, and `bun typecheck` passed.

### Slice 4: Task Records And Clarification

Status: `done`

Purpose:

- Connect cards to durable task records and provide a guided clarification flow
  for rough work.

Proof:

- A rough card can become a task record plus eligible board card without manual
  markdown editing.
- Selecting a card in the board panel exposes intent brief fields.
- Users can save intent brief fields back to `.t3/agent-board.json`.
- Users can create a durable task record under `docs/agents/tasks/` and move the
  card to `Ready`.
- `bun fmt`, `bun lint`, and `bun typecheck` passed.

### Slice 5: Board Runner MVP

Status: `tested`

Purpose:

- Claim one ready card, create an isolated workspace, and launch an agent run.

Proof:

- A ready card moves through running status with workspace and run metadata in
  the board file.
- 5A complete: Ready cards expose a manual `Run` control.
- 5A complete: `Run` moves a card to `Running`, increments
  `runtime.attemptCount`, records `runtime.lastHeartbeatAt`, and clears stale
  runtime error/decision fields.
- 5B complete: `Run` now claims through a server RPC, creates a project-local
  `.t3/workspaces/<card-id>` folder, persists `runtime.workspacePath`, and
  rejects non-Ready cards.
- 5C complete: a claimed board card now starts a fresh orchestration
  implementation thread and persists `runtime.implementationRunId`; launch
  failures mark the card `Blocked` with `runtime.currentError`.
- 5D complete: worker execution is provider-neutral and centrally configured —
  model selection resolves from `runner.workerModelSelection` in
  `.t3/agent-board.json`, falls back to the project `defaultModelSelection`,
  and blocks the card with a missing-config error when neither exists; the
  Planning UI exposes a board-level worker-execution picker that persists
  through the existing board save command.
- 5E complete: server-side runner service + run RPC (`projects.runAgentBoardCard`);
  manual Run and scheduler share one launch path — claim, real git worktree at
  `.t3/workspaces/<safe-card-id>` on branch `board/<card-id>` (reused across
  attempts), orchestration thread create + turn start, and runtime persistence
  all happen server-side with no web client required. The old client-side
  launch path in `ChatView` was deleted.
- 5F complete: an always-on 15-second scheduler reconciles durable thread
  state, updates completed cards to `Review`, interrupts user-moved work,
  retries routine failures with bounded in-memory exponential backoff, and
  claims dependency-eligible cards up to the board concurrency cap.

### Slice 6: Autonomous Review And Repair

Status: `tested`

Purpose:

- Add repair cycles and fresh review-agent handoff before cards become done.

Proof:

- A `Running` completed turn moves to `Reviewing` with a fresh review thread
  (`runtime.reviewRunId` persisted, same worktree, new thread, review prompt
  via `buildAgentBoardReviewPrompt` + `resolveWorkerModelSelection`); `REVIEW:
PASS` → `Review`/`Done`, `REVIEW: FAIL` routine → `Diagnosing` → repair
  turn on the implementation thread → next `Reviewing`; capped at
  `runner.repairCycles` (default 3) → `Needs Decision` with summary; intent
  questions (`NEEDS_DECISION:`) → `Needs Decision` immediately. Routine
  failures stay in the autonomous loop while intent decisions stop at `Needs
Decision`. Task-record proof is appended best-effort. Focused tests cover
  success → Reviewing → PASS → Review/Done, fail → Diagnosing → repair →
  re-review, cap → Needs Decision, intent → Needs Decision, and fresh-thread
  verification.

### Slice 7: Expanded Views

Status: `done` (implementation 2026-08-25, verified: view switch + persistence + expanded + canvas)

Purpose:

- Add full-board, table, and execution path views over the same card data.
- Finish without creating a second planning system.

Proof:

- Users can switch between Kanban (`kanban`), Planning table (`table`), and Execution-path (`execution-path`) via tabs in `AgentBoardPanel` (mode=page). `graph` → `execution-path` naming fixed with back-compat mapping.
- View state persists: init reads `board.defaultView` (`AgentBoardFile.defaultView`), tab switch writes back via existing `agentBoardEnvironment.save` RPC (`defaultView: AgentBoardView`), reload keeps view. URL param `?view=kanban|table|execution-path|expanded` is shareable and synced via `history.replaceState` + `popstate`.
- Canvas reactivated: guard `graphModel.width < 0` removed; Execution-path now shows the interactive pan/zoom/grid canvas (handlers `L625-656`, grid `L948`, zoom limits `0.5–1.8`) plus the dependency tree, both under the single `execution-path` view.
- Expanded mode: Kanban-only fullscreen variant via `?view=expanded` (persisted as `kanban`), toggled by Expand/Exit button in the tab bar, switches column min-width `260px → 320px` and full-bleed padding — no new component, CSS only.
- Verification: `vp lint` clean, `vp run --filter @t3tools/web typecheck` / `@t3tools/contracts typecheck` clean, manual switch 3 views, reload checks `defaultView` in `.t3/agent-board.json` and URL, toggle expanded, pan/zoom on canvas.
