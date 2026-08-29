import { satisfiesSemverRange } from "@t3tools/shared/semver";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";

/**
 * Background services must pin a Node binary that survives editor/agent
 * shutdown and reboot. `process.execPath` is not safe: `npx` from Cursor or
 * VS Code often runs under a private Node that disappears with the IDE.
 */

const EPHEMERAL_PATH_MARKERS = [
  "/cursor-agent/",
  "/.local/share/cursor-agent/",
  "/.cursor-server/",
  "/.cursor-server\\",
  "/cursor.app/",
  "/cursor.app\\",
  "/appdata/local/programs/cursor/",
  "/appdata/roaming/cursor/",
  "/.vscode-server/",
  "/.vscode-remote-containers/",
  "/.vscode-remote/",
  "/code.app/",
  "/code.app\\",
  "/visual studio code.app/",
  "/ms-vscode/",
  "/electron.app/",
  "/electron.app\\",
  "/node_modules/electron/",
  "/.npm/_npx/",
  "/npm/_npx/",
  "/npm-cache/_npx/",
  "/.npm/_cacache/",
  "/bunx-",
  "/yarn/berry/cache/",
] as const;

export function normalizeNodePathForComparison(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase();
}

/** True when a path is owned by an editor, agent runtime, temp cache, or Electron embed. */
export function isEphemeralNodeExecutablePath(nodePath: string): boolean {
  const normalized = normalizeNodePathForComparison(nodePath);
  if (normalized.length === 0) {
    return true;
  }
  return EPHEMERAL_PATH_MARKERS.some((marker) => normalized.includes(marker));
}

export function isEphemeralPathDirectory(directory: string): boolean {
  const normalized = normalizeNodePathForComparison(directory);
  if (normalized.length === 0) {
    return true;
  }
  return (
    isEphemeralNodeExecutablePath(directory) ||
    normalized.includes("/cursor-agent") ||
    normalized.endsWith("/cursor-agent")
  );
}

export function isEditorOwnedNodeExecutablePath(nodePath: string): boolean {
  const normalized = normalizeNodePathForComparison(nodePath);
  return (
    normalized.includes("cursor-agent") ||
    normalized.includes("cursor.app") ||
    normalized.includes("vscode-server") ||
    normalized.includes("vscode-remote") ||
    normalized.includes("code.app") ||
    normalized.includes("visual studio code") ||
    normalized.includes("ms-vscode") ||
    normalized.includes("electron.app") ||
    normalized.includes("/node_modules/electron/")
  );
}

export function parseNodeVersionOutput(stdout: string): string | null {
  const match = stdout.trim().match(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/);
  return match?.[1] ?? null;
}

export function nodeBinaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "node.exe" : "node";
}

export function listWellKnownDurableNodePaths(input: {
  readonly platform: NodeJS.Platform;
  readonly homeDir: string;
  readonly pathJoin: (...parts: string[]) => string;
}): ReadonlyArray<string> {
  const binary = nodeBinaryName(input.platform);
  if (input.platform === "win32") {
    const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
    const localAppData = process.env.LOCALAPPDATA ?? "";
    return [
      input.pathJoin(programFiles, "nodejs", binary),
      ...(localAppData.length > 0
        ? [input.pathJoin(localAppData, "Programs", "nodejs", binary)]
        : []),
      ...(input.homeDir.length > 0
        ? [input.pathJoin(input.homeDir, "AppData", "Local", "Programs", "nodejs", binary)]
        : []),
    ];
  }

  const unixSystem = [
    `/usr/bin/${binary}`,
    `/bin/${binary}`,
    `/usr/local/bin/${binary}`,
    `/opt/homebrew/bin/${binary}`,
  ];
  if (input.homeDir.length === 0) {
    return unixSystem;
  }
  return [
    ...unixSystem,
    input.pathJoin(input.homeDir, ".local", "bin", binary),
    input.pathJoin(input.homeDir, ".nvm", "current", "bin", binary),
    input.pathJoin(input.homeDir, ".fnm", "current", "bin", binary),
    input.pathJoin(input.homeDir, ".local", "share", "fnm", "current", "bin", binary),
    input.pathJoin(input.homeDir, ".asdf", "shims", binary),
  ];
}

