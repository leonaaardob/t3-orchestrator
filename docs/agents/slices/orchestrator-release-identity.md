# T3 Orchestrator Release and Desktop Identity

Status: `active`

This fork-only maintenance slice keeps T3 Orchestrator releases distinct from
upstream T3 Code while preserving upstream package-version compatibility.

## Guardrails

- App versions continue to follow upstream (`0.0.X`).
- GitHub release tags use `orchestrator-v0.0.X`.
- Desktop identity must not reuse the official app's bundle ID, protocol,
  user-data directory, or OS integration identifiers.
- Existing shared T3 Code state is never imported automatically.
