# TASK-20260828 — Safe unsigned macOS updates

Status: `Running`

## Intent

Prepare the next fork release (0.0.36 / `orchestrator-v0.0.36`) so unsigned
macOS builds continue checking `latest-mac.yml` but offer a manual,
architecture-correct DMG download instead of calling Electron's installer.

## Scope

- Carry a deterministic signed-macOS updater capability in packaged metadata.
- Preserve automatic installation for signed macOS and existing Windows/Linux behavior.
- Add explicit manual-download UX and updater diagnostics.
- Update updater/release docs; do not publish a release.

## Proof of done

- Focused desktop updater, web updater, shared URL, and packaging tests pass.
- Unsigned macOS state exposes manual download and does not call `quitAndInstall`.
- x64 and arm64 resolve to their matching DMG assets.
- `vp run build:desktop` and `vp run test:desktop-smoke` are run where host support allows.
- A non-publishing release dry run is attempted and its workflow result is recorded.

## Verification

- Focused updater/shared/UI/packaging tests: passed (121 tests).
- `vp run build:desktop`: passed.
- `vp run test:desktop-smoke`: passed.
- Impeccable UI detector: passed with no findings.
- Web typecheck remains blocked by the pre-existing `vite.config.ts` type
  error for `server.allowedHosts: false`.
- Non-publishing workflow `33125831450` was dispatched against commit
  `1372c0445`; it was still running at handoff, with a separate newer dispatch
  queued behind it. No release was published.
