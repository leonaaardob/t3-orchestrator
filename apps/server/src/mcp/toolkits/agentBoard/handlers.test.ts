import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  AgentBoardFileError,
  EnvironmentId,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Option, Path } from "effect";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../../config.ts";
import { runMigrations } from "../../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";
import { AgentBoardFileSystem } from "../../../agentBoard/Services/AgentBoardFileSystem.ts";
import { AgentBoardFileSystemLive } from "../../../agentBoard/Layers/AgentBoardFileSystem.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as WorkspacePathsModule from "../../../workspace/WorkspacePaths.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { AgentBoardToolkitHandlersLive } from "./handlers.ts";
import { AgentBoardToolkit } from "./tools.ts";

const environmentId = EnvironmentId.make("environment-supervisor-board");
const projectAId = ProjectId.make("project-a");
const projectBId = ProjectId.make("project-b");
const supervisorThreadA = ThreadId.make("thread-supervisor-a");
const supervisorThreadB = ThreadId.make("thread-supervisor-b");
const standardThreadA = ThreadId.make("thread-standard-a");

const makeProjectShell = (id: ProjectId, workspaceRoot: string): OrchestrationProjectShell =>
  ({
    id,
    title: String(id),
    workspaceRoot,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  }) as OrchestrationProjectShell;

const makeThreadShell = (input: {
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly role: "standard" | "project-supervisor";
}): OrchestrationThreadShell =>
  ({
    id: input.id,
    projectId: input.projectId,
    title: input.role === "project-supervisor" ? "Project Supervisor" : "Worker",
    role: input.role,
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    session: null,
  }) as OrchestrationThreadShell;

const invocationFor = (
  threadId: ThreadId,
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability>,
): McpInvocationContext.McpInvocationScope => ({
  environmentId,
  threadId,
  providerSessionId: `provider-session-${threadId}`,
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3-supervisor-board-",
  });
});

const runSupervisorBoardCase = <A, E>(
  body: (input: {
    readonly cwdA: string;
    readonly cwdB: string;
    readonly toolkit: {
      readonly handle: (
        name: "agent_board_read" | "agent_board_create_card" | "agent_board_update_card",
        params: unknown,
      ) => Effect.Effect<
        { readonly encodedResult: unknown },
        AgentBoardFileError,
        McpInvocationContext.McpInvocationContext
      >;
    };
  }) => Effect.Effect<
    A,
    E,
    FileSystem.FileSystem | Path.Path | McpInvocationContext.McpInvocationContext
  >,
) =>
  Effect.gen(function* () {
    const cwdA = yield* makeTempDir;
    const cwdB = yield* makeTempDir;
    const baseDir = yield* makeTempDir;
    const sqlite = NodeSqliteClient.layerMemory();

    const projects = new Map([
      [projectAId, makeProjectShell(projectAId, cwdA)],
      [projectBId, makeProjectShell(projectBId, cwdB)],
    ]);
    const threads = new Map([
      [
        supervisorThreadA,
        makeThreadShell({
          id: supervisorThreadA,
          projectId: projectAId,
          role: "project-supervisor",
        }),
      ],
      [
        supervisorThreadB,
        makeThreadShell({
          id: supervisorThreadB,
          projectId: projectBId,
          role: "project-supervisor",
        }),
      ],
      [
        standardThreadA,
        makeThreadShell({
          id: standardThreadA,
          projectId: projectAId,
          role: "standard",
        }),
      ],
    ]);

    const projectionMock = Layer.succeed(ProjectionSnapshotQuery, {
      getCommandReadModel: () => Effect.die("unused"),
      getSnapshot: () => Effect.die("unused"),
      getShellSnapshot: () => Effect.die("unused"),
      getArchivedShellSnapshot: () => Effect.die("unused"),
      searchThreads: () => Effect.die("unused"),
      getSnapshotSequence: () => Effect.die("unused"),
      getCounts: () => Effect.die("unused"),
      getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
      getProjectShellById: (projectId) => {
        const project = projects.get(projectId);
        return Effect.succeed(project ? Option.some(project) : Option.none());
      },
      getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
      getThreadCheckpointContext: () => Effect.succeed(Option.none()),
      getFullThreadDiffContext: () => Effect.succeed(Option.none()),
      getThreadShellById: (threadId) => {
        const thread = threads.get(threadId);
        return Effect.succeed(thread ? Option.some(thread) : Option.none());
      },
      getThreadDetailById: () => Effect.succeed(Option.none()),
      getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
    } as ProjectionSnapshotQuery["Service"]);

    const env = AgentBoardToolkitHandlersLive.pipe(
      Layer.provide(projectionMock),
      Layer.provide(
        AgentBoardFileSystemLive.pipe(
          Layer.provide(WorkspacePathsModule.layer),
          Layer.provide(ServerConfig.layerTest(cwdA, baseDir)),
        ),
      ),
      // Keep SqlClient + AgentBoardFileSystem available to the test body.
      Layer.provideMerge(
        AgentBoardFileSystemLive.pipe(
          Layer.provide(WorkspacePathsModule.layer),
          Layer.provide(ServerConfig.layerTest(cwdA, baseDir)),
          Layer.provideMerge(sqlite),
        ),
      ),
      Layer.provideMerge(NodeServices.layer),
    );

    return yield* Effect.gen(function* () {
      yield* runMigrations();
      const toolkit = yield* AgentBoardToolkit;
      return yield* body({ cwdA, cwdB, toolkit });
    }).pipe(Effect.provide(env));
  });

