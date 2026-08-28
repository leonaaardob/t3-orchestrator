# T3 Orchestrator Patch

Status: Active — synced through upstream T3 Code **v0.0.35**; first public desktop
Release is **T3 Orchestrator 0.0.34** on `leonaaardob/t3-orchestrator`.

Purpose: document the fork-specific Planning, agent-board, and
supervisor-workflow modifications so this public patch can be repaired after
upstream T3 Code changes.

## Patch Goals

- Add a project-local planning board backed by `.t3/agent-board.json`.
- Keep planning state visible through Kanban, Planning table, and Dependency
  tree views.
- Make markdown planning docs the durable reasoning layer.
- Make the board the visible proof ledger.
- Support a supervisor-first agent workflow where implementation is delegated
  to bounded worker agents and reviewed before `Done`.
- Keep the planning stack portable and installable instead of spreading hidden
  behavior throughout the repo.
- Keep the fork's desktop identity isolated from official T3 Code while
  preserving an explicit, one-time migration path for the fork's own legacy
  encrypted saved-connection catalog across the 0.0.34 → 0.0.35 boundary.
- Keep packaged T3 Orchestrator in `desktop-managed-local` auth mode: local
  projects, providers, Planning, orchestration, and saved environments never
  initialize Clerk or inherit upstream T3 cloud credentials. Clerk remains an
  explicitly configured hosted-web/T3 Connect concern only.
- Keep unsigned macOS updater installs manual while retaining feed discovery;
  packaged metadata marks signed macOS builds as eligible for automatic
  installation and the UI selects the matching public DMG for unsigned builds.

### Desktop local auth attachment points

- `package.json` sets `T3ORCHESTRATOR_DESKTOP_MANAGED_LOCAL=1` for every
  `build:desktop`; `apps/web/vite.config.ts` and `apps/server/vite.config.ts`
  clear cloud/Clerk public values in that build, including when an upstream
  `.env` is present.
- `apps/desktop/src/{main.ts,preload.ts,app/DesktopApp.ts}` contains no Clerk
  bridge or preload integration. `apps/web/src/main.tsx` also declines Clerk
  at runtime for Electron, providing defense in depth against accidental
  configuration leakage.
- Keep the `t3orchestrator://` CORS handling in the server separate from
  Clerk's own origin policy. Upstream changes that reintroduce an Electron
  Clerk bridge, desktop public-config injection, or a desktop sign-in button
  must be removed when repairing this patch.

## Source Of Truth Files

These files define the planning workflow and should move together when the
patch is installed elsewhere:

- `AGENTS.md`
- `WORKFLOW.md`
- `PROJECT.md` when present
- `CONTEXT.md` or `CONTEXT-MAP.md` when present
- `docs/agents/project-master-plan.md`
- `docs/agents/symphony-conformance.md`
- `docs/agents/slices/`
- `docs/agents/tasks/`
- `docs/agents/templates/` when present
- `.t3/agent-board.json`

Public repo note: upstream/internal `.docs/`, `.plans/`, `.cursor/`, and
`.vscode/` folders are intentionally omitted from this fork's published branch.
They are not required for the Planning patch and make the public repository
harder to inspect.

## Core Integration Points

The current patch attaches to upstream T3 Code through these areas:

### Contracts (`packages/contracts`)

- `src/orchestration.ts`
  - `AgentExecutionMode` / `AgentExecutionSimplePreset` /
    `AgentExecutionAdvancedPreset` / `AgentExecutionPresets` union (Simple:
    one ModelSelection, Advanced: {implementation, review, repair}). Project
    execution override `OrchestrationProject.agentExecutionPresets` and shell
    `OrchestrationProjectShell.agentExecutionPresets` (NullOr with decoding
    default null = inherit global). Commands/payloads
    `ProjectCreateCommand` / `ProjectMetaUpdateCommand` /
    `ProjectCreatedPayload` / `ProjectMetaUpdatedPayload` carry the optional
    override. Back-compat: old projects without the field still decode.
