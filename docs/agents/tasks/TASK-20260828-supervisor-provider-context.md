# TASK-20260828-supervisor-provider-context

Status: `Tested`
Agent eligible: yes
Slice: `docs/agents/slices/authoritative-agent-board.md`

## Owner Intent

Make the persisted `project-supervisor` thread role influence provider turn
context without adding a second orchestration path or mechanical delegation
enforcement.

## Scope

- Carry the projected thread role through normal provider turn construction.
- Add one provider-neutral context block only for `project-supervisor`.
- Preserve the standard-thread request and prompt unchanged.
- Deliver the context through each provider adapter's supported prompt or
  developer-instruction channel.

## Non-goals

- No title-based Supervisor inference.
- No automatic worker spawning, filesystem restrictions, or board enforcement.
- No automatic loading of planning files beyond the explicit AGENTS.md and
  WORKFLOW.md handoff.

## Proof Of Done

- Provider command reactor tests prove standard and Supervisor request shapes.
- Codex turn construction proves the developer instruction contains the handoff.
- Contract tests prove the neutral context composition rule.
