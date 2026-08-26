import * as NodeServices from "@effect/platform-node/NodeServices";
import type { NodeServices as NodeServicesType } from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path } from "effect";
import * as Stream from "effect/Stream";
import {
  type AgentBoardFile,
  type AgentBoardRunResult,
  type OrchestrationCommand,
  type OrchestrationProject,
  ProjectId,
  ProviderInstanceId,
} from "@t3tools/contracts";

import {
  buildAgentBoardImplementationPrompt,
  buildAgentBoardImplementationThreadTitle,
} from "@t3tools/shared/agentBoardPrompt";
import { MISSING_WORKER_CONFIG_ERROR } from "@t3tools/shared/agentBoardRunner";

import { AgentBoardRunner, type AgentBoardRunnerError } from "../Services/AgentBoardRunner.ts";
import { AgentBoardFileSystem } from "../Services/AgentBoardFileSystem.ts";
import { AgentBoardFileSystemLive } from "./AgentBoardFileSystem.ts";
import { AgentBoardRunnerLive } from "./AgentBoardRunner.ts";
import * as WorkspacePathsModule from "../../workspace/WorkspacePaths.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationCommandInvariantError } from "../../orchestration/Errors.ts";
import * as VcsProvisioningService from "../../vcs/VcsProvisioningService.ts";

const CARD_ID = "TASK-20260824-runner-card";

const BOARD_WORKER_SELECTION = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.2",
  options: [{ id: "reasoningEffort", value: "high" }],
} as const;

const PROJECT_DEFAULT_SELECTION = {
  instanceId: ProviderInstanceId.make("opencode"),
  model: "opencode/grok-code",
} as const;

interface Harness {
  readonly cwd: string;
  readonly boardFiles: AgentBoardFileSystem["Service"];
  // Platform services stay in R (satisfied by the suite's NodeServices
  // provide); every domain collaborator is closed inside runCard.
  readonly runCard: () => Effect.Effect<
    AgentBoardRunResult,
    AgentBoardRunnerError,
    NodeServicesType
  >;
  readonly dispatchedCommands: () => ReadonlyArray<OrchestrationCommand>;
  readonly createWorktreeCalls: () => number;
  readonly failNextTurnStartWith: (detail: string | null) => void;
}

