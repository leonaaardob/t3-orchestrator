import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path } from "effect";
import * as Stream from "effect/Stream";
import * as DateTime from "effect/DateTime";
import {
  type AgentBoardFile,
  EnvironmentId,
  type OrchestrationCommand,
  type OrchestrationProject,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationThreadShell,
  type OrchestrationProjectShell,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as Sink from "effect/Sink";

import {
  buildAgentBoardImplementationPrompt,
  buildAgentBoardImplementationThreadTitle,
} from "@t3tools/shared/agentBoardPrompt";
import { MISSING_WORKER_CONFIG_ERROR } from "@t3tools/shared/agentBoardRunner";

import { AgentBoardRunner } from "../Services/AgentBoardRunner.ts";
import { AgentBoardFileSystem } from "../Services/AgentBoardFileSystem.ts";
import {
  AgentBoardFileSystemLive,
  pathScopedProjectId,
  resolveOrchestrationWorkspacePath,
} from "./AgentBoardFileSystem.ts";
import { AgentBoardRunnerLive } from "./AgentBoardRunner.ts";
import { AgentBoardSchedulerLive } from "./AgentBoardScheduler.ts";
import { AgentBoardToolkit } from "../../mcp/toolkits/agentBoard/tools.ts";
import { AgentBoardToolkitHandlersLive } from "../../mcp/toolkits/agentBoard/handlers.ts";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as WorkspacePathsModule from "../../workspace/WorkspacePaths.ts";
import * as ServerConfig from "../../config.ts";
import { runMigrations } from "../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationCommandInvariantError } from "../../orchestration/Errors.ts";
import * as VcsProvisioningService from "../../vcs/VcsProvisioningService.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";

const CARD_ID = "TASK-20260824-runner-card";
const PROJECT_ID = ProjectId.make("prj_runner_test");

const BOARD_WORKER_SELECTION = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.2",
  options: [{ id: "reasoningEffort", value: "high" }],
} as const;

const PROJECT_DEFAULT_SELECTION = {
  instanceId: ProviderInstanceId.make("opencode"),
  model: "opencode/grok-code",
} as const;

