import { assert, describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Fiber, Layer } from "effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  AgentBoardFile,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
  type OrchestrationShellSnapshot,
} from "@t3tools/contracts";

import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import { runMigrations } from "../../persistence/Migrations.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { AgentBoardSupervisorWake } from "../Services/AgentBoardSupervisorWake.ts";
import { makeAgentBoardSupervisorWakeLive } from "./AgentBoardSupervisorWake.ts";

const PROJECT_ID = ProjectId.make("project-wake-test");
const THREAD_ID = ThreadId.make("supervisor-wake-test");
const NOW = "2026-09-08T00:00:00.000Z";
const decodeAgentBoardFile = Schema.decodeUnknownEffect(AgentBoardFile);
const encodeAgentBoardFileJson = Schema.encodeEffect(Schema.fromJsonString(AgentBoardFile));

const supervisor = {
  id: THREAD_ID,
  projectId: PROJECT_ID,
  title: "Project Supervisor",
  role: "project-supervisor",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
} as OrchestrationThreadShell;

const shell = (
  thread: OrchestrationThreadShell | undefined = supervisor,
): OrchestrationShellSnapshot => ({
  snapshotSequence: 1,
  projects: [],
  threads: thread === undefined ? [] : [thread],
  updatedAt: NOW,
});

const emptyShell = (): OrchestrationShellSnapshot => ({
  snapshotSequence: 1,
  projects: [],
  threads: [],
  updatedAt: NOW,
});