const makeHarness = Effect.fn("AgentBoardRunner.test.makeHarness")(function* (options?: {
  readonly projectDefaultModelSelection?: unknown;
  readonly boardWorkerModelSelection?: unknown;
}) {
  const dispatched: Array<OrchestrationCommand> = [];
  const gitCalls = { count: 0 };
  const turnStartFailure = { detail: null as string | null };

  // Captured so mock implementations carry no Effect requirements of their own.
  const fileSystem = yield* FileSystem.FileSystem;

  const gitWorkflowLayer = Layer.mock(GitWorkflowService)({
    createWorktree: (input) =>
      Effect.suspend(() => {
        gitCalls.count += 1;
        // Base is the project workspace HEAD, branch derives from the card,
        // and the explicit path is exactly the card workspace claim recorded.
        expect(input.refName).toBe("HEAD");
        expect(input.newRefName).toBe(`board/${CARD_ID}`);
        expect(input.path?.endsWith(`${CARD_ID}`)).toBe(true);
        return Effect.gen(function* () {
          yield* fileSystem.makeDirectory(input.path!, { recursive: true });
          yield* fileSystem.writeFileString(`${input.path!}/.git`, "gitdir: fake\n");
          return { worktree: { path: input.path!, refName: input.newRefName! } };
        }).pipe(Effect.orDie);
      }),
  });

  const vcsProvisioningLayer = Layer.mock(VcsProvisioningService.VcsProvisioningService)({
    initRepository: () => Effect.void,
    ensureGitRepositoryReady: () => Effect.void,
  });

  const orchestrationEngineLayer = Layer.mock(OrchestrationEngineService)({
    dispatch: (command) =>
      Effect.suspend(() => {
        if (command.type === "thread.turn.start" && turnStartFailure.detail !== null) {
          return Effect.fail(
            new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: turnStartFailure.detail,
            }),
          );
        }
        dispatched.push(command);
        return Effect.succeed({ sequence: dispatched.length });
      }),
    readEvents: () => Stream.empty,
    streamDomainEvents: Stream.empty,
    latestSequence: Effect.succeed(0),
  });

  const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-agent-runner-" });

  const projectionSnapshotQueryLayer = Layer.mock(ProjectionSnapshotQuery)({
    getActiveProjectByWorkspaceRoot: (workspaceRoot: string) =>
      Effect.suspend(() =>
        workspaceRoot === cwd
          ? Effect.succeed(
              Option.some({
                id: ProjectId.make("prj_runner_test"),
                title: "Runner project",
                workspaceRoot,
                defaultModelSelection:
                  options?.projectDefaultModelSelection === undefined
                    ? null
                    : options.projectDefaultModelSelection,
                scripts: [],
                createdAt: "2026-05-05T12:00:00.000Z",
                updatedAt: "2026-05-05T12:00:00.000Z",
                deletedAt: null,
              } as unknown as OrchestrationProject),
            )
          : Effect.succeed(Option.none()),
      ),
  });

  // The runner resolves its collaborators from the calling fiber, so tests
  // provide the full (fake-able) environment around each `run` invocation —
  // this doubles as the headless launch proof: no browser/client involved.
  // provideMerge keeps the collaborator outputs visible so they satisfy
  // `run`'s requirement channel.
  const runnerEnvironment = AgentBoardRunnerLive.pipe(
    Layer.provide(WorkspacePathsModule.layer),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(AgentBoardFileSystemLive.pipe(Layer.provide(WorkspacePathsModule.layer))),
    Layer.provideMerge(gitWorkflowLayer),
    Layer.provideMerge(vcsProvisioningLayer),
    Layer.provideMerge(orchestrationEngineLayer),
    Layer.provideMerge(projectionSnapshotQueryLayer),
  );

  const boardFiles = yield* AgentBoardFileSystem.pipe(Effect.provide(runnerEnvironment));

  // Seed a Ready card carrying the requested worker execution config.
  const created = yield* boardFiles.load({ cwd, createIfMissing: true });
  const readyBoard = {
    ...created.board,
    runner: {
      maxConcurrentCards: 1,
      repairCycles: 3,
      ...(options?.boardWorkerModelSelection === undefined
        ? {}
        : { workerModelSelection: options.boardWorkerModelSelection }),
    },
    cards: [
      {
        id: CARD_ID,
        title: "Runner card",
        state: "Ready" as const,
        intentBrief: {
          intent: "Launch this card server-side.",
          acceptanceCriteria: ["The run starts without a web client."],
        },
        createdAt: "2026-05-05T12:00:00.000Z",
        updatedAt: "2026-05-05T12:00:00.000Z",
      },
    ],
    updatedAt: "2026-05-05T12:00:00.000Z",
  } as unknown as AgentBoardFile;
  yield* boardFiles.save({ cwd, board: readyBoard });

  const runner = yield* AgentBoardRunner.pipe(Effect.provide(runnerEnvironment));

  return {
    cwd,
    boardFiles,
    runCard: () => runner.run({ cwd, cardId: CARD_ID }).pipe(Effect.provide(runnerEnvironment)),
    dispatchedCommands: () => dispatched,
    createWorktreeCalls: () => gitCalls.count,
    failNextTurnStartWith: (detail: string | null) => {
      turnStartFailure.detail = detail;
    },
  } satisfies Harness;
});

