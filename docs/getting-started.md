# Getting Started with T3 Orchestrator

This guide is for developers who have never used T3 Code before. It takes you from install to your first card reaching **Review**.

You should be comfortable with software development. You do not need prior T3 knowledge.

For product context and limitations, see the [README](../README.md).

---

## Mental model

### Environment

A machine (or headless server) running T3 Orchestrator. It owns projects, provider CLIs, and orchestration defaults for that machine.

Examples of labels you may see:

- **Local environment** (this computer’s desktop environment)
- A paired remote machine name (for example `kyle-house`)

A project always runs on the environment that owns it.

### Provider

The coding-agent backend available on that environment — typically a CLI such as Codex, Claude Code, Cursor (`cursor-agent` / `agent`), or OpenCode.

T3 Orchestrator does not ship credentials or provider CLIs. They must be installed and authenticated on the environment where work will run.

### Model

The model selected through a provider (for example a Codex or Cursor model). Orchestration presets choose which model runs Implementation, Review, and Repair.

### Project

A workspace / repository attached to one environment. Threads, Planning, and board state belong to that project.

### Project Supervisor

A special project conversation used to maintain context and help coordinate planning. It is a normal thread with a **Supervisor** badge — not a separate autonomous service. Optional, but useful.

### Board

The work queue used by orchestration, shown under the **Planning** tab. Cards move through states such as **Draft**, **Ready**, **Running**, **Reviewing**, **Review**, and **Done**.

### Review (important)

A successful automated review (`REVIEW: PASS`) moves the card to **Review**. That does **not** mean the card automatically becomes **Done**. You inspect the result and decide when the work is finished.

---

## Step 1 — Install the desktop app

