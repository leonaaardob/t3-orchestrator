# T3 Code Planning Patch

Status: Active — synced onto upstream T3 Code **v0.0.33** (tag `planning-fork-upstream-sync-0.0.33`).

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

- `src/agentBoard.ts`
  - Shared board schema, card states, runtime metadata, graph links, claim
    contract types, the `AgentBoardRunInput`/`AgentBoardRunResult` launch
    contract (run result carries `board`, `card`, optional `threadId`, and the
    absolute card `workspacePath`), and the `AgentBoardFileError` RPC error.
    Runner settings carry an optional `workerModelSelection`
    (`ModelSelection` imported from `./orchestration.ts`) — the
    project-central worker execution config for board card runs.
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
    Model selection resolves through `@t3tools/shared/agentBoardRunner`
    (board override -> project default) BEFORE any thread is created; every
    failure path marks the card `Blocked` with `runtime.currentError`, and a
    failed turn start deletes the created thread. Tested headless with fake
    engine/git layers in `Layers/AgentBoardRunner.test.ts`.
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
    `resolveWorkerModelSelection`); `Reviewing` polls `getThreadShellById` +
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

- `src/state/agentBoard.ts`
  - Atom commands for load/save/claimCard/runCard over the client-runtime
    environment RPC runtime (replaces the pre-0.0.23 `environmentApi` /
    `wsRpcClient` surface deleted upstream).
- `src/components/AgentBoardPanel.tsx`
  - Kanban, Planning table, card detail editor, Dependency tree UI; consumes
    the atom commands above plus `projectEnvironment.writeFile`. A
    worker-execution picker (upstream `ProviderModelPicker` + `TraitsPicker`
    wired like `ProjectSettingsPanel`) persists
    `runner.workerModelSelection` through the save atom command and shows
    whether the effective value is the board override or the project default.
    The Run button calls the `runCard` atom command (`projects.runAgentBoardCard`)
    — claim + worktree + thread launch happen server-side in one call, and the
    returned board is rendered directly.
- `src/components/ChatView.tsx`
  - Planning tab strip + persisted `Break` safety control. Board runs no
    longer launch from the client: the previous
    `onRunClaimedAgentBoardCard` callback and its provider-metadata prompt
    block were deleted when launching moved into the server-side runner
    service.

### Shared (`packages/shared`) — planning-fork modules

- `src/agentBoardRunner.ts` (subpath export `@t3tools/shared/agentBoardRunner`)
  - Worker execution resolver (`resolveWorkerModelSelection`: board runner
    override -> project default -> typed missing-config) plus the shared
    missing-config error text; unit-tested in `src/agentBoardRunner.test.ts`.
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
- GitHub Actions workflow files are intentionally omitted from this public
  fork's initial push unless the publishing token has GitHub `workflow` scope.

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
