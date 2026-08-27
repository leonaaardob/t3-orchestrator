# Desktop updater smoke (N → N+1)

> Maintainers only. Validates that an installed **T3 Orchestrator** build can
> discover, download, verify, and install the next published version from
> `leonaaardob/t3-orchestrator` Releases.
>
> Do **not** publish a next version solely to fill this checklist. Run it when
> the next release is intentionally ready.

## Preconditions

- Current public baseline: **0.0.35** (`orchestrator-v0.0.35` Release assets /
  merged `latest*.yml`), whose macOS app is unsigned.
- Next version **N+1** is published on
  [`leonaaardob/t3-orchestrator` Releases](https://github.com/leonaaardob/t3-orchestrator/releases)
  with merged updater manifests (`latest-mac.yml`, `latest.yml`,
  `latest-linux.yml`) and the expected `T3-Orchestrator-*` artifacts.
- Client under test was installed from the **0.0.35** public feed (not a local
  unsigned preview with publish omitted).
- No `T3CODE_DESKTOP_UPDATE_REPOSITORY` override unless deliberately testing
  override behavior.
- Until Apple credentials exist, unsigned macOS N+1 clients must offer manual
  DMG download instead of Install & Restart. Windows/Linux keep automatic
  install. Do not disable OS protections.

## What “pass” means

On each required platform:

1. Installed **0.0.35** client detects a newer version (**N+1**).
2. Updater selects the **correct architecture** for the host.
3. Download URL / artifact name matches the platform mapping below.
4. Metadata verification succeeds (`sha512` / size from the merged manifest)
   for automatic platforms; unsigned macOS opens the matching public DMG URL.
5. **Windows / Linux / signed macOS:** Install + restart leaves the app running
   as **N+1**.
6. **Unsigned macOS:** no `quitAndInstall`; user installs the DMG manually and
   relaunches as **N+1**.

## Architecture → asset mapping

| Host                        | Expected N+1 artifact                                  |
| --------------------------- | ------------------------------------------------------ |
| macOS Intel (x64)           | `T3-Orchestrator-<N+1>-x64.zip` (DMG also published)   |
| macOS Apple Silicon (arm64) | `T3-Orchestrator-<N+1>-arm64.zip` (DMG also published) |
| Windows x64                 | `T3-Orchestrator-<N+1>-x64.exe`                        |
| Windows ARM                 | `T3-Orchestrator-<N+1>-arm64.exe`                      |
| Linux x64                   | `T3-Orchestrator-<N+1>-x86_64.AppImage`                |
| Linux ARM64                 | `T3-Orchestrator-<N+1>-arm64.AppImage`                 |

Manifest feeds: mac → `latest-mac.yml`, Windows → `latest.yml`, Linux →
`latest-linux.yml`. Linux entries must keep `blockMapSize`.

## Required physical smoke

| Platform     | Priority | Notes                                     |
| ------------ | -------- | ----------------------------------------- |
| macOS x64    | Required | Public DMG path (also used by Mac agent). |
| macOS arm64  | Required | Physical Apple Silicon when available.    |
| Windows x64  | Required | Physical or VM; expect SmartScreen.       |
| Linux x86_64 | Required | AppImage replace/restart path.            |

## Metadata-only when hardware is missing

If physical hardware is unavailable for Windows ARM or Linux ARM64:

1. Confirm the merged manifest lists both arches with `sha512` + `size`.
2. Confirm the Release asset URLs return HTTP 200 for those filenames.
3. Record “metadata-only” in the smoke notes — do not mark full install pass.

## Suggested procedure (per platform)

1. Install and launch **0.0.35** from the public Release asset for that arch.
2. Clear any stale override env vars; confirm update repo is
   `leonaaardob/t3-orchestrator`.
3. Trigger in-app update check (or wait for the normal check).
4. Confirm offered version is **N+1** and the chosen file matches the table.
5. Accept download; wait for verify + install.
6. After restart, confirm About / update UI shows **N+1** and no error toast.
7. Optionally re-check updates: should report already newest.

## Failure triage (short)

- **No update offered:** wrong feed, preview build without publish config,
  or manifests not marked latest / wrong version.
- **Wrong arch asset:** inspect merged `latest*.yml` file list and host arch.
- **Hash / size failure:** re-download Release assets; ensure no partial
  upload and no leftover per-arch temporary manifests on the Release.
- **Install blocked on macOS:** retain the failed updater logs and confirm the
  downloaded ZIP's app passes the release verification commands. This smoke is
  specifically the unsigned 0.0.35 → signed N+1 transition; do not substitute
  0.0.34 unless testing it as a separate compatibility case.

## Related docs

- Fork release path: [`release.md`](./release.md) (top “Fork desktop releases”).
- Signing/notarization setup: same file, “Fork signing and notarization”.
- Next-release backlog: same file, “Fork next-release backlog”.