Download the build for your platform from
[GitHub Releases](https://github.com/leonaaardob/t3-orchestrator/releases):

| Platform            | Look for                                          |
| ------------------- | ------------------------------------------------- |
| macOS Intel         | `T3-Orchestrator-<version>-x64.dmg` (or `.zip`)   |
| macOS Apple Silicon | `T3-Orchestrator-<version>-arm64.dmg` (or `.zip`) |
| Windows x64         | `T3-Orchestrator-<version>-x64.exe`               |
| Windows ARM64       | `T3-Orchestrator-<version>-arm64.exe`             |
| Linux x64           | `T3-Orchestrator-<version>-x86_64.AppImage`       |
| Linux ARM64         | `T3-Orchestrator-<version>-arm64.AppImage`        |

You do **not** need upstream T3 Code, `npx t3`, or a repo clone for this path.

---

## Step 2 — Launch T3 Orchestrator

Open the installed app.

### macOS (unsigned builds)

Public builds are currently unsigned. Gatekeeper may block the first open.

Typical flow:

1. Open the DMG and drag **T3 Orchestrator** to Applications (or open the app from the DMG once).
2. If macOS says the app cannot be opened because it is from an unidentified developer, use **System Settings → Privacy & Security**, or right-click the app → **Open**, and confirm.
3. Updates currently use a **manual DMG install** flow — download the new DMG and replace the app.

Do not disable Gatekeeper system-wide.

### Windows (unsigned builds)

SmartScreen may warn on first run. Choose to run the app if you trust the download from this project's GitHub Releases. Do not disable SmartScreen system-wide.

### Linux

Make the AppImage executable, then run it (exact file manager / desktop steps vary by distro).

---

## Step 3 — Configure a provider

Open **Settings → Providers**.

Install and authenticate at least one provider CLI on **this machine** (the environment that will run agents). Examples:

| Provider | Typical login         |
| -------- | --------------------- |
| Codex    | `codex login`         |
| Claude   | `claude auth login`   |
| Cursor   | `agent login`         |
| OpenCode | `opencode auth login` |

You do not need every provider. One working provider is enough for a first run.

T3 Orchestrator does not magically provide API keys or CLIs. If the CLI is missing or not logged in on this environment, orchestration cannot run.

Enable optional providers in **Settings → Providers** when you want them.

---

## Step 4 — Add a project

From the empty home or sidebar:

1. Choose **Add project**
2. Pick **Local folder** (browse a folder on disk), or another source such as a Git URL if you prefer

You should land in a project with threads. The hero copy when no project exists is along the lines of **What should we work on?** / **Add a project to start your first thread.**

Use a real repository you are comfortable editing. For a first experiment, a small personal repo is ideal.

---

## Step 5 — Configure orchestration

Open **Settings → Orchestration**.

1. Use the **Environment** selector to choose which environment’s defaults you are editing (for a first run, that is usually **Local environment**).
2. Under **Environment defaults**, choose **Simple** or **Advanced**:
   - **Simple** — one model for implementation, review, and repair
   - **Advanced** — separate **Implementation**, **Review**, and **Repair** models; Review must differ from Implementation
3. Pick a provider/model that actually exists on this environment

Projects inherit these defaults. You can later override a single project under project settings → **Agent execution** (inherit vs **Simple (override)** / **Advanced (override)**).

For a first run, **Simple** with one known-good model is enough.

---

## Step 6 — Open Planning / Board

In the project, open the **Planning** tab.

On first open, T3 Orchestrator creates an empty board file at:

```text
.t3/agent-board.json
```

You do **not** need to hand-copy templates, and you do **not** need `PROJECT.md` / `WORKFLOW.md` / `AGENTS.md` for the board UI to work.

Empty board copy looks like: **No cards yet.** / **Add a draft card to start shaping work.**

Create a draft with **New item** (or **Add a card** in a column). Fill a short intent / acceptance criteria if prompted, then put the card in **Ready** when you want it runnable.

Cards intended for execution must reach **Ready**. That is the deliberate start-work signal.

---

## Step 7 — Project Supervisor (optional)

In the sidebar, use **Create Project Supervisor** (or **Create Supervisor** from the Planning affordance) if you want a pinned planning thread.

What it **does**:

- Gives you a durable place to discuss project context and shape board work
- Stays pinned with a **Supervisor** badge

What it **does not** do:

- It is not a separate orchestration daemon
- It does not auto-approve Review or mark cards **Done**

Skip this step if you only want to run one small card by hand.

---

## Step 8 — Run a small card

Keep the first card harmless, for example:

```text
Add a simple README section describing how to run the project locally.
```

Checklist:

1. Card is in **Ready**
2. Orchestration preset points at a working provider/model
3. Click **Run** on the card (or leave it Ready for autonomous pickup)

Observable happy path:

```text
Ready → Running → Reviewing → Review
```

Other branches you may see:

| State              | Meaning                                         |
| ------------------ | ----------------------------------------------- |
| **Diagnosing**     | Repair after a failed review                    |
| **Needs Decision** | Repair cap hit, or a human decision is required |

---

## Step 9 — Human review

When automated review passes:

```text
REVIEW: PASS
→ card enters Review
→ inspect the diff / threads / result
→ you decide when work is Done
```

Move the card to **Done** only when you accept the change. Automated review is a second opinion, not a ship button.

---

## Optional: Run projects on another machine

Skip this until local flow works.

Model:

```text
Your desktop (client)
    → Create link / pairing
    → Remote environment (owns projects, files, providers)
```

Typical UI path:

1. On the machine that should **host** projects, run T3 Orchestrator (desktop with network access, or a headless `t3-orchestrator` server). Fork identity and data live under `~/.t3-orchestrator` by default — not `~/.t3`.
2. In **Settings → Connections**, use **Create link** to mint a pairing link.
3. On your client, open that link / complete pairing so the remote environment appears.
4. Add or use projects on that remote environment. Execution stays there.

Important limits:

- Project execution remains on that environment
- There is no cross-machine Implementation / Review routing
- There is no automatic workspace sync between machines
- If the remote environment is offline, its projects cannot run

SSH can be used as a fallback / advanced connection option for launching or reaching a remote host. Prefer **Create link** / pairing when it fits your setup.

Never use upstream `npx t3` as the T3 Orchestrator server install path. Use the fork identity (`t3-orchestrator`, `~/.t3-orchestrator`).

---

## If something fails

- **No providers / models in Orchestration** — install and log in to a CLI on the project’s environment, then re-check **Settings → Providers**
- **Card stuck / Needs Decision** — open the card and linked threads; fix credentials, clarify intent, or adjust presets
- **Planning empty** — confirm a project thread is open; the board loads for the project workspace
- **Unsigned OS warning** — approve this build once; do not disable OS protections globally

---

## Next

- Product overview and limitations: [README](../README.md)
- Contributing: [CONTRIBUTING.md](../CONTRIBUTING.md)
