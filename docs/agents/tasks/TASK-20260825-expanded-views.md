# TASK-20260825-expanded-views

Status: `Done`
Agent eligible: no
Slice: `docs/agents/slices/authoritative-agent-board.md`
Brief: `docs/briefs/04-expanded-views.md`

## Owner Intent

Finish Slice 7 so users can switch between Kanban, Planning table, and Execution-path without data divergence, and open a fullscreen Kanban for planning sessions. No second planning system.

## Target Status

`Tested`

## Design Decisions (locked 2026-08-25)

- Canvas graph at `AgentBoardPanel.tsx:2924` (guard `width < 0`) → Reactivated as Execution-path interactive base.
- Expanded board → Fullscreen Kanban via `?view=expanded` + CSS, not a new layout.
- Persistence → Yes: `board.defaultView` ↔ `boardView` via existing `save` + URL param.

## Scope Guard

Do not create a second planning system or second data model. No timeline variant. No new RPCs. Keep monolith unless a view exceeds ~500 lines.

## Acceptance Criteria

- [ ] `graph` renamed/mapped to `execution-path` to match contract.
- [ ] `board.defaultView` persists the selected view; reload keeps it; URL `?view=` is shareable.
- [ ] Canvas execution-path is reachable (pan/zoom/grid works), not hidden behind `width < 0`.
- [ ] Expanded button toggles Kanban fullscreen (chat hidden, grid 320px) via `?view=expanded`.
- [ ] Switch Kanban ↔ Table ↔ Execution-path without data loss.

## Verification

- `vp test run` for any new view tests, `vp lint`, `vp run -r typecheck` for touched scope.
- Manual: open Planning tab, switch 3 views, reload, check URL and `defaultView` in `.t3/agent-board.json`, toggle expanded, verify pan/zoom.

## Parallelism Plan

Safe: `false`
Reason: Single file `AgentBoardPanel.tsx` + contract.
Allowed write scopes:

- `apps/web/src/components/AgentBoardPanel.tsx`
- `packages/contracts/src/agentBoard.ts` (only if rename needed)
- `docs/agents/project-master-plan.md` (Slice 7 → tested)
- `PATCH.md`
  Conflicts with: none

## Proof Of Done

Implemented 2026-08-25, verified by supervisor.

**Changed files**

- `AgentBoardPanel.tsx` — view state `graph`→`execution-path` with back-compat, URL `?view=` + `defaultView` persistence, canvas guard removed, expanded mode (320px grid, full-bleed)

**Verification**

- `vp lint` 0, `typecheck` web/contracts 0, `contracts` 235 passed, `web` 1985 passed (3 pre-existing failures unrelated)
- Manual: switch Kanban/Table/Execution-path persists `defaultView` + URL, reload keeps view, expanded toggle, canvas pan/zoom/grid works

**Review**

- Worker changes within allowed scopes, naming now matches contract, persistence uses existing `save` RPC, no new data model, expanded is CSS-only.

**Gaps**

- None — all 3 views share the same `.t3/agent-board.json`, no second system.
