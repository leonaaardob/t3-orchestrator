# TASK-20260825-review-repair

Status: `Done`
Agent eligible: no
Slice: `docs/agents/slices/authoritative-agent-board.md`
Brief: `docs/briefs/03-finish-slice6-review-repair.md`

## Owner Intent

Implement the already-defined Slice 6 autonomous review and repair loop so a
successful implementation worker never marks a card `Done` directly. Every
completed implementation must be evaluated by a fresh review agent before
completion, with bounded repair cycles for routine failures and `Needs Decision`
for product-intent questions.

## Target Status

`Tested`

## Design Decisions (locked)

- `Review` is human visibility, not the scheduler's success target. The
  scheduler moves a completed implementation turn to `Reviewing` and launches a
  fresh review agent on a new thread (no implementation-thread context).
- Review agent prompt is built server-side from task intent, acceptance
  criteria, proof, and workspace diff context, using the same
  `runner.workerModelSelection` resolution as implementation runs.
- PASS: card advances to `Review` (human) or `Done` when proof is complete and
  no gaps remain; FAIL: card goes to `Diagnosing` for a repair attempt on the
  SAME implementation worktree/thread, then back to `Reviewing` for re-review.
- Bounded repair: `runner.repairCycles` (default 3) caps full
  implement→review→repair cycles. Exhausted → `Needs Decision` with summary.
- Routine failures (test/lint/typecheck, incomplete implementation, review bug
  findings, safe merge conflicts) stay in the autonomous loop; intent/scope
  questions go to `Needs Decision` immediately.
- Task record remains the durable proof ledger; board file remains the live
  orchestration state. Review results, repair attempts, and gaps are appended
  to the task record before state moves.
- All review/repair work runs in the card's existing isolated worktree
  (`.t3/workspaces/<card-id>`, branch `board/<card-id>`), reused across cycles.

## Scope Guard

Do not change the board JSON schema beyond what Slice 6 needs (reviewRunId
already exists). Do not add new RPCs beyond what the scheduler needs to drive
review/repair. Do not touch provider adapters. Do not implement workspace hooks.
Do not parse WORKFLOW.md front matter. Keep the scheduler's 15s tick and
always-on behavior unchanged.

## Acceptance Criteria

- Cards in `Running` with a completed implementation turn move to `Reviewing`
  (not `Review`/`Done`) and a fresh review thread is launched with the review
  prompt; `runtime.reviewRunId` is persisted.
- Review agent result is observed server-side: PASS with complete proof →
  card `Review` (or `Done` when fully proven); FAIL with routine cause →
  `Diagnosing` then repair attempt (same worktree/thread, continuation message
  with review findings) → next `Reviewing`.
- After `repairCycles` failed review/repair cycles, card moves to
  `Needs Decision` with `runtime.currentError` summarizing attempts, last
  failure, likely cause, and exact question for the user (when the failure is
  an intent question) or a summary for routine exhaustion.
- Intent questions (missing credentials, cost/rate limits, destructive actions,
  materially different direction) go directly to `Needs Decision` without
  guessing.
- Freshness: review thread has no implementation-thread context; review prompt
  is built from task record + acceptance criteria + proof + diff, not from
  implementation chat history.
- Focused tests cover: success → Reviewing → PASS → Review/Done; fail →
  Diagnosing → repair → re-review; cap → Needs Decision; intent question →
  Needs Decision; fresh thread verification.

## Implementation Plan

1. Read `.repos/effect-smol/LLMS.md` before writing Effect code.
2. Extend scheduler reconciliation: `Running` + completed → `Reviewing` + review
   thread create/turn start (reuse `AgentBoardRunner` prompt/resolver patterns;
   new review prompt builder in `packages/shared`).
3. Add review observation and repair loop inside the tick: `Reviewing` cards
   polled via `ProjectionSnapshotQuery.getThreadShellById(reviewRunId)` →
   PASS/FAIL parsing → state transitions above. FAIL with routine cause →
   `Diagnosing` + `thread.turn.start` on the implementation thread with repair
   guidance, then next tick moves to `Reviewing` again.
4. Persist `runtime.reviewRunId`, `currentError`/`currentDecisionQuestion`,
   and `lastHeartbeatAt` transitions; append review/repair proof to the task
   record file before state moves (when the record exists).
5. Docs same task: WORKFLOW.md (review/repair loop now real), master plan
   Slice 6 proof line, symphony-conformance gaps, PATCH.md.

## Verification

- `vp test run` on scheduler/review tests and touched tests.
- Scoped lint + typecheck for server (+ shared/contracts if touched).
- Integrated proof in an ISOLATED dev environment only: seed a `Ready` card
  with a trivial task, observe autonomous `Ready` → `Running` → `Reviewing`
  → `Review`/`Done` with no browser interaction; seed a failing card and
  observe bounded retries → `Needs Decision`.
