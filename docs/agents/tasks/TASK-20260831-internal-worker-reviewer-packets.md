# ORCH-042-internal-worker-reviewer-packets

Status: `Backlog`
Agent eligible: yes
Slice: `docs/agents/slices/internal-orchestration-control-plane.md`

## Owner Intent

Make worker/reviewer/repair prompts consume authoritative T3 card packets and
constraints, not repository WORKFLOW.md / `.t3/agent-board.json` / generated
task Markdown as the orchestration control plane.

## Target Status

`Tested`

## Scope Guard

- Depends on ORCH-041 (internal card/proof state available).
- Do not implement Fast Mode bypass (ORCH-043).
- Do not invent synthetic repo instruction files.

## Acceptance Criteria

- `buildAgentBoardImplementationPrompt` / review / repair rebuilt around T3
  worker/reviewer constraints + card fields + optional project docs.
- No prompt language treating WORKFLOW.md or `.t3/agent-board.json` as
  orchestration source of truth.
- Workers receive scope, acceptance criteria, write scopes, attempt info, proof
  expectations from internal card state.
- Reviewers receive independent packet from internal state + diff/proof.
- Focused prompt unit tests.
- `PATCH.md` updated.

## Verification

- Unit tests for prompt builders.
- Scheduler tests still dispatch with new prompts.

## Parallelism Plan

Safe: `false`

Reason: Prompt builders feed runner/scheduler; conflicts with Fast Mode card until ORCH-041 done.

Allowed write scopes:

- `packages/shared/src/agentBoardPrompt.ts`
- `packages/shared/src/agentBoardPrompt.test.ts`
- `packages/shared/src/orchestration/**`
- `apps/server/src/agentBoard/**`
- `docs/**`
- `PATCH.md`
- `.t3/agent-board.json`

Conflicts with:

- ORCH-043 (may touch same scheduler prompt call sites lightly)

## Proof Of Done

Fill before marking done.
