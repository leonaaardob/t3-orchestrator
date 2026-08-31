# Server-owned orchestration storage (ORCH-041)

Status: Current

## Intent

Board documents, card proof, and card worktrees live in T3 server userdata —
not inside the user Git repository — so opening a normal project does not dirty
Git status or require a repo-local `.t3/agent-board.json`.

## Board persistence

- Table: `agent_boards` in `state.sqlite` (migration `047_AgentBoards`).
- Key: `project_id`.
- Payload: encoded `AgentBoardFile` JSON (`board_json`), plus `project_root`
  and timestamps.
- RPC still takes `cwd`; the server resolves `project_id` by looking up
  `projection_projects.workspace_root`. If no active project row exists yet,
  it uses the interim key `path:<sha256(projectRoot)[:24]>` so boards can be
  created before the project is registered. Documented as interim; prefer a
  real projection id once the project exists.
- Load/save results report `relativePath: "t3://orchestration/agent-board"`
  (not a path inside the repo).

## Legacy import

When SQLite has no row for the project and `<project>/.t3/agent-board.json`
exists, the server imports it once into `agent_boards` and then treats SQLite
as the only source of truth. There is no permanent dual-write. New
open/create paths never create the repo board file.

## Card workspaces

Absolute paths under T3 home userdata:

```text
{T3CODE_HOME}/userdata/orchestration/{projectId}/workspaces/{safeCardId}
```

(`stateDir` is `userdata` or `dev` depending on server mode.) Worktrees remain
git worktrees linked to the project repository when execution needs a checkout.

## Proof

Scheduler milestones append to `runtime.proofNotes` on the card (capped).
`taskRecordPath` / `slicePlanPath` stay optional context references only and
are never written by the scheduler.

## Related

- Slice: `docs/agents/slices/internal-orchestration-control-plane.md`
- Task: `docs/agents/tasks/TASK-20260831-internal-orchestration-storage.md`
- Patch notes: `PATCH.md` (AgentBoardFileSystem / migration 047)
