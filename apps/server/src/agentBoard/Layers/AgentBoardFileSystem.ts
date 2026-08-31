import { createHash } from "node:crypto";

import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import * as DateTime from "effect/DateTime";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  type AgentBoardCard,
  AgentBoardFile,
  type AgentBoardClaimResult,
  type AgentBoardLoadResult,
  type AgentBoardSaveResult,
} from "@t3tools/contracts";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";

import { ServerConfig } from "../../config.ts";
import {
  AgentBoardFileSystem,
  AgentBoardFileSystemError,
  type AgentBoardFileSystemShape,
} from "../Services/AgentBoardFileSystem.ts";
import { WorkspacePaths } from "../../workspace/WorkspacePaths.ts";

const LEGACY_BOARD_RELATIVE_PATH = ".t3/agent-board.json" as const;
const BOARD_STORAGE_REF = "t3://orchestration/agent-board" as const;

/** Board JSON with stable 2-space formatting. */
const AgentBoardFileJsonString = fromJsonStringPretty(AgentBoardFile);

const decodeAgentBoardFile = Schema.decodeUnknownEffect(AgentBoardFile);
const decodeAgentBoardFileJsonString = Schema.decodeUnknownEffect(AgentBoardFileJsonString);
const encodeAgentBoardFile = Schema.encodeEffect(AgentBoardFileJsonString);

/**
 * Deterministic filesystem segment for a board card id.
 * Exported so the runner derives identical card workspace paths.
 */