const makeHarness = Effect.fn("AgentBoardRunner.test.makeHarness")(function* (options?: {
  readonly projectDefaultModelSelection?: unknown;
  readonly boardWorkerModelSelection?: unknown;
  readonly providers?: ReadonlyArray<{
    readonly instanceId: ReturnType<typeof ProviderInstanceId.make>;
    readonly model: string;
  }>;
  readonly environmentLabel?: string;
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
  const baseDir = yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3code-agent-runner-home-",
  });
  const pathSvc = yield* Path.Path;
  const dbPath = pathSvc.join(baseDir, "userdata", "state.sqlite");
  yield* fileSystem.makeDirectory(pathSvc.dirname(dbPath), { recursive: true });
  const sqlite = NodeSqliteClient.layer({ filename: dbPath });
  const serverConfigLayer = ServerConfig.layerTest(cwd, baseDir);

  const projectionSnapshotQueryLayer = Layer.mock(ProjectionSnapshotQuery)({
    getActiveProjectByWorkspaceRoot: (workspaceRoot: string) =>
      Effect.suspend(() =>
        workspaceRoot === cwd
          ? Effect.succeed(
              Option.some({
                id: PROJECT_ID,
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

  const providerRegistryLayer =
    options?.providers === undefined
      ? Layer.empty
      : Layer.succeed(ProviderRegistry, {
          getProviders: Effect.succeed(
            options.providers.map((entry) => ({
              instanceId: entry.instanceId,
              driver: "codex",
              enabled: true,
              installed: true,
              version: "1.0.0",
              status: "ready",
              auth: { status: "authenticated" },
              checkedAt: "2026-08-29T00:00:00.000Z",
              models: [
                {
                  slug: entry.model,
                  name: entry.model,
                  isCustom: false,
                  capabilities: null,
                },
              ],
              slashCommands: [],
              skills: [],
            })) as never,
          ),
          refresh: () => Effect.succeed([]),
          refreshInstance: () => Effect.succeed([]),
          getProviderMaintenanceCapabilitiesForInstance: () =>
            Effect.succeed({ canUpdate: false, updateCommand: null }),
          setProviderMaintenanceActionState: () => Effect.succeed([]),
          streamChanges: Stream.empty,
        } as never);

  const serverEnvironmentLayer =
    options?.environmentLabel === undefined
      ? Layer.empty
      : Layer.succeed(ServerEnvironment, {
          getEnvironmentId: Effect.succeed(EnvironmentId.make("env-test")),
          getDescriptor: Effect.succeed({
            environmentId: EnvironmentId.make("env-test"),
            label: options.environmentLabel,
            platform: { os: "linux", arch: "x64" },
            serverVersion: "0.0.0-test",
            capabilities: {
              repositoryIdentity: false,
            },
          }),
        } as never);

  // The runner resolves its collaborators from the calling fiber, so tests
  // provide the full (fake-able) environment around each `run` invocation —
  // this doubles as the headless launch proof: no browser/client involved.
  // provideMerge keeps the collaborator outputs visible so they satisfy
  // `run`'s requirement channel.
  const makeBoardFsLayer = () =>
    AgentBoardFileSystemLive.pipe(
      Layer.provide(WorkspacePathsModule.layer),
      Layer.provideMerge(serverConfigLayer),
      Layer.provideMerge(Layer.fresh(sqlite)),
    );

  const makeRunnerEnvironment = () =>
    AgentBoardRunnerLive.pipe(
      Layer.provide(WorkspacePathsModule.layer),
      Layer.provideMerge(serverConfigLayer),
      Layer.provideMerge(NodeServices.layer),
      Layer.provideMerge(makeBoardFsLayer()),
      Layer.provideMerge(gitWorkflowLayer),
      Layer.provideMerge(vcsProvisioningLayer),
      Layer.provideMerge(orchestrationEngineLayer),
      Layer.provideMerge(projectionSnapshotQueryLayer),
      Layer.provideMerge(providerRegistryLayer),
      Layer.provideMerge(serverEnvironmentLayer),
    );

  const runInEnv = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.provide(makeRunnerEnvironment()));

  // Migrate once against the file DB; later scopes reopen the same file.
  yield* runMigrations().pipe(
    Effect.provide(Layer.mergeAll(Layer.fresh(sqlite), NodeServices.layer)),
  );

  // Seed a Ready card.
  yield* runInEnv(
    Effect.gen(function* () {
      const boardFiles = yield* AgentBoardFileSystem;
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
    }),
  );

  return {
    cwd,
    baseDir,
    runInEnv,
    boardFiles: {
      load: (input: { cwd: string; createIfMissing?: boolean }) =>
        runInEnv(
          Effect.gen(function* () {
            const boardFiles = yield* AgentBoardFileSystem;
            return yield* boardFiles.load({
              cwd: input.cwd,
              createIfMissing: input.createIfMissing ?? false,
            });
          }),
        ),
      save: (input: { cwd: string; board: AgentBoardFile }) =>
        runInEnv(
          Effect.gen(function* () {
            const boardFiles = yield* AgentBoardFileSystem;
            return yield* boardFiles.save(input);
          }),
        ),
    },
    runCard: () =>
      runInEnv(
        Effect.gen(function* () {
          const runner = yield* AgentBoardRunner;
          return yield* runner.run({ cwd, cardId: CARD_ID });
        }),
      ),
    dispatchedCommands: () => dispatched,
    createWorktreeCalls: () => gitCalls.count,
    failNextTurnStartWith: (detail: string | null) => {
      turnStartFailure.detail = detail;
    },
  };
});

describe("AgentBoardRunnerLive", () => {
  it.effect("Supervisor MCP creates, launches and independently reviews a persisted card", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ boardWorkerModelSelection: BOARD_WORKER_SELECTION });
      yield* harness.runInEnv(
        Effect.gen(function* () {
          const boardFs = yield* AgentBoardFileSystem;
          const loaded = yield* boardFs.load({ cwd: harness.cwd, createIfMissing: false });
          yield* boardFs.save({ cwd: harness.cwd, board: { ...loaded.board, cards: [] } });
          const projection = yield* ProjectionSnapshotQuery;
          const supervisorId = ThreadId.make("supervisor-e2e");
          const completed = new Set<string>();
          const timestamp = yield* Effect.map(DateTime.now, DateTime.formatIso);
          const project = {
            id: PROJECT_ID,
            workspaceRoot: harness.cwd,
            scripts: [],
          } as unknown as OrchestrationProjectShell;
          const projected = {
            ...projection,
            getProjectShellById: () => Effect.succeed(Option.some(project)),
            getThreadShellById: (threadId: ThreadId) =>
              Effect.sync(() => {
                if (threadId === supervisorId)
                  return Option.some({
                    id: supervisorId,
                    projectId: PROJECT_ID,
                    role: "project-supervisor",
                  } as OrchestrationThreadShell);
                const command = harness
                  .dispatchedCommands()
                  .find(
                    (candidate) =>
                      candidate.type === "thread.create" && candidate.threadId === threadId,
                  );
                if (command?.type !== "thread.create") return Option.none();
                return Option.some({
                  ...command,
                  id: threadId,
                  projectId: PROJECT_ID,
                  latestTurn: { state: completed.has(threadId) ? "completed" : "running" },
                  session: { status: completed.has(threadId) ? "ready" : "running" },
                  updatedAt: timestamp,
                } as unknown as OrchestrationThreadShell);
              }),
            getThreadDetailById: () =>
              Effect.succeed(
                Option.some({
                  messages: [
                    { role: "assistant", text: "Verified acceptance criteria. REVIEW: PASS" },
                  ],
                  activities: [],
                } as unknown as OrchestrationThread),
              ),
          };
          yield* Effect.gen(function* () {
            const toolkit = yield* AgentBoardToolkit;
            const call = (
              name: keyof typeof toolkit.tools,
              params: Parameters<typeof toolkit.handle>[1],
            ) =>
              Effect.gen(function* () {
                const stream = yield* toolkit.handle(name, params);
                return yield* Stream.run(stream, Sink.last()).pipe(
                  Effect.flatMap(Effect.fromOption),
                );
              });
            yield* call("agent_board_create_card", {
              id: CARD_ID,
              title: "End-to-end delegation",
              intent: "Verify worker and independent review",
              acceptanceCriteria: ["Worker and reviewer have separate threads"],
              markReady: true,
            });
            const launched = yield* call("agent_board_run_card", { cardId: CARD_ID });
            expect(launched.encodedResult).toMatchObject({ card: { state: "Running" } });
            const implementation = harness
              .dispatchedCommands()
              .find((command) => command.type === "thread.create");
            if (implementation?.type !== "thread.create")
              throw new Error("Missing implementation thread");
            yield* call("agent_board_run_card", { cardId: CARD_ID });
            expect(harness.createWorktreeCalls()).toBe(1);
            completed.add(implementation.threadId);
            const reviewing = yield* call("agent_board_run_card", { cardId: CARD_ID });
            expect(reviewing.encodedResult).toMatchObject({ card: { state: "Reviewing" } });
            const review = harness
              .dispatchedCommands()
              .filter((command) => command.type === "thread.create")[1];
            if (review?.type !== "thread.create")
              throw new Error("Missing independent review thread");
            expect(review.threadId).not.toBe(implementation.threadId);
            expect(review.worktreePath).toBe(implementation.worktreePath);
            completed.add(review.threadId);
            const reviewed = yield* call("agent_board_run_card", { cardId: CARD_ID });
            expect(reviewed.encodedResult).toMatchObject({
              card: {
                state: "Review",
                runtime: {
                  implementationRunId: implementation.threadId,
                  reviewRunId: review.threadId,
                },
              },
            });
            const reread = yield* call("agent_board_read", {});
            expect(reread.encodedResult).toMatchObject({ board: { cards: [{ state: "Review" }] } });
            expect(
              harness
                .dispatchedCommands()
                .filter((command) => command.type === "thread.turn.start"),
            ).toHaveLength(2);
          }).pipe(
            Effect.provide(
              AgentBoardToolkitHandlersLive.pipe(Layer.provideMerge(AgentBoardSchedulerLive)),
            ),
            Effect.provideService(ProjectionSnapshotQuery, projected),
            Effect.provideService(McpInvocationContext, {
              environmentId: EnvironmentId.make("env-e2e"),
              threadId: supervisorId,
              providerSessionId: "supervisor-session",
              providerInstanceId: ProviderInstanceId.make("codex"),
              capabilities: new Set(["agent-board"] as const),
              issuedAt: 1,
            }),
          );
        }),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("launches a claimed card end to end headless (happy path)", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ boardWorkerModelSelection: BOARD_WORKER_SELECTION });
      const path = yield* Path.Path;
      const derived = yield* ServerConfig.deriveServerPaths(harness.baseDir, undefined);
      const expectedWorktree = resolveOrchestrationWorkspacePath({
        stateDir: derived.stateDir,
        projectId: pathScopedProjectId(harness.cwd),
        cardId: CARD_ID,
        join: path.join,
      });

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
      expect(createCommand.role).toBeUndefined();
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
      const derived = yield* ServerConfig.deriveServerPaths(harness.baseDir, undefined);
      const existingWorktree = resolveOrchestrationWorkspacePath({
        stateDir: derived.stateDir,
        projectId: pathScopedProjectId(harness.cwd),
        cardId: CARD_ID,
        join: path.join,
      });
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

  it.effect(
    "blocks before worktree/thread when the resolved instance is absent on this environment",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          boardWorkerModelSelection: {
            instanceId: ProviderInstanceId.make("claudeAgent"),
            model: "fable-5",
          },
          providers: [{ instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.2" }],
          environmentLabel: "kyle-house",
        });

        const error = yield* Effect.flip(harness.runCard());
        expect(error._tag).toBe("AgentBoardRunnerError");
        if (error._tag === "AgentBoardRunnerError") {
          expect(error.operation).toBe("workerModelSelection.resolve");
          expect(error.detail).toContain("Implementation model unavailable on kyle-house");
          expect(error.detail).toContain("claudeAgent / fable-5");
        }
        expect(harness.dispatchedCommands()).toEqual([]);
        expect(harness.createWorktreeCalls()).toBe(0);

        const persisted = yield* harness.boardFiles.load({
          cwd: harness.cwd,
          createIfMissing: false,
        });
        const persistedCard = persisted.board.cards.find((card) => card.id === CARD_ID);
        expect(persistedCard?.state).toBe("Blocked");
        expect(persistedCard?.runtime.implementationRunId).toBeUndefined();
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("launches normally when the resolved selection is valid on this environment", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        boardWorkerModelSelection: BOARD_WORKER_SELECTION,
        providers: [
          {
            instanceId: BOARD_WORKER_SELECTION.instanceId,
            model: BOARD_WORKER_SELECTION.model,
          },
        ],
        environmentLabel: "kyle-house",
      });

      const result = yield* harness.runCard();
      expect(result.card.state).toBe("Running");
      expect(harness.dispatchedCommands()[0]?.type).toBe("thread.create");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
