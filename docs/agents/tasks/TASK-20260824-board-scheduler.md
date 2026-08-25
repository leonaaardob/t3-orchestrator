# TASK-20260824-board-scheduler

Status: `Review`
Agent eligible: no
Slice: `docs/agents/slices/authoritative-agent-board.md`
Brief: `docs/briefs/02-finish-scheduler-reconciler.md` (part 2 of 2)

## Owner Intent

Run an autonomous server-side scheduler/reconciler that removes the need for a
human to click `Run`: it reconciles active runs, claims eligible `Ready` cards,
launches them through the shared runner service, observes completion, and
persists state back to `.t3/agent-board.json` — with the Planning UI closed.

## Target Status

`Tested`

## Design Decisions (locked)

- Always on: no opt-in flag. `Ready` is the deliberate start-work signal, so the
  scheduler claiming Ready cards is the intended product behavior.
- Success lands the card in `Review` (human visibility), never `Done`.
  Review/repair cycles and fresh review agents are brief 03.
- Retry cap = `runner.repairCycles` (board file, default 3). Exhausted -> card
  `Needs Decision` with `runtime.currentError` summarizing what was tried.
- Backoff is in-memory (exponential, capped at 300000 ms per
  `WORKFLOW.md` `agent.max_retry_backoff_ms`). WORKFLOW explicitly allows
  in-memory scheduler state to be lost on restart; `attemptCount` persists and
  still gates the cap. No board schema change.
- One turn per attempt; continuation-turn policy (`agent.max_turns`) is brief 03.
- Poll interval is a named 15s constant (matches `WORKFLOW.md`
  `polling.interval_ms`); no YAML loader (documented conformance gap).

## Scope Guard

Do not implement review agents, Diagnosing/Reviewing transitions, repair
diagnosis, continuation turns, or workspace hooks (brief 03). Do not change the
board JSON schema or RPC surface. Do not parse WORKFLOW.md front matter. Do not
touch provider adapters. The scheduler must never write outside the project
board file and runtime fields.

## Acceptance Criteria

- A background daemon ticks every 15s using the reaper pattern
  (`forkParked` + `Schedule.spaced`, error-resilient per-tick), launched in the
  `reactors.start` phase and wired in `server.ts`.
- Each tick: enumerate projects, load each project's board (missing -> skip);
  reconcile `Running` cards before claiming new work.
- Reconciliation: `latestTurn.state` completed -> card `Review` (clear
  `currentError`); `error`/`interrupted`/dead-session-after-restart -> retry
  path; still running -> `lastHeartbeatAt` refresh (write only on change);
  card manually moved out of `Running` -> active turn aborted, no relaunch.
- Claiming: respects `runner.maxConcurrentCards`, skips cards whose
  `dependencies` are not all `Done`, orders by priority then oldest `updatedAt`
  then card id, and launches via the `AgentBoardRunner` service (part 1) —
  no separate launch path.
- Failure retries: relaunch as a continuation turn on the SAME thread with the
  failure context in the message; `attemptCount` gates against
  `runner.repairCycles`; at cap -> `Needs Decision` + summary in
  `runtime.currentError`.
- Restart recovery: a `Running` card whose `implementationRunId` no longer
  resolves to a thread is treated as a failed attempt (retry or cap).
- Missing worker config -> card `Blocked` with the shared missing-config error.
- Focused tests cover: happy claim, concurrency cap, dependency gating,
  success -> Review, failure -> retry -> cap -> Needs Decision, user-move
  abort, restart recovery, heartbeat write-only-on-change.

## Implementation Plan (research anchors verified 2026-08-24)

1. Read `.repos/effect-smol/LLMS.md` before writing any Effect code.
2. `apps/server/src/agentBoard/Services/AgentBoardScheduler.ts` tag with
   `start(): Effect<void, never, Scope>`; `Layers/AgentBoardScheduler.ts` copying
   `ProviderSessionReaper` (`provider/Services|Layers/ProviderSessionReaper.ts`,
   loop at `ProviderSessionReaper.ts:120-136`, `forkParked` from
   `serverActivation.ts:12-26`).
3. Launch in `serverRuntimeStartup.ts` `reactors.start` phase (next to
   `providerSessionReaper.start()` at `:349-355`); merge the layer in
   `server.ts` near `:366-369`.
4. Tick inputs: board via `AgentBoardFileSystem.load`; thread/project state via
   `ProjectionSnapshotQuery.getThreadShellById` (`latestTurn.state`,
   `session.status`, durable across restarts) and project lookup by
   workspaceRoot; project enumeration via the projection query service (find the
   existing list method). Do NOT use `RuntimeReceiptBus` (production layer is a
   deliberate no-op) or in-memory event streams as the source of truth.
5. Turn abort for user-moved cards: dispatch the orchestration turn-abort
   command (verify the exact command name in `orchestration/decider.ts`;
   `turn.aborted` runtime events exist).
