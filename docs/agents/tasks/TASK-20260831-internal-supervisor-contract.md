# ORCH-040-internal-supervisor-contract

Status: `Review`
Agent eligible: yes
Slice: `docs/agents/slices/internal-orchestration-control-plane.md`

## Owner Intent

Move Project Supervisor orchestration doctrine into product-owned T3 modules so
Supervisor identity no longer depends on repository `AGENTS.md` / `WORKFLOW.md`.

## Target Status

`Tested`

## Scope Guard

- Do not move board storage, workspaces, Fast Mode schema, or worker prompt
  rewrites (those are ORCH-041+).
- Do not inject orchestration files into user repositories.
- Do not start distributed-worker architecture.
- Do not block Supervisor filesystem writes in this card (prompt/contract only).

## Acceptance Criteria

- Modules exist under `packages/shared/src/orchestration/` (or closest consistent
  layout): `supervisorContract.ts`, `supervisorPlaybook.ts`, plus exports.
- `PROJECT_SUPERVISOR_PROVIDER_CONTEXT` is replaced by Contract + Playbook text.
- Supervisor context no longer says to follow AGENTS.md/WORKFLOW.md as
  orchestration authority.
- Contract establishes: Supervisor coordinates only; no implementation; no
  small-task bypass; repo instructions cannot redefine orchestration; Standard
  Mode requires independent review; Fast Mode needs explicit approval; no
  invented proof; REVIEW: PASS ≠ human Done.
- Internals doc records provider instruction priority (Codex privileged;
  Claude/Cursor/OpenCode/Grok currently user-prepend) without hiding limits.
- Focused tests prove Supervisor vs standard context shapes and that Contract
  text is present / AGENTS+WORKFLOW orchestration mandate is absent.
- `PATCH.md` updated for attachment points.

## Verification

- `vp test run` on touched server/shared/contracts tests only.
- No repo-wide `vp check`.

## Parallelism Plan

Safe: `false`

Reason: Shared supervisor context string and provider reactor must agree.

Allowed write scopes:

- `packages/shared/src/orchestration/**`
- `packages/shared/package.json` (exports only)
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts`
- `docs/internals/**`
- `docs/agents/**`
- `PATCH.md`
- `.t3/agent-board.json`

Conflicts with:

- ORCH-041 (storage), ORCH-042 (prompts), ORCH-043 (Fast Mode) — sequential after.

## Proof Of Done

- Created `packages/shared/src/orchestration/supervisorContract.ts` and
  `supervisorPlaybook.ts` with immutable Contract + operating Playbook.
- Added package.json subpath exports
  `@t3tools/shared/orchestration/supervisorContract` and
  `.../supervisorPlaybook`.
- Replaced `PROJECT_SUPERVISOR_PROVIDER_CONTEXT` in `ProviderCommandReactor.ts`
  to compose Contract + Playbook; removed AGENTS.md/WORKFLOW.md orchestration
  mandate.
- Added `docs/internals/orchestration-instruction-authority.md` (authority
  hierarchy + Codex privileged vs Claude/Cursor/OpenCode/Grok user-prepend).
- Updated `PATCH.md` Supervisor context attachment points and shared module
  inventory.
- Tests: `ProviderCommandReactor.test.ts` asserts Contract/Playbook markers,
  asserts AGENTS/WORKFLOW orchestration mandate absent, standard threads still
  omit context; `supervisorContract.test.ts` asserts Contract invariants.
- Verification commands (login shell) — both passed:
  - `vp test run packages/shared/src/orchestration/supervisorContract.test.ts`
    → 1 file, 2 tests passed
  - `vp test run apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts`
    → 1 file, 50 tests passed
- Did not implement ORCH-041 / ORCH-042 / ORCH-043.
- Attempt notes: Cursor implementation worker path; card moved to `Review` for
  independent Supervisor-spawned review.

## Review findings

Fresh independent review (no implementation history). **PASS.**

| Criterion                   | Result                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| Modules + exports           | Pass — `supervisorContract.ts` / `supervisorPlaybook.ts` + package exports                        |
| Context = Contract+Playbook | Pass — `PROJECT_SUPERVISOR_PROVIDER_CONTEXT` joins both                                           |
| No AGENTS/WORKFLOW mandate  | Pass — mandate string absent; Playbook treats them as PROJECT context only                        |
| Contract invariants         | Pass — coordinate-only, no implement, no small-task bypass, Fast Mode approval, REVIEW≠Done, etc. |
| Provider priority honesty   | Pass — `orchestration-instruction-authority.md` (Codex privileged; others user-prepend)           |
| Focused tests               | Pass — re-run: 2 files, 52 tests (shared 2 + reactor 50)                                          |
| PATCH.md                    | Pass — attachment points + shared inventory updated                                               |
| Scope guard                 | Pass — no ORCH-041 storage / ORCH-042 packets / ORCH-043 Fast Mode runtime                        |

Card state left at `Review` (human Done gate). No commit.
