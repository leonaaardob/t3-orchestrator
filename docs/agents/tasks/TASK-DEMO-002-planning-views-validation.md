# TASK-DEMO-002 — Validate Planning views manually

Status: `needs-decision`
Agent eligible: yes
Slice: `docs/agents/slices/authoritative-agent-board.md`

## Owner Intent

Open the Planning Kanban, table, and dependency-tree views in the real web
client, then create and edit cards to confirm the views share the same project
board without regressing Chat.

## Target Status

`Tested`

## Scope Guard

Validate the existing UI and persist only the board changes needed for the
manual proof. Do not expand this card into new Planning features or unrelated
code changes.

## Acceptance Criteria

- [ ] The project cards are visible in Kanban, Planning table, and dependency tree.
- [ ] A card created from Planning is visible after creation.
- [ ] A card edit is reflected across the Planning views.
- [ ] Chat remains reachable and usable after returning from Planning.

## Verification

- `curl http://localhost:5933/` returned `200 text/html` from the isolated
  development stack.
- `vp test run packages/contracts/src/agentBoard.test.ts apps/server/src/agentBoard/Layers/AgentBoardFileSystem.test.ts`
  passed: 2 files, 9 tests.
- Manual integrated web-client pass: blocked because neither the T3
  collaborative preview nor the configured in-app browser exposed an
  automation-capable browser in this agent environment.
- Read-back after UI mutations: pending the manual pass.

## Parallelism Plan

Safe: `true`

Reason: this task records manual validation and does not change production code.

Allowed write scopes:

- `.t3/agent-board.json`
- `docs/agents/tasks/TASK-DEMO-002-planning-views-validation.md`

Conflicts with:

- Other work that edits the same demo cards during the manual pass.

## Proof Of Done

### Completed plan

- [x] Read the project workflow, product direction, context, master plan,
      slice plan, board card, and workspace metadata.
- [x] Created and linked this persistent task record.
- [x] Started an isolated development stack and confirmed the web app is
      reachable.
- [x] Ran the focused agent-board contract and file-service tests.
- [ ] Open Kanban, Planning table, and dependency tree in a real browser.
- [ ] Create and edit cards through the UI.
- [ ] Return to Chat and confirm the composer remains usable.

### Acceptance criteria

- [ ] The project cards are visible in Kanban, Planning table, and dependency tree.
- [ ] A card created from Planning is visible after creation.
- [ ] A card edit is reflected across the Planning views.
- [ ] Chat remains reachable and usable after returning from Planning.

### Changed files

- `.t3/agent-board.json`: linked this task and slice record; recorded the
  manual-validation blocker.
- `docs/agents/tasks/TASK-DEMO-002-planning-views-validation.md`: added the
  durable workpad and verification evidence.

### Review result

No review pass was run because the card contains no production-code change and
the required visual validation remains blocked.

### Remaining gap

An operator with a browser must complete the three Planning-view checks, create
and edit a disposable card, then return to Chat and exercise the composer.