const withInvocation = <A, E, R>(
  invocation: McpInvocationContext.McpInvocationScope,
  effect: Effect.Effect<A, E, R | McpInvocationContext.McpInvocationContext>,
) => effect.pipe(Effect.provideService(McpInvocationContext.McpInvocationContext, invocation));

const runTool = <E, R>(
  toolkit: {
    readonly handle: (
      name: "agent_board_read" | "agent_board_create_card" | "agent_board_update_card",
      params: unknown,
    ) => unknown;
  },
  name: "agent_board_read" | "agent_board_create_card" | "agent_board_update_card",
  params: unknown,
  invocation: McpInvocationContext.McpInvocationScope,
) =>
  withInvocation(
    invocation,
    Effect.gen(function* () {
      const handled = toolkit.handle(name, params) as Effect.Effect<
        Stream.Stream<{ readonly encodedResult: unknown }, E, R>,
        E,
        R | McpInvocationContext.McpInvocationContext
      >;
      const stream = yield* handled;
      const last = yield* Stream.run(stream, Sink.last());
      return yield* Effect.fromOption(last);
    }),
  );

it.layer(Layer.mergeAll(NodeServices.layer))("Supervisor agent-board MCP toolkit", (it) => {
  describe("create / persist / update", () => {
    it.effect("Test A+B+F: Supervisor A creates a persisted card without repo pollution", () =>
      runSupervisorBoardCase(({ cwdA, toolkit }) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const invocation = invocationFor(supervisorThreadA, ["agent-board"]);

          const created = yield* runTool(
            toolkit,
            "agent_board_create_card",
            {
              title: "Ship readiness fix",
              intent: "Add Supervisor board tools",
              acceptanceCriteria: ["Card persists in T3 storage"],
              constraints: ["No distributed pivot"],
              nonGoals: ["Multi-server workers"],
              allowedWriteScopes: ["apps/server/src/mcp/**"],
              markReady: true,
              id: "ORCH-039-supervisor-board",
            },
            invocation,
          );

          const createdPayload = created.encodedResult as {
            readonly projectId: string;
            readonly projectRoot: string;
            readonly card: { readonly id: string; readonly state: string };
            readonly board: { readonly cards: ReadonlyArray<{ readonly id: string }> };
          };

          expect(createdPayload.projectId).toBe(projectAId);
          expect(createdPayload.projectRoot).toBe(cwdA);
          expect(createdPayload.card.id).toBe("ORCH-039-supervisor-board");
          expect(createdPayload.card.state).toBe("Ready");

          const reread = yield* runTool(toolkit, "agent_board_read", {}, invocation);
          const rereadPayload = reread.encodedResult as {
            readonly board: { readonly cards: ReadonlyArray<{ readonly id: string }> };
          };
          expect(rereadPayload.board.cards.map((card) => card.id)).toContain(
            "ORCH-039-supervisor-board",
          );

          // Also survive a second load via the board filesystem service.
          const boardFs = yield* AgentBoardFileSystem;
          const persisted = yield* boardFs.load({ cwd: cwdA, createIfMissing: false });
          expect(persisted.board.cards.map((card) => card.id)).toContain(
            "ORCH-039-supervisor-board",
          );

          expect(yield* fileSystem.exists(path.join(cwdA, ".t3", "agent-board.json"))).toBe(false);
          expect(yield* fileSystem.exists(path.join(cwdA, "WORKFLOW.md"))).toBe(false);
          expect(yield* fileSystem.exists(path.join(cwdA, "AGENTS.md"))).toBe(false);
          expect(yield* fileSystem.exists(path.join(cwdA, "T3_WORKFLOW.md"))).toBe(false);
        }),
      ),
    );

    it.effect("Test C: Supervisor can shape/update an existing authorized card", () =>
      runSupervisorBoardCase(({ toolkit }) =>
        Effect.gen(function* () {
          const invocation = invocationFor(supervisorThreadA, ["agent-board"]);
          yield* runTool(
            toolkit,
            "agent_board_create_card",
            {
              id: "CARD-SHAPE",
              title: "Shape me",
              intent: "Initial intent",
            },
            invocation,
          );

          const updated = yield* runTool(
            toolkit,
            "agent_board_update_card",
            {
              cardId: "CARD-SHAPE",
              intent: "Shaped intent",
              acceptanceCriteria: ["Criterion A"],
              constraints: ["Stay in project A"],
              dependencies: [],
              state: "Ready",
            },
            invocation,
          );

          const payload = updated.encodedResult as {
            readonly card: {
              readonly intentBrief?: {
                readonly intent: string;
                readonly acceptanceCriteria: string[];
              };
              readonly state: string;
            };
          };

          expect(payload.card.state).toBe("Ready");
          expect(payload.card.intentBrief?.intent).toBe("Shaped intent");
          expect(payload.card.intentBrief?.acceptanceCriteria).toEqual(["Criterion A"]);
        }),
      ),
    );
  });

  describe("isolation", () => {
    it.effect("Test D: Supervisor A cannot mutate project B board/cards", () =>
      runSupervisorBoardCase(({ toolkit }) =>
        Effect.gen(function* () {
          const invB = invocationFor(supervisorThreadB, ["agent-board"]);
          yield* runTool(
            toolkit,
            "agent_board_create_card",
            {
              id: "B-ONLY",
              title: "Project B card",
              intent: "B only",
            },
            invB,
          );

          const invA = invocationFor(supervisorThreadA, ["agent-board"]);
          const readA = yield* runTool(toolkit, "agent_board_read", {}, invA);
          const readPayload = readA.encodedResult as {
            readonly projectId: string;
            readonly board: { readonly cards: ReadonlyArray<{ readonly id: string }> };
          };
          expect(readPayload.projectId).toBe(projectAId);
          expect(readPayload.board.cards.map((card) => card.id)).not.toContain("B-ONLY");

          const updateForeign = yield* runTool(
            toolkit,
            "agent_board_update_card",
            {
              cardId: "B-ONLY",
              title: "Hijack",
            },
            invA,
          ).pipe(Effect.flip);

          expect(updateForeign).toBeInstanceOf(AgentBoardFileError);
          expect(String(updateForeign.message)).toContain("not found");
        }),
      ),
    );

    it.effect("Test E: standard (non-Supervisor) session is denied agent-board tools", () =>
      runSupervisorBoardCase(({ toolkit }) =>
        Effect.gen(function* () {
          const denied = yield* runTool(
            toolkit,
            "agent_board_create_card",
            {
              title: "Should fail",
              intent: "nope",
            },
            invocationFor(standardThreadA, ["preview"]),
          ).pipe(Effect.flip);

          expect(String(denied.message)).toContain("agent-board");

          const roleDenied = yield* runTool(
            toolkit,
            "agent_board_read",
            {},
            invocationFor(standardThreadA, ["agent-board"]),
          ).pipe(Effect.flip);
          expect(String(roleDenied.message)).toContain("agent-board");
        }),
      ),
    );
  });
});
