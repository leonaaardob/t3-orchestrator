# T3 Orchestrator Release and Desktop Identity

Status: `active` — release-blocker remediation in progress

This fork-only maintenance slice keeps T3 Orchestrator releases distinct from
upstream T3 Code while preserving upstream package-version compatibility.

## Guardrails

- App versions continue to follow upstream (`0.0.X`).
- GitHub release tags use `orchestrator-v0.0.X`.
- Desktop identity must not reuse the official app's bundle ID, protocol,
  user-data directory, or OS integration identifiers.
- Existing shared T3 Code state is never imported automatically. A narrowly
  scoped, one-time import of only decryptable legacy **connection records** is
  permitted when the new catalog is absent; opaque encrypted data and all other
  official T3 Code state remain out of scope.
- The isolated profile must bootstrap its own backend session and project list;
  it may not depend on the legacy T3 Code Electron/browser profile.
- Production and development Orchestrator schemes remain `t3orchestrator://`
  and `t3orchestrator-dev://` respectively. No identity rollback is allowed.
