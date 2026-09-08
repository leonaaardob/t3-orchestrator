import {
  AgentBoardFile,
  CommandId,
  MessageId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationShellSnapshot,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { forkParked } from "../../serverActivation.ts";
import { OrchestrationCommandInvariantError } from "../../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  buildSupervisorWakeMessage,
  supervisorWakeFingerprint,
  decodeSupervisorWakeCardIds,
  encodeSupervisorWakeCardIds,
  SUPERVISOR_WAKE_MAX_DISPATCH_ATTEMPTS,
  SUPERVISOR_WAKE_RETRY_BASE_DELAY_MS,
  SUPERVISOR_WAKE_RETRY_MAX_DELAY_MS,
} from "../supervisorWake.ts";
import {
  AgentBoardSupervisorWake,
  type AgentBoardSupervisorWakeShape,
} from "../Services/AgentBoardSupervisorWake.ts";

const DEFAULT_WAKE_INTERVAL_MS = 1_000;
const decodeBoard = Schema.decodeUnknownEffect(Schema.fromJsonString(AgentBoardFile));
const isCommandInvariantError = Schema.is(OrchestrationCommandInvariantError);

interface WakeRow {
  readonly projectId: string;
  readonly projectRoot: string;
  readonly pendingFingerprint: string | null;
  readonly pendingCardIdsJson: string;
  readonly pendingReason: string | null;
  readonly dispatchCommandId: string | null;
  readonly dispatchFingerprint: string | null;
  readonly dispatchThreadId: string | null;
  readonly dispatchMessageId: string | null;
  readonly dispatchMessageText: string | null;
  readonly dispatchRuntimeMode: string | null;
  readonly dispatchInteractionMode: string | null;
  readonly dispatchCreatedAt: string | null;
  readonly dispatchAttempts: number;
  readonly nextAttemptAt: string | null;
  readonly lastError: string | null;
}

export interface AgentBoardSupervisorWakeLiveOptions {
  readonly intervalMs?: number;
  /** Narrow crash seam: the accepted engine receipt exists before markSuccess. */
  readonly afterDispatchBeforeMarkSuccess?: Effect.Effect<void, OrchestrationCommandInvariantError>;
  /** Test-only observation seam; the actual engine dispatch remains unchanged. */
  readonly beforeDispatch?: (
    command: OrchestrationCommand,
  ) => Effect.Effect<void, OrchestrationCommandInvariantError>;
}