export function safeWorkspaceSegment(value: string): string {
  const segment = value
    .replaceAll(/[^a-zA-Z0-9._-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 80);
  return segment || "card";
}

/**
 * Interim project_id when no projection_projects row exists for the cwd yet.
 * Stable across restarts for the same normalized project root.
 */
export function pathScopedProjectId(projectRoot: string): string {
  const digest = createHash("sha256").update(projectRoot).digest("hex").slice(0, 24);
  return `path:${digest}`;
}

/** Absolute card worktree under T3 userdata (outside the user repo). */
export function resolveOrchestrationWorkspacePath(input: {
  readonly stateDir: string;
  readonly projectId: string;
  readonly cardId: string;
  readonly join: (...parts: ReadonlyArray<string>) => string;
}): string {
  return input.join(
    input.stateDir,
    "orchestration",
    safeWorkspaceSegment(input.projectId),
    "workspaces",
    safeWorkspaceSegment(input.cardId),
  );
}

export const makeAgentBoardFileSystem = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;
  const serverConfig = yield* ServerConfig;
  const sql = yield* SqlClient.SqlClient;

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  const resolveProjectRoot = Effect.fn("AgentBoardFileSystem.resolveProjectRoot")(function* (
    cwd: string,
  ) {
    return yield* workspacePaths.normalizeWorkspaceRoot(cwd);
  });

  /**
   * Prefer the durable projection project_id when the cwd is a registered
   * project. Fall back to a path-hash scoped id so boards can still be
   * created/loaded before the project row exists (interim key; documented in
   * PATCH.md / internals).
   */
  const resolveProjectId = Effect.fn("AgentBoardFileSystem.resolveProjectId")(function* (
    projectRoot: string,
  ) {
    const rows = yield* sql<{ readonly projectId: string }>`
      SELECT project_id AS "projectId"
      FROM projection_projects
      WHERE workspace_root = ${projectRoot}
        AND deleted_at IS NULL
      LIMIT 1
    `.pipe(
      // Missing projection row/table (fresh DB, unregistered cwd) → path-scoped id.
      Effect.catch(() => Effect.succeed([] as Array<{ readonly projectId: string }>)),
    );
    return rows[0]?.projectId ?? pathScopedProjectId(projectRoot);
  });

  const makeDefaultBoard = Effect.map(
    nowIso,
    (timestamp): AgentBoardFile => ({
      schemaVersion: 1,
      projectRoot: "",
      defaultView: "kanban",
      runner: {
        maxConcurrentCards: 1,
        repairCycles: 3,
      },
      cards: [],
      graphLinks: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );

  const readBoardRow = Effect.fn("AgentBoardFileSystem.readBoardRow")(function* (
    cwd: string,
    projectId: string,
  ) {
    const rows = yield* sql<{ readonly boardJson: string }>`
      SELECT board_json AS "boardJson"
      FROM agent_boards
      WHERE project_id = ${projectId}
      LIMIT 1
    `.pipe(
      Effect.mapError(
        (cause) =>
          new AgentBoardFileSystemError({
            cwd,
            operation: "agentBoard.read",
            detail: cause.message,
            cause,
          }),
      ),
    );
    return rows[0]?.boardJson !== undefined ? Option.some(rows[0].boardJson) : Option.none();
  });

  /**
   * When a durable projection project_id is in use, drop any leftover interim
   * `path:*` row for the same project_root (save-without-load race + defensive
   * duplicate cleanup on load).
   */
  const clearStalePathScopedBoard = Effect.fn("AgentBoardFileSystem.clearStalePathScopedBoard")(
    function* (input: {
      readonly cwd: string;
      readonly projectRoot: string;
      readonly durableProjectId: string;
    }) {
      const interimId = pathScopedProjectId(input.projectRoot);
      if (interimId === input.durableProjectId) return;
      yield* sql`
        DELETE FROM agent_boards
        WHERE project_id = ${interimId}
          AND project_root = ${input.projectRoot}
      `.pipe(
        Effect.mapError(
          (cause) =>
            new AgentBoardFileSystemError({
              cwd: input.cwd,
              operation: "agentBoard.rekey",
              detail: cause.message,
              cause,
            }),
        ),
      );
    },
  );

  const writeBoardRow = Effect.fn("AgentBoardFileSystem.writeBoardRow")(function* (input: {
    readonly cwd: string;
    readonly projectId: string;
    readonly projectRoot: string;
    readonly board: AgentBoardFile;
  }) {
    const contents = yield* encodeAgentBoardFile(input.board).pipe(
      Effect.mapError(
        (cause) =>
          new AgentBoardFileSystemError({
            cwd: input.cwd,
            operation: "agentBoard.encode",
            detail: String(cause),
            cause,
          }),
      ),
    );
    const timestamp = input.board.updatedAt;
    yield* sql`
      INSERT INTO agent_boards (
        project_id,
        project_root,
        board_json,
        created_at,
        updated_at
      )
      VALUES (
        ${input.projectId},
        ${input.projectRoot},
        ${contents},
        ${input.board.createdAt},
        ${timestamp}
      )
      ON CONFLICT (project_id)
      DO UPDATE SET
        project_root = excluded.project_root,
        board_json = excluded.board_json,
        updated_at = excluded.updated_at
    `.pipe(
      Effect.mapError(
        (cause) =>
          new AgentBoardFileSystemError({
            cwd: input.cwd,
            operation: "agentBoard.write",
            detail: cause.message,
            cause,
          }),
      ),
    );
  });

  /** Upsert durable/interim board row and remove stale path-scoped duplicate atomically. */
  const writeBoardAndClearInterim = Effect.fn("AgentBoardFileSystem.writeBoardAndClearInterim")(
    function* (input: {
      readonly cwd: string;
      readonly projectId: string;
      readonly projectRoot: string;
      readonly board: AgentBoardFile;
    }) {
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* writeBoardRow(input);
            yield* clearStalePathScopedBoard({
              cwd: input.cwd,
              projectRoot: input.projectRoot,
              durableProjectId: input.projectId,
            });
          }),
        )
        .pipe(
          Effect.mapError((cause) =>
            cause instanceof AgentBoardFileSystemError
              ? cause
              : new AgentBoardFileSystemError({
                  cwd: input.cwd,
                  operation: "agentBoard.write",
                  detail: cause instanceof Error ? cause.message : String(cause),
                  cause,
                }),
          ),
        );
    },
  );

  /**
   * Prefer durable projection project_id. If a board was created earlier under
   * the interim path-scoped key for the same project_root, rekey that row onto
   * the durable id and delete the interim row (one-way promotion).
   */
  const loadBoardJsonForProject = Effect.fn("AgentBoardFileSystem.loadBoardJsonForProject")(
    function* (cwd: string, projectRoot: string, preferredProjectId: string) {
      const preferred = yield* readBoardRow(cwd, preferredProjectId);
      if (Option.isSome(preferred)) {
        // Defensive: durable row may already exist while a stale path:* twin
        // remains after a save-without-load race that predated cleanup.
        yield* clearStalePathScopedBoard({
          cwd,
          projectRoot,
          durableProjectId: preferredProjectId,
        });
        return { projectId: preferredProjectId, boardJson: preferred.value } as const;
      }

      const interimId = pathScopedProjectId(projectRoot);
      if (preferredProjectId !== interimId) {
        const interim = yield* readBoardRow(cwd, interimId);
        if (Option.isSome(interim)) {
          const board = yield* decodeAgentBoardFileJsonString(interim.value).pipe(
            Effect.mapError(
              (cause) =>
                new AgentBoardFileSystemError({
                  cwd,
                  operation: "agentBoard.decode",
                  detail: String(cause),
                  cause,
                }),
            ),
          );
          const promoted = { ...board, projectRoot };
          yield* writeBoardAndClearInterim({
            cwd,
            projectId: preferredProjectId,
            projectRoot,
            board: promoted,
          });
          yield* Effect.logInfo("agentBoard.project-id-rekeyed", {
            fromProjectId: interimId,
            toProjectId: preferredProjectId,
            projectRoot,
          });
          const encoded = yield* encodeAgentBoardFile(promoted).pipe(
            Effect.mapError(
              (cause) =>
                new AgentBoardFileSystemError({
                  cwd,
                  operation: "agentBoard.encode",
                  detail: String(cause),
                  cause,
                }),
            ),
          );
          return { projectId: preferredProjectId, boardJson: encoded } as const;
        }
      }

      // Safety net: any row already keyed by this absolute project_root.
      const byRoot = yield* sql<{ readonly projectId: string; readonly boardJson: string }>`
        SELECT project_id AS "projectId", board_json AS "boardJson"
        FROM agent_boards
        WHERE project_root = ${projectRoot}
        LIMIT 1
      `.pipe(
        Effect.mapError(
          (cause) =>
            new AgentBoardFileSystemError({
              cwd,
              operation: "agentBoard.read",
              detail: cause.message,
              cause,
            }),
        ),
      );
      const rootRow = byRoot[0];
      if (rootRow !== undefined) {
        if (rootRow.projectId !== preferredProjectId) {
          const board = yield* decodeAgentBoardFileJsonString(rootRow.boardJson).pipe(
            Effect.mapError(
              (cause) =>
                new AgentBoardFileSystemError({
                  cwd,
                  operation: "agentBoard.decode",
                  detail: String(cause),
                  cause,
                }),
            ),
          );
          const promoted = { ...board, projectRoot };
          yield* writeBoardAndClearInterim({
            cwd,
            projectId: preferredProjectId,
            projectRoot,
            board: promoted,
          });
          if (rootRow.projectId !== pathScopedProjectId(projectRoot)) {
            // Clear any non-interim foreign key that byRoot surfaced.
            yield* sql`
              DELETE FROM agent_boards
              WHERE project_id = ${rootRow.projectId}
                AND project_root = ${projectRoot}
            `.pipe(
              Effect.mapError(
                (cause) =>
                  new AgentBoardFileSystemError({
                    cwd,
                    operation: "agentBoard.rekey",
                    detail: cause.message,
                    cause,
                  }),
              ),
            );
          }
        } else {
          yield* clearStalePathScopedBoard({
            cwd,
            projectRoot,
            durableProjectId: preferredProjectId,
          });
        }
        return { projectId: preferredProjectId, boardJson: rootRow.boardJson } as const;
      }

      return null;
    },
  );

  const resolveCardWorkspacePath = (projectId: string, cardId: string) =>
    resolveOrchestrationWorkspacePath({
      stateDir: serverConfig.stateDir,
      projectId,
      cardId,
      join: path.join,
    });

  const resolveLegacyBoardPath = Effect.fn("AgentBoardFileSystem.resolveLegacyBoardPath")(
    function* (projectRoot: string) {
      return yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: projectRoot,
        relativePath: LEGACY_BOARD_RELATIVE_PATH,
      });
    },
  );

  const tryDecodeLegacyFile = Effect.fn("AgentBoardFileSystem.tryDecodeLegacyFile")(function* (
    cwd: string,
    absolutePath: string,
  ) {
    const readOutcome = yield* fileSystem.readFileString(absolutePath).pipe(
      Effect.map((contents) => ({ _tag: "contents" as const, contents })),
      Effect.catch((error) => Effect.succeed({ _tag: "error" as const, error })),
    );
    if (readOutcome._tag === "error") {
      return { _tag: "missing" as const } as const;
    }
    const board = yield* decodeAgentBoardFileJsonString(readOutcome.contents).pipe(
      Effect.mapError(
        (cause) =>
          new AgentBoardFileSystemError({
            cwd,
            operation: "agentBoard.decode",
            detail: String(cause),
            cause,
          }),
      ),
    );
    return { _tag: "board" as const, board } as const;
  });

  const load: AgentBoardFileSystemShape["load"] = (input) =>
    Effect.gen(function* () {
      const projectRoot = yield* resolveProjectRoot(input.cwd);
      const projectId = yield* resolveProjectId(projectRoot);

      const stored = yield* loadBoardJsonForProject(input.cwd, projectRoot, projectId);
      if (stored !== null) {
        const board = yield* decodeAgentBoardFileJsonString(stored.boardJson).pipe(
          Effect.mapError(
            (cause) =>
              new AgentBoardFileSystemError({
                cwd: input.cwd,
                operation: "agentBoard.decode",
                detail: String(cause),
                cause,
              }),
          ),
        );
        return {
          board,
          relativePath: BOARD_STORAGE_REF,
          created: false,
        } satisfies AgentBoardLoadResult;
      }

      // One-shot legacy import from <project>/.t3/agent-board.json — SQLite
      // becomes source of truth afterwards (no permanent dual-write).
      const legacyPath = yield* resolveLegacyBoardPath(projectRoot);
      const legacyRead = yield* tryDecodeLegacyFile(input.cwd, legacyPath.absolutePath);
      if (legacyRead._tag === "board") {
        const imported = { ...legacyRead.board, projectRoot };
        yield* writeBoardAndClearInterim({
          cwd: input.cwd,
          projectId,
          projectRoot,
          board: imported,
        });
        yield* Effect.logInfo("agentBoard.legacy-imported", {
          projectId,
          projectRoot,
          legacyPath: legacyPath.absolutePath,
        });
        return {
          board: imported,
          relativePath: BOARD_STORAGE_REF,
          created: false,
        } satisfies AgentBoardLoadResult;
      }

      if (!input.createIfMissing) {
        return yield* new AgentBoardFileSystemError({
          cwd: input.cwd,
          operation: "agentBoard.read",
          detail: `No agent board for project ${projectId}`,
        });
      }

      const defaultBoard = Object.assign(yield* makeDefaultBoard, { projectRoot });
      yield* writeBoardAndClearInterim({
        cwd: input.cwd,
        projectId,
        projectRoot,
        board: defaultBoard,
      });
      return {
        board: defaultBoard,
        relativePath: BOARD_STORAGE_REF,
        created: true,
      } satisfies AgentBoardLoadResult;
    });

  const save: AgentBoardFileSystemShape["save"] = (input) =>
    Effect.gen(function* () {
      const projectRoot = yield* resolveProjectRoot(input.cwd);
      const projectId = yield* resolveProjectId(projectRoot);
      const board = yield* decodeAgentBoardFile({
        ...input.board,
        projectRoot,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new AgentBoardFileSystemError({
              cwd: input.cwd,
              operation: "agentBoard.decode",
              detail: String(cause),
              cause,
            }),
        ),
      );

      yield* writeBoardAndClearInterim({
        cwd: input.cwd,
        projectId,
        projectRoot,
        board,
      });

      return {
        board,
        relativePath: BOARD_STORAGE_REF,
      } satisfies AgentBoardSaveResult;
    });

  const claim: AgentBoardFileSystemShape["claim"] = (input) =>
    Effect.gen(function* () {
      const projectRoot = yield* resolveProjectRoot(input.cwd);
      const projectId = yield* resolveProjectId(projectRoot);
      const loaded = yield* load({ cwd: input.cwd, createIfMissing: false });
      const card = loaded.board.cards.find((candidate) => candidate.id === input.cardId);

      if (!card) {
        return yield* new AgentBoardFileSystemError({
          cwd: input.cwd,
          operation: "agentBoard.claim",
          detail: `Agent board card not found: ${input.cardId}`,
        });
      }

      if (card.state !== "Ready") {
        return yield* new AgentBoardFileSystemError({
          cwd: input.cwd,
          operation: "agentBoard.claim",
          detail: `Only Ready cards can be claimed. ${input.cardId} is ${card.state}.`,
        });
      }

      const workspacePath = resolveCardWorkspacePath(projectId, card.id);
      yield* fileSystem.makeDirectory(workspacePath, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new AgentBoardFileSystemError({
              cwd: input.cwd,
              operation: "agentBoard.makeWorkspace",
              detail: cause.message,
              cause,
            }),
        ),
      );

      const timestamp = yield* nowIso;
      const nextCards = loaded.board.cards.map((nextCard) => {
        if (nextCard.id !== input.cardId) return nextCard;
        const {
          currentError: _currentError,
          currentDecisionQuestion: _currentDecisionQuestion,
          ...runtime
        } = nextCard.runtime;
        const nextRuntime = {
          ...runtime,
          attemptCount: runtime.attemptCount + 1,
          lastHeartbeatAt: timestamp,
          workspacePath,
        };
        return Object.assign({}, nextCard, {
          state: "Running" as const,
          runtime: nextRuntime,
          updatedAt: timestamp,
        }) satisfies AgentBoardCard;
      });
      const nextBoard = {
        ...loaded.board,
        cards: nextCards,
        updatedAt: timestamp,
      };

      const saved = yield* save({ cwd: input.cwd, board: nextBoard });
      const savedCard = saved.board.cards.find((candidate) => candidate.id === input.cardId);

      if (!savedCard) {
        return yield* new AgentBoardFileSystemError({
          cwd: input.cwd,
          operation: "agentBoard.claim",
          detail: `Claimed card missing after save: ${input.cardId}`,
        });
      }

      return {
        board: saved.board,
        card: savedCard,
        relativePath: saved.relativePath,
        workspacePath,
      } satisfies AgentBoardClaimResult;
    });

  return { load, save, claim } satisfies AgentBoardFileSystemShape;
});

export const AgentBoardFileSystemLive = Layer.effect(
  AgentBoardFileSystem,
  makeAgentBoardFileSystem,
);
