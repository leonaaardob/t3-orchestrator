# TASK-20260826-execution-presets

Status: `Tested`
Agent eligible: yes
Slice: `docs/agents/slices/authoritative-agent-board.md`

## Owner Intent

Replace single worker execution setup with Simple/Advanced execution presets that follow Global -> Project inheritance, and enforce review independence (implementation model != review model).

## Target Status

`Tested`

## Design Decisions (locked)

- Execution presets follow existing ModelSelection architecture (instanceId + model + options). No new provider abstraction.
- Global settings store default presets; Project overrides via OrchestrationProject optional override field (null means inherit).
- Simple mode: one ModelSelection used for implementation, review, repair (back-compat).
- Advanced mode: { implementation, review, repair } each a ModelSelection. Runtime selects preset by operation.
- Review independence: if implementation and review selections are identical (same instanceId + model), review is blocked (Needs Decision / validation error) rather than silently self-reviewing. Repair may reuse implementation preset.
- No per-card or per-column configuration. No new scheduler architecture.

## Scope Guard

Do not introduce per-card provider/model, per-column config, dynamic routing, AI model selection, new supervisor runtime.

## Acceptance Criteria

- Contracts: new execution preset schemas (Simple/Advanced union) in settings and project override, with defaults to Simple back-compat mode; old boards/settings decode.
- Server: resolver selects correct preset by operation (implementation vs review vs repair) with Global->Project inheritance; review independence validation blocks same-model review with clear error / Needs Decision.
- Web: Global Agent Execution settings UI (Simple radio + Advanced with 3 pickers) and Project override UI (inherit vs override with same Simple/Advanced); uses existing ProviderModelPicker/TraitsPicker.
- Scheduler/Runner use new resolver; existing single workerModelSelection path deprecated but still decodes via migration.

## Implementation Plan

1. Contracts:
   - packages/contracts/src/settings.ts: add AgentExecutionMode ("simple"|"advanced"), AgentExecutionPresets (simple: ModelSelection, advanced: {implementation, review, repair}), global defaults.
   - packages/contracts/src/orchestration.ts: add optional agentExecutionOverride to OrchestrationProject (or reuse defaultModelSelection migration path).
   - packages/contracts/src/agentBoard.ts: deprecate workerModelSelection but keep for back-compat; new code reads from project/global.

2. Shared resolver: packages/shared/src/agentBoardRunner.ts extend with resolveImplementationModelSelection, resolveReviewModelSelection, resolveRepairModelSelection + independence check.

3. Server: update AgentBoardRunner/AgentBoardScheduler layers to use per-operation resolvers.

4. Web: SettingsPanels global UI + ProjectSettingsPanel project override UI.

5. Update WORKFLOW.md front matter and PATCH.md.

## Verification

- vp test run on contracts, shared resolver, scheduler tests
- Scoped typecheck/lint
- Manual: configure Simple globally, override per project, run board card and verify correct model used for impl vs review; same-model impl/review blocked.

## Completion

- Presets persist through the project event and SQL projection path; `null` remains inheritance.
- Focused resolver, runner, scheduler, and migration coverage passes.
- **Regression fix (2026-08-26):** `getActiveProjectByWorkspaceRoot` now maps `agentExecutionPresets` from the SQL row (was selected but dropped on decode, causing Codex fallback via `defaultModelSelection`). Regression test: `ProjectionSnapshotQuery.test.ts` → `preserves agentExecutionPresets in getActiveProjectByWorkspaceRoot`.
- **Live A/B proof (port 13991, LIVE-AB-CURSOR-008):** Advanced presets applied — implementation thread `807d4421…` → `cursor/composer-2.5`, review thread `71e757b2…` → `cursor/gemini-3.7-flash-high`; marker file created. Preset routing proven; review failure was not Codex fallback.
- **Cursor ACP composite slug bug (upstream T3, commit `9c9796c37`):** composite slugs like `gemini-3.7-flash-high` must map to `model=gemini-3.7-flash` + `reasoning=high`. Pre-fix: `session/set_config_option` failed → `review session is error`. Post-fix: session starts; see Gemini repro below.
- **Gemini provider repro (external to planning):** `apps/server/scripts/cursor-acp-model-mismatch-probe.ts` with `gemini-3.7-flash-high` or `gemini-3.7-flash` + `CURSOR_REASONING=high` returns `NonRetriableError: Provider Error We're having trouble connecting to the model provider` even when ACP config succeeds. `composer-2.5` and `grok-4.6` respond normally in the same environment.
- **Full-flow green proof:** rerun Advanced A/B with two working Cursor models (`composer-2.5` impl + `grok-4.6` review) and verify `REVIEW: PASS/FAIL` reconciliation.
- **Fixture trap:** agent-board card `priority` must be `>= 1` (`PositiveInt`); `priority: 0` yields `board-unreadable`.

## Parallelism Plan

Safe: `false` (touches contracts, settings, server layers, web UI)

Allowed write scopes:

- `packages/contracts/src/settings.ts`, `packages/contracts/src/orchestration.ts`, `packages/contracts/src/agentBoard.ts`
- `packages/shared/src/agentBoardRunner.ts`
- `apps/server/src/agentBoard/**`
- `apps/web/src/components/settings/**`, `apps/web/src/components/AgentBoardPanel.tsx`, `apps/web/src/state/**`
- `WORKFLOW.md`, `PATCH.md`

Conflicts with:

- TASK-20260826-supervisor-thread-badge (different area; can run parallel if contract changes coordinated)