const make = (options?: AgentBoardSupervisorWakeLiveOptions) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const projection = yield* ProjectionSnapshotQuery;
    const engine = yield* OrchestrationEngineService;
    const crypto = yield* Crypto.Crypto;
    const semaphore = yield* Semaphore.make(1);
    const intervalMs = Math.max(100, options?.intervalMs ?? DEFAULT_WAKE_INTERVAL_MS);
    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const nextUuid = Effect.orDie(crypto.randomUUIDv4);

    const listPending = Effect.fn("AgentBoardSupervisorWake.listPending")(function* () {
      return yield* sql<WakeRow>`
        SELECT
          project_id AS "projectId",
          project_root AS "projectRoot",
          pending_fingerprint AS "pendingFingerprint",
          pending_card_ids_json AS "pendingCardIdsJson",
          pending_reason AS "pendingReason",
          dispatch_command_id AS "dispatchCommandId",
          dispatch_fingerprint AS "dispatchFingerprint",
          dispatch_thread_id AS "dispatchThreadId",
          dispatch_message_id AS "dispatchMessageId",
          dispatch_message_text AS "dispatchMessageText",
          dispatch_runtime_mode AS "dispatchRuntimeMode",
          dispatch_interaction_mode AS "dispatchInteractionMode",
          dispatch_created_at AS "dispatchCreatedAt",
          dispatch_attempts AS "dispatchAttempts",
          next_attempt_at AS "nextAttemptAt",
          last_error AS "lastError"
        FROM agent_board_supervisor_wakes
        WHERE pending_fingerprint IS NOT NULL
        ORDER BY updated_at ASC
      `;
    });

    /** Existing cards are eligible once after migration, but only if a live Supervisor exists. */
    const seedExistingBoards = Effect.fn("AgentBoardSupervisorWake.seedExistingBoards")(
      function* () {
        const rows = yield* sql<{
          readonly projectId: string;
          readonly projectRoot: string;
          readonly boardJson: string;
          readonly updatedAt: string;
        }>`
        SELECT
          boards.project_id AS "projectId",
          boards.project_root AS "projectRoot",
          boards.board_json AS "boardJson",
          boards.updated_at AS "updatedAt"
        FROM agent_boards AS boards
        LEFT JOIN agent_board_supervisor_wakes AS wakes
          ON wakes.project_id = boards.project_id
        WHERE wakes.project_id IS NULL
      `;
        for (const row of rows) {
          const board = yield* decodeBoard(row.boardJson).pipe(
            Effect.match({
              onFailure: () => Option.none(),
              onSuccess: (value) => Option.some(value),
            }),
          );
          if (Option.isNone(board)) continue;
          const cardIds = board.value.cards
            .filter(
              (card) =>
                card.state === "Review" ||
                card.state === "Blocked" ||
                card.state === "Needs Decision",
            )
            .map((card) => card.id)
            .sort();
          if (cardIds.length === 0) continue;
          yield* sql`
          INSERT OR IGNORE INTO agent_board_supervisor_wakes (
            project_id, project_root, pending_fingerprint,
            pending_card_ids_json, pending_reason, dispatch_command_id,
            dispatch_attempts, next_attempt_at, last_dispatched_fingerprint,
            last_error, updated_at
          ) VALUES (
            ${row.projectId}, ${row.projectRoot}, ${supervisorWakeFingerprint(board.value)},
            ${encodeSupervisorWakeCardIds(cardIds)}, ${"Existing board result awaiting Supervisor follow-up."},
            NULL, 0, NULL, NULL, NULL, ${row.updatedAt}
          )
        `;
        }
      },
    );

    const markAttempt = Effect.fn("AgentBoardSupervisorWake.markAttempt")(function* (input: {
      readonly row: WakeRow;
      readonly commandId: string;
      readonly threadId: string;
      readonly messageId: string;
      readonly messageText: string;
      readonly runtimeMode: string;
      readonly interactionMode: string;
      readonly createdAt: string;
      readonly attempts: number;
      readonly updatedAt: string;
    }) {
      const dispatchFingerprint = input.row.dispatchFingerprint ?? input.row.pendingFingerprint;
      const claimed = yield* sql<{ readonly pendingFingerprint: string }>`
        UPDATE agent_board_supervisor_wakes
        SET dispatch_command_id = ${input.commandId},
            dispatch_fingerprint = ${dispatchFingerprint},
            dispatch_thread_id = ${input.threadId},
            dispatch_message_id = ${input.messageId},
            dispatch_message_text = ${input.messageText},
            dispatch_runtime_mode = ${input.runtimeMode},
            dispatch_interaction_mode = ${input.interactionMode},
            dispatch_created_at = ${input.createdAt},
            dispatch_attempts = ${input.attempts},
            next_attempt_at = NULL,
            last_error = NULL,
            updated_at = ${input.updatedAt}
        WHERE project_id = ${input.row.projectId}
          AND pending_fingerprint = ${input.row.pendingFingerprint}
          AND (dispatch_fingerprint IS NULL OR dispatch_fingerprint = ${dispatchFingerprint})
        RETURNING pending_fingerprint AS "pendingFingerprint"
      `;
      return claimed.length === 1;
    });

    const markSuccess = Effect.fn("AgentBoardSupervisorWake.markSuccess")(function* (input: {
      readonly row: WakeRow;
      readonly updatedAt: string;
    }) {
      const dispatchFingerprint = input.row.dispatchFingerprint ?? input.row.pendingFingerprint;
      const resolved = yield* sql<{ readonly projectId: string }>`
        UPDATE agent_board_supervisor_wakes
        SET pending_fingerprint = CASE
              WHEN pending_fingerprint = ${dispatchFingerprint} THEN NULL
              ELSE pending_fingerprint
            END,
            pending_card_ids_json = CASE
              WHEN pending_fingerprint = ${dispatchFingerprint} THEN '[]'
              ELSE pending_card_ids_json
            END,
            pending_reason = CASE
              WHEN pending_fingerprint = ${dispatchFingerprint} THEN NULL
              ELSE pending_reason
            END,
            dispatch_command_id = NULL,
            dispatch_fingerprint = NULL,
            dispatch_thread_id = NULL,
            dispatch_message_id = NULL,
            dispatch_message_text = NULL,
            dispatch_runtime_mode = NULL,
            dispatch_interaction_mode = NULL,
            dispatch_created_at = NULL,
            dispatch_attempts = 0,
            next_attempt_at = NULL,
            last_dispatched_fingerprint = ${dispatchFingerprint},
            last_error = NULL,
            updated_at = ${input.updatedAt}
        WHERE project_id = ${input.row.projectId}
          AND dispatch_fingerprint = ${dispatchFingerprint}
        RETURNING project_id AS "projectId"
      `;
      return resolved.length === 1;
    });

    const markDeferred = Effect.fn("AgentBoardSupervisorWake.markDeferred")(function* (input: {
      readonly row: WakeRow;
      readonly detail: string;
      readonly updatedAt: string;
    }) {
      const dispatchFingerprint = input.row.dispatchFingerprint ?? input.row.pendingFingerprint;
      const now = yield* DateTime.now;
      const nextAttemptAt = DateTime.formatIso(
        DateTime.add(now, { milliseconds: SUPERVISOR_WAKE_RETRY_BASE_DELAY_MS }),
      );
      yield* sql`
        UPDATE agent_board_supervisor_wakes
        SET dispatch_command_id = NULL,
            dispatch_fingerprint = NULL,
            dispatch_thread_id = NULL,
            dispatch_message_id = NULL,
            dispatch_message_text = NULL,
            dispatch_runtime_mode = NULL,
            dispatch_interaction_mode = NULL,
            dispatch_created_at = NULL,
            dispatch_attempts = CASE
              WHEN pending_fingerprint = ${dispatchFingerprint}
                THEN ${input.row.dispatchAttempts}
              ELSE 0
            END,
            next_attempt_at = ${nextAttemptAt},
            last_error = ${input.detail.slice(0, 2_000)},
            updated_at = ${input.updatedAt}
        WHERE project_id = ${input.row.projectId}
          AND dispatch_fingerprint = ${dispatchFingerprint}
      `;
    });

    const markFailure = Effect.fn("AgentBoardSupervisorWake.markFailure")(function* (input: {
      readonly row: WakeRow;
      readonly attempts: number;
      readonly detail: string;
      readonly updatedAt: string;
    }) {
      const dispatchFingerprint = input.row.dispatchFingerprint ?? input.row.pendingFingerprint;
      const exhausted = input.attempts >= SUPERVISOR_WAKE_MAX_DISPATCH_ATTEMPTS;
      const now = yield* DateTime.now;
      const delay = Math.min(
        SUPERVISOR_WAKE_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, input.attempts - 1),
        SUPERVISOR_WAKE_RETRY_MAX_DELAY_MS,
      );
      const nextAttemptAt = exhausted
        ? null
        : DateTime.formatIso(DateTime.add(now, { milliseconds: delay }));
      yield* sql`
        UPDATE agent_board_supervisor_wakes
        SET dispatch_command_id = CASE
              WHEN ${exhausted ? 1 : 0} = 1
                AND pending_fingerprint != ${dispatchFingerprint}
                THEN NULL
              ELSE dispatch_command_id
            END,
            dispatch_fingerprint = CASE
              WHEN ${exhausted ? 1 : 0} = 1
                AND pending_fingerprint != ${dispatchFingerprint}
                THEN NULL
              ELSE dispatch_fingerprint
            END,
            dispatch_thread_id = CASE
              WHEN ${exhausted ? 1 : 0} = 1
                AND pending_fingerprint != ${dispatchFingerprint}
                THEN NULL
              ELSE dispatch_thread_id
            END,
            dispatch_message_id = CASE
              WHEN ${exhausted ? 1 : 0} = 1
                AND pending_fingerprint != ${dispatchFingerprint}
                THEN NULL
              ELSE dispatch_message_id
            END,
            dispatch_message_text = CASE
              WHEN ${exhausted ? 1 : 0} = 1
                AND pending_fingerprint != ${dispatchFingerprint}
                THEN NULL
              ELSE dispatch_message_text
            END,
            dispatch_runtime_mode = CASE
              WHEN ${exhausted ? 1 : 0} = 1
                AND pending_fingerprint != ${dispatchFingerprint}
                THEN NULL
              ELSE dispatch_runtime_mode
            END,
            dispatch_interaction_mode = CASE
              WHEN ${exhausted ? 1 : 0} = 1
                AND pending_fingerprint != ${dispatchFingerprint}
                THEN NULL
              ELSE dispatch_interaction_mode
            END,
            dispatch_created_at = CASE
              WHEN ${exhausted ? 1 : 0} = 1
                AND pending_fingerprint != ${dispatchFingerprint}
                THEN NULL
              ELSE dispatch_created_at
            END,
            dispatch_attempts = CASE
              WHEN ${exhausted ? 1 : 0} = 1
                AND pending_fingerprint != ${dispatchFingerprint}
                THEN 0
              ELSE ${input.attempts}
            END,
            next_attempt_at = CASE
              WHEN ${exhausted ? 1 : 0} = 1
                AND pending_fingerprint != ${dispatchFingerprint}
                THEN NULL
              ELSE ${nextAttemptAt}
            END,
            last_error = ${input.detail.slice(0, 2_000)},
            updated_at = ${input.updatedAt}
        WHERE project_id = ${input.row.projectId}
          AND dispatch_fingerprint = ${dispatchFingerprint}
      `;
      yield* Effect.logWarning(
        exhausted
          ? "agentBoard.supervisorWake.dispatch-exhausted"
          : "agentBoard.supervisorWake.dispatch-failed",
        {
          projectId: input.row.projectId,
          attempts: input.attempts,
          nextAttemptAt,
          detail: input.detail,
        },
      );
    });

    const processOne = Effect.fn("AgentBoardSupervisorWake.processOne")(function* (input: {
      readonly row: WakeRow;
      readonly shell: OrchestrationShellSnapshot;
    }) {
      if (input.row.pendingFingerprint === null) return;
      const row = input.row;
      const now = yield* DateTime.now;
      if (row.nextAttemptAt !== null && Date.parse(row.nextAttemptAt) > now.epochMilliseconds)
        return;
      if (row.dispatchAttempts >= SUPERVISOR_WAKE_MAX_DISPATCH_ATTEMPTS && row.lastError !== null)
        return;

      const thread = input.shell.threads.find(
        (candidate) =>
          candidate.projectId === input.row.projectId &&
          candidate.role === "project-supervisor" &&
          candidate.archivedAt === null,
      );
      if (thread === undefined) return;
      if (thread.settledOverride === "settled") return;
      if (thread.snoozedUntil != null) return;
      if (thread.hasPendingApprovals || thread.hasPendingUserInput) return;
      if (
        thread.latestTurn?.state === "running" ||
        thread.latestTurn?.state === "interrupted" ||
        thread.session?.status === "interrupted" ||
        thread.session?.status === "stopped" ||
        thread.session?.activeTurnId != null
      )
        return;

      const attempts = row.dispatchAttempts + 1;
      const newEnvelope = row.dispatchFingerprint === null;
      const commandId = row.dispatchCommandId ?? (yield* nextUuid);
      const timestamp = row.dispatchCreatedAt ?? (yield* nowIso);
      const messageId = row.dispatchMessageId ?? (yield* nextUuid);
      const cardIds = decodeSupervisorWakeCardIds(row.pendingCardIdsJson);
      const messageText =
        row.dispatchMessageText ??
        buildSupervisorWakeMessage({
          cardIds,
          reason: row.pendingReason ?? "A board execution result changed.",
        });
      const threadId = row.dispatchThreadId ?? thread.id;
      const runtimeMode = row.dispatchRuntimeMode ?? thread.runtimeMode;
      const interactionMode = row.dispatchInteractionMode ?? thread.interactionMode;
      if (
        !newEnvelope &&
        (row.dispatchThreadId === null ||
          row.dispatchMessageId === null ||
          row.dispatchMessageText === null ||
          row.dispatchRuntimeMode === null ||
          row.dispatchInteractionMode === null ||
          row.dispatchCreatedAt === null ||
          row.dispatchFingerprint === null)
      )
        return;
      const claimed = yield* markAttempt({
        row,
        commandId,
        threadId,
        messageId,
        messageText,
        runtimeMode,
        interactionMode,
        createdAt: timestamp,
        attempts,
        updatedAt: yield* nowIso,
      });
      if (!claimed) return;

      const command = {
        type: "thread.turn.start" as const,
        commandId: CommandId.make(commandId),
        threadId: ThreadId.make(threadId),
        message: {
          messageId: MessageId.make(messageId),
          role: "user" as const,
          text: messageText,
          attachments: [],
        },
        runtimeMode: runtimeMode as typeof thread.runtimeMode,
        interactionMode: interactionMode as typeof thread.interactionMode,
        onlyIfIdle: true,
        createdAt: timestamp,
      } satisfies OrchestrationCommand;
      if (options?.beforeDispatch !== undefined) {
        yield* options.beforeDispatch(command);
      }
      const dispatched = yield* Effect.matchEffect(engine.dispatch(command), {
        onFailure: (error) => Effect.succeed({ _tag: "error" as const, error }),
        onSuccess: () => Effect.succeed({ _tag: "ok" as const }),
      });
      if (dispatched._tag === "ok") {
        if (options?.afterDispatchBeforeMarkSuccess !== undefined) {
          yield* options.afterDispatchBeforeMarkSuccess;
        }
        const resolved = yield* markSuccess({
          row,
          updatedAt: yield* nowIso,
        });
        if (!resolved) return;
        yield* Effect.logInfo("agentBoard.supervisorWake.dispatched", {
          projectId: row.projectId,
          threadId: thread.id,
          cardIds,
        });
      } else {
        const detail = String(dispatched.error);
        if (
          isCommandInvariantError(dispatched.error) &&
          dispatched.error.detail.includes("unavailable for an automatic Supervisor follow-up")
        ) {
          yield* markDeferred({ row, detail, updatedAt: yield* nowIso });
        } else {
          yield* markFailure({
            row,
            attempts,
            detail,
            updatedAt: yield* nowIso,
          });
        }
      }
    });

    const processPending: AgentBoardSupervisorWakeShape["processPending"] = () =>
      semaphore
        .withPermits(1)(
          Effect.gen(function* () {
            yield* seedExistingBoards();
            const pending = yield* listPending();
            if (pending.length === 0) return;
            const shell = yield* projection.getShellSnapshot();
            for (const row of pending) {
              yield* processOne({ row, shell }).pipe(
                Effect.catch((error) =>
                  Effect.logWarning("agentBoard.supervisorWake.process-failed", {
                    projectId: row.projectId,
                    error,
                  }),
                ),
              );
            }
          }),
        )
        .pipe(
          Effect.catch((error) => Effect.logWarning("agentBoard.supervisorWake.failed", { error })),
        );

    const start: AgentBoardSupervisorWakeShape["start"] = () =>
      Effect.gen(function* () {
        yield* forkParked(
          processPending().pipe(
            Effect.andThen(
              Effect.forever(Effect.sleep(intervalMs).pipe(Effect.andThen(processPending))),
            ),
          ),
        );
        yield* Effect.logInfo("agentBoard.supervisorWake.started", { intervalMs });
      });

    return { start, processPending } satisfies AgentBoardSupervisorWakeShape;
  });

export const makeAgentBoardSupervisorWakeLive = (options?: AgentBoardSupervisorWakeLiveOptions) =>
  Layer.effect(AgentBoardSupervisorWake, make(options));

export const AgentBoardSupervisorWakeLive = makeAgentBoardSupervisorWakeLive();