describe("AgentBoardRunnerLive", () => {
  it.effect("launches a claimed card end to end headless (happy path)", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ boardWorkerModelSelection: BOARD_WORKER_SELECTION });
      const path = yield* Path.Path;
      const expectedWorktree = path.join(harness.cwd, ".t3", "workspaces", CARD_ID);

      const result = yield* harness.runCard();

      expect(result.threadId).toBeDefined();
      expect(result.workspacePath).toBe(expectedWorktree);
      expect(result.card.state).toBe("Running");
      expect(result.card.runtime.implementationRunId).toBe(result.threadId);
      expect(result.card.runtime.attemptCount).toBe(1);
      expect(result.card.runtime.lastHeartbeatAt).toBeDefined();

      const [createCommand, turnStartCommand] = harness.dispatchedCommands();
      if (
        createCommand?.type !== "thread.create" ||
        turnStartCommand?.type !== "thread.turn.start"
      ) {
        throw new Error("Expected a thread.create followed by thread.turn.start");
      }
      expect(createCommand.threadId).toBe(result.threadId);
      expect(createCommand.worktreePath).toBe(expectedWorktree);
      expect(createCommand.branch).toBe(`board/${CARD_ID}`);
      expect(createCommand.modelSelection).toEqual(BOARD_WORKER_SELECTION);
      expect(createCommand.title).toBe(buildAgentBoardImplementationThreadTitle(result.card));
      expect(turnStartCommand.threadId).toBe(result.threadId);
      expect(turnStartCommand.message.text).toBe(buildAgentBoardImplementationPrompt(result.card));
      expect(harness.createWorktreeCalls()).toBe(1);

      // Runtime persistence lands on disk, not just in the returned snapshot.
      const persisted = yield* harness.boardFiles.load({
        cwd: harness.cwd,
        createIfMissing: false,
      });
      const persistedCard = persisted.board.cards.find((card) => card.id === CARD_ID);
      expect(persistedCard?.state).toBe("Running");
      expect(persistedCard?.runtime.implementationRunId).toBe(result.threadId);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reuses an existing card worktree instead of creating another", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ boardWorkerModelSelection: BOARD_WORKER_SELECTION });
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const existingWorktree = path.join(harness.cwd, ".t3", "workspaces", CARD_ID);
      yield* fileSystem.makeDirectory(existingWorktree, { recursive: true });
      yield* fileSystem.writeFileString(path.join(existingWorktree, ".git"), "gitdir: fake\n");

      const result = yield* harness.runCard();

      expect(result.workspacePath).toBe(existingWorktree);
      expect(harness.createWorktreeCalls()).toBe(0);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("blocks the card before any thread when worker config is missing", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ projectDefaultModelSelection: null });

      const error = yield* Effect.flip(harness.runCard());

      expect(error._tag).toBe("AgentBoardRunnerError");
      if (error._tag === "AgentBoardRunnerError") {
        expect(error.operation).toBe("workerModelSelection.resolve");
        expect(error.detail).toBe(MISSING_WORKER_CONFIG_ERROR);
      }
      expect(harness.dispatchedCommands()).toEqual([]);

      const persisted = yield* harness.boardFiles.load({
        cwd: harness.cwd,
        createIfMissing: false,
      });
      const persistedCard = persisted.board.cards.find((card) => card.id === CARD_ID);
      expect(persistedCard?.state).toBe("Blocked");
      expect(persistedCard?.runtime.currentError).toBe(MISSING_WORKER_CONFIG_ERROR);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("blocks the card and deletes the created thread when turn start fails", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ boardWorkerModelSelection: BOARD_WORKER_SELECTION });
      harness.failNextTurnStartWith("injected launch failure");

      const error = yield* Effect.flip(harness.runCard());

      expect(error._tag).toBe("AgentBoardRunnerError");
      if (error._tag === "AgentBoardRunnerError") {
        expect(error.operation).toBe("thread.turn.start");
        expect(error.detail).toContain("injected launch failure");
      }
      const commands = harness.dispatchedCommands().map((command) => command.type);
      expect(commands).toEqual(["thread.create", "thread.delete"]);

      const persisted = yield* harness.boardFiles.load({
        cwd: harness.cwd,
        createIfMissing: false,
      });
      const persistedCard = persisted.board.cards.find((card) => card.id === CARD_ID);
      expect(persistedCard?.state).toBe("Blocked");
      expect(persistedCard?.runtime.currentError).toContain("injected launch failure");
      expect(persistedCard?.runtime.implementationRunId).toBeUndefined();
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("falls back to the project default model selection", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        projectDefaultModelSelection: PROJECT_DEFAULT_SELECTION,
      });

      const result = yield* harness.runCard();

      const createCommand = harness.dispatchedCommands()[0];
      if (createCommand?.type !== "thread.create") {
        throw new Error("Expected a thread.create command");
      }
      expect(createCommand.modelSelection).toEqual(PROJECT_DEFAULT_SELECTION);
      expect(result.card.state).toBe("Running");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
