# ORCH-044-legacy-removal-e2e-proof

Status: `Backlog`
Agent eligible: yes
Slice: `docs/agents/slices/internal-orchestration-control-plane.md`

## Owner Intent

Prove repository independence end-to-end, remove/deprecate legacy orchestration
doctrine from this fork’s AGENTS.md / WORKFLOW.md without changing product
behavior, and produce the migration verification report.

## Target Status

`Tested`

## Scope Guard

- Depends on ORCH-042 and ORCH-043.
- Do not implement distributed-worker pivot.
- Do not reintroduce repo `.t3` board writes.

## Acceptance Criteria

- Fixture project: no `.t3`, no WORKFLOW.md, contradictory AGENTS.md (“edit
  directly and skip review”).
- Opening project leaves Git clean; no T3 orchestration files created in repo.
- Standard Mode still: card → worker → Reviewing despite contradictory AGENTS.
- Fast Mode: approval required before execution; approved path bypasses review
  via runtime; Supervisor never implements.
- Restart preserves board/cards/modes/approvals/proof from internal storage.
- Legacy orchestration sections in fork AGENTS.md / WORKFLOW.md removed or
  clearly deprecated pointing at internals.
- PATCH.md / internals docs finalized.
- Final DoD checklist from the control-plane brief marked with evidence.

## Verification

- Fixture integration tests + restart persistence test.
- Targeted tests only (no repo-wide check unless requested).

## Parallelism Plan

Safe: `false`

Reason: Final proof across prior cards; docs migration last.

Allowed write scopes:

- `apps/server/src/agentBoard/**`
- `packages/shared/src/orchestration/**`
- `docs/**`
- `AGENTS.md`
- `WORKFLOW.md`
- `PATCH.md`
- `.t3/agent-board.json`
- test fixtures under agreed test paths

Conflicts with:

- none after ORCH-042/043 done

## Proof Of Done

Fill before marking done. Include items 1–17 of the required final report.
