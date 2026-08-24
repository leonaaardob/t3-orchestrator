# Goal — Finish the Planning Fork Scheduler / Reconciler

## Goal

Complete the autonomous scheduler/reconciler already planned by the planning fork.

The existing manual path has already been proven:

```text
Ready card
→ Run
→ claim
→ isolated workspace
→ fresh worker thread
→ worker executes
```

The target is to remove the need for a human to click `Run` and manually observe completion.

The server must autonomously:

```text
reconcile active work
→ find eligible Ready cards
→ respect dependencies and concurrency
→ claim work
→ launch the configured worker through T3
→ observe the run
→ persist runtime state back to the board
→ continue / retry / block according to the existing workflow rules
```

`.t3/agent-board.json` remains the authoritative local tracker.

The scheduler must operate server-side without requiring the Planning UI to stay open.

Do not build a separate autonomous execution path. Manual `Run` and scheduler-driven execution should converge on the same underlying runner.

## Files / documents to consult

- `docs/agents/project-master-plan.md`
  - **Slice 5: Board Runner MVP** is the canonical implementation plan.
  - It records 5A/5B/5C as complete and explicitly lists the remaining work: stream/reconcile run status back into the board.
- `docs/agents/symphony-conformance.md`
  - Especially **Required Behaviors To Preserve** and **Current Gaps**.
  - This is where the intended scheduler/reconciler behavior is documented.
- `WORKFLOW.md`
  - Project-local runtime contract.
  - Consult the front matter (`tracker`, `polling`, `workspace`, `agent`) plus board-state, eligibility, runtime-state, retry, and reconciliation rules.
- `PATCH.md`
  - Current planning-fork implementation map.
- `packages/contracts/src/agentBoard.ts`
  - Existing runtime state and board contract.
- `apps/server/src/agentBoard/`
  - Existing claim, persistence, workspace, and launch path.
- OpenAI Symphony references already listed in `docs/agents/symphony-conformance.md`, if behavior is ambiguous:
  - `openai/symphony` → `SPEC.md`
  - `openai/symphony` → `elixir/WORKFLOW.md`
