# TASK-20260824-board-runner-service

Status: `Done`
Agent eligible: no
Slice: `docs/agents/slices/authoritative-agent-board.md`
Brief: `docs/briefs/02-finish-scheduler-reconciler.md` (part 1 of 2)

## Owner Intent

Move board card launching to a server-side runner service so the manual `Run`
button and the upcoming autonomous scheduler (part 2) converge on one
underlying launch path, and so runs execute in an isolated real git worktree
per card. No web client may be required for a card run to launch.

## Target Status

`Tested`

## Design Decisions (locked)

- One server runner service performs: claim -> card git worktree ->
  `thread.create` -> `thread.turn.start` -> persist runtime state. Both the
  manual Run RPC and the part-2 scheduler call it. No second launch path.
- Card workspace becomes a REAL git worktree at
  `<projectRoot>/.t3/workspaces/<safe-card-id>` on branch `board/<card-id>`,
  created once and reused across retries. This wires the workspace isolation
  deferred from TASK-20260824-cross-provider-runner.
- Model selection resolution stays config-only and reuses the shared resolver:
  `runner.workerModelSelection` -> `project.defaultModelSelection` -> card
  `Blocked` + `runtime.currentError` (no thread created).
- Headless turns pass `runtimeMode: "full-access"` explicitly (matches the
  manual path default; `DEFAULT_RUNTIME_MODE` in
  `packages/contracts/src/orchestration.ts`).
- The web Run button calls the new RPC; the client-side createThread/startTurn
  board-run path in ChatView is deleted, not kept in parallel.

## Scope Guard

Do not implement the scheduler/polling loop, retry backoff, review agents, or
Diagnosing/Reviewing transitions (part 2 / brief 03). Do not add a continuation-turn
policy. Do not touch provider adapters. Do not add settings or UI beyond the
Run-button rewiring. Do not change the board JSON schema.

## Acceptance Criteria

- `packages/shared` exports the worker-config resolver and the board-card
  prompt builder (subpath exports, no barrel); `apps/web` imports them from
  shared and the web-local copies are deleted.
- New server service `AgentBoardRunner` (Services tag + Live layer) launches a
  card run end to end server-side with no web client: claim, worktree
  create/reuse, thread create + turn start via `OrchestrationEngineService`,
  runtime persistence (`implementationRunId`, `attemptCount` via claim,
  `lastHeartbeatAt`).
- New RPC `runAgentBoardCard` wired through contracts (`WS_METHODS`, `Rpc.make`,
  `WsRpcGroup`), `ws.ts` handler, `RpcAuthorization.ts` scope (exhaustive by
  type), and `ipc.ts` parity with the existing three board methods.
- `AgentBoardPanel` Run calls the new RPC and renders the returned board; the
  old client-side launch callback in `ChatView.tsx`
  (`onRunClaimedAgentBoardCard` + prompt-metadata block) is removed.
- Launch failure marks the card `Blocked` with `runtime.currentError` (same
  semantics as today); missing worker config marks `Blocked` before any thread
  is created.
- Focused tests cover the runner service (happy path, worktree reuse,
  missing-config Blocked, launch-failure Blocked) and the new contract types.

## Implementation Plan (research anchors verified 2026-08-24)

1. Read `.repos/effect-smol/LLMS.md` before writing any Effect code.
2. Shared extraction: move `resolveWorkerModelSelection` +
   `MISSING_WORKER_CONFIG_ERROR` (now `apps/web/src/agentBoardRunner.ts`) and
   `buildAgentBoardImplementationPrompt` / `buildAgentBoardImplementationThreadTitle`
   (now `apps/web/src/agentBoardPrompt.ts`) into `packages/shared` following its
   subpath-export conventions; update web imports; delete web copies; keep
   `agentBoardRunner.test.ts` semantics (move it next to the shared source).