- `src/settings.ts`
  - `AgentExecutionPresets` re-exported from orchestration plus
    `DEFAULT_AGENT_EXECUTION_PRESETS` (Simple: codex/gpt-5.6-sol) and
    `ServerSettings.agentExecutionPresets` with decoding default. Patch
    `ServerSettingsPatch.agentExecutionPresets` for whole-preset replacement.
- `src/agentBoard.ts`
  - Shared board schema, card states, runtime metadata, graph links, claim
    contract types, the `AgentBoardRunInput`/`AgentBoardRunResult` launch
    contract (run result carries `board`, `card`, optional `threadId`, and the
    absolute card `workspacePath`), and the `AgentBoardFileError` RPC error.
    Runner settings carry an optional `workerModelSelection`
    (`ModelSelection` imported from `./orchestration.ts`) — legacy board
    worker pin for installs without modern execution presets (deprecated;
    new code reads environment→project presets; the field still decodes for
    back-compat and pure-legacy synthesis).
- `src/agentBoard.test.ts`
  - Contract coverage for the board file shape plus the run input/result
    schemas (runner: `vite-plus/test`).
- `src/rpc.ts`
  - Four `WS_METHODS` entries, four `Rpc.make` definitions
    (`projectsLoadAgentBoard`, `projectsSaveAgentBoard`,
    `projectsClaimAgentBoardCard`, `projectsRunAgentBoardCard`), and their
    registration in `WsRpcGroup`. Their `error:` must be
    `Schema.Union([AgentBoardFileError, EnvironmentAuthorizationError])` —
    the auth-wrapped handler adds the authorization error at runtime.
- `src/ipc.ts`
  - Board methods on the `EnvironmentApi.projects` interface
    (`loadAgentBoard`, `runAgentBoardCard`).
- `src/index.ts`
  - Barrel re-export of `./agentBoard.ts`.

### Server (`apps/server`)

- `src/serverSettings.ts` treats `agentExecutionPresets` as an atomic persisted
  value. Because it is a tagged Simple/Advanced union, recursive default
  stripping would otherwise remove `mode` when only a model or effort changes,
  making the settings write fail during encoding.

- `src/orchestration/{decider,projector}.ts`,
  `src/orchestration/Layers/{ProjectionPipeline,ProjectionSnapshotQuery}.ts`, and
  `src/persistence/{Services,Layers}/ProjectionProjects.ts`
  - Carry `agentExecutionPresets` through project events and the durable
    projection so project overrides survive reconnects and restarts.
- `src/persistence/Migrations/043_ProjectionProjectAgentExecutionPresets.ts`
  - Adds the nullable `projection_projects.agent_execution_presets_json`
    column; old projects remain global-inheriting.

- `src/agentBoard/Services/AgentBoardFileSystem.ts`
  - Service tag + shape; error union must include every
    `WorkspacePaths*Error` variant (including `WorkspaceRootStatFailedError`).
- `src/agentBoard/Layers/AgentBoardFileSystem.ts`
  - Load/save/claim over `.t3/agent-board.json`, workspace-isolated claim
    directories, Effect beta.103 idioms (`DateTime.now`,
    `fromJsonStringPretty`, hoisted schema codecs). Also exports
    `safeWorkspaceSegment` (the WORKFLOW.md workspace-key rule) for the
    runner.
- `src/agentBoard/Layers/AgentBoardFileSystem.test.ts`
  - Service tests (temp dirs via NodeServices + WorkspacePaths.layer).
