# TASK-20260827-orchestrator-macos-signing

Status: `Running` — awaiting fork Apple credentials and GitHub Actions dry-run
Agent eligible: yes
Slice: `docs/agents/slices/orchestrator-macos-signing.md`

## Owner Intent

Make public T3 Orchestrator macOS builds Developer ID signed and notarized so
the existing Electron/Squirrel updater can install the signed ZIP over the
public unsigned 0.0.35 baseline.

## Scope Guard

Keep `com.t3orchestrator.app`, `t3orchestrator://`, updater repository and
artifact names unchanged. Do not publish, alter Windows/Linux signing, or use
upstream credentials.

## Acceptance Criteria

- Both macOS architectures require fork-owned signing/notarization secrets.
- Signed apps use hardened runtime and minimal Electron entitlements.
- CI verifies the app extracted from each updater ZIP with `codesign`,
  `spctl`, identity/version/Team ID inspection, and notarization staples.
- `latest-mac.yml` continues to point to the existing x64/arm64 ZIP names.
- A non-publishing signed macOS dry run passes before release 0.0.36.

## Proof Of Done

Record the GitHub Actions run URLs/IDs and the accepted notarization/signature
output for both architectures. Then hand a physical Mac agent the public
0.0.35 → signed 0.0.36 updater smoke described in
`docs/operations/desktop-updater-smoke.md`.