/**
 * Deterministic durable Node candidates for service install/update.
 * Editor-owned and temp runtimes are excluded even when they launched the CLI.
 */
export function listDurableServiceNodeCandidates(input: {
  readonly platform: NodeJS.Platform;
  readonly homeDir: string;
  readonly pathEnv: string;
  readonly execPath: string;
  readonly pathJoin: (...parts: string[]) => string;
  readonly pathDelimiter?: string;
}): ReadonlyArray<string> {
  const delimiter = input.pathDelimiter ?? (input.platform === "win32" ? ";" : ":");
  const binary = nodeBinaryName(input.platform);
  const seen = new Set<string>();
  const candidates: string[] = [];

  const add = (candidate: string | undefined) => {
    if (candidate === undefined || candidate.length === 0) {
      return;
    }
    const key = normalizeNodePathForComparison(candidate);
    if (seen.has(key) || isEphemeralNodeExecutablePath(candidate)) {
      return;
    }
    seen.add(key);
    candidates.push(candidate);
  };

  for (const wellKnown of listWellKnownDurableNodePaths({
    platform: input.platform,
    homeDir: input.homeDir,
    pathJoin: input.pathJoin,
  })) {
    add(wellKnown);
  }

  for (const directory of input.pathEnv.split(delimiter)) {
    if (directory.length === 0 || isEphemeralPathDirectory(directory)) {
      continue;
    }
    add(input.pathJoin(directory, binary));
  }

  add(input.execPath);
  return candidates;
}

export class BootServiceNodeError extends Schema.TaggedErrorClass<BootServiceNodeError>()(
  "BootServiceNodeError",
  {
    nodeEngineRange: Schema.String,
    execPath: Schema.String,
    examinedCount: Schema.Number,
  },
) {
  override get message(): string {
    const invoking = isEditorOwnedNodeExecutablePath(this.execPath)
      ? ` The current process Node (${this.execPath}) is an editor/agent runtime and cannot be used.`
      : isEphemeralNodeExecutablePath(this.execPath)
        ? ` The current process Node (${this.execPath}) is a temporary package-manager runtime and cannot be used.`
        : this.execPath.length > 0
          ? ` The current process Node (${this.execPath}) was considered but is not a durable install that satisfies the range.`
          : "";
    return (
      `No durable Node.js installation satisfies engines.node (${this.nodeEngineRange}).` +
      ` Install a supported Node from your package manager, nvm, fnm, or asdf, then retry service install/update.` +
      invoking
    );
  }
}

export const resolveDurableServiceNode = Effect.fn("cloud.resolve_durable_service_node")(
  function* (input: {
    readonly platform: NodeJS.Platform;
    readonly homeDir: string;
    readonly pathEnv: string;
    readonly execPath: string;
    readonly nodeEngineRange: string;
    readonly pathDelimiter?: string;
    /** Test seam: replace discovery while keeping probe + engine checks. */
    readonly candidatePaths?: ReadonlyArray<string>;
    readonly runner: ProcessRunner.ProcessRunner["Service"];
  }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const engineRange = input.nodeEngineRange.trim();
    const candidates =
      input.candidatePaths?.filter((candidate) => !isEphemeralNodeExecutablePath(candidate)) ??
      listDurableServiceNodeCandidates({
        platform: input.platform,
        homeDir: input.homeDir,
        pathEnv: input.pathEnv,
        execPath: input.execPath,
        pathJoin: path.join,
        pathDelimiter: input.pathDelimiter,
      });

    let examined = 0;
    for (const candidate of candidates) {
      const exists = yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false));
      if (!exists) {
        continue;
      }
      examined += 1;
      const probe = yield* input.runner
        .run({
          command: candidate,
          args: ["--version"],
          timeout: Duration.seconds(10),
        })
        .pipe(Effect.option);
      if (probe._tag === "None" || probe.value.code !== 0) {
        continue;
      }
      const version = parseNodeVersionOutput(probe.value.stdout);
      if (version === null || !satisfiesSemverRange(version, engineRange)) {
        continue;
      }
      return candidate;
    }

    return yield* new BootServiceNodeError({
      nodeEngineRange: engineRange,
      execPath: input.execPath,
      examinedCount: examined,
    });
  },
);
