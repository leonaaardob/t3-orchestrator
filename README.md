# T3 Orchestrator

Project-level orchestration for [T3 Code](https://github.com/pingdotgg/t3code).

[![Planning](https://img.shields.io/badge/Planning-Agent%20Board-6366f1?style=flat-square)](#agent-board)
[![Cross-provider](https://img.shields.io/badge/Execution-Cross--provider-0ea5e9?style=flat-square)](#cross-provider-execution)
[![Review loop](https://img.shields.io/badge/Review-Autonomous-10b981?style=flat-square)](#review-and-repair-loop)
[![Upstream](https://img.shields.io/badge/Upstream-v0.0.34-64748b?style=flat-square)](https://github.com/pingdotgg/t3code/releases)

Talk to your **Project Supervisor**.  
It plans the work, launches isolated agents through T3, reviews their output, and repairs routine failures automatically.

> **This is not the official T3 Code project.** Upstream lives at [pingdotgg/t3code](https://github.com/pingdotgg/t3code). This repository is a separate planning/orchestration experiment inspired by [OpenAI Symphony](https://github.com/openai/symphony) — not affiliated with OpenAI.

<p align="center">
  <img src="./docs/assets/readme-hero-planning.png" alt="Planning board with Draft, Ready, Running, and Review cards plus a Run action" width="920" />
</p>

```text
You
 ↓
Supervisor
 ↓
Agent Board
 ↓
Scheduler
 ├─ Cursor
 ├─ Codex
 └─ OpenCode
 ↓
Independent Review
 ↓
Repair / Done
```

## Cross-provider execution

Unlike Symphony's Codex-centric reference, this fork runs workers through **T3's provider runtime**. Pick different models per operation — implementation, review, and repair — globally or per project.

<p align="center">
  <img src="./docs/assets/execution-presets-advanced.png" alt="Advanced execution presets for implementation, review, and repair" width="820" />
</p>

**Simple** uses one model for everything. **Advanced** splits implementation / review / repair; review must differ from implementation. Example intent:

```text
Implementation → Cursor / Composer
Review         → Cursor / Grok
Repair         → same as implementation (or override)
```

No parallel custom provider layer. If T3 can run the provider on your machine, the scheduler can dispatch it.

## Why this fork exists

Long agent sessions lose context. Plans drift, dependencies get forgotten, and work can be marked done without enough proof.

This fork adds a durable planning layer:

<p align="center">
  <img src="./docs/assets/project-supervisor-sidebar.png" alt="Sidebar showing a pinned Project Supervisor thread with Supervisor badge" width="340" />
</p>

<p align="center"><sub>Project Supervisor is a normal T3 thread — pinned and badged, not a separate runtime.</sub></p>

- **Project Supervisor** — normal T3 thread (`Project Supervisor`) guided by [`AGENTS.md`](./AGENTS.md) and [`WORKFLOW.md`](./WORKFLOW.md)
- **Agent Board** — `.t3/agent-board.json` as the visible proof ledger
- **Scheduler** — claims `Ready` cards every 15s, even with the Planning UI closed
- **Independent review** — fresh thread, same workspace, not the implementation conversation
- **Bounded repair** — routine failures retry; intent blockers stop at `Needs Decision`

## How it works

Orchestration state lives in the board file and task records — not in chat history.

```mermaid
flowchart TD
  User --> Supervisor["Project Supervisor thread"]
  Supervisor --> Board["Agent Board (.t3/agent-board.json)"]
  Board --> Scheduler["Scheduler / reconciler (15s tick)"]
  Scheduler --> Runtime["T3 provider runtime"]
  Runtime --> Workspaces["Isolated card workspaces"]
  Workspaces --> Review["Fresh review thread"]
  Review -->|PASS| Complete["Review / Done"]
  Review -->|FAIL| Repair["Diagnosing / repair"]
  Repair --> Review
  Review -->|cap exceeded or intent| Decision["Needs Decision"]
```

Card lifecycle:

```text
Backlog / Draft → Ready → Running → Reviewing → Review / Done
                              ↓            ↓
                         Diagnosing    Needs Decision
```

## Key features

### Agent Board

Project-local board backed by [`.t3/agent-board.json`](./docs/agents/templates/agent-board.example.json):

- **Kanban**, **Planning table**, and **Execution path** views over the same cards
- Card detail editing: intent, acceptance criteria, constraints, dependencies, area/slice links
- Task records under `docs/agents/tasks/` as the durable workpad per card
- Manual **Run** plus autonomous pickup when cards are `Ready`

### Autonomous scheduler

The server starts a board scheduler automatically (15-second reconciler). It:

- Reconciles `Running`, `Reviewing`, and `Diagnosing` cards before claiming new work
- Creates or reuses isolated workspaces at `.t3/workspaces/<card-id>`
- Dispatches implementation, review, and repair through T3's orchestration layer
- Appends proof to linked task records when possible
- Runs headless — the Planning tab does not need to stay open

### Simple vs Advanced execution presets

Configure defaults in **Settings → General → Agent execution presets**. Projects can inherit or override.

| Mode         | Behavior                                                   |
| ------------ | ---------------------------------------------------------- |
| **Simple**   | One model selection for implementation, review, and repair |
| **Advanced** | Separate selections for implementation, review, and repair |

In Advanced mode, **review must use a different model than implementation** (same `instanceId` + model is blocked). Repair may reuse the implementation model.

### Review and repair loop

After implementation completes:

1. Scheduler opens a **fresh review thread** in the same card workspace
2. Review agent returns `REVIEW: PASS`, `REVIEW: FAIL`, or `NEEDS_DECISION: …`
3. **PASS** → card moves to `Review` (human visibility) with proof appended
4. **FAIL** (routine) → `Diagnosing` → repair turn on the implementation thread → new review
5. Repair cycles cap at `runner.repairCycles` (default **3**) → `Needs Decision` with a summary
6. Intent or credential questions → `Needs Decision` immediately

## Visual walkthrough

**Planning table** — dense grouping by area and slice:

![Planning table view](./docs/assets/planning-table.png)

**Execution path** — dependency tiers and sequencing (same board data):

![Execution path view](./docs/assets/planning-dependency-tree.png)

## Getting started

### Requirements

- Node.js `^24.13.1` (see upstream [install docs](./docs/user/install.md))
- At least one provider CLI installed and authenticated (Codex, Claude, Cursor, OpenCode, …)
- [Vite+](https://viteplus.dev/guide/) (`vp`) — the repo package manager and task runner

### Clone and run this fork

Keep this checkout separate from a normal T3 Code install:

```bash
git clone https://github.com/leonaaardob/t3-orchestrator.git
cd t3-orchestrator
vp i
vp run dev
```

Read the `[dev-runner]` line in the terminal for the actual **server port**, **web port**, and **pairing URL**. Open the full pairing URL (including `#token=…`) in your browser before using the UI.

Runtime state defaults to this worktree's gitignored `.t3/` directory.

### Using upstream T3 instead

If you only want stock T3 Code without planning:

```bash
npx t3@latest
```

See [docs/user/install.md](./docs/user/install.md) for desktop packages and provider setup.

### Provider setup (same as upstream)

Install and log in to the CLIs you plan to use on the **machine running the server**:

| Provider | Login                 |
| -------- | --------------------- |
| Codex    | `codex login`         |
| Claude   | `claude auth login`   |
| Cursor   | `agent login`         |
| OpenCode | `opencode auth login` |

Enable additional providers under **Settings → Providers** when needed.

## Configuration

| What                     | Where                                                       |
| ------------------------ | ----------------------------------------------------------- |
| Global execution presets | Settings → General → Agent execution presets                |
| Project override         | Project settings → Agent execution (inherit or override)    |
| Board file               | `.t3/agent-board.json` (per project; gitignored by default) |
| Workflow contract        | [`WORKFLOW.md`](./WORKFLOW.md)                              |
| Supervisor rules         | [`AGENTS.md`](./AGENTS.md)                                  |
| Patch / integration map  | [`PATCH.md`](./PATCH.md)                                    |

Example board shape: [`docs/agents/templates/agent-board.example.json`](./docs/agents/templates/agent-board.example.json)

## Remote and headless usage

Planning features follow T3 Code's remote model: run the server on a host with provider credentials, pair from another device, and use the same board/scheduler behavior. See [docs/user/remote-access.md](./docs/user/remote-access.md).

The scheduler runs server-side, so autonomous `Ready` → worker → review loops do not require the Planning UI to remain open.

## Project status

- **Upstream sync:** this fork tracks [T3 Code v0.0.34](https://github.com/pingdotgg/t3code/releases).
- **Experimental:** expect breakage when upstream changes routing, RPC, chat layout, or provider orchestration. Start repairs from [`PATCH.md`](./PATCH.md).
- **Validated in this phase:** cross-provider execution, autonomous scheduler/reconciler, independent review/repair, and Advanced A/B execution presets (review model ≠ implementation model).
- **Not production-ready:** workflow front-matter validation, hook execution, and some Symphony parity items remain backlog (see [`docs/agents/symphony-conformance.md`](./docs/agents/symphony-conformance.md)).

Use the header **Break** control to disable Planning UI at runtime if a board view misbehaves during an active session (`t3code.planningFeaturesDisabled` in browser storage).

## Relationship to upstream T3 Code

|               | Upstream T3 Code                                            | This fork                                       |
| ------------- | ----------------------------------------------------------- | ----------------------------------------------- |
| Maintainer    | [T3 Tools / pingdotgg](https://github.com/pingdotgg/t3code) | Community fork                                  |
| Focus         | Multi-surface agent GUI                                     | + Agent Board, scheduler, Supervisor workflow   |
| Orchestration | Per-thread turns                                            | + project board, workspaces, review/repair loop |
| License       | MIT                                                         | MIT (same; see [LICENSE](./LICENSE))            |

Sync upstream with:

```bash
git fetch upstream --prune
git log --oneline main..upstream/main
```

Do not push planning changes to upstream unless you are contributing through their process.

## Symphony inspiration

[OpenAI Symphony](https://github.com/openai/symphony) explores long-running, repository-owned agent orchestration: tracked work items, isolated workspaces, autonomous scheduling, reconciliation, bounded retries, and durable state outside chat.

**OpenAI did not build or endorse this fork.** We borrowed the _shape_ of that workflow and mapped it onto T3 Code:

| Symphony reference    | This fork                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| Linear issues         | `.t3/agent-board.json` cards                                                                                    |
| Codex-centric workers | T3 provider-neutral runtime                                                                                     |
| WORKFLOW.md policy    | [`WORKFLOW.md`](./WORKFLOW.md) + [`docs/agents/symphony-conformance.md`](./docs/agents/symphony-conformance.md) |

## Known limitations

- No official T3 plugin system — this is a modified fork, not a drop-in extension.
- GitHub Actions workflows are omitted from this public repository (publish token lacked `workflow` scope).
- `.t3/` runtime data, workspaces, and local board state are gitignored — seed from the example template.
- Typed `WORKFLOW.md` front-matter validation and hook execution are not implemented yet.
- A generic Cursor ACP fix for composite model slugs (e.g. `gemini-3.7-flash-high`) lives on `main` for validation; upstream may absorb it separately — it is not planning-specific.

## Documentation

- Planning workflow: [`WORKFLOW.md`](./WORKFLOW.md), [`docs/agents/project-master-plan.md`](./docs/agents/project-master-plan.md)
- Templates: [`docs/agents/templates/`](./docs/agents/templates/)
- User docs (upstream): [`docs/user/`](./docs/user/)
- Internals: [`docs/internals/overview.md`](./docs/internals/overview.md)

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md). Feature ideas for **upstream** T3 Code belong in [their Ideas discussions](https://github.com/pingdotgg/t3code/discussions/categories/ideas). For this fork, open issues or PRs here.

When changing planning behavior, update [`PATCH.md`](./PATCH.md) in the same change.

## Credits

- [T3 Code](https://github.com/pingdotgg/t3code) by [T3 Tools](https://t3.gg) — upstream GUI, server, and provider stack (MIT).
- [OpenAI Symphony](https://github.com/openai/symphony) — conceptual inspiration for tracked work, workspaces, and autonomous scheduling (not affiliated).
- Orchestrator maintenance: [leonaaardob/t3-orchestrator](https://github.com/leonaaardob/t3-orchestrator).

## License

MIT — see [LICENSE](./LICENSE). Copyright (c) 2026 T3 Tools Inc. This fork remains under the upstream license; attribution to T3 Code is required when redistributing.
