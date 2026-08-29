import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import {
  HostProcessArguments,
  HostProcessExecutablePath,
  HostProcessPlatform,
  HostProcessUserId,
} from "@t3tools/shared/hostProcess";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as NodePath from "node:path";

import * as ProcessRunner from "../processRunner.ts";
import * as BootService from "./bootService.ts";
import {
  isEphemeralNodeExecutablePath,
  isEphemeralPathDirectory,
  listDurableServiceNodeCandidates,
  parseNodeVersionOutput,
  resolveDurableServiceNode,
} from "./durableServiceNode.ts";
import { pinnedRuntimePaths } from "./pinnedRuntime.ts";

const ENGINE_RANGE = "^22.16 || ^23.11 || >=24.10";

describe("durableServiceNode", () => {
  it("treats cursor-agent and editor runtimes as ephemeral", () => {
    assert.equal(
      isEphemeralNodeExecutablePath(
        "/home/kyle/.local/share/cursor-agent/versions/2026.08.25-3e8eec8/node",
      ),
      true,
    );
    assert.equal(isEphemeralNodeExecutablePath("/tmp/cursor-agent/bin/node"), true);
    assert.equal(isEphemeralNodeExecutablePath("/home/kyle/.vscode-server/bin/abc123/node"), true);
    assert.equal(
      isEphemeralNodeExecutablePath(
        "/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node",
      ),
      true,
    );
    assert.equal(
      isEphemeralNodeExecutablePath("/var/folders/xx/npm-cache/_npx/abc/bin/node"),
      true,
    );
  });

  it("treats system and intentional version-manager installs as durable", () => {
    assert.equal(isEphemeralNodeExecutablePath("/usr/bin/node"), false);
    assert.equal(isEphemeralNodeExecutablePath("/usr/local/bin/node"), false);
    assert.equal(isEphemeralNodeExecutablePath("/opt/homebrew/bin/node"), false);
    assert.equal(
      isEphemeralNodeExecutablePath("/home/kyle/.nvm/versions/node/v22.22.0/bin/node"),
      false,
    );
    assert.equal(isEphemeralNodeExecutablePath("/home/kyle/.local/bin/node"), false);
  });

  it("lists durable candidates ahead of polluted PATH entries", () => {
    const candidates = listDurableServiceNodeCandidates({
      platform: "linux",
      homeDir: "/home/kyle",
      pathEnv: "/tmp/cursor-agent/bin:/usr/bin:/home/kyle/.nvm/versions/node/v22.22.0/bin",
      execPath: "/tmp/cursor-agent/bin/node",
      pathJoin: NodePath.posix.join,
      pathDelimiter: ":",
    });

    assert.equal(candidates.includes("/tmp/cursor-agent/bin/node"), false);
    assert.ok(candidates.includes("/usr/bin/node"));
    assert.ok(candidates.includes("/home/kyle/.nvm/versions/node/v22.22.0/bin/node"));
    assert.ok(
      candidates.indexOf("/usr/bin/node") <
        candidates.indexOf("/home/kyle/.nvm/versions/node/v22.22.0/bin/node"),
    );
  });

  it("parses node --version output", () => {
    assert.equal(parseNodeVersionOutput("v24.10.0\n"), "24.10.0");
    assert.equal(parseNodeVersionOutput("v22.22.0"), "22.22.0");
    assert.equal(parseNodeVersionOutput("not a version"), null);
  });

  it("filters ephemeral directories from PATH inheritance", () => {
    assert.equal(isEphemeralPathDirectory("/tmp/cursor-agent/bin"), true);
    assert.equal(isEphemeralPathDirectory("/usr/bin"), false);
    assert.equal(isEphemeralPathDirectory("/home/kyle/.nvm/versions/node/v22.22.0/bin"), false);
  });
});

const nodeVersionRunner = (versions: ReadonlyMap<string, string>) =>
  ProcessRunner.ProcessRunner.of({
    run: (input) =>
      Effect.sync(() => {
        if (input.args[1] === "--version") {
          return {
            stdout: "t3 v1.2.3\n",
            stderr: "",
            code: ChildProcessSpawner.ExitCode(0),
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutInvalidUtf8: false,
            stderrInvalidUtf8: false,
          };
        }
        if (input.args[0] === "--version") {
          const version = versions.get(input.command);
          return {
            stdout: version === undefined ? "" : `${version}\n`,
            stderr: "",
            code: ChildProcessSpawner.ExitCode(version === undefined ? 1 : 0),
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutInvalidUtf8: false,
            stderrInvalidUtf8: false,
          };
        }
        return {
          stdout: "",
          stderr: "",
          code: ChildProcessSpawner.ExitCode(0),
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        };
      }),
  });

