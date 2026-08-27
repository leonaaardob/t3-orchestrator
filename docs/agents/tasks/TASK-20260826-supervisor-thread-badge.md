# TASK-20260826-supervisor-thread-badge

Status: `Tested`
Agent eligible: yes
Slice: `docs/agents/slices/authoritative-agent-board.md`

## Owner Intent

Make the project Supervisor thread visibly identifiable using only existing T3 thread capabilities. The Supervisor is a normal chat thread guided by AGENTS.md/WORKFLOW.md supervisor-first instructions, not a special runtime.

## Target Status

`Tested`

## Confirmed Regression (2026-08-28)

The original title-only designation is not durable enough. `ChatView` auto-titles
any existing thread on its first message, including a created Supervisor. That
overwrites `Project Supervisor`, which is currently both the identity and the
badge predicate. The thread is not replaced; its semantic designation is lost
because it was never represented independently of its mutable title.

Legacy events are recognized by their creation title exactly once during replay
and converted into the durable role; normal title updates never infer or clear
that role.

## Design Decisions (superseded)

- No new Supervisor service, runtime, or orchestration state in .t3/agent-board.json.
- Persist an explicit thread role; `project-supervisor` is independent from the
  mutable display title and is the sole badge predicate.
- Retain title and pinning as presentation choices, not identity.
- The UX should show "Project Supervisor" (star/badge) at the top of the thread list for the project's main supervisor thread.
- Implementation chooses smallest consistent change: likely thread list/sidebar component + optional helper to create/ensure supervisor thread exists (or just UI affordance to pin/rename existing thread).

## Scope Guard

Do not create a separate supervisor execution backend, store supervisor state
in the board file, or create a parallel thread system. The Supervisor remains
one normal thread with a durable role on its normal thread record.

## Acceptance Criteria

- A normal thread can be designated as Project Supervisor (role set to
  `project-supervisor`, title optionally set to "Project Supervisor", pinned,
  and shows Supervisor badge in thread list).
- Badge/label is visible without opening the thread.
- Thread remains a normal T3 thread (no special execution path); sends and
  execution preserve the same thread ID and role.
- No new RPC methods unless required for badge; prefer existing pin/title APIs.

## Implementation Plan

1. Inspect apps/web/src/components/\* thread list (Sidebar, thread-list-v2-items.tsx, etc.), ChatView pinned handling, and contracts OrchestrationThread.pinnedAt.
2. Add supervisor badge/label in thread list UI for a designated supervisor thread (e.g., title == "Project Supervisor" or pinned + marker).
3. Provide affordance to create/ensure supervisor thread (e.g., button in Planning or placeholder when none exists) that creates a normal thread with title "Project Supervisor" and pins it via existing thread.pin command.
4. Keep docs minimal: update PATCH.md, maybe WORKFLOW.md note.

## Verification

- `vp test run` on touched tests
- Typecheck/lint scoped
- Manual: thread list shows supervisor badge, pin persists, survives reload

## Completion

- Supervisor role is persisted on the normal thread record and survives title
  mutation, turn execution, projection hydration, and restart.
- Normal workers/reviewers default to `standard`; no execution path creates or
  rebinds a Supervisor thread.
- Sidebar/search/header presentation exposes the durable role without a new
  Supervisor runtime or RPC.

## Parallelism Plan

Safe: `false` (touches thread UI)

Allowed write scopes:

- `apps/web/src/components/**/*`
- `packages/client-runtime/**/*` (only if thread presentation needs it)
- `packages/contracts/**/*` (only if schema needed, unlikely)
- `WORKFLOW.md`, `PATCH.md`

Conflicts with:

- TASK-20260826-execution-presets (touches different area: settings/board runner vs thread UI; can run in parallel if contracts not conflicting)
