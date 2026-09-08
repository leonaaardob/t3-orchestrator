import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { AgentBoardFile, type AgentBoardCardId } from "@t3tools/contracts";

import * as ServerConfig from "../../config.ts";
import { runMigrations } from "../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import { AgentBoardFileSystem } from "../Services/AgentBoardFileSystem.ts";
import { supervisorWakeFingerprint } from "../supervisorWake.ts";
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
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | SqlClient.SqlClient>,
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
            // @effect-diagnostics-next-line preferSchemaOverJson:off - Raw persisted legacy JSON fixture.
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

    it.effect("records one durable Supervisor wake for a result transition", () =>
      runWithBoard(({ service, cwd }) =>
        Effect.gen(function* () {
          const created = yield* service.load({ cwd, createIfMissing: true });
          const running = {
            ...created.board,
            cards: [
              {
                id: "CARD-WAKE",
                title: "Wake card",
                state: "Running" as const,
                runtime: { attemptCount: 1 },
                intentBrief: { intent: "Test wake" },
                createdAt: "2026-05-05T12:00:00.000Z",
                updatedAt: "2026-05-05T12:00:00.000Z",
              },
            ],
          } as unknown as AgentBoardFile;
          yield* service.save({ cwd, board: running }, "scheduler");
          const review = {
            ...running,
            cards: running.cards.map((card) => ({
              ...card,
              state: "Review" as const,
              updatedAt: "2026-05-05T12:00:01.000Z",
            })),
          };
          yield* service.save({ cwd, board: review }, "scheduler");
          const sql = yield* SqlClient.SqlClient;
          const first = yield* sql<{
            readonly pendingFingerprint: string | null;
            readonly pendingCardIdsJson: string;
          }>`
            SELECT
              pending_fingerprint AS "pendingFingerprint",
              pending_card_ids_json AS "pendingCardIdsJson"
            FROM agent_board_supervisor_wakes
          `;
          expect(first).toHaveLength(1);
          expect(first[0]?.pendingFingerprint).not.toBeNull();
          expect(first[0]?.pendingCardIdsJson).toBe('["CARD-WAKE"]');

          yield* service.save(
            {
              cwd,
              board: {
                ...review,
                updatedAt: "2026-05-05T12:00:02.000Z",
              },
            },
            "scheduler",
          );
          const second = yield* sql<{ readonly pendingCardIdsJson: string }>`
            SELECT pending_card_ids_json AS "pendingCardIdsJson"
            FROM agent_board_supervisor_wakes
          `;
          expect(second).toEqual(first.map(({ pendingCardIdsJson }) => ({ pendingCardIdsJson })));
        }),
      ),
    );

    it.effect(
      "records a human unblock or Review validation without waking for the unanswered decision itself",
      () =>
        runWithBoard(({ service, cwd }) =>
          Effect.gen(function* () {
            const created = yield* service.load({ cwd, createIfMissing: true });
            const needsDecision = {
              ...created.board,
              cards: [
                {
                  id: "CARD-HUMAN-UNBLOCK",
                  title: "Human unblock",
                  state: "Needs Decision" as const,
                  runtime: { attemptCount: 3, currentDecisionQuestion: "Choose a path" },
                  intentBrief: { intent: "Test human unblock" },
                  createdAt: "2026-05-05T12:00:00.000Z",
                  updatedAt: "2026-05-05T12:00:00.000Z",
                },
              ],
            } as unknown as AgentBoardFile;
            yield* service.save({ cwd, board: needsDecision });
            const sql = yield* SqlClient.SqlClient;
            const before = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS "count" FROM agent_board_supervisor_wakes
          `;
            expect(before).toEqual([{ count: 0 }]);

            const ready = {
              ...needsDecision,
              cards: needsDecision.cards.map((card) => ({
                ...card,
                state: "Ready" as const,
                updatedAt: "2026-05-05T12:00:01.000Z",
              })),
            } as unknown as AgentBoardFile;
            yield* service.save({ cwd, board: ready });
            const wakes = yield* sql<{ readonly pendingCardIdsJson: string }>`
            SELECT pending_card_ids_json AS "pendingCardIdsJson"
            FROM agent_board_supervisor_wakes
          `;
            expect(wakes).toEqual([{ pendingCardIdsJson: '["CARD-HUMAN-UNBLOCK"]' }]);

            const review = {
              ...ready,
              cards: [
                {
                  ...ready.cards[0],
                  id: "CARD-HUMAN-VALIDATION",
                  title: "Human validation",
                  state: "Review" as const,
                  updatedAt: "2026-05-05T12:00:02.000Z",
                },
              ],
            } as unknown as AgentBoardFile;
            yield* service.save({ cwd, board: review });
            const done = {
              ...review,
              cards: review.cards.map((card) => ({
                ...card,
                state: "Done" as const,
                updatedAt: "2026-05-05T12:00:03.000Z",
              })),
            } as unknown as AgentBoardFile;
            yield* service.save({ cwd, board: done });
            const validationWake = yield* sql<{ readonly pendingCardIdsJson: string }>`
            SELECT pending_card_ids_json AS "pendingCardIdsJson"
            FROM agent_board_supervisor_wakes
          `;
            expect(validationWake).toEqual([
              {
                pendingCardIdsJson: '["CARD-HUMAN-UNBLOCK","CARD-HUMAN-VALIDATION"]',
              },
            ]);
          }),
        ),
    );

    it.effect("keeps an accepted dispatch envelope when a newer scheduler result is saved", () =>
      runWithBoard(({ service, cwd }) =>
        Effect.gen(function* () {
          const created = yield* service.load({ cwd, createIfMissing: true });
          const running = {
            ...created.board,
            cards: [
              {
                id: "CARD-IN-FLIGHT",
                title: "In flight",
                state: "Running" as const,
                runtime: { attemptCount: 1 },
                intentBrief: { intent: "Test in-flight envelope" },
                createdAt: "2026-05-05T12:00:00.000Z",
                updatedAt: "2026-05-05T12:00:00.000Z",
              },
            ],
          } as unknown as AgentBoardFile;
          yield* service.save({ cwd, board: running }, "scheduler");
          const review = {
            ...running,
            cards: running.cards.map((card) => ({
              ...card,
              state: "Review" as const,
              updatedAt: "2026-05-05T12:00:01.000Z",
            })),
          };
          yield* service.save({ cwd, board: review }, "scheduler");
          const sql = yield* SqlClient.SqlClient;
          const firstFingerprint = supervisorWakeFingerprint(review);
          yield* sql`
            UPDATE agent_board_supervisor_wakes
            SET dispatch_command_id = 'in-flight-command',
                dispatch_fingerprint = ${firstFingerprint},
                dispatch_thread_id = 'supervisor-thread',
                dispatch_message_id = 'in-flight-message',
                dispatch_message_text = 'original wake body',
                dispatch_runtime_mode = 'full-access',
                dispatch_interaction_mode = 'default',
                dispatch_created_at = '2026-05-05T12:00:02.000Z',
                dispatch_attempts = 1,
                last_error = NULL
          `;
          const blocked = {
            ...review,
            cards: review.cards.map((card) => ({
              ...card,
              state: "Blocked" as const,
              updatedAt: "2026-05-05T12:00:03.000Z",
            })),
          };
          yield* service.save({ cwd, board: blocked }, "scheduler");
          const rows = yield* sql<{
            readonly pendingFingerprint: string | null;
            readonly dispatchFingerprint: string | null;
            readonly dispatchCommandId: string | null;
            readonly dispatchMessageText: string | null;
          }>`
            SELECT
              pending_fingerprint AS "pendingFingerprint",
              dispatch_fingerprint AS "dispatchFingerprint",
              dispatch_command_id AS "dispatchCommandId",
              dispatch_message_text AS "dispatchMessageText"
            FROM agent_board_supervisor_wakes
          `;
          expect(rows).toEqual([
            {
              pendingFingerprint: supervisorWakeFingerprint(blocked),
              dispatchFingerprint: firstFingerprint,
              dispatchCommandId: "in-flight-command",
              dispatchMessageText: "original wake body",
            },
          ]);
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
