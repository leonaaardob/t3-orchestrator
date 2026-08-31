# Internal Orchestration Control Plane

Status: Active

## Intent

Make T3 Orchestration product-owned, server-owned, repository-independent,
deterministic, and auditable — without starting the distributed-worker pivot.

## Product Direction

```text
T3 SERVER / ORCHESTRATION CONTROL PLANE  →  owns board, cards, proof, workspaces
USER PROJECT REPOSITORY                 →  owns source, optional AGENTS.md, docs
```

Opening a normal Git repo in T3 must not require T3-specific orchestration
files, must not dirty Git status, and must leave the repo usable without T3.

## Cards

| Card     | Focus                                                      |
| -------- | ---------------------------------------------------------- |
| ORCH-040 | Internal Supervisor Contract + Playbook                    |
| ORCH-041 | Server-owned board / proof / workspaces + legacy migration |
| ORCH-042 | Worker / reviewer execution packets                        |
| ORCH-043 | Fast Mode runtime + approval                               |
| ORCH-044 | Legacy removal + end-to-end independence proof             |

## Guardrails

- No synthetic AGENTS.md / WORKFLOW.md / `.t3/AGENTS.md` injected into projects.
- No distributed worker-pool / cross-server dispatch in this slice.
- Supervisor never implements production code.
- Fast Mode is never inferred from task size.
- Persistence uses existing T3 server patterns (SQLite userdata + T3-home
  workspace paths), not inventing a second database product.

## Persistence decisions (locked for ORCH-041)

- Board/cards/proof: SQLite table keyed by `project_id`, storing the board
  document (and card-embedded proof) in server `state.sqlite`.
- Card worktrees: under T3 home userdata, outside the project root, still
  linked via `git worktree` to the project when execution needs a checkout.
- Legacy `<project>/.t3/agent-board.json`: one-shot import into SQLite, then
  stop reading/writing the repo board as runtime source of truth (no permanent
  dual-write).

## Success Criteria

Match Definition of Done in the Internal Orchestration Control Plane brief
(repository cleanliness, Standard/Fast lifecycles, restart durability,
Supervisor non-implementation, no distributed-worker pivot).
