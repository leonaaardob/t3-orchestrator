# Orchestration instruction authority

> Maintainer-facing. Describes where Project Supervisor orchestration doctrine
> lives and how providers receive it. Not a user guide.

## Authority hierarchy

For **Project Supervisor** identity and T3 orchestration behavior:

1. **Product Contract + Playbook** — `packages/shared` modules
   (`supervisorContract`, `supervisorPlaybook`), composed into
   `PROJECT_SUPERVISOR_PROVIDER_CONTEXT` by `ProviderCommandReactor`.
2. **T3 server orchestration** — board, cards, proof, workspaces, thread role
   `project-supervisor`, and turn construction.
3. **Project-native instructions** — `AGENTS.md`, `WORKFLOW.md`, `CLAUDE.md`,
   `PROJECT.md`, `CONTEXT.md`, and similar files in the opened repository.

Project-native files may describe repository norms, product constraints, and
coding taste. They **cannot redefine** Supervisor identity, delegation rules,
Standard/Fast Mode policy, or other T3 orchestration doctrine.

Opening a normal Git repo must not require T3-specific orchestration files in
the tree. T3 must not inject fake `AGENTS.md` / `WORKFLOW.md` /
`.t3/AGENTS.md` into user projects to carry Supervisor doctrine.

## Board and proof storage

- Live boards: SQLite `agent_boards` in T3 userdata (`t3://orchestration/agent-board`).
- Card worktrees: `{stateDir}/orchestration/{projectId}/workspaces/{cardId}`.
- Proof: `runtime.proofNotes` on the card (not required task Markdown).
- Legacy `<project>/.t3/agent-board.json`: imported once, then ignored for writes.

Supervisor follow-up notifications are durable SQLite state in
`agent_board_supervisor_wakes`. Board saves record result transitions into
`Review`, `Blocked`, or `Needs Decision`, plus human unblock transitions back
to `Ready` and human `Review` → `Done` validation; scheduler, human, and
Supervisor writers are identified explicitly.
A Supervisor-origin save marks its current snapshot observed so it cannot wake
itself. Each row stores a coalescing fingerprint, card ids, command id, retry
attempts/deadline, and last error. The same command id is reused until the
orchestration receipt confirms acceptance, together with its immutable thread,
message, mode, and `createdAt` fields. A receipt resolves that notification
immediately: a later notification is not held behind a missing projection.
The envelope claim is conditional on the pending fingerprint, so a concurrent
board save cannot attach a newly generated command to a replacement notice. The
in-flight dispatch fingerprint is stored separately from the current pending
fingerprint: a newer result cannot overwrite the immutable command envelope, and
receipt resolution checks affected rows before clearing it. This lets restart
replay the original command and then process the newer notification once.
The `onlyIfIdle` command guard rejects a later automatic start while the first
turn is queued or active. Accepted `thread.turn.interrupt` and
`thread.session.stop` events immediately project an interrupted or stopped
session before their provider reactor work begins, so the same guard rejects a
pending wake at receipt time. A normal user `thread.turn.start` remains an
explicit resume path. Three failed dispatches park the row until a new board
transition changes its fingerprint. Existing result-state boards
are seeded once by decoding their persisted JSON through `AgentBoardFile`'s
JSON codec, rather than treating the JSON string as a board object.
The provider-command reactor then atomically claims the exact pending start row
before provider preparation. Explicit `thread.turn.interrupt` and
`thread.session.stop` events delete that row in their engine transaction, so an
accepted automatic event cannot bypass a user stop while it is waiting in the
reactor queue; whichever durable operation commits first wins.

## Attachment point

When a thread has durable role `project-supervisor`, the reactor adds one
provider-neutral `context` field on the send-turn input. Standard threads omit
it.

The same Supervisor session also receives T3 MCP tools when a credential is
minted for the provider turn:

- `agent_board_read`
- `agent_board_create_card`
- `agent_board_update_card`
- `agent_board_run_card`