3. Contracts: add `AgentBoardRunInput {cwd, cardId}` /
   `AgentBoardRunResult {board, card, threadId?, workspacePath}` to
   `packages/contracts/src/agentBoard.ts`; register the RPC in `rpc.ts`
   (mirror the three existing board entries, error union
   `Schema.Union([AgentBoardFileError, EnvironmentAuthorizationError])`), add the
   `ipc.ts` method, and add the `RpcAuthorization.ts` scope entry.
4. Server runner service `apps/server/src/agentBoard/Services|Layers/AgentBoardRunner.ts`:
   - claim via existing `AgentBoardFileSystem.claim` (Ready-only, attemptCount++,
     workspacePath recorded);
   - worktree: `GitWorkflowService.createWorktree` accepts an explicit `path`
     (`git/GitWorkflowService.ts:65,302-304`; driver path handling
     `GitVcsDriverCore.ts:2741-2747`) — pass
     `<projectRoot>/.t3/workspaces/<safeWorkspaceSegment(card.id)>`, branch
     `board/<card-id>`, base = current HEAD of the project workspaceRoot; reuse
     when the worktree already exists;
   - dispatch: build `thread.create` (worktreePath, modelSelection from shared
     resolver against `getProjectShellById(workspaceRoot)`, runtimeMode
     `"full-access"`, title from shared builder) then `thread.turn.start`
     (prompt from shared builder) directly via `OrchestrationEngineService.dispatch`
     — fully self-contained, no WS normalize needed (precedent:
     `orchestration/http.ts:91-107`, `serverRuntimeStartup.ts:206-238`);
   - persist `runtime.implementationRunId = threadId` + heartbeat via board save;
   - every failure path: card `Blocked` + `runtime.currentError`, delete the
     created thread when the turn start failed (mirror `ws.ts:767-779`).
5. Web: `AgentBoardPanel` Run handler calls the new atom command; ChatView loses
   `onRunClaimedAgentBoardCard` and its provider-metadata block; keep the
   `Blocked`-on-failure toasts behavior equivalent.
6. Docs same task: PATCH.md (new service, RPC, shared exports, ChatView change),
   project-master-plan.md Slice 5 proof line "5E complete: server-side runner
   service + run RPC; manual Run and scheduler share one launch path".

## Verification

- `vp test run` on: moved shared resolver test, new runner service test,
  contracts `agentBoard.test.ts`, touched server/web tests.
- Scoped lint + typecheck for shared, contracts, server, web.
- Headless proof: a service-level test (or scripted check against a dev server)
  launches a card run with no browser open.

## Parallelism Plan

Safe: `false`

Reason: touches shared contracts, ChatView send path, and server wiring.

Allowed write scopes:

- `packages/shared/**` (new agentBoard module + exports)
- `packages/contracts/src/agentBoard.ts` (+ test), `rpc.ts`, `ipc.ts`
- `apps/server/src/agentBoard/**`, `apps/server/src/ws.ts`,
  `apps/server/src/auth/RpcAuthorization.ts`, `apps/server/src/server.ts` (layer
  merge only)
- `apps/web/src/agentBoardRunner.ts` (deleted), `apps/web/src/agentBoardPrompt.ts`
  (deleted), `apps/web/src/state/agentBoard.ts`,
  `apps/web/src/components/AgentBoardPanel.tsx`,
  `apps/web/src/components/ChatView.tsx`
- `PATCH.md`, `docs/agents/project-master-plan.md`,
  `docs/agents/tasks/TASK-20260824-board-runner-service.md`

Conflicts with:

- `TASK-20260824-board-scheduler` (must land first; scheduler card depends on
  this one)

## Proof Of Done

Implemented by a fresh worker agent; reviewed and verified by the supervisor
(2026-08-25).

### Changed Files

Shared:

- `packages/shared/src/agentBoardRunner.ts` (+ test) — resolver + missing-config
  error, moved from web.
- `packages/shared/src/agentBoardPrompt.ts` — prompt/title builders, moved from
  web; `packages/shared/package.json` gains both subpath exports.
- `apps/web/src/agentBoardRunner.ts`, `agentBoardPrompt.ts` (+ web test) deleted.

Contracts:

- `packages/contracts/src/agentBoard.ts` — `AgentBoardRunInput` /
  `AgentBoardRunResult` (`threadId` optional for blocked launches).
- `packages/contracts/src/rpc.ts` — `projects.runAgentBoardCard` method +
  `WsProjectsRunAgentBoardCardRpc` + `WsRpcGroup` entry (error union
  `AgentBoardFileError | EnvironmentAuthorizationError`).
- `packages/contracts/src/ipc.ts` — `runAgentBoardCard` on `EnvironmentApi.projects`
  (only `loadAgentBoard` existed there upstream; save/claim are web-RPC-only).
- `packages/contracts/src/agentBoard.test.ts` — run contract coverage.

Server:

- `apps/server/src/agentBoard/Services/AgentBoardRunner.ts` — service tag +
  shape; `run()` R carries AgentBoardFileSystem / GitWorkflowService /
  OrchestrationEngineService / ProjectionSnapshotQuery (resolved per call).
- `apps/server/src/agentBoard/Layers/AgentBoardRunner.ts` — claim -> worktree
  (create/reuse via `.git` marker, branch `board/<card-id>`, base HEAD) ->
  `thread.create` -> `thread.turn.start` (full-access, shared prompt/resolver)
  -> runtime persist; every failure persists `Blocked` + `currentError` before
  surfacing; failed turn start deletes the created thread (mirrors ws.ts
  bootstrap cleanup).
- `apps/server/src/agentBoard/Layers/AgentBoardFileSystem.ts` — exports
  `safeWorkspaceSegment` for identical workspace-path derivation.
- `apps/server/src/server.ts` — `AgentBoardRunnerLayerLive` merged into
  `WorkspaceLayerLive`; `apps/server/src/ws.ts` — RPC handler (runner error ->
  `AgentBoardFileError`); `apps/server/src/auth/RpcAuthorization.ts` —
  `AuthOrchestrationOperateScope` entry; `apps/server/src/server.test.ts` — wiring.

Web:

- `apps/web/src/state/agentBoard.ts` — `runCard` atom command.
- `apps/web/src/components/AgentBoardPanel.tsx` — Run calls the RPC; renders
  returned board; `onRunClaimedCard` prop removed.
- `apps/web/src/components/ChatView.tsx` — client-side launch callback and
  provider-metadata block deleted (~200 lines).

Docs: PATCH.md entries, master-plan Slice 5 "5E complete" proof line.

### Verification Results

- `vp test run` over shared resolver test, contracts `agentBoard.test.ts`,
  runner service test, `AgentBoardFileSystem.test.ts`, `server.test.ts`
  — 147/147 passed (headless happy path, worktree reuse with 0 git calls,
  missing-config Blocked before dispatch, turn-start failure -> thread.delete +
  Blocked, project-default fallback).
- Typecheck shared + contracts + server + web: exit 0.
- Scoped lint over all changed files: clean.

### Review Findings (supervisor audit)

- All writes stayed inside allowed scopes; net -178 lines (client path removed,
  not duplicated).
- Deviation #1 accepted: per-call collaborator resolution (R-widened `run`)
  is idiomatic Effect, keeps layer composition simple, and is the precedent
  for the part-2 scheduler fiber. The four services are always present in the
  app runtime.
- Deviations #2-#5 accepted: `.git`-marker reuse detection (claim pre-creates a
  plain folder), ipc parity, untruncated title (matches server-side precedent),
  claim RPC kept (record only mandated removing the client launch callback).

### Remaining Gaps (inputs for part 2)

- `runner.run` is not internally serialized: the scheduler must serialize per
  project and respect `runner.maxConcurrentCards` (claim is Ready-only, so a
  race fails cleanly on the second caller).
- Worktree edge cases (leftover non-worktree folder without `.git`; orphaned
  `board/<id>` branch) -> Blocked with git error; recovery is manual.
- Failure-path board save is best-effort: a save failure can leave a card
  `Running` with a dead run — the reconciler must treat stale heartbeats /
  unresolvable threads as failed attempts.
- Interactive Planning-UI Run-button pass not yet run live (service-level tests
  only).
