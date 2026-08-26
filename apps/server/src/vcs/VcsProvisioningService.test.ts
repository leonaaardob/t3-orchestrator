import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as VcsDriver from "./VcsDriver.ts";
import * as VcsDriverRegistry from "./VcsDriverRegistry.ts";
import * as VcsProvisioningService from "./VcsProvisioningService.ts";

const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");

function makeDriver(calls: string[]): VcsDriver.VcsDriver["Service"] {
  return {
    capabilities: {
      kind: "git",
      supportsWorktrees: true,
      supportsBookmarks: false,
      supportsAtomicSnapshot: false,
      supportsPushDefaultRemote: true,
      ignoreClassifier: "native",
    },
    execute: () =>
      Effect.succeed({
        exitCode: ChildProcessSpawner.ExitCode(0),
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      }),
    detectRepository: () => Effect.succeed(null),
    isInsideWorkTree: () => Effect.succeed(false),
    listWorkspaceFiles: () =>
      Effect.succeed({
        paths: [],
        truncated: false,
        freshness: {
          source: "live-local",
          observedAt: TEST_EPOCH,
          expiresAt: Option.none(),
        },
      }),
    listRemotes: () =>
      Effect.succeed({
        remotes: [],
        freshness: {
          source: "live-local",
          observedAt: TEST_EPOCH,
          expiresAt: Option.none(),
        },
      }),
    filterIgnoredPaths: (_cwd, relativePaths) => Effect.succeed(relativePaths),
    initRepository: (input) =>
      Effect.sync(() => {
        calls.push(`${input.kind ?? "default"}:${input.cwd}`);
      }),
  };
}

it.effect("routes repository initialization through an explicit VCS driver kind", () => {
  const calls: string[] = [];
  const driver = makeDriver(calls);
  const testLayer = VcsProvisioningService.layer.pipe(
    Layer.provide(
      Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
        get: (kind) => (kind === "git" ? Effect.succeed(driver) : Effect.die("unexpected kind")),
      }),
    ),
  );

  return Effect.gen(function* () {
    const provisioning = yield* VcsProvisioningService.VcsProvisioningService;
    yield* provisioning.initRepository({ cwd: "/repo", kind: "git" });

    assert.deepStrictEqual(calls, ["git:/repo"]);
  }).pipe(Effect.provide(testLayer));
});

it.effect("defaults repository initialization to Git until callers choose a VCS kind", () => {
  const calls: string[] = [];
  const driver = makeDriver(calls);
  const testLayer = VcsProvisioningService.layer.pipe(
    Layer.provide(
      Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
        get: (kind) => (kind === "git" ? Effect.succeed(driver) : Effect.die("unexpected kind")),
      }),
    ),
  );

  return Effect.gen(function* () {
    const provisioning = yield* VcsProvisioningService.VcsProvisioningService;
    yield* provisioning.initRepository({ cwd: "/repo" });

    assert.deepStrictEqual(calls, ["default:/repo"]);
  }).pipe(Effect.provide(testLayer));
});

it.effect(
  "initializes git and creates an empty commit when ensureGitRepositoryReady runs on a bare folder",
  () => {
    const calls: string[] = [];
    let hasRepository = false;
    let hasHeadCommit = false;
    const driver: VcsDriver.VcsDriver["Service"] = {
      ...makeDriver(calls),
      detectRepository: () =>
        Effect.succeed(
          hasRepository
            ? {
                rootPath: "/repo",
                metadataPath: null,
                freshness: {
                  source: "live-local",
                  observedAt: TEST_EPOCH,
                  expiresAt: Option.none(),
                },
              }
            : null,
        ),
      initRepository: (input) =>
        Effect.sync(() => {
          hasRepository = true;
          calls.push(`init:${input.cwd}`);
        }),
      execute: (input) =>
        Effect.succeed({
          exitCode: ChildProcessSpawner.ExitCode(
            input.args[0] === "rev-parse" ? (hasHeadCommit ? 0 : 1) : 0,
          ),
          stdout: "",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        }),
    };
    const testLayer = VcsProvisioningService.layer.pipe(
      Layer.provide(
        Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
          get: (kind) => (kind === "git" ? Effect.succeed(driver) : Effect.die("unexpected kind")),
          detect: () =>
            Effect.succeed(
              hasRepository
                ? {
                    kind: "git" as const,
                    repository: {
                      rootPath: "/repo",
                      metadataPath: null,
                      freshness: {
                        source: "live-local" as const,
                        observedAt: TEST_EPOCH,
                        expiresAt: Option.none(),
                      },
                    },
                    driver,
                  }
                : null,
            ),
        }),
      ),
    );

    return Effect.gen(function* () {
      const provisioning = yield* VcsProvisioningService.VcsProvisioningService;
      yield* provisioning.ensureGitRepositoryReady({ cwd: "/repo" });

      assert.deepStrictEqual(calls, ["init:/repo"]);
    }).pipe(Effect.provide(testLayer));
  },
);
