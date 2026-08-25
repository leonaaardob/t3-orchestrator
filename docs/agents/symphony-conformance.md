# Symphony Conformance Notes

Status: Draft

Purpose: document how this T3 Code planning fork maps to OpenAI Symphony's
long-running project orchestration model.

Sources reviewed:

- <https://github.com/openai/symphony/blob/main/README.md>
- <https://github.com/openai/symphony/blob/main/SPEC.md>
- <https://github.com/openai/symphony/blob/main/elixir/README.md>
- <https://github.com/openai/symphony/blob/main/elixir/WORKFLOW.md>

## What We Mirror

This fork mirrors these Symphony concepts:

- Repository-owned `WORKFLOW.md` as the policy and runtime contract.
- A scheduler/runner that claims eligible work instead of relying on manual
  one-off scripts.
- Isolated per-work-item workspaces.
- Bounded concurrency.
- Runtime state owned by one orchestrator.
- Retry and reconciliation behavior for long-running agent sessions.
- T3's provider-neutral runtime as the expected worker protocol; the worker
  provider, model, and effort are project-central configuration
  (`runner.workerModelSelection` in `.t3/agent-board.json`), not a pinned CLI.
- A single persistent workpad/proof ledger per work item.
- Workflow-defined handoff state. Success does not have to mean automatic
  merge or final `Done`.
- Operator-visible status through logs and, in this fork, the Planning UI.

## T3 Local Extensions

This fork deliberately replaces Linear with a local project board file:

- Symphony issue tracker: Linear.
- T3 planning fork tracker: `.t3/agent-board.json`.

The local tracker extension is documented in `WORKFLOW.md`:

- `tracker.kind: t3-local`
- `tracker.board_file`
- local board states
- card IDs as workspace keys
- task records as local workpads

## Vocabulary Mapping

| Symphony term        | T3 planning fork term |
| -------------------- | --------------------- |
| Issue                | Work card             |
| Issue identifier     | Board card ID         |
| Linear state         | Board state           |
| Workpad comment      | Task record           |
| Issue tracker client | Board file service    |
| Per-issue workspace  | Card workspace        |
| Human Review         | Review                |
| Terminal issue state | `Done` or `Canceled`  |

## Required Behaviors To Preserve

Future implementation should preserve these behaviors:

- `Ready` is the only autonomous launch state.
- New cards do not default to `Ready`.
- The runner reconciles active work before claiming new work.
- A card cannot run when hard dependencies are incomplete.
- Claiming and running are single-authority operations.
- Workspaces are deterministic and isolated.
- Clean worker exits trigger a continuation check if the card remains active.
- Routine failures retry with bounded repair cycles.
- State, attempt count, current error, heartbeat, and workspace path are written
  back to `.t3/agent-board.json`.
- Durable proof is written to the linked task record.
- Review uses a fresh review agent, not the original implementation thread.

## Intentional Differences

These differences are intentional and should not be treated as drift:

- The UI is richer than Symphony requires. Symphony does not prescribe a rich
  dashboard; this fork adds Kanban, table, and dependency tree views because the
  target user needs visual planning.
- The tracker is local-first. Linear can be added later, but local board state
  remains the authoritative T3 project source for this fork.
- The supervisor/architectural pass is stricter than Symphony's reference
  prompt because this fork is optimized for a non-coding user who wants intent
  shaping before implementation.
- The project planning stack includes `PROJECT.md`, `CONTEXT.md`, slice plans,
  and task records. Symphony requires only `WORKFLOW.md`; these extra files
  are local context anchors for large projects.

## Current Gaps

Implementation gaps to close before claiming full Symphony-style behavior:

- The active daemon runner reconciles `Running`/`Reviewing`/`Diagnosing` and
  claims project boards every 15 seconds, using the server-side runner and
  durable projection as its source of truth. Retry deadlines are
  intentionally in-memory; board attempt metadata remains durable across
  restarts.
- No typed workflow loader validates `WORKFLOW.md` front matter yet.
- No dynamic workflow reload yet.
- No persisted orchestrator runtime state beyond board fields yet.
- The provider-neutral worker loop is formalized: scheduler claim, shared
  runner launch, projection reconciliation, bounded continuation retries,
  fresh review-agent handoff (`Reviewing` with `reviewRunId`), `Diagnosing`
  repair cycles, and `Review`/`Needs Decision` completion are server-side and
  UI-independent. Review uses `buildAgentBoardReviewPrompt` /
  `parseAgentBoardReviewResult` / `buildAgentBoardRepairPrompt` in
  `packages/shared` with `resolveWorkerModelSelection`.
- No hook execution layer yet.
- No local equivalent of Linear comment editing for task-record update
  arbitration yet.

These are product backlog items, not documentation blockers.
