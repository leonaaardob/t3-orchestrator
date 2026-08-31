# ORCH-041-internal-orchestration-storage

Status: `Backlog`
Agent eligible: yes
Slice: `docs/agents/slices/internal-orchestration-control-plane.md`

## Owner Intent

Move board, cards, proof, and card workspaces out of the user Git repository
into T3 server-owned persistence so opening a project does not dirty Git status
or require `.t3` in the repo.

## Target Status

`Tested`

## Scope Guard

- Depends on ORCH-040.
- Do not implement Fast Mode UI/scheduler bypass (ORCH-043).
- Do not rewrite worker/reviewer prompt packets beyond path fixes required by
  storage move (ORCH-042 owns prompt rewrite).
- No distributed worker pool.
- No permanent dual-write to repo `.t3/agent-board.json`.

## Acceptance Criteria

- Board load/save persists in server SQLite (or approved T3-home userdata path
  documented in the slice) keyed by `project_id`, not `<project>/.t3/agent-board.json`.
- Opening/creating a board does not create `.t3/agent-board.json` in the project.
- Card worktrees live under T3 home userdata outside the project root.
- Scheduler/runner stop appending orchestration proof into repository
  `taskRecordPath` files; proof is stored in internal board/card state.
- `taskRecordPath` / `slicePlanPath` become optional project-context references only.
- Legacy `<project>/.t3/agent-board.json` is imported once into internal storage
  when detected; thereafter internal storage is source of truth.
- Restart preserves board/cards/runtime fields from internal storage.
- Repository cleanliness tests: clean Git status after board open/create.
- `PATCH.md` + internals docs updated.

## Verification

- Focused AgentBoardFileSystem / scheduler / migration / cleanliness tests.
- Restart durability test for board persistence.

## Parallelism Plan

Safe: `false`

Reason: Persistence, RPC, runner worktree paths, and scheduler proof path must move together.

Allowed write scopes:

- `packages/contracts/src/agentBoard.ts`
- `packages/contracts/src/agentBoard.test.ts`
- `apps/server/src/agentBoard/**`
- `apps/server/src/persistence/**`
- `apps/web/src/state/agentBoard.ts`
- `apps/web/src/components/AgentBoardPanel.tsx`
- `docs/**`
- `PATCH.md`
- `.t3/agent-board.json`

Conflicts with:

- ORCH-042, ORCH-043

## Proof Of Done

Fill before marking done.
