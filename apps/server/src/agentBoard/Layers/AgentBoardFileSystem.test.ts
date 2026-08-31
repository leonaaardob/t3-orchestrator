import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { AgentBoardFile, type AgentBoardCardId } from "@t3tools/contracts";

import * as ServerConfig from "../../config.ts";
import { runMigrations } from "../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import { AgentBoardFileSystem } from "../Services/AgentBoardFileSystem.ts";
import {
  AgentBoardFileSystemLive,
  pathScopedProjectId,
  resolveOrchestrationWorkspacePath,
} from "./AgentBoardFileSystem.ts";
import * as WorkspacePathsModule from "../../workspace/WorkspacePaths.ts";

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3code-agent-board-",
  });
});

/**
 * Build a board env where SqlClient is provided INTO AgentBoardFileSystemLive
 * (Layer.provide), and migrations + board ops share one Effect.provide scope.
 */
const runWithBoard = <A, E>(
  body: (input: {
    readonly service: AgentBoardFileSystem["Service"];
    readonly cwd: string;
    readonly baseDir: string;
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const cwd = yield* makeTempDir;
    const baseDir = yield* makeTempDir;
    const sqlite = NodeSqliteClient.layerMemory();
    const env = AgentBoardFileSystemLive.pipe(
      Layer.provide(WorkspacePathsModule.layer),
      Layer.provide(ServerConfig.layerTest(cwd, baseDir)),
      // provideMerge: satisfy FS construction AND keep SqlClient for migrations.
      Layer.provideMerge(sqlite),
      Layer.provideMerge(NodeServices.layer),
    );
    return yield* Effect.gen(function* () {
      yield* runMigrations();
      const service = yield* AgentBoardFileSystem;
      return yield* body({ service, cwd, baseDir });
    }).pipe(Effect.provide(env));
  });

it.layer(Layer.mergeAll(NodeServices.layer))("AgentBoardFileSystemLive", (it) => {
  describe("load", () => {
    it.effect("creates a server-owned board without writing into the project", () =>
      runWithBoard(({ service, cwd }) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;

          const result = yield* service.load({ cwd, createIfMissing: true });

          expect(result.created).toBe(true);
          expect(result.relativePath).toBe("t3://orchestration/agent-board");
          expect(result.board.projectRoot).toBe(cwd);
          expect(result.board.cards).toEqual([]);
          expect(yield* fileSystem.exists(path.join(cwd, ".t3", "agent-board.json"))).toBe(false);
        }),
      ),
    );

    it.effect("imports a legacy project .t3 board once into server storage", () =>
      runWithBoard(({ service, cwd }) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;

          yield* fileSystem.makeDirectory(path.join(cwd, ".t3"), { recursive: true });
          yield* fileSystem.writeFileString(
            path.join(cwd, ".t3", "agent-board.json"),
            `${JSON.stringify({
              schemaVersion: 1,
              projectRoot: cwd,
              defaultView: "kanban",
              runner: { maxConcurrentCards: 1, repairCycles: 3 },
              cards: [
                {
                  id: "LEGACY-1",
                  title: "Legacy card",
                  state: "Backlog",
                  createdAt: "2026-05-05T12:00:00.000Z",
                  updatedAt: "2026-05-05T12:00:00.000Z",
                },
              ],
              graphLinks: [],
              createdAt: "2026-05-05T12:00:00.000Z",
              updatedAt: "2026-05-05T12:00:00.000Z",
            })}\n`,
          );

          const result = yield* service.load({ cwd, createIfMissing: false });

          expect(result.created).toBe(false);
          expect(result.board.cards[0]?.id).toBe("LEGACY-1");
          expect(result.relativePath).toBe("t3://orchestration/agent-board");

          const again = yield* service.load({ cwd, createIfMissing: false });
          expect(again.board.cards[0]?.id).toBe("LEGACY-1");
        }),
      ),
    );

    it.effect("rejects missing boards when creation is not requested", () =>
      runWithBoard(({ service, cwd }) =>
        Effect.gen(function* () {
          const error = yield* service.load({ cwd, createIfMissing: false }).pipe(Effect.flip);

          expect(error._tag).toBe("AgentBoardFileSystemError");
          if (error._tag === "AgentBoardFileSystemError") {
            expect(error.operation).toBe("agentBoard.read");
          }
        }),
      ),
    );
  });

  describe("save", () => {
    it.effect("writes a validated board into server storage only", () =>
      runWithBoard(({ service, cwd }) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const created = yield* service.load({ cwd, createIfMissing: true });
          const nextBoard = {
            ...created.board,
            cards: [
              {
                id: "TASK-20260505-test-card",
                title: "Test card",
                state: "Backlog" as const,
                createdAt: "2026-05-05T12:00:00.000Z",
                updatedAt: "2026-05-05T12:00:00.000Z",
              },
            ],
            updatedAt: "2026-05-05T12:00:00.000Z",
          } as unknown as AgentBoardFile;

          const result = yield* service.save({ cwd, board: nextBoard });

          expect(result.board.cards[0]?.id).toBe("TASK-20260505-test-card");
          expect(yield* fileSystem.exists(path.join(cwd, ".t3", "agent-board.json"))).toBe(false);
        }),
      ),
    );

    it.effect("rejects title-only ready cards on save", () =>
      runWithBoard(({ service, cwd }) =>
        Effect.gen(function* () {
          const created = yield* service.load({ cwd, createIfMissing: true });
          const invalidBoard = {
            ...created.board,
            cards: [
              {
                id: "TASK-20260505-title-only",
                title: "Title only",
                state: "Ready" as const,
                createdAt: "2026-05-05T12:00:00.000Z",
                updatedAt: "2026-05-05T12:00:00.000Z",
              },
            ],
          } as unknown as AgentBoardFile;

          const error = yield* service.save({ cwd, board: invalidBoard }).pipe(Effect.flip);

          expect(error._tag).toBe("AgentBoardFileSystemError");
          if (error._tag === "AgentBoardFileSystemError") {
            expect(error.operation).toBe("agentBoard.decode");
          }
        }),
      ),
    );
  });

  describe("claim", () => {
    it.effect("creates a server-owned workspace outside the project and moves Ready→Running", () =>
      runWithBoard(({ service, cwd, baseDir }) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const cardId = "TASK-20260505-ready-card" as AgentBoardCardId;
          const created = yield* service.load({ cwd, createIfMissing: true });
          const readyBoard = {
            ...created.board,
            cards: [
              {
                id: cardId,
                title: "Ready card",
                state: "Ready" as const,
                runtime: {
                  attemptCount: 1,
                  currentError: "Previous failure",
                  currentDecisionQuestion: "Previous question?",
                },
                intentBrief: {
                  intent: "Claim this card.",
                  acceptanceCriteria: ["Workspace exists."],
                },
                createdAt: "2026-05-05T12:00:00.000Z",
                updatedAt: "2026-05-05T12:00:00.000Z",
              },
            ],
            updatedAt: "2026-05-05T12:00:00.000Z",
          } as unknown as AgentBoardFile;
          yield* service.save({ cwd, board: readyBoard });

          const result = yield* service.claim({ cwd, cardId });

          expect(result.card.state).toBe("Running");
          expect(result.card.runtime.attemptCount).toBe(2);
          expect(path.isAbsolute(result.card.runtime.workspacePath ?? "")).toBe(true);
          expect(result.card.runtime.workspacePath?.includes(cwd)).toBe(false);
          expect(result.card.runtime.currentError).toBeUndefined();
          expect(result.card.runtime.currentDecisionQuestion).toBeUndefined();
          expect(yield* fileSystem.exists(result.workspacePath)).toBe(true);
          expect(
            yield* fileSystem.exists(
              path.join(cwd, ".t3", "workspaces", "TASK-20260505-ready-card"),
            ),
          ).toBe(false);

          const derived = yield* ServerConfig.deriveServerPaths(baseDir, undefined);
          const expected = resolveOrchestrationWorkspacePath({
            stateDir: derived.stateDir,
            projectId: pathScopedProjectId(cwd),
            cardId,
            join: path.join,
          });
          expect(result.workspacePath).toBe(expected);
        }),
      ),
    );

    it.effect("rejects non-ready cards", () =>
      runWithBoard(({ service, cwd }) =>
        Effect.gen(function* () {
          const cardId = "TASK-20260505-draft-card" as AgentBoardCardId;
          const created = yield* service.load({ cwd, createIfMissing: true });
          const draftBoard = {
            ...created.board,
            cards: [
              {
                id: cardId,
                title: "Draft card",
                state: "Draft" as const,
                createdAt: "2026-05-05T12:00:00.000Z",
                updatedAt: "2026-05-05T12:00:00.000Z",
              },
            ],
          } as unknown as AgentBoardFile;
          yield* service.save({ cwd, board: draftBoard });

          const error = yield* service.claim({ cwd, cardId }).pipe(Effect.flip);

          expect(error._tag).toBe("AgentBoardFileSystemError");
          if (error._tag === "AgentBoardFileSystemError") {
            expect(error.operation).toBe("agentBoard.claim");
          }
        }),
      ),
    );
  });
});
