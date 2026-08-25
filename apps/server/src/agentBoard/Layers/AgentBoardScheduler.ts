import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
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
      const withoutCurrentError = (runtime: AgentBoardCard["runtime"]) => {
        const { currentError: _clearedError, ...rest } = runtime;
        return rest;
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
          const timestamp = yield* nowIso;
          yield* Effect.logInfo("agentBoard.scheduler.run-completed", {
            cwd,
            cardId: card.id,
            threadId: card.runtime.implementationRunId,
          });
          applyPatch(card.id, (current) =>
            Object.assign({}, current, {
              state: "Review" as const,
              runtime: withoutCurrentError(current.runtime),
              updatedAt: timestamp,
            }),
          );
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

      if (dirty) {
        const timestamp = yield* nowIso;
        const saved = yield* boardFiles.save({
          cwd,
          board: { ...board, updatedAt: timestamp },
        });
        board = saved.board;
        dirty = false;
      }

      // --- Abort active turns for cards the user moved out of `Running`. ---
      for (const card of board.cards.filter(
        (candidate) =>
          candidate.state !== "Running" && candidate.runtime.implementationRunId !== undefined,
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

      // --- Claim eligible `Ready` cards up to the concurrency cap. ---
      const runningCount = board.cards.filter((candidate) => candidate.state === "Running").length;
      const capacity = board.runner.maxConcurrentCards - runningCount;
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
          if (
            Option.isSome(previousThread) &&
            previousThread.value.latestTurn?.state === "running"
          ) {
            yield* Effect.logInfo("agentBoard.scheduler.claim-deferred-active-run", {
              cwd,
              cardId: candidate.id,
              threadId: previousRunId,
            });
            continue;
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
