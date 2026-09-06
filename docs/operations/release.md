# T3 Orchestrator releases

The active repository is `leonaaardob/t3-orchestrator`. The previous
`t3code-planning-fork` repository is historical. Do not publish the upstream
`t3` npm package or configure upstream T3 Code infrastructure.

## Two artifacts, one version

The desktop application includes its own server. Installing or updating it does
not fetch that local server from npm. A standalone server such as KH is installed
from the public `t3-orchestrator` npm package. Its existing service launcher
prepares a pinned version, checks compatibility, snapshots state, starts a trial,
and either commits the healthy update or rolls back.

Both artifacts must have the same version: a desktop client asks a remote server
to install that exact version. Publishing desktop without npm causes
`Could not prepare t3-orchestrator@<version>` on remote update.

## Fix, verify, release

1. Commit the bug fix and focused regression tests. Keep `PATCH.md` current for
   fork attachment points. Preserve unrelated local work.
2. Advance the version with
   `node scripts/update-release-package-versions.ts X.Y.Z` and commit the four
   package manifests. Use a new stable version; never replace existing releases.
3. Push to the active repository. `Orchestrator CI` runs typechecks and tests for
   the server, desktop/web clients and their shared packages. It also runs on pull
   requests. The release workflow calls the same checks on its own source commit.
4. Run `.github/workflows/desktop-release.yml` (`Orchestrator Release`) with
   `publish_release=false` to validate a candidate. Branch dry runs are allowed.
   It builds all six desktop variants, packs the standalone server with resolved
   dependencies and production icons, installs that exact tarball into a temporary
   directory, verifies its version and service preflight, starts it, and checks
   that it serves the bundled web client. It then validates desktop updater
   manifests and assets. Nothing is published during a dry run.
5. After validation, run the same workflow from `main` with
   `publish_release=true`. A version override is optional; the default is the
   desktop manifest version. Public publication from another repository or branch
   is refused. All checks and artifact validations must pass again.
6. The workflow publishes the tested server tarball to npm using trusted
   publishing, verifies registry integrity and downloads it publicly, then
   publishes the desktop GitHub Release and updater manifests. Failure before
   npm verification blocks the desktop release. Registry metadata and tarball
   availability propagate separately; verification retries both for up to six
   minutes, including npm/CDN negative-cache delays.
7. Verify the new Mac application and update KH from its Connections screen.
   Check that the server returns at the requested version and existing projects,
   conversations and board cards remain accessible. See
   [desktop updater smoke](desktop-updater-smoke.md).

GitHub Actions owns the full suite. Locally, use targeted tests and typechecks for
changed scopes as required by `AGENTS.md`.

## npm publishing configuration

The package is public; publication access belongs to the maintainer and the
trusted GitHub workflow. The trusted publisher is:

- Owner: `leonaaardob`
- Repository: `t3-orchestrator`
- Workflow filename: `desktop-release.yml`
- Allowed action: `npm publish`

The publishing job grants `id-token: write` and installs npm 11 with OIDC support.
There is no permanent npm token to copy onto the Mac, KH, or repository. A renamed
workflow or repository requires updating the trusted publisher in npm settings.

The tarball is produced by the existing server CLI using
`node apps/server/scripts/cli.ts publish --pack-dir server-release`; this uses
exactly the same metadata resolution and icon handling as manual publishing, but
packs without contacting npm. `scripts/smoke-server-package.mjs` validates the
installed artifact. `scripts/publish-server-release.mjs` publishes those tested
bytes and verifies the registry before desktop publication.

## Failure and retry

A failed validation publishes nothing. Fix the failure and rerun the workflow.
If npm publication succeeded but the desktop publication failed, rerun failed jobs
in the **same Actions run** so it reuses the same validated artifacts. An existing
npm version is accepted only if its integrity matches the tested tarball exactly.
A different tarball requires a new version. Never republish a tag or mutate public
installers in place. The release concurrency group serializes release runs.

An npm installation failure leaves the running KH server intact. Inspect its
update error and service logs; do not overwrite its SQLite database or manually
mix runtime files. If a service trial fails, the launcher handles rollback using
its snapshot. Preserve that evidence before retrying.

### Fork signing and notarization

Current public builds through **0.0.38** are unsigned. Unsigned macOS builds
retain update detection/download but use the manual DMG install flow (no
`quitAndInstall` auto-install). When fork Apple credentials are supplied,
future builds may be Developer ID signed and notarized; those builds can
re-enable automatic installation. GitHub Release notes are generated from that
same signing state so unsigned publishes never claim notarization.

- **macOS:** when credentials are supplied, the job verifies the app
  extracted from the updater ZIP with `codesign`, `spctl`, its bundle identity,
  version, Team ID, and the app's stapled notarization ticket. The DMG retains
  that stapled app; it is not a separately notarized updater payload.
- **Windows:** no Authenticode / Trusted Signing. SmartScreen warning is
  expected on first launch of the NSIS installer.
- Do **not** ask users to disable system-wide Gatekeeper or SmartScreen.
  Only the macOS warning is expected to disappear after the signed release.

Required GitHub Actions secrets (all are fork-owned; never reuse upstream
secrets):

- `T3_ORCHESTRATOR_CSC_LINK`: base64-encoded `.p12` export containing the
  **Developer ID Application** certificate and private key.
- `T3_ORCHESTRATOR_CSC_KEY_PASSWORD`: password for that `.p12` export.
- `T3_ORCHESTRATOR_APPLE_TEAM_ID`: the 10-character Apple Developer Team ID.
- `T3_ORCHESTRATOR_APPLE_API_KEY`: App Store Connect API `.p8` key contents.
- `T3_ORCHESTRATOR_APPLE_API_KEY_ID`: App Store Connect API key ID.
- `T3_ORCHESTRATOR_APPLE_API_ISSUER`: App Store Connect API issuer ID.

The workflow maps these only for the macOS packaging step to electron-builder's
standard `CSC_*` / `APPLE_API_*` variables. electron-builder submits with
Apple's `notarytool` API-key flow; no Apple ID, app-specific password, or
provisioning profile is needed for this Clerk-free app. The minimal hardened
runtime entitlements are in `apps/desktop/entitlements.mac*.plist`; do not add
Associated Domains, sandbox, or other app capabilities without a product need.

## Repair after upstream changes

Keep the fork workflow and npm identity, including the publish-before-desktop
dependency. Do not restore upstream `release.yml` wholesale: its npm package,
relay/cloud credentials, web deployments and signing services belong to another
product. If upstream changes packaging, revalidate `apps/server/scripts/cli.ts`,
the service launcher/preflight, server tarball smoke, desktop manifests and both
Mac/KH update paths before publishing.
