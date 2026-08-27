# TASK-20260827-orchestrator-release-identity

Status: `Running` — 0.0.35 Intel-Mac validation regressions
Agent eligible: yes
Slice: `docs/agents/slices/orchestrator-release-identity.md`

## Owner Intent

Repair the 0.0.35 candidate's three desktop regressions without publishing it:
Clerk must accept the isolated protocol, a fresh isolated profile must load
projects, and useful legacy Orchestrator saved connections must have a safe
migration or recovery path. Preserve collision-free release tags and side-by-
side desktop identity isolation.

## Scope Guard

Do not publish 0.0.35, add signing, rewrite public main, revert technical
identity isolation, or migrate official T3 Code user data wholesale.

## Acceptance Criteria

- Fork releases derive `orchestrator-v<version>` tags.
- 0.0.34's release points to a fork-owned tag on its actual release commit.
- Upstream 0.0.35 merges without renumbering shipped fork migrations.
- Desktop bundle, protocol, user-data, and integration identifiers are fork-specific.
- The updater continues to use `leonaaardob/t3-orchestrator`.
- Packaged Clerk authentication accepts `t3orchestrator://`; development
  accepts `t3orchestrator-dev://`; Orchestrator runtime never falls back to
  `t3code://`.
- A fresh Orchestrator Electron profile starts/pairs its backend and renders
  existing projects without legacy browser/profile state.
- When no new connection catalog exists, legacy saved-environment metadata may
  be imported once; existing new catalogs are never overwritten and legacy
  secrets that cannot be decrypted require reconnecting.

## Verification

- Focused workflow, desktop identity/protocol/backend, migration, updater, and
  desktop build/smoke tests.
- Non-publishing six-target Desktop Release workflow dispatch for 0.0.35.
- Focused auth/protocol, bootstrap/project-query, connection catalog migration,
  identity, updater, and desktop smoke/build tests. The final proof records
  exact local pass counts and CI run/artifact details.

## Parallelism Plan

Safe: `false`

Reason: release, merge, and identity surfaces share versioned files and public
release state.

Allowed write scopes:

- `.github/workflows/desktop-release.yml`
- `apps/desktop/**`
- `scripts/**`
- `packages/**`
- `docs/**`
- `PATCH.md`
- `.t3/agent-board.json`

## Remediation Design

- The allowed desktop origins must be an identity-specific allow-list shared by
  desktop Clerk setup and server-side desktop-origin authorization. It must not
  weaken generic origin checks.
- First-run session/bootstrap must derive its own local backend endpoint and
  pairing credentials in the isolated profile; project hydration may not be
  gated on an old cached connection.
- The migration detects an absent isolated catalog, reads only the legacy
  plaintext saved-environment registry, and writes the recovered connection
  metadata using the new profile's encryption. It never opens/copies the old
  opaque encrypted catalog; unavailable or corrupt legacy secrets are omitted
  and require reconnecting.

## Proof Of Done

- Retagged the existing 0.0.34 release without re-uploading its assets.
- Merged upstream 0.0.35 preparation normally.
- Added fork-specific release tag and desktop technical identities.
- 0.0.35 regression repair: Clerk's Electron provider and server CORS now
  allow only `t3orchestrator://app` / `t3orchestrator-dev://app`; connection
  catalogs are isolated under the Electron profile, so legacy ciphertext can
  no longer block environment-registry hydration. Legacy endpoint metadata is
  recovered without importing unreadable secrets.
- Independent review: pass after recovery handling was extended for both
  unavailable and malformed legacy credentials.
- Local proof: focused suite: 8 files / 184 tests passed; `vp run
build:desktop` and `vp run test:desktop-smoke` passed. CI dry-run and Intel
  candidate retest remain required before this card can leave `Running`.