The wake reactor uses the same `thread.turn.start` path, so the durable
Supervisor role, provider context, and MCP capability are preserved. It only
selects an active Supervisor thread for the matching project. Archived/deleted
threads, settled, snoozed, stopped, or interrupted Supervisors, active or queued turns, and pending
approvals or user input are skipped without clearing the pending row. Its
`thread.turn.start` uses the server-only `onlyIfIdle` guard as a second check in
the command decider, preventing a stale wake snapshot from reviving an explicit
user stop or issuing a duplicate queued turn. The wake message is intentionally
small and requires `agent_board_read` against the current board; it does not
carry a board snapshot or authorize Review→Done, Draft promotion, attempt
resets, or human decisions.

`agent_board_run_card` immediately reconciles the owning project through the
same scheduler as automatic Ready-card execution. Scheduler ticks and explicit
requests share a lock, preserving dependencies, priority, concurrency limits,
Fast Mode approval, and duplicate-run protection. The returned persisted card
distinguishes queued Ready work, an active worker, and launch failures. Review
and repair remain scheduler-owned, and Done remains a human decision.
Before review, the scheduler stores the completed worker turn's assistant report
in card proof notes and includes it in the reviewer packet. Repair requests store
their timestamp in `runtime.repairRequestedAt`; the previous completed turn cannot
trigger another review while the new request is still awaiting projection.
When a Ready card retains a completed worker and an unresolved runtime error or
decision question, the scheduler dispatches a repair continuation instead of
re-reviewing the old completion. Successful dispatch enters Diagnosing with a
fresh bounded attempt budget and records the previous cycle count in proof notes.
The existing thread/workspace and proof remain intact; dispatch failure parks the
card as Blocked without resetting its budget. Completed Ready cards without a
failure still reconcile normally. This shared path serves MCP Run, client Run,
and automatic Ready-card scheduling under the same lock and concurrency limit.

These tools are gated by the `agent-board` MCP capability (issued only for
`project-supervisor` threads) and re-check durable thread role + project id from
projection state. Project identity is never taken from a model-supplied path.

Adapters then map that field into whatever channel their CLI supports. The
mapping differs by provider; do not assume a privileged developer channel
everywhere.

## Per-provider reality

| Provider     | How Supervisor `context` reaches the model today                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Codex**    | Privileged path: `developerInstructions` ← `context`, which lands in collaboration-mode `developer_instructions`. CodexAdapter also joins via `providerTurnText`, so the same text can appear in the turn prompt as well. |
| **Claude**   | No separate developer field in the adapter path used here. `providerTurnText` **prepends** `context` to the user-level turn text.                                                                                         |
| **Cursor**   | Same as Claude: **user-level prepend** via `providerTurnText`.                                                                                                                                                            |
| **OpenCode** | Same: **user-level prepend** via `providerTurnText`.                                                                                                                                                                      |
| **Grok**     | Same: **user-level prepend** via `providerTurnText`.                                                                                                                                                                      |

### Do not hide the limitation

For Claude, Cursor, OpenCode, and Grok, Supervisor Contract/Playbook currently
travel as **user-visible / user-turn text**, not as a privileged system or
developer instruction channel. Models may treat that text like ordinary user
content. Improving those channels is future work; documenting the limit is
required now.

Codex is the only adapter in this set with a first-class privileged
`developer_instructions` attachment for the same `context` field.

Provider turn-start delivery is durable through the local provider response:
the reactor retains and reconciles only a `pending` start on boot. A process
failure after the claim or across an external provider's acceptance boundary
cannot be made exactly-once without a provider idempotency acknowledgement;
persisted `claimed` and `sending` intents are retained for inspection and are
not replayed blindly. The projection exposes a delivery reason: recovery paused
after claim, or recovery paused after the provider handoff. Inspect
`ProjectionTurnRepository.getPendingTurnStartByThreadId`; its
`ProjectionPendingTurnStart.deliveryReason` is the server-visible diagnostic
for this retained intent.

## What this is not

- Not a license to write orchestration files into the project worktree.
- Not a claim that every provider has equal instruction privilege.
- Not the worker/reviewer packet rewrite (separate card) or board storage move
  (separate card).

## Related code

- `@t3tools/shared/orchestration/supervisorContract`
- `@t3tools/shared/orchestration/supervisorPlaybook`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
  (`PROJECT_SUPERVISOR_PROVIDER_CONTEXT`)
- `packages/contracts` `providerTurnText`
- Provider adapters under `apps/server/src/provider/Layers/`
