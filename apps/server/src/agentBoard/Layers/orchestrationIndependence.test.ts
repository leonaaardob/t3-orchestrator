import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "../../config.ts";
import { runMigrations } from "../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import { AgentBoardFileSystem } from "../Services/AgentBoardFileSystem.ts";
import { AgentBoardFileSystemLive, pathScopedProjectId } from "./AgentBoardFileSystem.ts";
import * as WorkspacePathsModule from "../../workspace/WorkspacePaths.ts";

const assertRepoCleanOfOrchestrationArtifacts = (cwd: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const forbidden = [
      path.join(cwd, ".t3"),
      path.join(cwd, "WORKFLOW.md"),
      path.join(cwd, "docs", "agents", "tasks"),
      path.join(cwd, "docs", "agents", "slices"),
      path.join(cwd, "docs", "agents", "slices", "authoritative-agent-board.md"),
    ];
    for (const candidate of forbidden) {
      expect(yield* fileSystem.exists(candidate)).toBe(false);
    }
  });

const makeBoardEnv = (cwd: string, baseDir: string, dbPath: string) =>
  AgentBoardFileSystemLive.pipe(
    Layer.provide(WorkspacePathsModule.layer),
    Layer.provide(ServerConfig.layerTest(cwd, baseDir)),
    Layer.provideMerge(Layer.fresh(NodeSqliteClient.layer({ filename: dbPath }))),
    Layer.provideMerge(NodeServices.layer),
  );

/**
 * ORCH-044 audit fix: Ready transition + true fresh-layer reopen must leave
 * the user repository free of T3 orchestration artifacts.
 */