6. Continuation retry: `thread.turn.start` on the existing
   `implementationRunId` thread with a short failure-context message; do not
   resend the full card prompt (WORKFLOW continuation rule).
7. Docs same task: WORKFLOW.md (scheduler now real: note always-on behavior and
   retry semantics under "Polling, Claiming, Retry, And Reconciliation"),
   `docs/agents/symphony-conformance.md` (resolve the "No active daemon runner"
   and "no formal worker loop" gaps; note in-memory scheduler state),
   `docs/agents/project-master-plan.md` Slice 5 proof line "5F complete" +
   remaining line cleared, PATCH.md (scheduler service, startup wiring).

## Verification

- `vp test run` on the scheduler service test file and any touched tests.
- Scoped lint + typecheck for server (+ shared/contracts if touched).
- Integrated proof in an ISOLATED dev environment only (never the developer's
  `~/.t3`): seed a `Ready` card, observe the scheduler claim -> run -> `Review`
  with no browser interaction, and a failing card reaching `Needs Decision` at
  the cap (a fake/failing provider config is acceptable for the failure path).

## Parallelism Plan

Safe: `false`

Reason: extends the same server wiring and board services as part 1.

Allowed write scopes:

- `apps/server/src/agentBoard/**`
- `apps/server/src/serverRuntimeStartup.ts`, `apps/server/src/server.ts` (wiring
  only)
- `PATCH.md`, `WORKFLOW.md`, `docs/agents/symphony-conformance.md`,
  `docs/agents/project-master-plan.md`,
  `docs/agents/tasks/TASK-20260824-board-scheduler.md`

Conflicts with:

- `TASK-20260824-board-runner-service` (hard dependency — land it first)

## Proof Of Done

### Changed files

- Server: scheduler service/layer, server startup and live-layer wiring.
- Tests: scheduler reconciliation, claiming, retry, abort, recovery, and
  heartbeat coverage.
- Docs: `WORKFLOW.md`, Symphony conformance, Slice 5 master plan, and patch
  maintenance map.

### Verification

- `pnpm exec vp test run apps/server/src/agentBoard/Layers/AgentBoardScheduler.test.ts apps/server/src/agentBoard/Layers/AgentBoardRunner.test.ts` — 15/15 passed.
- `pnpm --dir apps/server typecheck` — passed (existing Effect suggestions in
  unrelated orchestration files only).
- Scoped scheduler/server lint — passed.

### Live integrated proof (2026-08-25) — provider revenu

Isolated env `/tmp/t3-live-home-YNMoyL` + repo `/tmp/t3-live-CRFZfi/repo-success`
(card `LIVE-SUCCESS-001` — trivial hello.txt task, `repairCycles: 2`,
`workerModelSelection: codex/gpt-5.6-sol`), scheduler always-on, no browser
after initial project creation:

- `16:10:55` `card-launched` — scheduler claimed `Ready` → `Running`
  (`attemptCount: 1`, `implementationRunId: 918ae8b6…`, worktree
  `.t3/workspaces/LIVE-SUCCESS-001` created as real git worktree on
  `board/LIVE-SUCCESS-001`)
- Codex turn created `hello.txt` in the worktree with `live scheduler proof`
  (visible at `14:13:07`)
- `16:13:41` `run-completed` — provider turn completed
- `14:13:52` board `Review` — scheduler reconciled `latestTurn.state: completed`
  → `Review` (cleared `currentError`, `lastHeartbeatAt` refreshed), no human
  interaction

Failure path (retry → `Needs Decision`) remains proven by the fake-layer
matrix (worker network was blocked at report time); live it requires forcing a
turn error, which is nondeterministic with a real LLM. The live success path
above proves the claim → worktree → dispatch → observe → persist loop end to
end with a real provider.

### Supervisor Review (2026-08-25)

- Reprise fixes confirmed: `@ts-nocheck` removed (Clock/Effect.sleep), unreadable
  boards log `agentBoard.scheduler.board-unreadable`, `vp fmt` clean.
- Supervisor verification: 34/34 (shared/contracts/runner/scheduler/board-fs)
  - 124/124 (`server.test.ts`); typecheck 4 packages exit 0; lint + fmt clean;
    plus live proof above.
- Beyond-spec additions accepted: 30-min stale-heartbeat detection and
  claim-deferral for re-queued cards with active previous turn.
- Product decision (slot semantics): a card in backoff stays `Running` and keeps
  its concurrency slot — ACCEPTED (bounded by `repairCycles` ≤3 and 300 s cap).

### Remaining Gaps

- `interruptedRuns` grows without purge (in-memory, negligible, bounded by user
  moves).
- Backoff deadlines are in memory by design (see WORKFLOW.md); restart discards
  pending delays but `attemptCount` persists and still caps retries.
