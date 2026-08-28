# T3 Orchestrator remote home migration

This runbook moves an existing **T3 Orchestrator** remote install from legacy upstream
paths under `~/.t3` to the fork-isolated home `~/.t3-orchestrator`.

It does **not** migrate official T3 Code data. Do not run this against a host where
`~/.t3` is owned by official T3 unless you have confirmed Orchestrator is the sole
consumer of the staged runtime there.

## When to use

- A host has Orchestrator runtime/service state under `~/.t3/runtime/versions/<version>`
  (for example the kyle-house staging noted in the distribution-identity audit).
- You want Orchestrator Desktop SSH connections to use:
  - npm package `t3-orchestrator@<version>`
  - remote home `~/.t3-orchestrator`
  - service `t3-orchestrator.service` / `com.t3orchestrator.service`

## What moves vs stays

| Path / artifact                              | Orchestrator-owned when staged under `~/.t3` | Action                                                  |
| -------------------------------------------- | -------------------------------------------- | ------------------------------------------------------- |
| `runtime/versions/<v>/` built from this fork | yes                                          | move/copy to `~/.t3-orchestrator/runtime/versions/<v>/` |
| `runtime/service-launcher.mjs`               | yes                                          | move/copy to `~/.t3-orchestrator/runtime/`              |
| `runtime/service-state.json`                 | yes if created by Orchestrator service       | move with launcher                                      |
| `userdata/state.sqlite` (+ `-wal`/`-shm`)    | only if this DB was created by Orchestrator  | copy after confirming not shared with official T3       |
| `userdata/projects`, settings, secrets       | only Orchestrator-created data               | copy selectively; never wholesale copy official T3      |
| `ssh-launch/`                                | Orchestrator SSH sessions                    | recreate under `~/.t3-orchestrator/ssh-launch/`         |
| Official `~/.t3` after migration             | official T3 only                             | leave untouched                                         |

If both products ever ran against the same `~/.t3/userdata/state.sqlite`, treat that
database as ambiguous. Export needed projects or reconnect environments manually instead
of copying the whole DB.

## Preconditions

1. Stop Orchestrator-managed processes only:
   - `systemctl --user stop t3-orchestrator.service` (Linux) or
   - `launchctl bootout --wait gui/$UID/com.t3orchestrator.service` (macOS)
   - Stop any Orchestrator SSH-managed server under `~/.t3/ssh-launch/`
2. Confirm official T3 (if installed) keeps using `~/.t3`, `t3`, and `t3code.service`.
3. Take a backup:

```bash
BACKUP="$HOME/t3-orchestrator-migration-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$BACKUP" -C "$HOME" .t3 .t3-orchestrator 2>/dev/null || tar -czf "$BACKUP" -C "$HOME" .t3
echo "Backup: $BACKUP"
```

## Migration procedure

```bash
set -euo pipefail
ORCH_HOME="$HOME/.t3-orchestrator"
LEGACY_HOME="$HOME/.t3"

mkdir -p "$ORCH_HOME/runtime/versions" "$ORCH_HOME/userdata/logs"

# 1. Runtime tree (example: 0.0.36 staged under legacy paths)
if [ -d "$LEGACY_HOME/runtime/versions/0.0.36" ]; then
  rsync -a "$LEGACY_HOME/runtime/versions/0.0.36/" \
    "$ORCH_HOME/runtime/versions/0.0.36/"
fi

# 2. Service launcher + state (Orchestrator-owned only)
for f in service-launcher.mjs service-state.json; do
  if [ -f "$LEGACY_HOME/runtime/$f" ]; then
    cp -a "$LEGACY_HOME/runtime/$f" "$ORCH_HOME/runtime/$f"
  fi
done

# 3. Userdata — copy only after manual review (example: settings only)
# cp -a "$LEGACY_HOME/userdata/settings.json" "$ORCH_HOME/userdata/"

# 4. Reconcile service with the fork CLI
# From a machine with the built package:
#   t3-orchestrator service update --base-dir "$ORCH_HOME"
```

After migration:

- Desktop SSH resolves `t3-orchestrator@<desktopVersion>`.
- Remote launch scripts use `~/.t3-orchestrator` and `~/.t3-orchestrator/ssh-launch/`.
- Legacy `~/.t3/runtime/versions/0.0.36` on kyle-house is **not** deleted by this
  procedure; remove it manually only after verifying the new home works.

## Verification

```bash
test -f "$ORCH_HOME/runtime/versions/0.0.36/node_modules/t3-orchestrator/dist/bin.mjs"
command -v t3-orchestrator >/dev/null   # optional global install
systemctl --user status t3-orchestrator.service 2>/dev/null || true
test ! -e "$LEGACY_HOME/runtime/service-state.json" || echo "legacy service state still present"
```

Coexistence check with official T3 on the same host:

```bash
test -d "$HOME/.t3"
test -d "$HOME/.t3-orchestrator"
command -v t3 >/dev/null
command -v t3-orchestrator >/dev/null
```

Both semver `0.0.36` runtimes must live in separate homes and separate
`node_modules/t3` vs `node_modules/t3-orchestrator` trees.

## Rollback

```bash
systemctl --user stop t3-orchestrator.service 2>/dev/null || true
rm -rf "$HOME/.t3-orchestrator"
tar -xzf "$BACKUP" -C "$HOME"
# reinstall legacy service if needed: t3 service update --base-dir "$HOME/.t3"
```