- `src/agentBoard/Services/AgentBoardRunner.ts` +
  `src/agentBoard/Layers/AgentBoardRunner.ts`
  - The single server-side launch path for board card runs (manual Run RPC
    and the future scheduler both call it): claim ->
    `GitWorkflowService.createWorktree` at `<projectRoot>/.t3/workspaces/<safe
-card-id>` on branch `board/<card-id>` from project HEAD (reused when the
    directory already contains a `.git` marker) -> `OrchestrationEngineService
.dispatch(thread.create)` with the resolved model selection and
    `runtimeMode: "full-access"` -> `dispatch(thread.turn.start)` with the
    shared prompt -> persist `runtime.implementationRunId` + heartbeat.
    Model selection resolves via environment→project presets
    (`OrchestrationProject.agentExecutionPresets` override →
    `ServerSettings.agentExecutionPresets` on Inherit; legacy
    `defaultModelSelection` / `runner.workerModelSelection` synthesize
    Simple only when no modern preset exists at either level) through
    `@t3tools/shared/agentBoardRunner`
    (`resolveEffectiveAgentExecutionPresets`,
    `resolveExecutionPresetForOperation`,
    `resolveAndValidateExecutionPresetForOperation`) BEFORE worktree/thread
    creation. When `ProviderRegistry` is present, the resolved selection is
    validated against this environment's provider catalog with no silent
    fallback to another provider/model/environment. Every failure path marks
    the card `Blocked` with `runtime.currentError`, and a failed turn start
    deletes the created thread. Review independence is not checked for
    implementation; repair passes `repair` preset when Advanced. Tested
    headless with fake engine/git layers in `Layers/AgentBoardRunner.test.ts`.
