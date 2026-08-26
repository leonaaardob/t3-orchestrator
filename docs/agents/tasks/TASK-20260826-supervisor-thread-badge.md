# TASK-20260826-supervisor-thread-badge

Status: `Ready`
Agent eligible: yes
Slice: `docs/agents/slices/authoritative-agent-board.md`

## Owner Intent

Make the project Supervisor thread visibly identifiable using only existing T3 thread capabilities. The Supervisor is a normal chat thread guided by AGENTS.md/WORKFLOW.md supervisor-first instructions, not a special runtime.

## Target Status

`Tested`

## Design Decisions (locked)

- No new Supervisor service, runtime, or orchestration state in .t3/agent-board.json.
- Use existing thread title + pinning (pinnedAt/pinOrderKey) + badge/label in thread list.
- The UX should show "Project Supervisor" (star/badge) at the top of the thread list for the project's main supervisor thread.
- Implementation chooses smallest consistent change: likely thread list/sidebar component + optional helper to create/ensure supervisor thread exists (or just UI affordance to pin/rename existing thread).

## Scope Guard

Do not create supervisor execution backend, do not store supervisor state in board file, do not create parallel thread system.

## Acceptance Criteria

- A normal thread can be designated as Project Supervisor (renamed to "Project Supervisor", pinned, shows Supervisor badge in thread list).
- Badge/label is visible without opening the thread.
- Thread remains a normal T3 thread (no special execution path).
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

## Parallelism Plan

Safe: `false` (touches thread UI)

Allowed write scopes:

- `apps/web/src/components/**/*`
- `packages/client-runtime/**/*` (only if thread presentation needs it)
- `packages/contracts/**/*` (only if schema needed, unlikely)
- `WORKFLOW.md`, `PATCH.md`

Conflicts with:

- TASK-20260826-execution-presets (touches different area: settings/board runner vs thread UI; can run in parallel if contracts not conflicting)
