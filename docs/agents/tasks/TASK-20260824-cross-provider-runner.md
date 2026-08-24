# TASK-20260824-cross-provider-runner

Status: `Review`
Agent eligible: no
Slice: `docs/agents/slices/authoritative-agent-board.md`
Brief: `docs/briefs/01-generalize-runner-cross-provider.md`

## Owner Intent

Generalize the planning fork's board runner so worker execution is chosen once
per project through T3's provider/runtime abstraction instead of implicitly
following whatever Codex selection happens to be active. Preserve the current
workflow shape: claim Ready card -> isolated workspace -> fresh worker thread ->
run.

## Target Status

`Tested`

## Design Decisions (locked)

- Central worker config lives in `.t3/agent-board.json`:
  `runner.workerModelSelection` (`ModelSelection`: instanceId + model +
  options; effort rides as an option entry).
- Run resolution is config-only: `runner.workerModelSelection`
  -> `project.defaultModelSelection` -> typed error. The chat composer's
  current selection no longer influences board runs.
- Wiring the claimed card workspace as the run's working directory is OUT of
  scope (brief 02 owns it).

## Scope Guard

Do not build a scheduler/reconciler, do not spawn provider CLIs outside T3's
existing orchestration path, do not add new RPC methods, do not change upstream
provider adapters, do not touch mobile/desktop beyond what shared-contract
typecheck requires.

## Acceptance Criteria

- `AgentBoardRunnerSettings` accepts an optional `workerModelSelection`;
  boards saved before this change still decode.
- Board card runs resolve their model selection from board runner settings,
  falling back to `project.defaultModelSelection`; with neither, the card goes
  `Blocked` with `runtime.currentError` explaining missing worker config.
- `AgentBoardPanel` offers a worker-execution picker (instance -> model ->
  options) persisting to `runner.workerModelSelection` via the existing save
  command.
- `WORKFLOW.md` front matter no longer pins `codex app-server`; the codex
  section is replaced by generalized provider/model/effort documentation that
  names the board file as machine-readable source.
- `docs/agents/symphony-conformance.md` states the worker protocol is T3's
  provider-neutral runtime, not Codex App Server specifically.
- `PATCH.md` reflects the contract/UI/doc changes.

## Implementation Plan

1. Contracts: extend `AgentBoardRunnerSettings`
   (`packages/contracts/src/agentBoard.ts:155`) with
   `Schema.optionalKey(ModelSelection)` imported from
   `packages/contracts/src/orchestration.ts` (no import cycle). Extend
   contract tests (back-compat + round-trip). Note: the seeded-board contract
   test reads `docs/agents/templates/agent-board.example.json` inline — keep
   valid.
2. Server default board factory
   (`apps/server/src/agentBoard/Layers/AgentBoardFileSystem.ts:54`): leave the
   field absent (optional); update service tests only if they assert the full
   default shape.
3. Web resolver: small module `apps/web/src/agentBoardRunner.ts` exporting
   `resolveWorkerModelSelection(board, project)` returning selection or a
   typed "no worker execution configured" reason. Unit-test it.
4. ChatView `onRunClaimedAgentBoardCard`
   (`apps/web/src/components/ChatView.tsx:5776`): replace the composer-first
   chain (`:5785-5792`) with the resolver. Build outgoing prompt metadata
   (`formatOutgoingPrompt`) from the resolved selection via
   `apps/web/src/providerInstances.ts` helpers; fall back to plain prompt text
   if instance info is unavailable. Existing Blocked-on-failure path stays.
5. Board panel picker: reuse `ProviderModelPicker`
   (pattern: `ProjectSettingsPanel.tsx:411-432, 824-860` with
   `deriveProviderInstanceEntries` / `applyProviderInstanceSettings` /
   `sortProviderInstanceEntries`). Persist through the existing save command;
   show effective source (override vs project default).
6. Docs per acceptance criteria + master-plan Slice 5 proof line.

## Verification

- `vp test run <touched test files>` (contracts + web resolver + server service)
- Scoped lint/typecheck for contracts, server, web (no repo-wide checks)

## Parallelism Plan

Safe: `false`

Reason:

Touches shared contracts and the ChatView send path.

Allowed write scopes:

- `packages/contracts/src/agentBoard.ts` (+ `.test.ts`)
- `apps/server/src/agentBoard/**`
- `apps/web/src/agentBoardRunner.ts` (new) (+ test)
- `apps/web/src/agentBoardPrompt.ts`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/AgentBoardPanel.tsx`
- `WORKFLOW.md`, `PATCH.md`, `docs/agents/symphony-conformance.md`,
  `docs/agents/project-master-plan.md`
- `docs/agents/tasks/TASK-20260824-cross-provider-runner.md`

Conflicts with:

- any other task touching contracts/board UI (none currently open)

## Proof Of Done

Implemented by a fresh worker agent; reviewed and verified by the supervisor
(2026-08-24).

### Changed Files

Contracts:

- `packages/contracts/src/agentBoard.ts` — `AgentBoardRunnerSettings` gains
  optional `workerModelSelection: ModelSelection` (import from
  `./orchestration.ts`, no cycle).
- `packages/contracts/src/agentBoard.test.ts` — pre-change board JSON string
  decodes unchanged and re-encodes without the key; populated selection
  round-trips through `Schema.fromJsonString`.

Web:

- `apps/web/src/agentBoardRunner.ts` (new) — config-only resolver
  (board override -> project default -> typed missing-config) plus
  `MISSING_WORKER_CONFIG_ERROR`; unit-tested in
  `apps/web/src/agentBoardRunner.test.ts`.
- `apps/web/src/components/ChatView.tsx` — `onRunClaimedAgentBoardCard` uses
  the resolver; composer/thread fallback chain removed (`composerRef` out of
  deps); prompt metadata built from the resolved selection with plain-text
  fallback; missing config persists `Blocked` + `runtime.currentError`
  before throwing.
- `apps/web/src/components/AgentBoardPanel.tsx` — worker-execution picker
  (upstream `ProviderModelPicker` + `TraitsPicker`) persisting
  `runner.workerModelSelection` via the save command, showing effective
  source (board override vs project default) and a clear-override control.

Docs:

- `WORKFLOW.md` front matter: `codex:` block replaced by a provider-neutral
  `provider:` section pointing at `.t3/agent-board.json#runner.workerModelSelection`
  as the machine-readable source.
- `docs/agents/symphony-conformance.md`: worker protocol is T3's
  provider-neutral runtime; formal-loop gap wording de-Codexed.
- `docs/agents/project-master-plan.md`: Slice 5 proof line "5D complete".
- `PATCH.md`: contract/UI/resolver entries updated.

Server code needed no change (field is optional; default board omits it).

### Verification Results

- `vp test run packages/contracts/src/agentBoard.test.ts
apps/web/src/agentBoardRunner.test.ts
apps/server/src/agentBoard/Layers/AgentBoardFileSystem.test.ts`
  — 15/15 passed.
- Typecheck: contracts + server exit 0 (pre-existing suggestions in upstream
  files only), web exit 0.
- Scoped lint over all changed TS/TSX files: clean.

### Review Findings (supervisor audit)

- All writes stayed inside the task's allowed write scopes.
- Acceptance criteria met; both worker deviations were correct calls:
  (1) persisting `Blocked`+`currentError` before throwing satisfies the
  criteria where the old code only threw; (2) JSON-string codec for
  round-trip tests matches the server persistence shape.

### Integrated Pass (2026-08-24)

Verified in the real web client against an isolated dev environment
(`/tmp/t3code-test.4K0ovX`, project rooted at this repo):

- Planning tab renders the `Worker execution` row with source label
  `Project default — pick a model to override` and the effective selection
  (GPT-5.6-Sol / Low).
- Picking `GPT-5.6-Terra` in the model picker persisted
  `runner.workerModelSelection {instanceId: codex, model: gpt-5.6-terra}` to
  `.t3/agent-board.json` on disk; label flipped to
  `Board override — used for every card run` and a `Use project default`
  clear control appeared.
- Setting reasoning effort `High` persisted
  `options: [{id: reasoningEffort, value: high}, {id: serviceTier, value: default}]`.
- `Use project default` removed the key from disk entirely (no null residue)
  and reverted the label/effective selection to the project default.
- The board loaded the seeded card `TASK-20260824-cross-provider-runner` in
  the `Review` column.
- Not exercised live: the missing-config `Blocked` run path (covered by
  resolver unit tests; requires clearing both board and project defaults).

### Remaining Gaps

- Claimed-card runs still use the thread's normal cwd/worktree; wiring the
  card workspace is brief 02 scope.
- Picker reads primary-server provider atoms; on remote environments with
  divergent provider configs the display may differ from the run environment.
- No before/after screenshots captured (preview media tooling failed during
  the pass); capture when convenient for the PR description.
- No live cross-provider run yet (e.g. OpenCode-backed worker) — only Codex
  is configured in the test environment.
- Changes committed in `3c97278e`; card remains in `Review` pending human
  sign-off.
