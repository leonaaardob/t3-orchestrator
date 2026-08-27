# T3 Orchestrator macOS signing and notarization

Status: `active`

This fork-only release-engineering slice makes public macOS updater ZIPs
installable by using the fork's own Developer ID Application certificate and
App Store Connect notarization identity. It does not change updater feeds,
bundle identity, protocols, or non-macOS signing.

## Design

- Bundle ID remains `com.t3orchestrator.app`.
- `scripts/build-desktop-artifact.ts --signed` enables electron-builder's
  Developer ID signing/notarization discovery with hardened runtime and the
  minimal Electron JIT/library-validation entitlements.
- `.github/workflows/desktop-release.yml` maps only
  `T3_ORCHESTRATOR_*` GitHub secrets into electron-builder's standard
  environment names. A macOS dispatch fails before packaging if any is absent.
- CI extracts the updater ZIP and verifies its app's signature, identity,
  version, Team ID, Gatekeeper assessment, and stapled notarization ticket.

## Non-goals

- No Windows/Linux signing changes.
- No Clerk, Associated Domains, provisioning profile, or broad entitlement.
- No public release until x64 and arm64 signed dry runs are green.
