import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";

import {
  type AgentBoardCard,
  type AgentBoardFile,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  ThreadId,
} from "@t3tools/contracts";
import {
  buildAgentBoardRepairPrompt,
  buildAgentBoardReviewPrompt,
  buildAgentBoardReviewThreadTitle,
  parseAgentBoardReviewResult,
} from "@t3tools/shared/agentBoardPrompt";
import {
  MISSING_WORKER_CONFIG_ERROR,
  resolveWorkerModelSelection,
} from "@t3tools/shared/agentBoardRunner";
import { projectScriptCwd } from "@t3tools/shared/projectScripts";

import { forkParked } from "../../serverActivation.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { AgentBoardFileSystem } from "../Services/AgentBoardFileSystem.ts";
import { AgentBoardRunner } from "../Services/AgentBoardRunner.ts";
import {
  AgentBoardScheduler,
  type AgentBoardSchedulerShape,
} from "../Services/AgentBoardScheduler.ts";

/** Fixed poll interval; mirrors `WORKFLOW.md` `polling.interval_ms` (15s). */
const DEFAULT_TICK_INTERVAL_MS = 15_000;
/** Base delay for the exponential retry backoff (doubled per failed attempt). */
const DEFAULT_RETRY_BASE_DELAY_MS = 5_000;
/** Backoff cap; mirrors `WORKFLOW.md` `agent.max_retry_backoff_ms`. */
const MAX_RETRY_BACKOFF_MS = 300_000;
const CARD_KEY_SEPARATOR = "\u001f";
/**
 * A `Running` card whose run shows no progress (neither newer thread activity
 * nor a fresher heartbeat) for this long is treated as a failed attempt
 * instead of pinning the concurrency slot forever. Same order of magnitude as
 * the provider session reaper's default inactivity threshold.
 */
const DEFAULT_STALE_HEARTBEAT_MS = 30 * 60 * 1000;

export interface AgentBoardSchedulerLiveOptions {
  readonly tickIntervalMs?: number;
  readonly retryBaseDelayMs?: number;
  readonly retryMaxDelayMs?: number;
  readonly staleHeartbeatMs?: number;
}

interface TickCollaborators {
  readonly boardFiles: AgentBoardFileSystem["Service"];
  readonly runner: AgentBoardRunner["Service"];
  readonly orchestrationEngine: OrchestrationEngineService["Service"];
  readonly projectionSnapshotQuery: ProjectionSnapshotQuery["Service"];
}

const parseTimeMs = (value: string | undefined): number => {
  if (value === undefined) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
};

/**
 * Board states a tick may skip without comment: the project simply has no
 * board file yet, or its workspace root has disappeared. Corrupt or
 * unreadable boards surface through `board-unreadable` warnings instead.
 */
const isQuietlyAbsentBoard = (error: unknown): boolean => {
  const tag = (error as { _tag?: string } | null)?._tag;
  if (tag === "AgentBoardFileSystemError") {
    return (error as { operation?: string }).operation === "agentBoard.read";
  }
  return tag === "WorkspaceRootNotExistsError";
};

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

type Outcome<A, E> =
  | { readonly _tag: "ok"; readonly value: A }
  | { readonly _tag: "error"; readonly error: E };

/** Inspect an effect's failure without short-circuiting (part-1 runner precedent). */
const outcome = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<Outcome<A, E>, never, R> =>
  Effect.matchEffect(effect, {
    onFailure: (error) => Effect.succeed({ _tag: "error" as const, error }),
    onSuccess: (value) => Effect.succeed({ _tag: "ok" as const, value }),
  });