const insertWake = Effect.fn("AgentBoardSupervisorWake.test.insertWake")(function* (input: {
  readonly fingerprint: string;
  readonly commandId?: string;
}) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO agent_board_supervisor_wakes (
      project_id, project_root, pending_fingerprint, pending_card_ids_json,
      pending_reason, dispatch_command_id, dispatch_attempts, next_attempt_at,
      last_dispatched_fingerprint, last_error, updated_at
    ) VALUES (
      ${PROJECT_ID}, '/project', ${input.fingerprint}, '["CARD-1"]',
      'CARD-1: Review', ${input.commandId ?? null}, 0, NULL, NULL, NULL, ${NOW}
    )
  `;
});

const makeTestLayer = (
  dispatch: (command: OrchestrationCommand) => Effect.Effect<{ sequence: number }, unknown>,
  getShellSnapshot: () => OrchestrationShellSnapshot = () => shell(),
) =>
  makeAgentBoardSupervisorWakeLive().pipe(
    Layer.provideMerge(NodeSqliteClient.layerMemory()),
    Layer.provideMerge(
      Layer.succeed(ProjectionSnapshotQuery, {
        getShellSnapshot: () => Effect.succeed(getShellSnapshot()),
      } as never),
    ),
    Layer.provideMerge(Layer.succeed(OrchestrationEngineService, { dispatch } as never)),
    Layer.provideMerge(NodeServices.layer),
  );

describe("AgentBoardSupervisorWake", () => {
  it.effect("dispatches once and clears the receipt-backed pending row", () => {
    const commands: OrchestrationCommand[] = [];
    return Effect.gen(function* () {
      yield* runMigrations();
      yield* insertWake({ fingerprint: "wake-once" });
      const wake = yield* AgentBoardSupervisorWake;
      yield* wake.processPending();
      yield* wake.processPending();
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly pendingFingerprint: string | null }>`
        SELECT pending_fingerprint AS "pendingFingerprint"
        FROM agent_board_supervisor_wakes WHERE project_id = ${PROJECT_ID}
      `;
      expect(commands).toHaveLength(1);
      assert.deepEqual(rows, [{ pendingFingerprint: null }]);
    }).pipe(
      Effect.provide(
        makeTestLayer((command) =>
          Effect.sync(() => {
            commands.push(command);
            return { sequence: 1 };
          }),
        ),
      ),
    );
  });

  it.effect("keeps a pending wake while the Supervisor turn is active", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      yield* insertWake({ fingerprint: "guarded" });
      const wake = yield* AgentBoardSupervisorWake;
      yield* wake.processPending();
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly pendingFingerprint: string | null }>`
        SELECT pending_fingerprint AS "pendingFingerprint"
        FROM agent_board_supervisor_wakes WHERE project_id = ${PROJECT_ID}
      `;
      expect(rows[0]?.pendingFingerprint).toBe("guarded");
    }).pipe(
      Effect.provide(
        makeTestLayer(
          () => Effect.succeed({ sequence: 1 }),
          () =>
            shell({ ...supervisor, latestTurn: { state: "running" } } as OrchestrationThreadShell),
        ),
      ),
    ),
  );

  it.effect(
    "does not wake a settled, snoozed, stopped/interrupted, absent, or approval-gated Supervisor",
    () =>
      Effect.forEach(
        [
          { ...supervisor, settledOverride: "settled" },
          { ...supervisor, snoozedUntil: "2026-09-09T00:00:00.000Z" },
          { ...supervisor, latestTurn: { state: "interrupted" } },
          { ...supervisor, session: { status: "interrupted", activeTurnId: null } },
          { ...supervisor, session: { status: "stopped", activeTurnId: null } },
          { ...supervisor, hasPendingApprovals: true },
          { ...supervisor, hasPendingUserInput: true },
          undefined,
        ] as ReadonlyArray<OrchestrationThreadShell | undefined>,
        (thread) =>
          Effect.gen(function* () {
            yield* runMigrations();
            yield* insertWake({
              fingerprint: `guarded-${thread?.id ?? "absent"}-${thread?.settledOverride ?? "active"}`,
            });
            const wake = yield* AgentBoardSupervisorWake;
            yield* wake.processPending();
            const sql = yield* SqlClient.SqlClient;
            const rows = yield* sql<{ readonly pendingFingerprint: string | null }>`
            SELECT pending_fingerprint AS "pendingFingerprint"
            FROM agent_board_supervisor_wakes WHERE project_id = ${PROJECT_ID}
          `;
            expect(rows[0]?.pendingFingerprint).toContain("guarded-");
          }).pipe(
            Effect.provide(
              makeTestLayer(
                () => Effect.succeed({ sequence: 1 }),
                () => (thread === undefined ? emptyShell() : shell(thread)),
              ),
            ),
          ),
        { concurrency: 1 },
      ),
  );

  it.effect("does not leave a later wake blocked after an accepted dispatch receipt", () => {
    const commands: OrchestrationCommand[] = [];
    return Effect.gen(function* () {
      yield* runMigrations();
      yield* insertWake({ fingerprint: "first-wake" });
      const wake = yield* AgentBoardSupervisorWake;
      const sql = yield* SqlClient.SqlClient;
      yield* wake.processPending();
      yield* sql`
        UPDATE agent_board_supervisor_wakes
        SET pending_fingerprint = 'second-wake',
            pending_card_ids_json = '["CARD-2"]',
            pending_reason = 'CARD-2: Blocked',
            dispatch_command_id = NULL,
            dispatch_attempts = 0,
            next_attempt_at = NULL
        WHERE project_id = ${PROJECT_ID}
      `;

      yield* wake.processPending();
      expect(commands).toHaveLength(2);
      expect(
        commands.every(
          (command) => command.type === "thread.turn.start" && command.onlyIfIdle === true,
        ),
      ).toBe(true);
    }).pipe(
      Effect.provide(
        makeTestLayer(
          (command) =>
            Effect.sync(() => {
              commands.push(command);
              return { sequence: commands.length };
            }),
          () => shell(),
        ),
      ),
    );
  });

  it.effect("preserves the in-flight envelope while a newer result arrives during dispatch", () => {
    const commands: OrchestrationCommand[] = [];
    let signalDispatchStarted!: () => void;
    let releaseDispatch!: () => void;
    const dispatchStarted = new Promise<void>((resolve) => {
      signalDispatchStarted = resolve;
    });
    const dispatchRelease = new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    });

    return Effect.gen(function* () {
      yield* runMigrations();
      yield* insertWake({ fingerprint: "in-flight-first" });
      const wake = yield* AgentBoardSupervisorWake;
      const sql = yield* SqlClient.SqlClient;
      const processing = wake.processPending();
      const fiber = yield* processing.pipe(Effect.forkChild);

      yield* Effect.promise(() => dispatchStarted);
      yield* sql`
        UPDATE agent_board_supervisor_wakes
        SET pending_fingerprint = 'in-flight-second',
            pending_card_ids_json = '["CARD-2"]',
            pending_reason = 'CARD-2: Blocked'
        WHERE project_id = ${PROJECT_ID}
      `;
      const duringDispatch = yield* sql<{
        readonly pendingFingerprint: string;
        readonly dispatchFingerprint: string | null;
        readonly dispatchCommandId: string | null;
        readonly dispatchMessageId: string | null;
        readonly dispatchMessageText: string | null;
        readonly dispatchCreatedAt: string | null;
      }>`
        SELECT
          pending_fingerprint AS "pendingFingerprint",
          dispatch_fingerprint AS "dispatchFingerprint",
          dispatch_command_id AS "dispatchCommandId",
          dispatch_message_id AS "dispatchMessageId",
          dispatch_message_text AS "dispatchMessageText",
          dispatch_created_at AS "dispatchCreatedAt"
        FROM agent_board_supervisor_wakes
        WHERE project_id = ${PROJECT_ID}
      `;
      const firstCommand = commands[0];
      if (firstCommand?.type !== "thread.turn.start") {
        return yield* Effect.die("expected the first dispatch to be in flight");
      }
      expect(duringDispatch).toEqual([
        {
          pendingFingerprint: "in-flight-second",
          dispatchFingerprint: "in-flight-first",
          dispatchCommandId: firstCommand.commandId,
          dispatchMessageId: firstCommand.message.messageId,
          dispatchMessageText: firstCommand.message.text,
          dispatchCreatedAt: firstCommand.createdAt,
        },
      ]);

      releaseDispatch();
      yield* Fiber.join(fiber);
      const afterFirst = yield* sql<{
        readonly pendingFingerprint: string | null;
        readonly dispatchFingerprint: string | null;
        readonly dispatchCommandId: string | null;
      }>`
        SELECT
          pending_fingerprint AS "pendingFingerprint",
          dispatch_fingerprint AS "dispatchFingerprint",
          dispatch_command_id AS "dispatchCommandId"
        FROM agent_board_supervisor_wakes
        WHERE project_id = ${PROJECT_ID}
      `;
      expect(afterFirst).toEqual([
        {
          pendingFingerprint: "in-flight-second",
          dispatchFingerprint: null,
          dispatchCommandId: null,
        },
      ]);

      yield* wake.processPending();
      expect(commands).toHaveLength(2);
      const secondCommand = commands[1];
      if (secondCommand?.type !== "thread.turn.start") {
        return yield* Effect.die("expected the second dispatch to be a turn start");
      }
      expect(secondCommand.commandId).not.toBe(firstCommand.commandId);
      expect(secondCommand.message.text).toContain("CARD-2");
    }).pipe(
      Effect.provide(
        makeTestLayer((command) =>
          Effect.promise(async () => {
            commands.push(command);
            signalDispatchStarted();
            await dispatchRelease;
            return { sequence: commands.length };
          }),
        ),
      ),
    );
  });

  it.effect("seeds a valid persisted board JSON result once after migration", () => {
    const commands: OrchestrationCommand[] = [];
    return Effect.gen(function* () {
      yield* runMigrations();
      const sql = yield* SqlClient.SqlClient;
      const seededBoard = yield* decodeAgentBoardFile({
        schemaVersion: 1,
        projectRoot: "/project",
        defaultView: "kanban",
        runner: { maxConcurrentCards: 1, repairCycles: 3 },
        cards: [
          {
            id: "TASK-20260908-seeded-result",
            title: "Seeded result",
            state: "Review",
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        graphLinks: [],
        createdAt: NOW,
        updatedAt: NOW,
      });
      const boardJson = yield* encodeAgentBoardFileJson(seededBoard);
      yield* sql`
        INSERT INTO agent_boards (project_id, project_root, board_json, created_at, updated_at)
        VALUES (
          ${PROJECT_ID}, '/project', ${boardJson}, ${NOW}, ${NOW}
        )
      `;
      const wake = yield* AgentBoardSupervisorWake;
      yield* wake.processPending();
      expect(commands).toHaveLength(1);
    }).pipe(
      Effect.provide(
        makeTestLayer((command) =>
          Effect.sync(() => {
            commands.push(command);
            return { sequence: 1 };
          }),
        ),
      ),
    );
  });

  it.effect("retries with one command id and parks after bounded dispatch failures", () => {
    const commands: OrchestrationCommand[] = [];
    return Effect.gen(function* () {
      yield* runMigrations();
      yield* insertWake({ fingerprint: "wake-failure" });
      const wake = yield* AgentBoardSupervisorWake;
      const sql = yield* SqlClient.SqlClient;

      yield* wake.processPending();
      yield* sql`
        UPDATE agent_board_supervisor_wakes
        SET next_attempt_at = '1970-01-01T00:00:00.000Z'
        WHERE project_id = ${PROJECT_ID}
      `;
      yield* wake.processPending();
      yield* sql`
        UPDATE agent_board_supervisor_wakes
        SET next_attempt_at = '1970-01-01T00:00:00.000Z'
        WHERE project_id = ${PROJECT_ID}
      `;
      yield* wake.processPending();

      const rows = yield* sql<{
        readonly pendingFingerprint: string | null;
        readonly dispatchAttempts: number;
        readonly dispatchCommandId: string | null;
        readonly nextAttemptAt: string | null;
        readonly lastError: string | null;
        readonly dispatchThreadId: string | null;
        readonly dispatchMessageId: string | null;
        readonly dispatchMessageText: string | null;
        readonly dispatchRuntimeMode: string | null;
        readonly dispatchInteractionMode: string | null;
        readonly dispatchCreatedAt: string | null;
      }>`
        SELECT
          pending_fingerprint AS "pendingFingerprint",
          dispatch_attempts AS "dispatchAttempts",
          dispatch_command_id AS "dispatchCommandId",
          next_attempt_at AS "nextAttemptAt",
          last_error AS "lastError",
          dispatch_thread_id AS "dispatchThreadId",
          dispatch_message_id AS "dispatchMessageId",
          dispatch_message_text AS "dispatchMessageText",
          dispatch_runtime_mode AS "dispatchRuntimeMode",
          dispatch_interaction_mode AS "dispatchInteractionMode",
          dispatch_created_at AS "dispatchCreatedAt"
        FROM agent_board_supervisor_wakes WHERE project_id = ${PROJECT_ID}
      `;
      expect(commands).toHaveLength(3);
      expect(new Set(commands.map((command) => command.commandId))).toHaveLength(1);
      expect(commands[1]).toEqual(commands[0]);
      expect(commands[2]).toEqual(commands[0]);
      const firstCommand = commands[0];
      if (firstCommand?.type !== "thread.turn.start")
        return yield* Effect.die("expected wake command");
      assert.deepEqual(rows, [
        {
          pendingFingerprint: "wake-failure",
          dispatchAttempts: 3,
          dispatchCommandId: commands[0]?.commandId ?? null,
          nextAttemptAt: null,
          lastError: "dispatch failed",
          dispatchThreadId: THREAD_ID,
          dispatchMessageId: firstCommand.message.messageId,
          dispatchMessageText: firstCommand.message.text,
          dispatchRuntimeMode: "full-access",
          dispatchInteractionMode: "default",
          dispatchCreatedAt: firstCommand.createdAt,
        },
      ]);
    }).pipe(
      Effect.provide(
        makeTestLayer((command) =>
          Effect.gen(function* () {
            commands.push(command);
            return yield* Effect.fail("dispatch failed");
          }),
        ),
      ),
    );
  });
});
