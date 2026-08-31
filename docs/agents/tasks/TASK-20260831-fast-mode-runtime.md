# ORCH-043-fast-mode-runtime

Status: `Backlog`
Agent eligible: yes
Slice: `docs/agents/slices/internal-orchestration-control-plane.md`

## Owner Intent

Add durable Fast Mode as an explicitly requested, explicitly approved alternate
lifecycle with structural scheduler review bypass — never Supervisor
implementation and never inferred from task size.

## Target Status

`Tested`

## Scope Guard

- Depends on ORCH-040 and ORCH-041.
- May land in parallel with ORCH-042 if prompt touch points are coordinated;
  prefer after ORCH-041 storage is stable.
- No project-wide silent Fast Mode preference in v1.
- No distributed workers.

## Acceptance Criteria

- Card schema supports `workflowMode: "standard" | "fast"` (default standard).
- `fastModeApproval` evidence: requestedAt, approvedAt, approvedBy,
  bypassedStages.
- `reviewBypass` recorded when scheduler skips Reviewing.
- Fast without approval never executes (Needs Decision / blocked path).
- Approval UI surfaces decision question + Approve/Reject Fast Mode.
- On approved Fast: impl complete → no review thread → Review + audit fields.
- Visible Fast Mode badge when review was skipped.
- Silence / other-card approval / size inference do not activate Fast Mode.
- Focused contract + scheduler + UI logic tests.
- `PATCH.md` updated.

## Verification

- Scheduler tests for standard vs fast+approved vs fast-without-approval.
- Contract decode defaults for existing boards.

## Parallelism Plan

Safe: `false`

Reason: Schema + scheduler + Planning UI share Fast Mode state.

Allowed write scopes:

- `packages/contracts/src/agentBoard.ts`
- `packages/contracts/src/agentBoard.test.ts`
- `apps/server/src/agentBoard/**`
- `apps/web/src/components/AgentBoardPanel.tsx`
- `docs/**`
- `PATCH.md`
- `.t3/agent-board.json`

Conflicts with:

- ORCH-042 (prompt/scheduler call sites)

## Proof Of Done

Fill before marking done.
