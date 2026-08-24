# Goal — Finish Slice 6: Autonomous Review and Repair

## Goal

Implement the planning fork's already-defined **Slice 6: Autonomous Review And Repair**.

A successful implementation worker must not directly make a card `Done`.

The intended flow is:

```text
implementation worker finishes
→ fresh review agent
→ review against task intent / acceptance criteria / proof
→ PASS: advance toward completion
→ FAIL: bounded repair cycle
→ fresh review again
→ repeat only up to the configured repair limit
```

Routine implementation or review failures should enter the repair cycle.

Questions requiring product intent or a decision the agent should not make must stop at `Needs Decision` rather than being guessed.

Review must use a fresh agent/thread rather than the original implementation thread.

Preserve task records as the durable proof/history layer and `.t3/agent-board.json` as the live orchestration-state layer.

Use the project's configured T3 worker backend rather than hard-coding Codex for implementation, review, or repair.

## Files / documents to consult

- `docs/agents/project-master-plan.md`
  - **Slice 6: Autonomous Review And Repair** is the canonical definition.
- `WORKFLOW.md`
  - Already defines the intended review/repair policy, including:
    - `agent.max_repair_cycles`
    - `agent.review_agent: fresh`
    - `Diagnosing`
    - `Reviewing`
    - `Review`
    - `Needs Decision`
  - Also defines proof-of-done and task-record/runtime-state responsibilities.
- `docs/agents/symphony-conformance.md`
  - Required behaviors include bounded repair cycles, durable proof, and fresh review agents.
- `docs/agents/slices/`
  - Inspect any existing Slice 6-specific plan before implementation and preserve its decisions if present.
- `docs/agents/templates/`
  - Existing worker handoff, worker report, review report, and board templates.
- `docs/agents/tasks/`
  - Existing task-record format.
- `packages/contracts/src/agentBoard.ts`
  - Existing board/review/runtime contract.
- `apps/server/src/agentBoard/`
  - Existing runner/runtime path that Slice 6 should extend.
- `PATCH.md`
  - Current implementation map after the upstream T3 v0.0.33 sync.
