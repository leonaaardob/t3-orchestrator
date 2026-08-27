# TASK-20260827-orchestrator-release-identity

Status: `in-progress`
Agent eligible: no
Slice: `docs/agents/slices/orchestrator-release-identity.md`

## Owner Intent

Prepare the next T3 Orchestrator release without publishing it, including
collision-free release tags and side-by-side desktop identity isolation.

## Scope Guard

Do not publish 0.0.35, add signing, rewrite public main, or migrate official
T3 Code user data.

## Acceptance Criteria

- Fork releases derive `orchestrator-v<version>` tags.
- 0.0.34's release points to a fork-owned tag on its actual release commit.
- Upstream 0.0.35 merges without renumbering shipped fork migrations.
- Desktop bundle, protocol, user-data, and integration identifiers are fork-specific.
- The updater continues to use `leonaaardob/t3-orchestrator`.

## Verification

- Focused workflow, desktop identity/protocol/backend, migration, updater, and
  desktop build/smoke tests.
- Non-publishing six-target Desktop Release workflow dispatch for 0.0.35.

## Parallelism Plan

Safe: `false`

Reason: release, merge, and identity surfaces share versioned files and public
release state.

Allowed write scopes:

- `.github/workflows/desktop-release.yml`
- `apps/desktop/**`
- `scripts/**`
- `packages/**`
- `docs/**`
- `PATCH.md`
- `.t3/agent-board.json`

## Proof Of Done

In progress.