const makeAgentBoardScheduler = (options?: AgentBoardSchedulerLiveOptions) =>
  Effect.gen(function* () {
    // Platform-only collaborator (command/message ids). Domain services are
    // resolved per tick so this Live layer carries no cross-domain build-time
    // dependencies — the calling fiber provides them.
    const crypto = yield* Crypto.Crypto;
    const nextUuid = Effect.orDie(crypto.randomUUIDv4);

    const tickIntervalMs = Math.max(1, options?.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS);
    const retryBaseDelayMs = Math.max(1, options?.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS);
    // The WORKFLOW cap outranks any larger override.
    const retryMaxDelayMs = Math.min(
      Math.max(1, options?.retryMaxDelayMs ?? MAX_RETRY_BACKOFF_MS),
      MAX_RETRY_BACKOFF_MS,
    );
    const staleHeartbeatMs = Math.max(1, options?.staleHeartbeatMs ?? DEFAULT_STALE_HEARTBEAT_MS);

    // In-memory scheduler state. WORKFLOW.md explicitly allows this to be lost
    // on restart; `attemptCount` persists in the board file and still gates
    // the retry cap.
    const retryDueAtMs = new Map<string, number>();
    const interruptedRuns = new Set<string>();

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

    const appendTaskRecord = Effect.fn("AgentBoardScheduler.appendTaskRecord")(function* (input: {
      readonly cwd: string;
      readonly card: AgentBoardCard;
      readonly lines: ReadonlyArray<string>;
    }) {
      const recordPath = input.card.taskRecordPath;
      if (!recordPath) return;
      const pathOption = yield* Effect.serviceOption(Path.Path);
      const fsOption = yield* Effect.serviceOption(FileSystem.FileSystem);
      if (Option.isNone(pathOption) || Option.isNone(fsOption)) return;
      const path = pathOption.value;
      const fs = fsOption.value;
      const absolute = path.isAbsolute(recordPath) ? recordPath : path.join(input.cwd, recordPath);
      const header = `\n\n---\n\n### Scheduler ${yield* nowIso} — ${input.card.id} ${input.card.state}→\n`;
      const body = input.lines.join("\n");
      const content = `${header}${body}\n`;
      const existing = yield* fs
        .readFileString(absolute)
        .pipe(Effect.catch(() => Effect.succeed(null as string | null)));
      if (existing === null) return;
      yield* fs.writeFileString(absolute, `${existing}${content}`).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("agentBoard.scheduler.task-record-append-failed", {
            cardId: input.card.id,
            recordPath: absolute,
            cause: String(cause),
          }),
        ),
      );
    });

    const collectReviewText = (detail: {
      messages: ReadonlyArray<{ text: string; role: string }>;
    }): string => {
      const assistant = detail.messages.filter((m) => m.role === "assistant").map((m) => m.text);
      if (assistant.length > 0) return assistant.join("\n");
      return detail.messages.map((m) => m.text).join("\n");
    };

    /** Short continuation message for a retry turn — never the full prompt. */
    const continuationMessage = (card: AgentBoardCard, lastError: string): string =>
      [
        `Continue agent board card "${card.id}" (${card.title}).`,
        `The previous implementation turn ended in failure: ${truncate(lastError, 500)}`,
        "Pick up from the current workspace state, finish the remaining work, and self-verify (tests/lint/typecheck) before finishing. Do not start over.",
      ].join("\n");

    /**
     * Failed-attempt handling for a `Running` card whose run died. Once the
     * persisted `attemptCount` reaches `runner.repairCycles`, the card moves
     * to `Needs Decision` with an attempt summary; otherwise a continuation
     * retry is scheduled with exponential backoff and `attemptCount` is
     * incremented persistently, so the cap keeps working after a restart.
     * Returns the card mutator to apply onto the project board.
     */
    const recordFailedAttempt = Effect.fn("AgentBoardScheduler.recordFailedAttempt")(
      function* (input: {
        readonly cwd: string;
        readonly board: AgentBoardFile;
        readonly card: AgentBoardCard;
        readonly detail: string;
      }) {
        const attempts = Math.max(1, input.card.runtime.attemptCount);
        const now = yield* Clock.currentTimeMillis;
        const timestamp = yield* nowIso;

        if (attempts >= input.board.runner.repairCycles) {
          yield* Effect.logWarning("agentBoard.scheduler.attempts-exhausted", {
            cwd: input.cwd,
            cardId: input.card.id,
            attempts,
            detail: input.detail,
          });
          return (card: AgentBoardCard): AgentBoardCard =>
            Object.assign({}, card, {
              state: "Needs Decision" as const,
              runtime: {
                ...card.runtime,
                attemptCount: attempts,
                lastHeartbeatAt: timestamp,
                currentError: truncate(
                  `Autonomous retries exhausted after ${attempts} attempt(s). Last failure: ${input.detail}`,
                  2000,
                ),
              },
              updatedAt: timestamp,
            });
        }

        const delayMs = Math.min(retryBaseDelayMs * 2 ** (attempts - 1), retryMaxDelayMs);
        retryDueAtMs.set(`${input.cwd}${CARD_KEY_SEPARATOR}${input.card.id}`, now + delayMs);
        yield* Effect.logWarning("agentBoard.scheduler.retry-scheduled", {
          cwd: input.cwd,
          cardId: input.card.id,
          attempts,
          nextAttemptInMs: delayMs,
          detail: input.detail,
        });
        return (card: AgentBoardCard): AgentBoardCard =>
          Object.assign({}, card, {
            runtime: {
              ...card.runtime,
              attemptCount: attempts + 1,
              lastHeartbeatAt: timestamp,
              currentError: truncate(input.detail, 2000),
            },
            updatedAt: timestamp,
          });
      },
    );

    /**
     * Dispatch a retry as a continuation turn on the SAME implementation
     * thread with a short failure-context message. Returns null when the
     * card carries no resolvable run id.
     */
    const dispatchContinuationTurn = Effect.fn("AgentBoardScheduler.dispatchContinuationTurn")(
      function* (input: {
        readonly orchestrationEngine: OrchestrationEngineService["Service"];
        readonly cwd: string;
        readonly card: AgentBoardCard;
        readonly detail: string;
      }) {
        const runId = input.card.runtime.implementationRunId;
        if (runId === undefined) return null;
        yield* input.orchestrationEngine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(yield* nextUuid),
          threadId: ThreadId.make(runId),
          message: {
            messageId: MessageId.make(yield* nextUuid),
            role: "user",
            text: continuationMessage(input.card, input.detail),
            attachments: [],
          },
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          createdAt: yield* nowIso,
        });
        yield* Effect.logInfo("agentBoard.scheduler.retry-dispatched", {
          cwd: input.cwd,
          cardId: input.card.id,
          threadId: runId,
        });
        return runId;
      },
    );

    const launchReviewThread = Effect.fn("AgentBoardScheduler.launchReviewThread")(
      function* (input: {
        readonly collaborators: TickCollaborators;
        readonly cwd: string;
        readonly board: AgentBoardFile;
        readonly card: AgentBoardCard;
      }) {
        const projectOption = yield* input.collaborators.projectionSnapshotQuery
          .getActiveProjectByWorkspaceRoot(input.cwd)
          .pipe(Effect.catch(() => Effect.succeed(Option.none())));
        const resolution = resolveWorkerModelSelection(
          input.board,
          Option.isSome(projectOption)
            ? (projectOption.value.defaultModelSelection as unknown as
                | import("@t3tools/contracts").ModelSelection
                | null)
            : null,
        );
        if (resolution._tag === "missing-config") {
          return {
            _tag: "error" as const,
            error: MISSING_WORKER_CONFIG_ERROR,
            needsDecision: true as const,
            question: MISSING_WORKER_CONFIG_ERROR,
          };
        }
        if (Option.isNone(projectOption)) {
          const msg = `No active project matches the board workspace root: ${input.cwd}`;
          return {
            _tag: "error" as const,
            error: msg,
            needsDecision: true as const,
            question: msg,
          };
        }
        const project = projectOption.value;
        const worktreePath = projectScriptCwd({
          project: { cwd: input.cwd },
          worktreePath: input.card.runtime.workspacePath ?? `.t3/workspaces/${input.card.id}`,
        });
        const branchName = input.card.runtime.branchName ?? `board/${input.card.id}`;
        const reviewThreadId = ThreadId.make(yield* nextUuid);
        const threadTitle = buildAgentBoardReviewThreadTitle(input.card);
        const reviewPrompt = buildAgentBoardReviewPrompt(input.card);
        const createdAt = yield* nowIso;
        const createOutcome = yield* outcome(
          input.collaborators.orchestrationEngine.dispatch({
            type: "thread.create",
            commandId: CommandId.make(yield* nextUuid),
            threadId: reviewThreadId,
            projectId: project.id,
            title: threadTitle,
            modelSelection: resolution.selection,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: branchName,
            worktreePath,
            createdAt,
          }),
        );
        if (createOutcome._tag === "error") {
          const detail =
            (createOutcome.error as { message?: string }).message ?? String(createOutcome.error);
          return {
            _tag: "error" as const,
            error: `review thread.create failed: ${detail}`,
            needsDecision: false as const,
          };
        }
        const turnOutcome = yield* outcome(
          input.collaborators.orchestrationEngine.dispatch({
            type: "thread.turn.start",
            commandId: CommandId.make(yield* nextUuid),
            threadId: reviewThreadId,
            message: {
              messageId: MessageId.make(yield* nextUuid),
              role: "user",
              text: reviewPrompt,
              attachments: [],
            },
            modelSelection: resolution.selection,
            titleSeed: threadTitle,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            createdAt,
          }),
        );
        if (turnOutcome._tag === "error") {
          const detail =
            (turnOutcome.error as { message?: string }).message ?? String(turnOutcome.error);
          yield* input.collaborators.orchestrationEngine
            .dispatch({
              type: "thread.delete",
              commandId: CommandId.make(yield* nextUuid),
              threadId: reviewThreadId,
            })
            .pipe(Effect.ignore);
          return {
            _tag: "error" as const,
            error: `review thread.turn.start failed: ${detail}`,
            needsDecision: false as const,
          };
        }
        yield* Effect.logInfo("agentBoard.scheduler.review-launched", {
          cwd: input.cwd,
          cardId: input.card.id,
          reviewThreadId,
          worktreePath,
        });
        return { _tag: "ok" as const, reviewThreadId: reviewThreadId as unknown as string };
      },
    );

    const dispatchRepairTurn = Effect.fn("AgentBoardScheduler.dispatchRepairTurn")(
      function* (input: {
        readonly orchestrationEngine: OrchestrationEngineService["Service"];
        readonly cwd: string;
        readonly card: AgentBoardCard;
        readonly reviewReason: string;
      }) {
        const runId = input.card.runtime.implementationRunId;
        if (runId === undefined) return null;
        yield* input.orchestrationEngine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(yield* nextUuid),
          threadId: ThreadId.make(runId),
          message: {
            messageId: MessageId.make(yield* nextUuid),
            role: "user",
            text: buildAgentBoardRepairPrompt(input.card, input.reviewReason),
            attachments: [],
          },
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          createdAt: yield* nowIso,
        });
        yield* Effect.logInfo("agentBoard.scheduler.repair-dispatched", {
          cwd: input.cwd,
          cardId: input.card.id,
          threadId: runId,
          reason: truncate(input.reviewReason, 300),
        });
        return runId;
      },
    );

    const processProject = Effect.fn("AgentBoardScheduler.processProject")(function* (input: {
      readonly collaborators: TickCollaborators;
      readonly cwd: string;
    }) {
      const { cwd } = input;
      const boardFiles = input.collaborators.boardFiles;
      const loaded = yield* outcome(boardFiles.load({ cwd, createIfMissing: false }));
      if (loaded._tag === "error") {
        // A missing board file just means the project is not a scheduler
        // target. Anything else (corrupt JSON, unreadable root) must stay
        // visible instead of being silently swallowed every tick.
        if (!isQuietlyAbsentBoard(loaded.error)) {
          yield* Effect.logWarning("agentBoard.scheduler.board-unreadable", {
            workspaceRoot: cwd,
            detail: loaded.error.message,
          });
        }
        return;
      }

      let board = loaded.value.board;
      let dirty = false;
      const applyPatch = (cardId: string, mutate: (card: AgentBoardCard) => AgentBoardCard) => {
        const index = board.cards.findIndex((card) => card.id === cardId);
        const current = index === -1 ? undefined : board.cards[index];
        if (current === undefined) return;
        const nextCards = [...board.cards];
        nextCards[index] = mutate(current);
        board = { ...board, cards: nextCards };
        dirty = true;
      };
      // --- Reconcile `Running` cards before claiming anything. ---
      for (const card of board.cards.filter((candidate) => candidate.state === "Running")) {
        const key = `${cwd}${CARD_KEY_SEPARATOR}${card.id}`;

        // A pending retry parks the card until its backoff elapses; the
        // failed attempt's thread state must not re-trigger detection.
        const dueAtMs = retryDueAtMs.get(key);
        if (dueAtMs !== undefined) {
          const now = yield* Clock.currentTimeMillis;
          if (now < dueAtMs) continue;
          retryDueAtMs.delete(key);

          if (card.runtime.implementationRunId !== undefined) {
            const dispatched = yield* outcome(
              dispatchContinuationTurn({
                orchestrationEngine: input.collaborators.orchestrationEngine,
                cwd,
                card,
                detail: card.runtime.currentError ?? "previous attempt failed",
              }),
            );
            if (dispatched._tag === "error") {
              const mutator = yield* recordFailedAttempt({
                cwd,
                board,
                card,
                detail: `continuation turn failed to dispatch: ${dispatched.error.message}`,
              });
              applyPatch(card.id, mutator);
            }
            continue;
          }
          // Fall through: without a run id the generic failed-attempt path
          // below owns the outcome.
        }

        const runId = card.runtime.implementationRunId;
        const threadOption =
          runId === undefined
            ? Option.none()
            : yield* input.collaborators.projectionSnapshotQuery.getThreadShellById(
                ThreadId.make(runId),
              );

        if (Option.isNone(threadOption)) {
          const mutator = yield* recordFailedAttempt({
            cwd,
            board,
            card,
            detail:
              runId === undefined
                ? "claimed card has no implementationRunId; the launch never completed"
                : `implementation run thread ${runId} is no longer resolvable (restart or deleted thread)`,
          });
          applyPatch(card.id, mutator);
          continue;
        }
        const thread = threadOption.value;
        const latestTurn = thread.latestTurn;
        const sessionStatus = thread.session?.status ?? null;
        const sessionDead =
          sessionStatus === null ||
          sessionStatus === "stopped" ||
          sessionStatus === "error" ||
          sessionStatus === "interrupted";

        if (latestTurn?.state === "completed") {
          const launch = yield* launchReviewThread({
            collaborators: input.collaborators,
            cwd,
            board,
            card,
          });
          if (launch._tag === "ok") {
            const timestamp = yield* nowIso;
            yield* Effect.logInfo("agentBoard.scheduler.run-completed", {
              cwd,
              cardId: card.id,
              threadId: card.runtime.implementationRunId,
            });
            yield* appendTaskRecord({
              cwd,
              card,
              lines: [
                `Implementation completed (thread ${runId}); launching review thread ${launch.reviewThreadId}.`,
              ],
            }).pipe(Effect.catch(() => Effect.void));
            applyPatch(card.id, (current) => {
              const {
                currentError: _e,
                currentDecisionQuestion: _q,
                ...rest
              } = current.runtime as Record<string, unknown>;
              return Object.assign({}, current, {
                state: "Reviewing" as const,
                runtime: {
                  ...(rest as AgentBoardCard["runtime"]),
                  implementationRunId: current.runtime.implementationRunId,
                  reviewRunId:
                    launch.reviewThreadId as unknown as typeof current.runtime.reviewRunId,
                  lastHeartbeatAt: timestamp,
                },
                updatedAt: timestamp,
              });
            });
          } else if ((launch as { needsDecision: boolean }).needsDecision) {
            const timestamp = yield* nowIso;
            const err = (launch as unknown as { error: string }).error;
            const q = (launch as unknown as { question?: string }).question ?? err;
            yield* Effect.logWarning("agentBoard.scheduler.review-launch-needs-decision", {
              cwd,
              cardId: card.id,
              detail: err,
            });
            applyPatch(card.id, (current) =>
              Object.assign({}, current, {
                state: "Needs Decision" as const,
                runtime: {
                  ...current.runtime,
                  lastHeartbeatAt: timestamp,
                  currentError: truncate(err, 2000),
                  currentDecisionQuestion: truncate(q, 2000),
                },
                updatedAt: timestamp,
              }),
            );
          } else {
            const mutator = yield* recordFailedAttempt({
              cwd,
              board,
              card,
              detail: (launch as unknown as { error: string }).error,
            });
            applyPatch(card.id, mutator);
          }
          continue;
        }

        if (latestTurn?.state === "error" || latestTurn?.state === "interrupted") {
          const mutator = yield* recordFailedAttempt({
            cwd,
            board,
            card,
            detail: thread.session?.lastError
              ? `turn ${latestTurn.state}: ${thread.session.lastError}`
              : `turn ${latestTurn.state}`,
          });
          applyPatch(card.id, mutator);
          continue;
        }

        if (sessionDead) {
          const mutator = yield* recordFailedAttempt({
            cwd,
            board,
            card,
            detail: `worker session is ${sessionStatus} while the turn never settled (restart or crash)`,
          });
          applyPatch(card.id, mutator);
          continue;
        }

        // Still running. Detect a silently dead run: neither the thread nor
        // the persisted heartbeat shows recent progress.
        const now = yield* Clock.currentTimeMillis;
        const lastProgressMs = Math.max(
          parseTimeMs(thread.updatedAt),
          parseTimeMs(card.runtime.lastHeartbeatAt),
        );
        const hasProgress =
          !Number.isNaN(lastProgressMs) && now - lastProgressMs < staleHeartbeatMs;
        if (!hasProgress) {
          const mutator = yield* recordFailedAttempt({
            cwd,
            board,
            card,
            detail: `no run progress for ${Math.round(staleHeartbeatMs / 1000)}s (stale heartbeat)`,
          });
          applyPatch(card.id, mutator);
          continue;
        }

        // Alive: refresh the heartbeat only when the run actually advanced,
        // so idle ticks never rewrite the board file.
        const heartbeatMs = parseTimeMs(card.runtime.lastHeartbeatAt);
        const threadProgressMs = parseTimeMs(thread.updatedAt);
        if (
          Number.isNaN(heartbeatMs) ||
          (!Number.isNaN(threadProgressMs) && threadProgressMs > heartbeatMs)
        ) {
          const timestamp = yield* nowIso;
          applyPatch(card.id, (current) =>
            Object.assign({}, current, {
              runtime: { ...current.runtime, lastHeartbeatAt: timestamp },
            }),
          );
        }
      }

      // --- Reconcile `Reviewing` cards: observe fresh review thread ---
      for (const card of board.cards.filter((candidate) => candidate.state === "Reviewing")) {
        const reviewRunId = card.runtime.reviewRunId;
        if (reviewRunId === undefined) {
          const timestamp = yield* nowIso;
          applyPatch(card.id, (current) =>
            Object.assign({}, current, {
              state: "Needs Decision" as const,
              runtime: {
                ...current.runtime,
                lastHeartbeatAt: timestamp,
                currentError: "Reviewing card has no reviewRunId",
                currentDecisionQuestion:
                  "Reviewing card has no reviewRunId — re-queue or inspect workspace.",
              },
              updatedAt: timestamp,
            }),
          );
          continue;
        }
        const shellOption = yield* input.collaborators.projectionSnapshotQuery.getThreadShellById(
          ThreadId.make(reviewRunId),
        );
        if (Option.isNone(shellOption)) {
          const attempts = Math.max(1, card.runtime.attemptCount);
          const timestamp = yield* nowIso;
          if (attempts >= board.runner.repairCycles) {
            applyPatch(card.id, (current) =>
              Object.assign({}, current, {
                state: "Needs Decision" as const,
                runtime: {
                  ...current.runtime,
                  attemptCount: attempts,
                  lastHeartbeatAt: timestamp,
                  currentError: truncate(
                    `Autonomous review retries exhausted after ${attempts} attempt(s). Last failure: review thread ${reviewRunId} is no longer resolvable`,
                    2000,
                  ),
                },
                updatedAt: timestamp,
              }),
            );
          } else {
            applyPatch(card.id, (current) =>
              Object.assign({}, current, {
                state: "Diagnosing" as const,
                runtime: {
                  ...current.runtime,
                  attemptCount: attempts + 1,
                  lastHeartbeatAt: timestamp,
                  currentError: truncate(
                    `review thread ${reviewRunId} is no longer resolvable`,
                    2000,
                  ),
                },
                updatedAt: timestamp,
              }),
            );
          }
          continue;
        }
        const shell = shellOption.value;
        const latestTurn = shell.latestTurn;
        const sessionStatus = shell.session?.status ?? null;
        if (latestTurn?.state === "completed") {
          const detailOption = yield* input.collaborators.projectionSnapshotQuery
            .getThreadDetailById(ThreadId.make(reviewRunId))
            .pipe(Effect.catch(() => Effect.succeed(Option.none())));
          let reviewText = "";
          if (Option.isSome(detailOption)) {
            reviewText = collectReviewText(detailOption.value);
          }
          if (!reviewText) {
            reviewText =
              (shell as unknown as { activities?: ReadonlyArray<{ summary?: string }> }).activities
                ?.map((a) => a.summary ?? "")
                .join("\n") ?? "";
          }
          const parsed = parseAgentBoardReviewResult(reviewText);
          const timestamp = yield* nowIso;
          if (parsed === null) {
            const reason = truncate(
              reviewText.slice(0, 500) || "review completed without REVIEW marker",
              2000,
            );
            const attempts = Math.max(1, card.runtime.attemptCount);
            if (attempts >= board.runner.repairCycles) {
              yield* appendTaskRecord({
                cwd,
                card,
                lines: [
                  `Review thread ${reviewRunId} completed without marker → Needs Decision (cap ${attempts}).`,
                  `Review output: ${reason}`,
                ],
              }).pipe(Effect.catch(() => Effect.void));
              applyPatch(card.id, (current) =>
                Object.assign({}, current, {
                  state: "Needs Decision" as const,
                  runtime: {
                    ...current.runtime,
                    attemptCount: attempts,
                    lastHeartbeatAt: timestamp,
                    currentError: truncate(
                      `Autonomous review retries exhausted after ${attempts} attempt(s). Last failure: review completed without REVIEW marker: ${reason}`,
                      2000,
                    ),
                  },
                  updatedAt: timestamp,
                }),
              );
            } else {
              yield* appendTaskRecord({
                cwd,
                card,
                lines: [
                  `Review thread ${reviewRunId} missing marker → Diagnosing`,
                  `Review output: ${reason}`,
                ],
              }).pipe(Effect.catch(() => Effect.void));
              const repairDispatched = yield* outcome(
                dispatchRepairTurn({
                  orchestrationEngine: input.collaborators.orchestrationEngine,
                  cwd,
                  card,
                  reviewReason: reason,
                }),
              );
              if (repairDispatched._tag === "error") {
                const mut = yield* recordFailedAttempt({
                  cwd,
                  board,
                  card,
                  detail: `repair dispatch failed: ${repairDispatched.error.message}`,
                });
                applyPatch(card.id, mut);
              } else {
                applyPatch(card.id, (current) =>
                  Object.assign({}, current, {
                    state: "Diagnosing" as const,
                    runtime: {
                      ...current.runtime,
                      attemptCount: attempts + 1,
                      lastHeartbeatAt: timestamp,
                      currentError: truncate(`Review failed: ${reason}`, 2000),
                    },
                    updatedAt: timestamp,
                  }),
                );
              }
            }
            continue;
          }
          if (parsed._tag === "needsDecision") {
            yield* appendTaskRecord({
              cwd,
              card,
              lines: [
                `Review thread ${reviewRunId} → NEEDS_DECISION: ${parsed.question}`,
                `Reason: ${parsed.reason}`,
              ],
            }).pipe(Effect.catch(() => Effect.void));
            applyPatch(card.id, (current) =>
              Object.assign({}, current, {
                state: "Needs Decision" as const,
                runtime: {
                  ...current.runtime,
                  lastHeartbeatAt: timestamp,
                  currentError: truncate(parsed.reason, 2000),
                  currentDecisionQuestion: truncate(parsed.question, 2000),
                },
                updatedAt: timestamp,
              }),
            );
            continue;
          }
          if (parsed._tag === "pass") {
            yield* Effect.logInfo("agentBoard.scheduler.review-pass", {
              cwd,
              cardId: card.id,
              reviewRunId,
            });
            yield* appendTaskRecord({
              cwd,
              card,
              lines: [
                `Review thread ${reviewRunId} → PASS`,
                parsed.summary ? `Summary: ${parsed.summary}` : "",
              ],
            }).pipe(Effect.catch(() => Effect.void));
            applyPatch(card.id, (current) => {
              const {
                currentError: _e,
                currentDecisionQuestion: _q,
                ...rest
              } = current.runtime as Record<string, unknown>;
              return Object.assign({}, current, {
                state: "Review" as const,
                runtime: rest as AgentBoardCard["runtime"],
                updatedAt: timestamp,
              });
            });
            continue;
          }
          if (parsed._tag === "fail") {
            const attempts = Math.max(1, card.runtime.attemptCount);
            if (attempts >= board.runner.repairCycles) {
              yield* appendTaskRecord({
                cwd,
                card,
                lines: [
                  `Review thread ${reviewRunId} → FAIL (cap exhausted ${attempts})`,
                  `Reason: ${parsed.reason}`,
                ],
              }).pipe(Effect.catch(() => Effect.void));
              applyPatch(card.id, (current) =>
                Object.assign({}, current, {
                  state: "Needs Decision" as const,
                  runtime: {
                    ...current.runtime,
                    attemptCount: attempts,
                    lastHeartbeatAt: timestamp,
                    currentError: truncate(
                      `Autonomous review retries exhausted after ${attempts} attempt(s). Last failure: ${parsed.reason}`,
                      2000,
                    ),
                  },
                  updatedAt: timestamp,
                }),
              );
            } else {
              yield* appendTaskRecord({
                cwd,
                card,
                lines: [
                  `Review thread ${reviewRunId} → FAIL: ${parsed.reason}`,
                  `Dispatching repair on ${card.runtime.implementationRunId}`,
                ],
              }).pipe(Effect.catch(() => Effect.void));
              const repairDispatched = yield* outcome(
                dispatchRepairTurn({
                  orchestrationEngine: input.collaborators.orchestrationEngine,
                  cwd,
                  card,
                  reviewReason: parsed.reason,
                }),
              );
              if (repairDispatched._tag === "error") {
                const mut = yield* recordFailedAttempt({
                  cwd,
                  board,
                  card,
                  detail: `repair dispatch failed: ${repairDispatched.error.message}`,
                });
                applyPatch(card.id, mut);
              } else {
                applyPatch(card.id, (current) =>
                  Object.assign({}, current, {
                    state: "Diagnosing" as const,
                    runtime: {
                      ...current.runtime,
                      attemptCount: attempts + 1,
                      lastHeartbeatAt: timestamp,
                      currentError: truncate(`Review failed: ${parsed.reason}`, 2000),
                    },
                    updatedAt: timestamp,
                  }),
                );
              }
            }
            continue;
          }
        }
        if (latestTurn?.state === "error" || latestTurn?.state === "interrupted") {
          const attempts = Math.max(1, card.runtime.attemptCount);
          const detail = shell.session?.lastError
            ? `review turn ${latestTurn.state}: ${shell.session.lastError}`
            : `review turn ${latestTurn.state}`;
          const timestamp = yield* nowIso;
          if (attempts >= board.runner.repairCycles) {
            applyPatch(card.id, (current) =>
              Object.assign({}, current, {
                state: "Needs Decision" as const,
                runtime: {
                  ...current.runtime,
                  attemptCount: attempts,
                  lastHeartbeatAt: timestamp,
                  currentError: truncate(
                    `Autonomous review retries exhausted after ${attempts} attempt(s). Last failure: ${detail}`,
                    2000,
                  ),
                },
                updatedAt: timestamp,
              }),
            );
          } else {
            const repairDispatched = yield* outcome(
              dispatchRepairTurn({
                orchestrationEngine: input.collaborators.orchestrationEngine,
                cwd,
                card,
                reviewReason: detail,
              }),
            );
            if (repairDispatched._tag === "error") {
              const mut = yield* recordFailedAttempt({
                cwd,
                board,
                card,
                detail: `repair dispatch failed: ${repairDispatched.error.message}`,
              });
              applyPatch(card.id, mut);
            } else {
              applyPatch(card.id, (current) =>
                Object.assign({}, current, {
                  state: "Diagnosing" as const,
                  runtime: {
                    ...current.runtime,
                    attemptCount: attempts + 1,
                    lastHeartbeatAt: timestamp,
                    currentError: truncate(detail, 2000),
                  },
                  updatedAt: timestamp,
                }),
              );
            }
          }
          continue;
        }
        if (
          sessionStatus === "stopped" ||
          sessionStatus === "error" ||
          sessionStatus === "interrupted"
        ) {
          const attempts = Math.max(1, card.runtime.attemptCount);
          const detail = `review session is ${sessionStatus}`;
          const timestamp = yield* nowIso;
          if (attempts >= board.runner.repairCycles) {
            applyPatch(card.id, (current) =>
              Object.assign({}, current, {
                state: "Needs Decision" as const,
                runtime: {
                  ...current.runtime,
                  attemptCount: attempts,
                  lastHeartbeatAt: timestamp,
                  currentError: truncate(
                    `Autonomous review retries exhausted after ${attempts} attempt(s). Last failure: ${detail}`,
                    2000,
                  ),
                },
                updatedAt: timestamp,
              }),
            );
          } else {
            const repairDispatched = yield* outcome(
              dispatchRepairTurn({
                orchestrationEngine: input.collaborators.orchestrationEngine,
                cwd,
                card,
                reviewReason: detail,
              }),
            );
            if (repairDispatched._tag === "error") {
              const mut = yield* recordFailedAttempt({
                cwd,
                board,
                card,
                detail: `repair dispatch failed: ${repairDispatched.error.message}`,
              });
              applyPatch(card.id, mut);
            } else {
              applyPatch(card.id, (current) =>
                Object.assign({}, current, {
                  state: "Diagnosing" as const,
                  runtime: {
                    ...current.runtime,
                    attemptCount: attempts + 1,
                    lastHeartbeatAt: timestamp,
                    currentError: truncate(detail, 2000),
                  },
                  updatedAt: timestamp,
                }),
              );
            }
          }
          continue;
        }
        const heartbeatMs = parseTimeMs(card.runtime.lastHeartbeatAt);
        const shellProgressMs = parseTimeMs(shell.updatedAt);
        if (
          Number.isNaN(heartbeatMs) ||
          (!Number.isNaN(shellProgressMs) && shellProgressMs > heartbeatMs)
        ) {
          const timestamp = yield* nowIso;
          applyPatch(card.id, (current) =>
            Object.assign({}, current, {
              runtime: { ...current.runtime, lastHeartbeatAt: timestamp },
            }),
          );
        }
      }

      // --- Reconcile `Diagnosing` cards: wait for repair turn to complete then re-review ---
      for (const card of board.cards.filter((candidate) => candidate.state === "Diagnosing")) {
        const implRunId = card.runtime.implementationRunId;
        if (implRunId === undefined) {
          const timestamp = yield* nowIso;
          applyPatch(card.id, (current) =>
            Object.assign({}, current, {
              state: "Needs Decision" as const,
              runtime: {
                ...current.runtime,
                lastHeartbeatAt: timestamp,
                currentError: "Diagnosing card has no implementationRunId to repair",
                currentDecisionQuestion:
                  "Diagnosing card has no implementationRunId — re-queue or inspect workspace.",
              },
              updatedAt: timestamp,
            }),
          );
          continue;
        }
        const threadOption = yield* input.collaborators.projectionSnapshotQuery.getThreadShellById(
          ThreadId.make(implRunId),
        );
        if (Option.isNone(threadOption)) {
          const mutator = yield* recordFailedAttempt({
            cwd,
            board,
            card,
            detail: `repair run thread ${implRunId} is no longer resolvable`,
          });
          applyPatch(card.id, mutator);
          continue;
        }
        const thread = threadOption.value;
        const latestTurn = thread.latestTurn;
        const sessionStatus = thread.session?.status ?? null;
        const sessionDead =
          sessionStatus === null ||
          sessionStatus === "stopped" ||
          sessionStatus === "error" ||
          sessionStatus === "interrupted";
        if (latestTurn?.state === "completed") {
          const launch = yield* launchReviewThread({
            collaborators: input.collaborators,
            cwd,
            board,
            card,
          });
          if (launch._tag === "ok") {
            const timestamp = yield* nowIso;
            yield* appendTaskRecord({
              cwd,
              card,
              lines: [
                `Repair completed (thread ${implRunId}); re-launching review ${launch.reviewThreadId}.`,
              ],
            }).pipe(Effect.catch(() => Effect.void));
            applyPatch(card.id, (current) =>
              Object.assign({}, current, {
                state: "Reviewing" as const,
                runtime: {
                  ...current.runtime,
                  reviewRunId:
                    launch.reviewThreadId as unknown as typeof current.runtime.reviewRunId,
                  lastHeartbeatAt: timestamp,
                },
                updatedAt: timestamp,
              }),
            );
          } else if ((launch as { needsDecision: boolean }).needsDecision) {
            const timestamp = yield* nowIso;
            const err2 = (launch as unknown as { error: string }).error;
            const q2 = (launch as unknown as { question?: string }).question ?? err2;
            applyPatch(card.id, (current) =>
              Object.assign({}, current, {
                state: "Needs Decision" as const,
                runtime: {
                  ...current.runtime,
                  lastHeartbeatAt: timestamp,
                  currentError: truncate(err2, 2000),
                  currentDecisionQuestion: truncate(q2, 2000),
                },
                updatedAt: timestamp,
              }),
            );
          } else {
            const mutator = yield* recordFailedAttempt({
              cwd,
              board,
              card,
              detail: (launch as unknown as { error: string }).error,
            });
            applyPatch(card.id, mutator);
          }
          continue;
        }
        if (latestTurn?.state === "error" || latestTurn?.state === "interrupted") {
          const mutator = yield* recordFailedAttempt({
            cwd,
            board,
            card,
            detail: thread.session?.lastError
              ? `repair turn ${latestTurn.state}: ${thread.session.lastError}`
              : `repair turn ${latestTurn.state}`,
          });
          applyPatch(card.id, mutator);
          continue;
        }
        if (sessionDead) {
          const mutator = yield* recordFailedAttempt({
            cwd,
            board,
            card,
            detail: `repair session is ${sessionStatus} while the turn never settled`,
          });
          applyPatch(card.id, mutator);
          continue;
        }
        const heartbeatMs = parseTimeMs(card.runtime.lastHeartbeatAt);
        const threadProgressMs = parseTimeMs(thread.updatedAt);
        if (
          Number.isNaN(heartbeatMs) ||
          (!Number.isNaN(threadProgressMs) && threadProgressMs > heartbeatMs)
        ) {
          const timestamp = yield* nowIso;
          applyPatch(card.id, (current) =>
            Object.assign({}, current, {
              runtime: { ...current.runtime, lastHeartbeatAt: timestamp },
            }),
          );
        }
      }

      if (dirty) {
        const timestamp = yield* nowIso;
        const saved = yield* boardFiles.save({
          cwd,
          board: { ...board, updatedAt: timestamp },
        });
        board = saved.board;
        dirty = false;
      }

      // --- Abort active turns for cards the user moved out of `Running`/`Diagnosing`. ---
      for (const card of board.cards.filter(
        (candidate) =>
          candidate.state !== "Running" &&
          candidate.state !== "Diagnosing" &&
          candidate.runtime.implementationRunId !== undefined,
      )) {
        const runId = card.runtime.implementationRunId!;
        const runKey = `${cwd}${CARD_KEY_SEPARATOR}${card.id}${CARD_KEY_SEPARATOR}${runId}`;
        // A moved card no longer consumes its parked retry slot.
        retryDueAtMs.delete(`${cwd}${CARD_KEY_SEPARATOR}${card.id}`);
        if (interruptedRuns.has(runKey)) continue;

        const threadOption = yield* input.collaborators.projectionSnapshotQuery.getThreadShellById(
          ThreadId.make(runId),
        );
        if (Option.isNone(threadOption)) continue;
        if (threadOption.value.latestTurn?.state !== "running") continue;

        const interruptOutcome = yield* outcome(
          input.collaborators.orchestrationEngine.dispatch({
            type: "thread.turn.interrupt",
            commandId: CommandId.make(yield* nextUuid),
            threadId: ThreadId.make(runId),
            createdAt: yield* nowIso,
          }),
        );
        if (interruptOutcome._tag === "ok") {
          interruptedRuns.add(runKey);
          yield* Effect.logInfo("agentBoard.scheduler.abandoned-run-aborted", {
            cwd,
            cardId: card.id,
            state: card.state,
            threadId: runId,
          });
        }
      }
      for (const card of board.cards.filter(
        (candidate) =>
          candidate.state !== "Reviewing" && candidate.runtime.reviewRunId !== undefined,
      )) {
        const reviewId = card.runtime.reviewRunId!;
        const runKey = `${cwd}${CARD_KEY_SEPARATOR}${card.id}${CARD_KEY_SEPARATOR}${reviewId}-review`;
        if (interruptedRuns.has(runKey)) continue;
        const threadOption = yield* input.collaborators.projectionSnapshotQuery.getThreadShellById(
          ThreadId.make(reviewId),
        );
        if (Option.isNone(threadOption)) continue;
        if (threadOption.value.latestTurn?.state !== "running") continue;
        const interruptOutcome = yield* outcome(
          input.collaborators.orchestrationEngine.dispatch({
            type: "thread.turn.interrupt",
            commandId: CommandId.make(yield* nextUuid),
            threadId: ThreadId.make(reviewId),
            createdAt: yield* nowIso,
          }),
        );
        if (interruptOutcome._tag === "ok") {
          interruptedRuns.add(runKey);
          yield* Effect.logInfo("agentBoard.scheduler.abandoned-review-aborted", {
            cwd,
            cardId: card.id,
            state: card.state,
            threadId: reviewId,
          });
        }
      }

      // --- Claim eligible `Ready` cards up to the concurrency cap. ---
      const activeCount = board.cards.filter(
        (candidate) =>
          candidate.state === "Running" ||
          candidate.state === "Reviewing" ||
          candidate.state === "Diagnosing",
      ).length;
      const capacity = board.runner.maxConcurrentCards - activeCount;
      if (capacity <= 0) return;

      const doneIds = new Set(
        board.cards
          .filter((candidate) => candidate.state === "Done")
          .map((candidate) => candidate.id),
      );
      const candidates = board.cards
        .filter(
          (candidate) =>
            candidate.state === "Ready" &&
            candidate.dependencies.every((dependency) => doneIds.has(dependency)),
        )
        .sort((left, right) => {
          if (left.priority !== right.priority) return left.priority - right.priority;
          const leftUpdated = parseTimeMs(left.updatedAt);
          const rightUpdated = parseTimeMs(right.updatedAt);
          if (leftUpdated !== rightUpdated) return leftUpdated - rightUpdated;
          return left.id.localeCompare(right.id);
        });

      let launched = 0;
      for (const candidate of candidates) {
        if (launched >= capacity) break;
        // A Ready card whose previous run's turn is still active (e.g. the
        // user re-queued it and the abort has yet to settle) must not get a
        // second concurrent turn on top of the old one.
        const previousRunId = candidate.runtime.implementationRunId;
        if (previousRunId !== undefined) {
          const previousThread =
            yield* input.collaborators.projectionSnapshotQuery.getThreadShellById(
              ThreadId.make(previousRunId),
            );
          if (Option.isSome(previousThread)) {
            const turnState = previousThread.value.latestTurn?.state;
            if (turnState === "running") {
              yield* Effect.logInfo("agentBoard.scheduler.claim-deferred-active-run", {
                cwd,
                cardId: candidate.id,
                threadId: previousRunId,
              });
              continue;
            }
            // A Ready card whose implementation already finished but was moved
            // back to Ready (stale UI save) must re-enter reconciliation, not
            // spawn a second concurrent run.
            if (turnState === "completed") {
              const timestamp = yield* nowIso;
              applyPatch(candidate.id, (current) =>
                Object.assign({}, current, {
                  state: "Running" as const,
                  updatedAt: timestamp,
                }),
              );
              yield* Effect.logInfo("agentBoard.scheduler.claim-deferred-completed-run", {
                cwd,
                cardId: candidate.id,
                threadId: previousRunId,
              });
              continue;
            }
          }
        }
        const launchOutcome = yield* outcome(
          input.collaborators.runner.run({ cwd, cardId: candidate.id }),
        );
        if (launchOutcome._tag === "error") {
          // The runner already persisted `Blocked` + `currentError`; log it
          // and move on to the next candidate.
          yield* Effect.logWarning("agentBoard.scheduler.launch-failed", {
            cwd,
            cardId: candidate.id,
            operation: launchOutcome.error.operation,
            detail: launchOutcome.error.detail,
          });
          continue;
        }
        launched += 1;
        yield* Effect.logInfo("agentBoard.scheduler.card-launched", {
          cwd,
          cardId: candidate.id,
          threadId: launchOutcome.value.threadId,
          workspacePath: launchOutcome.value.workspacePath,
        });
      }

      if (dirty) {
        const timestamp = yield* nowIso;
        const saved = yield* boardFiles.save({
          cwd,
          board: { ...board, updatedAt: timestamp },
        });
        board = saved.board;
        dirty = false;
      }
    });

    const tick = Effect.fn("AgentBoardScheduler.tick")(function* () {
      const collaborators: TickCollaborators = {
        boardFiles: yield* AgentBoardFileSystem,
        runner: yield* AgentBoardRunner,
        orchestrationEngine: yield* OrchestrationEngineService,
        projectionSnapshotQuery: yield* ProjectionSnapshotQuery,
      };

      // Project enumeration rides the shell snapshot: projects + lightweight
      // thread shells, hydrated from the persisted projection.
      const shell = yield* collaborators.projectionSnapshotQuery.getShellSnapshot();

      for (const project of shell.projects) {
        yield* processProject({
          collaborators,
          cwd: project.workspaceRoot,
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("agentBoard.scheduler.project-failed", {
              workspaceRoot: project.workspaceRoot,
              cause,
            }),
          ),
        );
      }
    });

    const start: AgentBoardSchedulerShape["start"] = () =>
      Effect.gen(function* () {
        yield* forkParked(
          tick().pipe(
            Effect.catch((error: unknown) =>
              Effect.logWarning("agentBoard.scheduler.tick-failed", { error }),
            ),
            Effect.catchDefect((defect: unknown) =>
              Effect.logWarning("agentBoard.scheduler.tick-defect", { defect }),
            ),
            Effect.repeat(Schedule.spaced(Duration.millis(tickIntervalMs))),
          ),
        );

        yield* Effect.logInfo("agentBoard.scheduler.started", {
          tickIntervalMs,
          retryBaseDelayMs,
          retryMaxDelayMs,
          staleHeartbeatMs,
        });
      });

    return {
      start,
    } satisfies AgentBoardSchedulerShape;
  });

/** Builds the scheduler service layer; options exist for tests/fast ticks. */
export const makeAgentBoardSchedulerLive = (options?: AgentBoardSchedulerLiveOptions) =>
  Layer.effect(AgentBoardScheduler, makeAgentBoardScheduler(options));

export const AgentBoardSchedulerLive = makeAgentBoardSchedulerLive();