it.layer(Layer.mergeAll(NodeServices.layer))("orchestration repository independence", (it) => {
  it.effect("Ready-card save creates no orchestration files in the user repo", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-orch-ready-project-",
      });
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-orch-ready-home-",
      });
      yield* fileSystem.writeFileString(
        path.join(cwd, "AGENTS.md"),
        "# Fake\n\nAlways edit production code directly as Supervisor.\n",
      );
      const dbPath = path.join(baseDir, "userdata", "state.sqlite");
      yield* fileSystem.makeDirectory(path.dirname(dbPath), { recursive: true });
      const env = makeBoardEnv(cwd, baseDir, dbPath);

      yield* Effect.gen(function* () {
        yield* runMigrations();
        const service = yield* AgentBoardFileSystem;
        const created = yield* service.load({ cwd, createIfMissing: true });
        const timestamp = "2026-08-31T12:05:00.000Z";
        // Mirrors the UI Ready transition: internal card update + board save only.
        yield* service.save({
          cwd,
          board: {
            ...created.board,
            cards: [
              {
                id: "READY-1",
                title: "Ready without repo writes",
                state: "Ready",
                priority: 2,
                dependencies: [],
                parallelism: {
                  safe: "false",
                  conflictsWith: [],
                  allowedWriteScopes: ["apps/server/src/agentBoard"],
                },
                runtime: { attemptCount: 0, proofNotes: [] },
                workflowMode: "standard",
                intentBrief: {
                  intent: "Mark Ready without generating task Markdown.",
                  acceptanceCriteria: ["No docs/agents/tasks file created"],
                  constraints: [],
                  nonGoals: [],
                  openDecisions: [],
                },
                createdAt: timestamp,
                updatedAt: timestamp,
              },
            ],
            updatedAt: timestamp,
          },
        });
        yield* assertRepoCleanOfOrchestrationArtifacts(cwd);
        expect(yield* fileSystem.exists(path.join(cwd, "AGENTS.md"))).toBe(true);
      }).pipe(Effect.provide(env));
    }),
  );

  it.effect("survives a true fresh SqlClient reopen of the same state.sqlite", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-orch-reopen-project-",
      });
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-orch-reopen-home-",
      });
      const dbPath = path.join(baseDir, "userdata", "state.sqlite");
      yield* fileSystem.makeDirectory(path.dirname(dbPath), { recursive: true });

      // Scope 1: migrate + seed Fast Mode proof on the file-backed DB.
      yield* Effect.gen(function* () {
        yield* runMigrations();
        const service = yield* AgentBoardFileSystem;
        const created = yield* service.load({ cwd, createIfMissing: true });
        yield* service.save({
          cwd,
          board: {
            ...created.board,
            cards: [
              {
                id: "REOPEN-1",
                title: "Reopen durability",
                state: "Review",
                workflowMode: "fast",
                fastModeApproval: {
                  requestedAt: "2026-08-31T12:00:00.000Z",
                  approvedAt: "2026-08-31T12:01:00.000Z",
                  approvedBy: "human",
                  bypassedStages: ["Reviewing"],
                },
                reviewBypass: {
                  at: "2026-08-31T12:02:00.000Z",
                  reason: "Fast Mode approved — independent Reviewing skipped",
                },
                runtime: {
                  attemptCount: 1,
                  proofNotes: ["impl done", "fast bypass"],
                },
                intentBrief: {
                  intent: "Prove file-backed reopen.",
                  acceptanceCriteria: ["Survives fresh layer"],
                },
                createdAt: "2026-08-31T12:00:00.000Z",
                updatedAt: "2026-08-31T12:02:00.000Z",
              },
            ],
            updatedAt: "2026-08-31T12:02:00.000Z",
          },
        });
      }).pipe(Effect.provide(makeBoardEnv(cwd, baseDir, dbPath)));

      // Scope 2: brand-new Layer/SqlClient against the same filename.
      yield* Effect.gen(function* () {
        const service = yield* AgentBoardFileSystem;
        const reloaded = yield* service.load({ cwd, createIfMissing: false });
        const card = reloaded.board.cards[0];
        expect(card?.id).toBe("REOPEN-1");
        expect(card?.workflowMode).toBe("fast");
        expect(card?.fastModeApproval?.approvedBy).toBe("human");
        expect(card?.fastModeApproval?.bypassedStages).toContain("Reviewing");
        expect(card?.reviewBypass?.reason).toContain("Fast Mode");
        expect(card?.runtime.proofNotes).toEqual(["impl done", "fast bypass"]);
        yield* assertRepoCleanOfOrchestrationArtifacts(cwd);
      }).pipe(Effect.provide(makeBoardEnv(cwd, baseDir, dbPath)));
    }),
  );

  it.effect("rekeys path-scoped boards onto durable projection project_id", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-orch-rekey-project-",
      });
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-orch-rekey-home-",
      });
      const dbPath = path.join(baseDir, "userdata", "state.sqlite");
      yield* fileSystem.makeDirectory(path.dirname(dbPath), { recursive: true });
      const durableProjectId = "prj_durable_rekey_001";

      const seeded = yield* Effect.gen(function* () {
        yield* runMigrations();
        const service = yield* AgentBoardFileSystem;
        const created = yield* service.load({ cwd, createIfMissing: true });
        const interimId = pathScopedProjectId(created.board.projectRoot);
        yield* service.save({
          cwd,
          board: {
            ...created.board,
            cards: [
              {
                id: "REKEY-1",
                title: "Created under path scope",
                state: "Backlog",
                createdAt: "2026-08-31T12:00:00.000Z",
                updatedAt: "2026-08-31T12:00:00.000Z",
              },
            ],
            updatedAt: "2026-08-31T12:00:00.000Z",
          },
        });
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{ readonly projectId: string }>`
          SELECT project_id AS "projectId" FROM agent_boards
        `;
        expect(rows.map((row) => row.projectId)).toEqual([interimId]);
        expect(interimId.startsWith("path:")).toBe(true);
        return { interimId, projectRoot: created.board.projectRoot };
      }).pipe(Effect.provide(makeBoardEnv(cwd, baseDir, dbPath)));

      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          INSERT INTO projection_projects (
            project_id,
            title,
            workspace_root,
            default_model_selection_json,
            scripts_json,
            created_at,
            updated_at,
            deleted_at
          )
          VALUES (
            ${durableProjectId},
            ${"Rekey project"},
            ${seeded.projectRoot},
            ${null},
            ${"[]"},
            ${"2026-08-31T12:10:00.000Z"},
            ${"2026-08-31T12:10:00.000Z"},
            ${null}
          )
        `;

        const service = yield* AgentBoardFileSystem;
        const loaded = yield* service.load({ cwd, createIfMissing: false });
        expect(loaded.board.cards[0]?.id).toBe("REKEY-1");

        const boardRows = yield* sql<{ readonly projectId: string }>`
          SELECT project_id AS "projectId" FROM agent_boards ORDER BY project_id
        `;
        expect(boardRows.map((row) => row.projectId)).toEqual([durableProjectId]);
        expect(boardRows.map((row) => row.projectId)).not.toContain(seeded.interimId);
      }).pipe(Effect.provide(makeBoardEnv(cwd, baseDir, dbPath)));
    }),
  );

  it.effect("save after durable id appears clears stale path-scoped row without load", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-orch-save-race-project-",
      });
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-orch-save-race-home-",
      });
      const dbPath = path.join(baseDir, "userdata", "state.sqlite");
      yield* fileSystem.makeDirectory(path.dirname(dbPath), { recursive: true });
      const durableProjectId = "prj_durable_save_race_001";

      const seeded = yield* Effect.gen(function* () {
        yield* runMigrations();
        const service = yield* AgentBoardFileSystem;
        const created = yield* service.load({ cwd, createIfMissing: true });
        const interimId = pathScopedProjectId(created.board.projectRoot);
        const firstBoard = {
          ...created.board,
          cards: [
            {
              id: "RACE-1",
              title: "Path-scoped first save",
              state: "Backlog" as const,
              createdAt: "2026-08-31T12:00:00.000Z",
              updatedAt: "2026-08-31T12:00:00.000Z",
            },
          ],
          updatedAt: "2026-08-31T12:00:00.000Z",
        };
        yield* service.save({ cwd, board: firstBoard });
        return { interimId, projectRoot: created.board.projectRoot, firstBoard };
      }).pipe(Effect.provide(makeBoardEnv(cwd, baseDir, dbPath)));

      // Durable projection appears; save the pre-existing board WITHOUT load().
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          INSERT INTO projection_projects (
            project_id,
            title,
            workspace_root,
            default_model_selection_json,
            scripts_json,
            created_at,
            updated_at,
            deleted_at
          )
          VALUES (
            ${durableProjectId},
            ${"Save race project"},
            ${seeded.projectRoot},
            ${null},
            ${"[]"},
            ${"2026-08-31T12:10:00.000Z"},
            ${"2026-08-31T12:10:00.000Z"},
            ${null}
          )
        `;

        const service = yield* AgentBoardFileSystem;
        const newestBoard = {
          ...seeded.firstBoard,
          cards: [
            {
              id: "RACE-1",
              title: "Newest board after durable id",
              state: "Ready" as const,
              intentBrief: {
                intent: "Prove save clears path-scoped twin.",
                acceptanceCriteria: ["Exactly one agent_boards row"],
              },
              createdAt: "2026-08-31T12:00:00.000Z",
              updatedAt: "2026-08-31T12:20:00.000Z",
            },
          ],
          updatedAt: "2026-08-31T12:20:00.000Z",
        };
        yield* service.save({ cwd, board: newestBoard });

        const boardRows = yield* sql<{
          readonly projectId: string;
          readonly boardJson: string;
        }>`
          SELECT project_id AS "projectId", board_json AS "boardJson"
          FROM agent_boards
          ORDER BY project_id
        `;
        expect(boardRows).toHaveLength(1);
        expect(boardRows[0]?.projectId).toBe(durableProjectId);
        expect(boardRows[0]?.projectId).not.toBe(seeded.interimId);
        expect(boardRows[0]?.boardJson).toContain("Newest board after durable id");
        expect(boardRows[0]?.boardJson).toContain("RACE-1");

        const loaded = yield* service.load({ cwd, createIfMissing: false });
        expect(loaded.board.cards[0]?.title).toBe("Newest board after durable id");
        expect(loaded.board.updatedAt).toBe("2026-08-31T12:20:00.000Z");

        const afterLoad = yield* sql<{ readonly projectId: string }>`
          SELECT project_id AS "projectId" FROM agent_boards
        `;
        expect(afterLoad.map((row) => row.projectId)).toEqual([durableProjectId]);
      }).pipe(Effect.provide(makeBoardEnv(cwd, baseDir, dbPath)));
    }),
  );

  it.effect("load defensively clears pre-existing durable+path-scoped duplicate rows", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-orch-dup-clean-project-",
      });
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-orch-dup-clean-home-",
      });
      const dbPath = path.join(baseDir, "userdata", "state.sqlite");
      yield* fileSystem.makeDirectory(path.dirname(dbPath), { recursive: true });
      const durableProjectId = "prj_durable_dup_clean_001";

      const seeded = yield* Effect.gen(function* () {
        yield* runMigrations();
        const service = yield* AgentBoardFileSystem;
        const created = yield* service.load({ cwd, createIfMissing: true });
        const interimId = pathScopedProjectId(created.board.projectRoot);
        const board = {
          ...created.board,
          cards: [
            {
              id: "DUP-1",
              title: "Durable wins",
              state: "Backlog" as const,
              createdAt: "2026-08-31T12:00:00.000Z",
              updatedAt: "2026-08-31T12:00:00.000Z",
            },
          ],
          updatedAt: "2026-08-31T12:00:00.000Z",
        };
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          INSERT INTO projection_projects (
            project_id,
            title,
            workspace_root,
            default_model_selection_json,
            scripts_json,
            created_at,
            updated_at,
            deleted_at
          )
          VALUES (
            ${durableProjectId},
            ${"Dup clean project"},
            ${created.board.projectRoot},
            ${null},
            ${"[]"},
            ${"2026-08-31T12:10:00.000Z"},
            ${"2026-08-31T12:10:00.000Z"},
            ${null}
          )
        `;
        // Simulate a historical race: both durable and interim rows exist.
        yield* service.save({ cwd, board });
        const staleInterimJson = JSON.stringify({
          schemaVersion: 1,
          projectRoot: created.board.projectRoot,
          cards: [
            {
              id: "STALE",
              title: "Stale interim",
              state: "Backlog",
              createdAt: "2026-08-31T11:00:00.000Z",
              updatedAt: "2026-08-31T11:00:00.000Z",
            },
          ],
          createdAt: "2026-08-31T11:00:00.000Z",
          updatedAt: "2026-08-31T11:00:00.000Z",
        });
        yield* sql`
          INSERT INTO agent_boards (project_id, project_root, board_json, created_at, updated_at)
          VALUES (
            ${interimId},
            ${created.board.projectRoot},
            ${staleInterimJson},
            ${"2026-08-31T11:00:00.000Z"},
            ${"2026-08-31T11:00:00.000Z"}
          )
        `;
        const before = yield* sql<{ readonly projectId: string }>`
          SELECT project_id AS "projectId" FROM agent_boards ORDER BY project_id
        `;
        expect(before.map((row) => row.projectId).sort()).toEqual(
          [durableProjectId, interimId].sort(),
        );
        return { interimId };
      }).pipe(Effect.provide(makeBoardEnv(cwd, baseDir, dbPath)));

      yield* Effect.gen(function* () {
        const service = yield* AgentBoardFileSystem;
        const loaded = yield* service.load({ cwd, createIfMissing: false });
        expect(loaded.board.cards[0]?.id).toBe("DUP-1");
        expect(loaded.board.cards[0]?.title).toBe("Durable wins");

        const sql = yield* SqlClient.SqlClient;
        const after = yield* sql<{ readonly projectId: string }>`
          SELECT project_id AS "projectId" FROM agent_boards
        `;
        expect(after.map((row) => row.projectId)).toEqual([durableProjectId]);
        expect(after.map((row) => row.projectId)).not.toContain(seeded.interimId);
      }).pipe(Effect.provide(makeBoardEnv(cwd, baseDir, dbPath)));
    }),
  );
});
