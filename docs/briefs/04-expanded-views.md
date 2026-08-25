# Goal — Slice 7: Expanded Views

## Goal

Finish the already-defined **Slice 7: Expanded Views** without creating a second planning system. Users can switch between Kanban, Planning table, and Execution-path without data divergence. The expanded board gives a full-screen Kanban for planning sessions.

Current state (verified 2026-08-25): `AgentBoardPanel.tsx` (3537 lines) already implements 3 views — Kanban (DndKit), Planning table (resizable columns, area groups), Dependency graph (tiered DAG, read-only family tree). Gaps are integration, not greenfield: contract/UI naming mismatch, view state not persisted, dead canvas code, and no expanded mode.

## Decisions Locked (2026-08-25)

- **Canvas graph (dead code at `AgentBoardPanel.tsx:2924`, guard `width < 0`) → Reactivated** as the interactive Execution-path base (pan/zoom already coded at `L625-656`, `L1005-1085`). Remove the guard, keep existing pan/zoom/grid logic.
- **Expanded board → Fullscreen Kanban** (not a new layout). Same Kanban component, flag `?view=expanded` + CSS (`mode=page` full-bleed, chat hidden, grid `260px` → `320px`). Swimlanes by Area/Slice only if later requested — simplest = fastest for productivity.
- **Persistence → Yes.** Wire `boardView` ↔ `AgentBoardFile.defaultView` (contract `agentBoard.ts:41`, `L172`) via existing `save` RPC + URL param `?view=kanban|table|execution-path`. Reload keeps the view and is shareable.

## Scope

- Fix `graph` vs `execution-path` naming (contract says `execution-path`, UI local type is `graph` at `L200`). Map or rename UI to `execution-path`.
- Wire persistence: init reads `board.defaultView`, switch writes back via `agentBoardEnvironment.save`, URL sync.
- Reactivate canvas: delete `width < 0` guard, expose as Execution-path interactive view.
- Expanded mode: 1 flag + CSS, no new component. Toggle button in tab bar.
- Keep monolith unless a view exceeds ~500 lines after changes — then extract.

## Non-Goals

- No Microsoft Project-style timeline variant (only if requested later).
- No new planning system, no second data model.
- No extraction into 3 files unless needed for testability.
- No new RPCs — reuse `save`.

## Files / documents to consult

- `docs/agents/project-master-plan.md` — Slice 7: Expanded Views (status `not-started`, proof: switch views without second system)
- `docs/agents/slices/authoritative-agent-board.md` — Intent: full-board/table/execution-path over same data
- `WORKFLOW.md` — Board Views (Kanban primary, list/table, expanded board, execution path with dependency lines)
- `PROJECT.md` / `CONTEXT.md` — later views include full board tab and execution-path
- `packages/contracts/src/agentBoard.ts` — `AgentBoardView` (`kanban|table|execution-path`), `defaultView`, `graphPosition`/`graphLinks`
- `apps/server/src/agentBoard/` — existing board persistence (no view logic needed beyond save)
- `apps/web/src/components/AgentBoardPanel.tsx` — current views: Kanban `L2110-2387`, Table `L2389-2653`, Dependency tree `L2656-2921`, Canvas `L2924-3221` (dead), tabs `L1818-1867`, view state `L604`
- `PATCH.md` — current implementation map after v0.0.33 sync