it.layer(NodeServices.layer)("resolveDurableServiceNode", (it) => {
  it.effect("prefers a durable supported Node over a polluted Cursor-like execPath", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-durable-node-" });
      const editorNode = path.join(root, "cursor-agent", "bin", "node");
      const durableNode = path.join(root, "durable", "bin", "node");
      const unsupportedSystemNode = path.join(root, "opt", "old", "bin", "node");
      yield* fs.makeDirectory(path.dirname(editorNode), { recursive: true });
      yield* fs.makeDirectory(path.dirname(durableNode), { recursive: true });
      yield* fs.makeDirectory(path.dirname(unsupportedSystemNode), { recursive: true });
      yield* fs.writeFileString(editorNode, "#!/bin/true\n");
      yield* fs.writeFileString(durableNode, "#!/bin/true\n");
      yield* fs.writeFileString(unsupportedSystemNode, "#!/bin/true\n");

      const resolved = yield* resolveDurableServiceNode({
        platform: "linux",
        homeDir: root,
        pathEnv: `${path.dirname(editorNode)}:${path.dirname(unsupportedSystemNode)}:${path.dirname(durableNode)}`,
        execPath: editorNode,
        nodeEngineRange: ENGINE_RANGE,
        candidatePaths: [editorNode, unsupportedSystemNode, durableNode],
        runner: nodeVersionRunner(
          new Map([
            [editorNode, "v24.5.0"],
            [unsupportedSystemNode, "v20.11.0"],
            [durableNode, "v22.22.0"],
          ]),
        ),
      });

      expect(resolved).toBe(durableNode);
    }),
  );

  it.effect("fails closed when only unsupported or ephemeral Nodes exist", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-durable-node-fail-" });
      const editorNode = path.join(root, "cursor-agent", "bin", "node");
      const oldNode = path.join(root, "opt", "old", "bin", "node");
      yield* fs.makeDirectory(path.dirname(editorNode), { recursive: true });
      yield* fs.makeDirectory(path.dirname(oldNode), { recursive: true });
      yield* fs.writeFileString(editorNode, "#!/bin/true\n");
      yield* fs.writeFileString(oldNode, "#!/bin/true\n");

      const error = yield* resolveDurableServiceNode({
        platform: "linux",
        homeDir: root,
        pathEnv: `${path.dirname(editorNode)}:${path.dirname(oldNode)}`,
        execPath: editorNode,
        nodeEngineRange: ENGINE_RANGE,
        candidatePaths: [editorNode, oldNode],
        runner: nodeVersionRunner(
          new Map([
            [editorNode, "v24.5.0"],
            [oldNode, "v18.20.0"],
          ]),
        ),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("BootServiceNodeError");
      expect(error.message).toContain(ENGINE_RANGE);
      expect(error.message).toContain("editor/agent runtime");
    }),
  );

  it.effect("keeps ExecStart on durable Node after polluted-PATH service update", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-boot-polluted-" });
      const baseDir = path.join(home, ".t3");
      const durableNode = path.join(home, "durable", "bin", "node");
      const editorNode = path.join(home, "cursor-agent", "bin", "node");
      yield* fs.makeDirectory(path.dirname(durableNode), { recursive: true });
      yield* fs.makeDirectory(path.dirname(editorNode), { recursive: true });
      yield* fs.writeFileString(durableNode, "#!/bin/true\n");
      yield* fs.writeFileString(editorNode, "#!/bin/true\n");

      const sourceLauncher = path.join(home, "service-launcher.mjs");
      yield* fs.writeFileString(sourceLauncher, "export {};\n");
      const runtime = pinnedRuntimePaths(path, baseDir, "1.2.3");
      yield* fs.makeDirectory(path.dirname(runtime.entryPath), { recursive: true });
      yield* fs.writeFileString(runtime.entryPath, "export {};\n");
      yield* fs.writeFileString(runtime.sentinelPath, "1.2.3\n");

      const runner = nodeVersionRunner(
        new Map([
          [durableNode, "v22.22.0"],
          [editorNode, "v24.5.0"],
        ]),
      );

      const serviceFrom = (execPath: string, pathEnv: string) =>
        BootService.make({
          baseDir,
          logsDir: path.join(baseDir, "userdata", "logs"),
          cliVersion: "1.2.3",
          nodeEngineRange: ENGINE_RANGE,
          host: {
            execPath,
            launcherSourcePath: sourceLauncher,
            candidatePaths: [editorNode, durableNode],
          },
        }).pipe(
          Effect.provideService(ProcessRunner.ProcessRunner, runner),
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(HostProcessPlatform, "linux"),
              Layer.succeed(HostProcessUserId, 1000),
              Layer.succeed(HostProcessExecutablePath, execPath),
              Layer.succeed(HostProcessArguments, [execPath, "service", "update"]),
              ConfigProvider.layer(
                ConfigProvider.fromEnv({
                  env: {
                    HOME: home,
                    PATH: pathEnv,
                  },
                }),
              ),
            ),
          ),
        );

      const healthy = yield* serviceFrom(durableNode, `${path.dirname(durableNode)}:/usr/bin:/bin`);
      const initial = yield* healthy.install;
      expect(initial.nodePath).toBe(durableNode);
      expect(yield* fs.readFileString(initial.unitPath)).toContain(`ExecStart=${durableNode} `);

      // Exact real-world sequence: healthy service, then update from Cursor-like PATH.
      expect(isEphemeralNodeExecutablePath(editorNode)).toBe(true);
      const polluted = yield* serviceFrom(
        editorNode,
        `${path.dirname(editorNode)}:${path.dirname(durableNode)}:/usr/bin:/bin`,
      );
      const updated = yield* polluted.install;
      expect(updated.nodePath).toBe(durableNode);
      expect(yield* fs.readFileString(updated.unitPath)).toContain(`ExecStart=${durableNode} `);
      expect(yield* fs.readFileString(updated.unitPath)).not.toContain("cursor-agent");
    }),
  );
});
