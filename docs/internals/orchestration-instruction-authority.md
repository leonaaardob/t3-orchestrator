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

## Attachment point

When a thread has durable role `project-supervisor`, the reactor adds one
provider-neutral `context` field on the send-turn input. Standard threads omit
it.

The same Supervisor session also receives T3 MCP tools when a credential is
minted for the provider turn:

- `agent_board_read`
- `agent_board_create_card`
- `agent_board_update_card`

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