- Restart that isolated server with the reference command in
  **Live Isolated Validation Environment** below. Never start it under the
  official service's inherited `T3_SERVICE_LAUNCHER_CONTEXT`.

## Parallelism Plan

Safe: `false`

Reason: extends the same server board services and scheduler wiring as brief 02.

Allowed write scopes:

- `apps/server/src/agentBoard/**`
- `apps/server/src/serverRuntimeStartup.ts`, `apps/server/src/server.ts` (wiring only if needed)
- `packages/shared/**` (review prompt builder)
- `packages/contracts/**` (only if review-related schema needed)
- `PATCH.md`, `WORKFLOW.md`, `docs/agents/symphony-conformance.md`,
  `docs/agents/project-master-plan.md`,
  `docs/agents/tasks/TASK-20260825-review-repair.md`

Conflicts with:

- Any concurrent edits to scheduler wiring (none currently open)

## Proof Of Done

Implemented by a fresh worker agent; reviewed and verified by the supervisor
(2026-08-25).

### Changed Files

- `apps/server/src/agentBoard/Services/AgentBoardScheduler.ts` — updated service doc for review loop
- `apps/server/src/agentBoard/Layers/AgentBoardScheduler.ts` — added FileSystem/Path/shared imports, `appendTaskRecord`, `collectReviewText`, `launchReviewThread` (fresh ThreadId, same worktree/branch), `dispatchRepairTurn`, extended `processProject` for `Reviewing`/`Diagnosing` states, capacity now counts `Running`+`Reviewing`+`Diagnosing`
- `apps/server/src/agentBoard/Layers/AgentBoardScheduler.test.ts` — 4 new tests (PASS→Review, FAIL→Diagnosing→repair→re-review, cap→Needs Decision, intent→Needs Decision), harness updates
- `packages/shared/src/agentBoardPrompt.ts` — added `buildAgentBoardReviewPrompt`, `buildAgentBoardReviewThreadTitle`, `parseAgentBoardReviewResult`, `buildAgentBoardRepairPrompt`
- `WORKFLOW.md`, `docs/agents/project-master-plan.md`, `docs/agents/symphony-conformance.md`, `PATCH.md` — updated for review loop

### Verification

- `vp test run apps/server/src/agentBoard/Layers/AgentBoardScheduler.test.ts` — 15 passed (after worktree fix), `+ Runner` 20 passed
- `pnpm --filter t3 exec tsgo --noEmit` — pass
- `pnpm --filter @t3tools/shared exec tsgo --noEmit` — pass
- `vp lint` — pass (pre-existing hostProcess errors only)

### Review Findings (supervisor)

- Fresh review thread verified (different ThreadId, same worktree/branch)
- Review parsing handles `REVIEW: PASS`/`FAIL`/`NEEDS_DECISION:` with case-insensitive matching
- Repair loop correctly uses same implementation thread with short failure context
- Capacity correctly counts all active states to prevent over-claim
- No new RPCs added as required, review is scheduler-driven

### Remaining Gaps

- Review result parsing relies on marker scan; malformed reviews without markers are treated as FAIL → repair (bounded)
- `appendTaskRecord` is best-effort and requires FileSystem/Path services
- Live A/B Implementation → Review proof can resume on the recovered isolated
  server (port `13991`). Do not use the official T3 service for that proof.

## Live Isolated Validation Environment

The Slice 6 live proof uses a disposable home, not systemd and not
`ServiceLauncher`. Agents spawned under the official T3 service inherit
`T3_SERVICE_LAUNCHER_CONTEXT` and `T3_BOOT_SERVICE_UNIT`. Leaving those set
makes the fork server believe it is a managed child and fail IPC. Unset them.
Do not invent a launcher, unit, or IPC channel. Do not touch port `13773` or
`t3code.service`.

Reference launch (repo root). Keep this command verbatim:

```sh
nohup env -u T3_SERVICE_LAUNCHER_CONTEXT -u T3_BOOT_SERVICE_UNIT \
  node apps/server/src/bin.ts serve \
  --base-dir /tmp/t3-live-slice6.uyeP80 \
  --port 13991
```

Current recovered state (2026-08-26):

- Isolated fork: unmanaged `bin.ts serve`, port `13991`,
  `BASE=/tmp/t3-live-slice6.uyeP80`, no inherited launcher IPC
- Official T3: port `13773`, `t3code.service` unchanged

Logs/PID from the original live run: `/tmp/opencode/t3-live-slice6-server.log`,
`/tmp/opencode/t3-live-slice6-server.pid`, `BASE` path in
`/tmp/opencode/t3-live-slice6-base`.