- `src/agentBoard/Services/AgentBoardScheduler.ts` +
  `src/agentBoard/Layers/AgentBoardScheduler.ts`
  - Always-on 15-second reconciler: reads project shells from the durable
    projection, reconciles `Running`/`Reviewing`/`Diagnosing` before claiming
    Ready work, uses the shared runner, persists `Reviewing`/`Review`/
    `Diagnosing`/`Needs Decision` runtime state (`reviewRunId`,
    `currentError`/`currentDecisionQuestion`, `lastHeartbeatAt`), appends
    review/repair proof to the task record (best-effort `FileSystem` write),
    and interrupts cards moved out of `Running`/`Reviewing`/`Diagnosing`.
    Review handoff is `Running` completed → `Reviewing` with a fresh review
    thread (same worktree, new thread via `buildAgentBoardReviewPrompt` +
    `resolveEffectiveAgentExecutionPresets` /
    `resolveExecutionPresetForOperation` (environment→project; legacy only if no modern preset,
    review `needs-decision` on same instanceId+model); `Reviewing` polls
    `getThreadShellById` +
    `getThreadDetailById` and parses `REVIEW: PASS`/`REVIEW: FAIL`/
    `NEEDS_DECISION:` via `parseAgentBoardReviewResult`; `FAIL` routine →
    `Diagnosing` → repair turn on the implementation thread
    (`buildAgentBoardRepairPrompt`) → next `Reviewing`; capped at
    `runner.repairCycles` (default 3) → `Needs Decision` with summary; intent
    questions → `Needs Decision` immediately. In-memory retry deadlines are
    deliberate; persisted attempt counts preserve the repair cap after restart.
    Tested in `Layers/AgentBoardScheduler.test.ts` (15 tests including
    `Reviewing` → `PASS` → `Review`, `FAIL` → `Diagnosing` → repair →
    re-review, cap → `Needs Decision`, intent → `Needs Decision`, fresh-thread
    verification).
- `src/server.ts`
  - `AgentBoardFileSystemLayerLive`, `AgentBoardRunnerLayerLive`, and
    `AgentBoardSchedulerLive` merged into `WorkspaceLayerLive`.
- `src/serverRuntimeStartup.ts`
  - Starts the scheduler in `reactors.start` beside the orchestration reactor
    and provider-session reaper.
- `src/ws.ts`
  - `agentBoardFileSystem` / `agentBoardRunner` yields in the RPC handler
    generator and four `observeRpcEffect(...)` handler entries.
- `src/auth/RpcAuthorization.ts`
  - Scope entries for the four board methods (`RPC_REQUIRED_SCOPES` is
    exhaustive by type — adding an RPC without a scope entry is a compile
    error).
- `src/server.test.ts`
  - Agent board layers added to the test app wiring.

### Web (`apps/web`)

- `src/routes/settings.orchestration.tsx`, `src/components/settings/SettingsSidebarNav.tsx`,
  `src/components/settings/settingsSearch.ts`, and `SettingsPanels.tsx` keep global
  execution presets under the dedicated **Settings → Orchestration** route. The
  project override remains in `ProjectSettingsPanel.tsx`; it is not duplicated in
  the main project sidebar. Simple mode writes one complete tagged preset used by
  implementation, review, and repair, while Advanced mode retains its three
  selections.

- `src/state/agentBoard.ts`
  - Atom commands for load/save/claimCard/runCard over the client-runtime
    environment RPC runtime (replaces the pre-0.0.23 `environmentApi` /
    `wsRpcClient` surface deleted upstream).
- `src/components/AgentBoardPanel.tsx`
  - Kanban, Planning table, card detail editor, Dependency tree + interactive Execution-path canvas, and expanded-Kanban variant over the same `board.cards` data; consumes
    the atom commands above plus `projectEnvironment.writeFile`. A
    worker-execution picker (upstream `ProviderModelPicker` + `TraitsPicker`
    wired like `ProjectSettingsPanel`) persists
    `runner.workerModelSelection` through the save atom command and shows
    whether the effective value is the board override or the project default.
    The Run button calls the `runCard` atom command (`projects.runAgentBoardCard`)
    — claim + worktree + thread launch happen server-side in one call, and the
    returned board is rendered directly.
  - Slice 7 (2026-08-25): `AgentBoardLocalView` `graph` → `execution-path` (contract `AgentBoardView: kanban|table|execution-path`, `AgentBoardFile.defaultView`) with back-compat mapping for legacy `?view=graph`; view state ↔ `board.defaultView` persistence via existing `agentBoardEnvironment.save` (persisted as `kanban` for the `expanded` presentation variant) plus `?view=kanban|table|execution-path|expanded` URL sync (`history.replaceState` + `popstate`); dead canvas guard `graphModel.width < 0` removed so the pan/zoom/grid canvas (`L625-656`, `L1005-1085`, `L948`, `0.5–1.8`) is the interactive Execution-path view alongside the dependency tree; expanded mode is a Kanban-only `?view=expanded` CSS variant (`260px → 320px`, full-bleed) toggled by an Expand/Exit button — no new component, no new RPC, monolith kept under 500 lines/view.
- `src/lib/supervisorThread.ts`
  - `SUPERVISOR_THREAD_TITLE = "Project Supervisor"` plus an
    `isSupervisorThread` helper that reads the durable thread role, never the
    mutable title.
- `packages/contracts/src/orchestration.ts`, `apps/server/src/orchestration/`,
  and `apps/server/src/persistence/`
  - Fork-local `project-supervisor` thread role, carried through the normal
    thread create/meta-update events and the durable projection. Migration 045
    backfills the former exact-title designation once. It keeps the normal
    thread runtime intact, so auto-titling and turns cannot clear identity.
- `packages/contracts/src/provider.ts`, `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`,
  and `apps/server/src/provider/Layers/`
  - The durable `project-supervisor` role adds one provider-neutral turn context
    block during normal request construction. Standard threads omit the field;
    adapters compose it into their supported prompt channel, while Codex also
    places it in collaboration-mode developer instructions. This attachment
    point must be preserved if upstream changes provider turn input or adapter
    prompt assembly.
- `src/components/Sidebar.logic.ts`
  - Re-exports `SUPERVISOR_THREAD_TITLE` / `isSupervisorThread` for shared thread presentation.
- `src/components/Sidebar.tsx`
  - Supervisor badge (violet `Crown` pill, `data-testid="supervisor-badge"`) in card, slim, and search rows; pin indicator retained. Context menu wires `Make Supervisor` / `Remove Supervisor` (set/clear durable role, set presentation title, and pin/unpin via existing APIs). Placeholder `Create Project Supervisor` creates a normal thread with the Supervisor role and pins it at top.
- `src/components/ChatView.tsx`
  - Planning tab strip + persisted `Break` safety control. Board runs no
    longer launch from the client: the previous
    `onRunClaimedAgentBoardCard` callback and its provider-metadata prompt
    block were deleted when launching moved into the server-side runner
    service.
- `src/components/chat/ChatHeader.tsx`
  - Shows Supervisor badge next to title when `title === "Project Supervisor"`.
- `src/components/threadActionMenu.logic.ts` + `src/hooks/useThreadActionMenu.ts`
  - Added `make-supervisor` / `remove-supervisor` menu items (`isSupervisor` state) dispatching through existing pin + metadata commands.
- `src/components/AgentBoardPanel.tsx`
  - Supervisor affordance banner (violet accent) — shows whether the current project's Supervisor thread exists; `Create Supervisor` button creates a normal thread with `SUPERVISOR_THREAD_TITLE` and pins it via existing commands. No board file state.
- `src/components/settings/SettingsPanels.tsx`
  - Global Agent Execution section moved to
    `OrchestrationSettingsPanel.tsx` (environment-scoped).
- `src/components/settings/OrchestrationSettingsPanel.tsx`
  - Environment selector at top of Settings → Orchestration; read/write
    `agentExecutionPresets` and provider/model catalogs via
    `useEnvironmentSettings(environmentId)` +
    `providersValueAtom(environmentId)`. Stale selections warn
    (`Unavailable on <label>`) without silent rewrite. Offline known
    environments show cached settings read-only or an explicit unavailable
    state. Preset schema remains environment-agnostic.
- `src/components/settings/ProjectSettingsPanel.tsx`
  - Project Agent Execution row: inherit (null) vs override (Simple/Advanced) over `OrchestrationProject.agentExecutionPresets` via `projectEnvironment.update`; shows inherited effective label; same pickers and same-model validation.
  - Informational `Runs on <label>` from the project's owning environment;
    project override pickers/settings use that environment's catalog.

### Client runtime (`packages/client-runtime`)

- `src/state/supervisorThread.ts`
  - Mirror of `SUPERVISOR_THREAD_TITLE` / `isSupervisorThread` for non-web consumers (mobile shares the same title rule via `packages/shared` or web lib).

### Shared (`packages/shared`) — planning-fork modules

- `src/agentBoardRunner.ts` (subpath export `@t3tools/shared/agentBoardRunner`)
  - Worker execution resolver (`resolveWorkerModelSelection`: board runner
    override -> project default -> typed missing-config) plus the shared
    missing-config error text; unit-tested in `src/agentBoardRunner.test.ts`.
    Extended for presets: `AgentExecutionOperation`,
    `resolveEffectiveAgentExecutionPresets` (project override → environment
    presets on Inherit; legacy board / project-default only when no modern
    preset exists), `resolveModelSelectionForOperation` /
    `resolveImplementationModelSelection` /
    `resolveReviewModelSelection` / `resolveRepairModelSelection`,
    `isSameModelSelection` / `isReviewIndependent` /
    `REVIEW_INDEPENDENCE_ERROR`, and `resolveExecutionPresetForOperation`
    (operation-aware + Needs Decision on same impl/review). Keeps legacy
    `resolveWorkerModelSelection` for back-compat decode.
    Environment catalog preflight:
    `validateModelSelectionAgainstProviders`,
    `resolveAndValidateExecutionPresetForOperation`,
    `formatModelSelectionCatalogError`, `describeStaleModelSelection` —
    no silent provider/model/environment fallback.
    Consumed by both the server runner service and the web Planning UI picker.
- `src/agentBoardPrompt.ts` (subpath export
  `@t3tools/shared/agentBoardPrompt`)
  - Board-card worker handoff prompt construction
    (`buildAgentBoardImplementationPrompt`,
    `buildAgentBoardImplementationThreadTitle`) plus Slice 6 review/repair
    prompt builders (`buildAgentBoardReviewPrompt`,
    `buildAgentBoardReviewThreadTitle`, `parseAgentBoardReviewResult`,
    `buildAgentBoardRepairPrompt`) which enforce the `REVIEW: PASS` /
    `REVIEW: FAIL` / `NEEDS_DECISION:` protocol and are consumed by the
    scheduler's review loop.

### Theme customization addon (fork-local addon)

- `apps/web/src/localAddons/theme-customization/themeCustomization.ts`
  - Accent / font / background-effect preference store.
- `apps/web/src/hooks/useTheme.ts`
  - Calls `applyThemeCustomization()` after each theme application.
- `apps/web/src/index.css`
  - Tail of file: font stacks, accent palettes, background-effect canvas
    layers. Overlay layers are scoped to non-default effects so the default
    look/perf matches upstream exactly (upstream moved grain into per-surface
    backgrounds for compositor-cost reasons).
- `apps/web/src/index.html`
  - Google Fonts stylesheet for the optional interface fonts.
- `apps/web/src/components/settings/settingsLayout.tsx`
  - `data-slot="settings-section-accent"` / `-surface` hooks on
    `SettingsSection`.
- `apps/web/src/components/settings/SettingsPanels.tsx`
  - Theme customization row inside `AppearanceSettingsPanel`; restore-defaults
    integration in `useSettingsRestore`.
- `apps/web/src/components/settings/settingsSearch.ts`
  - `theme-customization` search entry.

If upstream T3 Code changes navigation, project routing, RPC transport,
provider orchestration, or chat layout, start repair from these files.

## Upstream Tracking

This local repository tracks upstream T3 Code for awareness only:

```text
upstream fetch: https://github.com/pingdotgg/t3code.git
upstream push: DISABLED
```

Use `git fetch upstream --prune` to see upstream changes. Do not push planning
fork changes to upstream unless the maintainer workflow explicitly changes.

To inspect upstream drift without merging:

```powershell
git fetch upstream --prune
git log --oneline --decorate main..upstream/main
git diff --stat main..upstream/main
```

Merge or rebase only after reviewing `PATCH.md` attachment points.

## Symphony Alignment

The planning workflow is intended to mimic Symphony's long-running project
shape while using a local board file instead of Linear.

Core mapping:

- Symphony issue tracker -> T3 local `.t3/agent-board.json`.
- Symphony issue -> T3 work card.
- Symphony issue identifier -> stable board card ID.
- Symphony workpad comment -> linked task record under `docs/agents/tasks/`.
- Symphony per-issue workspace -> T3 card workspace.
- Symphony status surface -> Planning Kanban/table/dependency views.

Keep `WORKFLOW.md` front matter close to Symphony's canonical top-level keys:
`tracker`, `polling`, `workspace`, `hooks`, `agent`, and `codex`. T3-specific
fields should be documented as extensions in `WORKFLOW.md` and summarized in
`docs/agents/symphony-conformance.md`.

## Data Model

Board data is stored in `.t3/agent-board.json`.

Important card fields:

- `id`
- `title`
- `state`
- `priority`
- `area`
- `slice`
- `taskRecordPath`
- `slicePlanPath`
- `dependencies`
- `parallelism`
- `runtime`
- `intentBrief`

Important board fields:

- `schemaVersion`
- `projectRoot`
- `defaultView`
- `runner`
- `cards`
- `graphLinks`
- `createdAt`
- `updatedAt`

Dependency truth belongs in `dependencies`. Use prose in task and slice docs to
explain relationships, but keep the board fields authoritative for
visualization.

## Supervisor-First Workflow

Default behavior for non-trivial implementation:

1. Supervisor reads the project planning stack.
2. Supervisor runs an architectural pass.
3. Supervisor creates or updates the board card and task record.
4. Supervisor generates a bounded worker handoff packet.
5. Worker agent implements within allowed write scopes.
6. Worker reports changed files, verification, docs, risks, and gaps.
7. Reviewer or supervisor audits the result.
8. Supervisor updates board/task docs and decides the next state.

The supervisor may directly perform docs, board maintenance, formatting, and
tiny explicitly requested fixes. Production implementation should be delegated
when orchestration is available and authorized.

## Install/Repair Shape

For another T3 Code checkout, the planning patch should be installable in these
layers:

1. Copy planning docs and templates.
2. Add shared board contracts.
3. Add server board file service and RPC methods.
4. Add web board atom commands and Planning UI.
5. Wire Run/claim behavior into orchestration.
6. Run `vp fmt --check`, `vp lint`, and `vp run -r typecheck`.

Keep future changes aligned with that layering. Avoid placing planning rules in
unrelated UI or provider code unless there is no smaller attachment point.

### Fork install constraint (no published `t3-orchestrator@0.0.36`)

`t3-orchestrator@0.0.36` is **not** published to npm yet. The standard
`npx t3-orchestrator@latest service update` path installs an exact version from the
registry once published; until then, build the server
(`vp run --filter t3-orchestrator build:bundle`) and pre-position the runtime under
`~/.t3-orchestrator/runtime/versions/0.0.36/` with the built `dist` plus a pinned
`node_modules` tree containing `t3-orchestrator`, then run
`node dist/bin.mjs service update --base-dir ~/.t3-orchestrator`. Do not publish early
just to satisfy local migration testing.

### Distribution identity (server/CLI/npm)

Fork server/CLI distribution identity is centralized in
`packages/shared/src/distributionIdentity.ts` and exported as
`@t3tools/shared/distributionIdentity`. Upstream merges must preserve these attachment
points instead of reintroducing bare `t3` strings:

| Concern                  | Fork value                                  | Primary attachment                                         |
| ------------------------ | ------------------------------------------- | ---------------------------------------------------------- |
| npm package              | `t3-orchestrator`                           | `apps/server/package.json`                                 |
| CLI bin                  | `t3-orchestrator`                           | same + `apps/server/src/cli/invocation.ts`                 |
| Remote home default      | `~/.t3-orchestrator`                        | `apps/server/src/os-jank.ts`, `packages/ssh/src/tunnel.ts` |
| Pinned runtime entry     | `node_modules/t3-orchestrator/dist/bin.mjs` | `pinnedRuntime.ts`, `serviceLauncher.ts`                   |
| Linux service            | `t3-orchestrator.service`                   | `apps/server/src/cloud/bootService.ts`                     |
| macOS service            | `com.t3orchestrator.service`                | same                                                       |
| Desktop SSH package spec | `t3-orchestrator@<version>`                 | `packages/ssh/src/command.ts`, `apps/desktop/src/main.ts`  |
| SSH runner PATH          | never `command -v t3`                       | `packages/ssh/src/tunnel.ts`                               |
| Publish filter           | `t3-orchestrator`                           | `apps/server/scripts/cli.ts`, root `package.json`          |

Regression tests: `packages/shared/src/distributionIdentity.test.ts`,
`packages/ssh/src/tunnel.test.ts` (PATH collision), `packages/ssh/src/command.test.ts`.

Legacy Orchestrator installs under `~/.t3` require the explicit one-time procedure in
`docs/operations/orchestrator-remote-home-migration.md`. Do not auto-migrate or delete
official `~/.t3`.

## Migration Immutability

Once a migration ID has shipped (recorded in `effect_sql_migrations` on any real
database), its semantic effect must not be changed. The migrator keys by numeric
migration ID, so editing an already-shipped migration's body does **not** replay it on
databases that already recorded that ID — the change is silently skipped and the schema
drifts. Follow-up schema changes must use a **new** migration ID.

Example: the `agent_execution_presets_json` column on `projection_projects` was
originally folded into fork migration `043`. Upstream 0.0.35 had already recorded
migration `43` (as `ProjectionThreadsUnsettledAt`) on existing databases, so the
modified `043` was never replayed and the server crashed with
`no such column: agent_execution_presets_json`. The correct schema guarantee now lives
in migration `046` (`046_ProjectionProjectAgentExecutionPresets`), which is idempotent
and runs after the previously-recorded ids. Do not repurpose `043`/`044`/`045` for new
schema effects.

## v0.0.33 Sync Notes (2026-08-23)

Baseline: fork snapshot matched upstream `cb3211c8` (2026-05-03, between
v0.0.22 nightlies). Ancestry was grafted onto that commit so future syncs are
regular merges; the sync merged tag **v0.0.33** (2026-08-10).

Packaging follows upstream: **pnpm + vite-plus** (`pnpm-workspace.yaml`,
`pnpm-lock.yaml`). The earlier bun migration was dropped in this sync;
`bun.lock` is gone and repo commands are `vp i` / `vp run dev`.

Adaptations made while porting (behavior-preserving unless noted):

- Theme overlay CSS is gated on a non-default background effect; upstream
  removed full-viewport overlays for compositor-cost reasons, so the default
  look now matches upstream exactly.
- The seeded-board contract test reads the committed
  `docs/agents/templates/agent-board.example.json` shape inline instead of the
  gitignored local `.t3/agent-board.json`.
- Server board save still trusts client-provided `updatedAt` (no server-side
  timestamp override was introduced).

Verification at sync time: contracts/server/web typecheck clean under the
patched tsgo; contracts board tests 3/3; server board service tests 6/6;
server boots headless with migrations, serves the built web bundle, and the
live auth path (bootstrap → access token → WS ticket → upgrade) passes end to
end. Provider-level checks (Codex/Cursor/OpenCode runs) and an interactive
browser pass over the Planning tab remain manual follow-ups.

## Upstream Break Risks

- Chat route or tab structure changes may break the Planning entry point.
- Header/action layout changes may break the `Break` safety control.
- WebSocket/RPC contract changes may break board load/save/claim methods.
- Contract package schema conventions may change.
- Project root/environment selection may change how `.t3/agent-board.json` is
  located.
- Provider orchestration or projection-query changes may affect the runner,
  scheduler reconciliation, continuation retries, and Run/claim handoff.
- CSS/component library changes may affect `AgentBoardPanel` layout.
- Desktop packaging CI is fork-owned:
  `.github/workflows/desktop-release.yml` builds T3 Orchestrator for macOS /
  Windows / Linux (x64 + arm64), uploads Actions artifacts, and optionally
  publishes a GitHub Release to `leonaaardob/t3-orchestrator` with
  electron-updater metadata. macOS uses fork-owned Developer ID and App Store
  Connect API secrets to sign, notarize, staple, and verify the updater ZIP;
  Windows remains unsigned. It must not restore upstream `release.yml`
  (npm OIDC, Vercel, Azure signing, relay production secrets).
  Fork release tags are `orchestrator-vX.Y.Z`; package and updater versions
  remain `X.Y.Z`. `packages/shared/src/desktopUpdateRepository.ts` derives
  manual macOS DMG and release-page URLs with the same `orchestrator-vX.Y.Z`
  tag form used by the fork release workflow. The desktop app uses the
  independent bundle ID
  `com.t3orchestrator.app`, `t3orchestrator://` protocol, and `T3 Orchestrator`
  user-data profile so it can run beside official T3 Code. Existing shared T3
  Code state is intentionally not migrated.
  Note: `.gitignore` ignores `.github/workflows/`; new workflow files must be
  force-added (`git add -f`) like the other tracked workflows.
- Preview builds remain in `.github/workflows/desktop-macos-preview.yml`.
- `scripts/merge-update-manifests.ts` accepts `linux` so multi-arch
  `latest-linux.yml` can be merged the same way as mac/Windows. The parser
  preserves per-file `blockMapSize` from real AppImage manifests. Linux x64
  artifacts keep electron-builder's `x86_64` filename token. Collect steps
  drop `builder-debug.yml` / `builder-debug-*.yml`. Dry runs
  (`publish_release=false`) still merge and validate the release payload.
- Root `vite.config.ts` test `exclude` includes `**/.t3/**` so board worktree
  copies under `.t3/workspaces/` are not picked up by `vp test run`.
- N → N+1 desktop updater smoke checklist:
  `docs/operations/desktop-updater-smoke.md` (paired with the fork section of
  `docs/operations/release.md`).

## Maintenance Rule

When a future change touches fork-specific planning behavior, update this file
in the same task. A future repair agent should be able to read `PATCH.md` and
know where the patch attaches, what to verify, and which files should remain
portable.

## Runtime Break Control

The project header includes a `Break` button. It stores
`t3code.planningFeaturesDisabled` in browser local storage, switches the project
view back to Chat, disables the Planning tab, and prevents `AgentBoardPanel`
from rendering.

Use this if the Planning UI, board parser, or dependency view is crashing during
an active run. The same button appears as `Planning disabled` and can re-enable
the extra features after the run is safe.
