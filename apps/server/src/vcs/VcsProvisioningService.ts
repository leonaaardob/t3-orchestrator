import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  type VcsDriverKind,
  type VcsError,
  type VcsInitInput,
  VcsUnsupportedOperationError,
} from "@t3tools/contracts";
import * as VcsDriverRegistry from "./VcsDriverRegistry.ts";

const DEFAULT_GIT_USER_EMAIL = "t3@t3.codes";
const DEFAULT_GIT_USER_NAME = "T3 Code";
const INITIAL_COMMIT_MESSAGE = "Initial commit";

export class VcsProvisioningService extends Context.Service<
  VcsProvisioningService,
  {
    readonly initRepository: (input: VcsInitInput) => Effect.Effect<void, VcsError>;
    /** Ensures `cwd` is a git repo with at least one commit so worktrees can attach to HEAD. */
    readonly ensureGitRepositoryReady: (input: {
      readonly cwd: string;
    }) => Effect.Effect<void, VcsError>;
  }
>()("t3/vcs/VcsProvisioningService") {}

function resolveRequestedKind(
  kind: VcsDriverKind | undefined,
): Effect.Effect<VcsDriverKind, VcsUnsupportedOperationError> {
  if (kind === undefined) {
    return Effect.succeed("git");
  }
  if (kind === "unknown") {
    return Effect.fail(
      new VcsUnsupportedOperationError({
        operation: "VcsProvisioningService.resolveRequestedKind",
        kind,
        detail: "A concrete VCS driver kind is required for repository provisioning.",
      }),
    );
  }
  return Effect.succeed(kind);
}

export const make = Effect.gen(function* () {
  const registry = yield* VcsDriverRegistry.VcsDriverRegistry;

  const initRepository: VcsProvisioningService["Service"]["initRepository"] = Effect.fn(
    "VcsProvisioningService.initRepository",
  )(function* (input) {
    const kind = yield* resolveRequestedKind(input.kind);
    const driver = yield* registry.get(kind);
    return yield* driver.initRepository(input);
  });

  const ensureGitRepositoryReady: VcsProvisioningService["Service"]["ensureGitRepositoryReady"] =
    Effect.fn("VcsProvisioningService.ensureGitRepositoryReady")(function* (input) {
      const gitDriver = yield* registry.get("git");
      const detected = yield* registry.detect({ cwd: input.cwd });
      if (!detected) {
        yield* gitDriver.initRepository({ cwd: input.cwd });
      }

      const head = yield* gitDriver.execute({
        operation: "VcsProvisioningService.ensureGitRepositoryReady.head",
        cwd: input.cwd,
        args: ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
        allowNonZeroExit: true,
        timeoutMs: 10_000,
        maxOutputBytes: 4_096,
      });
      if (head.exitCode === 0) {
        return;
      }

      yield* gitDriver.execute({
        operation: "VcsProvisioningService.ensureGitRepositoryReady.configUserEmail",
        cwd: input.cwd,
        args: ["config", "user.email", DEFAULT_GIT_USER_EMAIL],
        timeoutMs: 10_000,
        maxOutputBytes: 4_096,
      });
      yield* gitDriver.execute({
        operation: "VcsProvisioningService.ensureGitRepositoryReady.configUserName",
        cwd: input.cwd,
        args: ["config", "user.name", DEFAULT_GIT_USER_NAME],
        timeoutMs: 10_000,
        maxOutputBytes: 4_096,
      });
      yield* gitDriver.execute({
        operation: "VcsProvisioningService.ensureGitRepositoryReady.initialCommit",
        cwd: input.cwd,
        args: ["commit", "--allow-empty", "-m", INITIAL_COMMIT_MESSAGE],
        timeoutMs: 10_000,
        maxOutputBytes: 64 * 1024,
      });
    });

  return VcsProvisioningService.of({
    initRepository,
    ensureGitRepositoryReady,
  });
});

export const layer = Layer.effect(VcsProvisioningService, make);
