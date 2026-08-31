# ORCH-039-orchestration-env-scoping

Status: `ready`
Agent eligible: yes
Area: `Backend`
Slice group: `Orchestration environment scoping`
Slice: `docs/agents/slices/authoritative-agent-board.md`

## Owner Intent

Scope Orchestration settings and execution preflight to the selected/owning environment without changing preset schema.

## Target Status

Settings → Orchestration reads and writes per environment; invalid presets block before provider turn with no silent fallback.

## Scope Guard

- No environmentId on ModelSelection/AgentExecutionPresets.
- No cross-environment execution.
- Do not publish.

## Acceptance Criteria

- Environment selector routes settings and provider catalogs per environmentId.
- Stale and offline states are explicit.
- Execution preflight validates against the project environment catalog.
- Preset schema unchanged; no migration; no publication.

## Non Goals

- Cross-environment orchestration.
- Remote Link/SSH/catalog changes.

## Open Decisions

- None.

## Verification

- Run the smallest relevant focused checks.
- Run broader repo checks when the implementation touches shared contracts or UI shell behavior.

## Parallelism Plan

Safe: `false`

Reason:

Settings UI, shared resolver/preflight, and board runner must agree on environment-local preset validation.

Allowed write scopes:

- packages/shared/src/agentBoardRunner.ts
- packages/shared/src/agentBoardRunner.test.ts
- apps/server/src/agentBoard/\*\*
- apps/web/src/components/settings/\*\*
- docs/agents/\*\*
- PATCH.md
- .t3/agent-board.json

Conflicts with:

- None listed.

## Proof Of Done

Fill before marking done.

---

### Scheduler 2026-08-29T12:41:43.655Z — ORCH-039-orchestration-env-scoping Running→

Implementation completed (thread 14f55e8d-8c06-4cbc-9603-680552f78808); launching review thread 6c79a44a-0cfb-4466-80be-18bb200ad868.

---

### Scheduler 2026-08-29T12:44:59.276Z — ORCH-039-orchestration-env-scoping Reviewing→

Review thread 6c79a44a-0cfb-4466-80be-18bb200ad868 → FAIL (cap exhausted 4)
Reason: invalid repair preflight is silently treated as a successful dispatch instead of explicitly blocking the card
