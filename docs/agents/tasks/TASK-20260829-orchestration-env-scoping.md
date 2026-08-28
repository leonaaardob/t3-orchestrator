# TASK-20260829-orchestration-env-scoping

Status: `Tested`
Agent eligible: yes
Slice: `docs/agents/slices/authoritative-agent-board.md`

## Owner Intent

Make Settings → Orchestration environment-aware. Presets stay environment-agnostic
in schema. Provider/model choices are scoped to the selected environment. No
silent fallback. Add execution preflight against the project environment's
provider catalog before board work proceeds.

## Target Status

`Tested`

## Design Decisions (locked)

- Project = execution boundary. No cross-environment execution.
- Do not add `environmentId` to `ModelSelection` or `AgentExecutionPresets`.
- Reuse existing `EnvironmentId` / connection registry / `providersValueAtom`.
- Prefer Provider Settings environment abstractions.
- No silent provider/model fallback. Stale presets warn and stay editable.
- Offline: show cached settings when available; otherwise explicit unavailable.
- Project UI: informational `Runs on <label>` only — no environment dropdown.
- Preflight validates resolved selection against the owning environment catalog
  before worktree/thread/provider turn.

## Scope Guard

Do not implement cross-environment orchestration. Do not modify Remote Link,
SSH, pairing, connection catalog, or runtime distribution. Do not change board
execution semantics beyond preflight validation. Do not publish.

## Acceptance Criteria

- Settings → Orchestration has an environment selector; read/write target the
  selected environment's settings/providers.
- Same `instanceId` on two environments does not bleed catalogs.
- Stale provider/model shows warning without rewrite.
- Offline known environments stay selectable with explicit offline/cached state.
- Execution preflight blocks invalid selections before provider turn.
- Focused tests cover switching, persistence, stale, offline, preflight,
  Simple, and Advanced.
- Preset schema unchanged; no migration; no npm/GitHub publication.

## Verification

- Focused Orchestration settings / provider routing / preflight tests
- Web build, desktop smoke, desktop build
- Optional two-environment smoke (This Mac vs kyle-house)
- Dry-run `0.0.36` with `publish_release=false` if clean

## Parallelism Plan

Safe: `false`

Allowed write scopes:

- `packages/shared/src/agentBoardRunner.ts`
- `packages/shared/src/agentBoardRunner.test.ts`
- `apps/server/src/agentBoard/**`
- `apps/web/src/components/settings/**`
- `docs/agents/**`
- `PATCH.md`
- `.t3/agent-board.json`
