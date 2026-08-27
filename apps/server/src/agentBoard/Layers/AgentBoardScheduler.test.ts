import { Clock, Duration, Effect, FileSystem, Layer, Option, Stream } from "effect";
import { describe, expect, it } from "@effect/vitest";
import {
  type AgentBoardCard,
  type AgentBoardFile,
  type AgentBoardNonReadyCard,
  type AgentBoardRunInput,
  type AgentBoardRunResult,
  type OrchestrationCommand,
  ProjectId,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { MISSING_WORKER_CONFIG_ERROR } from "@t3tools/shared/agentBoardRunner";

import * as NodeServices from "@effect/platform-node/NodeServices";

import { AgentBoardFileSystem } from "../Services/AgentBoardFileSystem.ts";
import { AgentBoardFileSystemLive } from "./AgentBoardFileSystem.ts";
import { AgentBoardRunner, AgentBoardRunnerError } from "../Services/AgentBoardRunner.ts";
import { AgentBoardScheduler } from "../Services/AgentBoardScheduler.ts";
import { makeAgentBoardSchedulerLive } from "./AgentBoardScheduler.ts";
import * as WorkspacePathsModule from "../../workspace/WorkspacePaths.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { OrchestrationCommandInvariantError } from "../../orchestration/Errors.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";

const T0 = "2026-05-05T12:00:00.000Z";
const TFRESH = "2026-06-01T00:00:00.000Z";
const PROJECT_ID = ProjectId.make("prj_scheduler_test");
const MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.2",
} as const;

type FakeTurnState = "running" | "interrupted" | "completed" | "error";

interface FakeThreadEntry {
  readonly latestTurnState: FakeTurnState | null;
  readonly sessionStatus:
    | "starting"
    | "running"
    | "ready"
    | "interrupted"
    | "stopped"
    | "error"
    | null;
  readonly lastError: string | null;
  readonly updatedAt: string;
}

const isTornRead = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { _tag?: string })._tag === "AgentBoardFileSystemError" &&
  (error as { operation?: string }).operation === "agentBoard.decode";

// Live-clock bounded wait for observable state changes.
// Live-clock bounded wait for observable state changes. The scheduler runs on
// the real clock under `it.live`, so polling through Clock keeps the timing
// semantics identical to production.
const waitFor = <E, R>(
  predicate: () => Effect.Effect<boolean, E, R>,
  timeoutMs = 8_000,
): Effect.Effect<void, E, R> =>
  Effect.gen(function* () {
    const deadline = (yield* Clock.currentTimeMillis) + timeoutMs;
    for (;;) {
      if (yield* predicate()) return;
      if ((yield* Clock.currentTimeMillis) >= deadline) {
        return yield* Effect.die(new Error("Timed out waiting for expectation."));
      }
      yield* Effect.sleep(Duration.millis(5));
    }
  });

const pause = (ms: number): Effect.Effect<void> => Effect.sleep(Duration.millis(ms));

const drainFibers = Effect.forEach(Array.from({ length: 25 }), () => Effect.yieldNow, {
  discard: true,
});

const makeCard = (
  overrides: Partial<AgentBoardNonReadyCard> & { readonly id: string },
): AgentBoardCard =>
  ({
    title: `Card ${overrides.id}`,
    state: "Ready",
    priority: 1,
    dependencies: [],
    runtime: { attemptCount: 0 },
    createdAt: T0,
    updatedAt: T0,
    intentBrief: { intent: `Implement ${overrides.id}.` },
    ...overrides,
  }) as AgentBoardCard;

const makeHarness = Effect.fn("AgentBoardScheduler.test.harness")(function* (options?: {
  readonly maxConcurrentCards?: number;
  readonly repairCycles?: number;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const cwd = yield* fileSystem.makeTempDirectory({ prefix: "t3code-board-scheduler-" });
  yield* Effect.addFinalizer(() => fileSystem.remove(cwd, { recursive: true }).pipe(Effect.ignore));

  // Real board persistence over the temp directory; resolved outside the
  // scheduler environment so the fake runner can drive it directly.
  const boardFiles = yield* AgentBoardFileSystem.pipe(
    Effect.provide(
      AgentBoardFileSystemLive.pipe(
        Layer.provide(WorkspacePathsModule.layer),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );

  const fakeThreads = new Map<string, FakeThreadEntry>();
  const dispatched: Array<OrchestrationCommand> = [];
  const runCalls: Array<AgentBoardRunInput> = [];
  let launchMode: "launch" | "missing-config" = "launch";
  let launchedThreadCounter = 0;
  let schedulerSaveCount = 0;

  const toRunnerFailure = (cardId: string, operation: string, cause: unknown) =>
    new AgentBoardRunnerError({
      cwd,
      cardId,
      operation,
      detail: cause instanceof Error ? cause.message : String(cause),
    });

  const patchCard = (
    cardId: string,
    mutate: (card: AgentBoardCard) => AgentBoardCard,
  ): Effect.Effect<AgentBoardCard, AgentBoardRunnerError> =>
    Effect.gen(function* () {
      const loaded = yield* boardFiles
        .load({ cwd, createIfMissing: false })
        .pipe(Effect.mapError((cause) => toRunnerFailure(cardId, "test.load", cause)));
      const index = loaded.board.cards.findIndex((card) => card.id === cardId);
      const current = index === -1 ? undefined : loaded.board.cards[index];
      if (current === undefined) {
        return yield* new AgentBoardRunnerError({
          cwd,
          cardId,
          operation: "test.patch",
          detail: `card not found: ${cardId}`,
        });
      }
      const updatedCard = mutate(current);
      const nextCards = [...loaded.board.cards];
      nextCards[index] = updatedCard;
      yield* boardFiles
        .save({ cwd, board: { ...loaded.board, cards: nextCards } })
        .pipe(Effect.mapError((cause) => toRunnerFailure(cardId, "test.save", cause)));
      return updatedCard;
    });

  const threadShell = (id: string, entry: FakeThreadEntry) =>
    ({
      id: ThreadId.make(id),
      projectId: PROJECT_ID,
      title: `Thread ${id}`,
      modelSelection: MODEL_SELECTION,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      latestTurn:
        entry.latestTurnState === null
          ? null
          : {
              turnId: TurnId.make(`turn-${id}`),
              state: entry.latestTurnState,
              requestedAt: T0,
              startedAt: T0,
              completedAt: null,
              assistantMessageId: null,
            },
      createdAt: T0,
      updatedAt: entry.updatedAt,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      session:
        entry.sessionStatus === null
          ? null
          : {
              threadId: ThreadId.make(id),
              status: entry.sessionStatus,
              providerName: "codex",
              runtimeMode: "full-access",
              activeTurnId: entry.latestTurnState === "running" ? TurnId.make(`turn-${id}`) : null,
              lastError: entry.lastError,
              updatedAt: entry.updatedAt,
            },
      latestUserMessageAt: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
    }) as unknown as import("@t3tools/contracts").OrchestrationThreadShell;

  const fakeDetails = new Map<string, { text: string }>();
  const projectionSnapshotQueryLayer = Layer.mock(ProjectionSnapshotQuery)({
    getShellSnapshot: () =>
      Effect.succeed({
        snapshotSequence: 0,
        updatedAt: T0,
        projects: [
          {
            id: PROJECT_ID,
            title: "Scheduler project",
            workspaceRoot: cwd,
            defaultModelSelection: MODEL_SELECTION,
            scripts: [],
            createdAt: T0,
            updatedAt: T0,
          },
        ],
        threads: [],
      } as unknown as import("@t3tools/contracts").OrchestrationShellSnapshot),
    getActiveProjectByWorkspaceRoot: (workspaceRoot: string) =>
      Effect.succeed(
        workspaceRoot === cwd
          ? Option.some({
              id: PROJECT_ID,
              title: "Scheduler project",
              workspaceRoot: cwd,
              defaultModelSelection: MODEL_SELECTION,
              scripts: [],
              createdAt: T0,
              updatedAt: T0,
            } as unknown as import("@t3tools/contracts").OrchestrationProject)
          : Option.none(),
      ),
    getThreadShellById: (threadId: ThreadId) =>
      Effect.suspend(() => {
        const entry = fakeThreads.get(threadId);
        return Effect.succeed(
          entry === undefined ? Option.none() : Option.some(threadShell(threadId, entry)),
        );
      }),
    getThreadDetailById: (threadId: ThreadId) =>
      Effect.suspend(() => {
        const detail = fakeDetails.get(threadId);
        const entry = fakeThreads.get(threadId);
        if (entry === undefined) return Effect.succeed(Option.none());
        const text = detail?.text ?? "";
        return Effect.succeed(
          Option.some({
            thread: {
              id: threadId,
              messages: text ? [{ role: "assistant", text }] : [],
              activities: [],
            },
          } as unknown as import("@t3tools/contracts").OrchestrationThreadDetailSnapshot),
        );
      }),
  } as unknown as ProjectionSnapshotQuery["Service"]);

  const orchestrationEngineLayer = Layer.mock(OrchestrationEngineService)({
    dispatch: (command: OrchestrationCommand) =>
      Effect.suspend(() => {
        if (command.type === "thread.create") {
          fakeThreads.set(command.threadId, {
            latestTurnState: "running",
            sessionStatus: "running",
            lastError: null,
            updatedAt: TFRESH,
          });
          dispatched.push(command);
          return Effect.succeed({ sequence: dispatched.length });
        }
        // Mirror decider.requireThread: continuations onto threads the
        // projection no longer knows are rejected before being recorded.
        if (command.type === "thread.turn.start" && !fakeThreads.has(command.threadId)) {
          return Effect.fail(
            new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: `Thread '${command.threadId}' does not exist.`,
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

  const mockRunnerLayer = Layer.succeed(AgentBoardRunner, {
    run: (input: AgentBoardRunInput) =>
      Effect.suspend(() =>
        Effect.gen(function* () {
          runCalls.push(input);
          const loaded = yield* boardFiles
            .load({ cwd: input.cwd, createIfMissing: false })
            .pipe(
              Effect.mapError((cause) => toRunnerFailure(input.cardId, "agentBoard.claim", cause)),
            );
          const card = loaded.board.cards.find((candidate) => candidate.id === input.cardId);
          if (card === undefined || card.state !== "Ready") {
            return yield* new AgentBoardRunnerError({
              cwd: input.cwd,
              cardId: input.cardId,
              operation: "agentBoard.claim",
              detail: "Only Ready cards can be claimed.",
            });
          }

          if (launchMode === "missing-config") {
            yield* patchCard(input.cardId, (current) =>
              Object.assign({}, current, {
                state: "Blocked",
                runtime: { ...current.runtime, currentError: MISSING_WORKER_CONFIG_ERROR },
                updatedAt: TFRESH,
              }),
            );
            return yield* new AgentBoardRunnerError({
              cwd: input.cwd,
              cardId: input.cardId,
              operation: "workerModelSelection.resolve",
              detail: MISSING_WORKER_CONFIG_ERROR,
            });
          }

          const threadId = `thread-${++launchedThreadCounter}`;
          fakeThreads.set(threadId, {
            latestTurnState: "running",
            sessionStatus: "running",
            lastError: null,
            updatedAt: TFRESH,
          });
          const updatedCard = yield* patchCard(input.cardId, (current) =>
            Object.assign({}, current, {
              state: "Running",
              runtime: {
                ...current.runtime,
                attemptCount: current.runtime.attemptCount + 1,
                implementationRunId: RuntimeSessionId.make(threadId),
                lastHeartbeatAt: TFRESH,
                workspacePath: `.t3/workspaces/${current.id}`,
              },
              updatedAt: TFRESH,
            }),
          );
          return {
            board: loaded.board,
            card: updatedCard,
            threadId: RuntimeSessionId.make(threadId),
            workspacePath: `${input.cwd}/.t3/workspaces/${input.cardId}`,
          } satisfies AgentBoardRunResult;
        }),
      ),
  });

  // Counts only scheduler-driven saves; the fake runner persists through the
  // raw service so launch writes stay out of the tally.
  const countingBoardLayer = Layer.succeed(AgentBoardFileSystem, {
    load: (input) => boardFiles.load(input),
    save: (input) =>
      Effect.suspend(() =>
        Effect.gen(function* () {
          schedulerSaveCount += 1;
          return yield* boardFiles.save(input);
        }),
      ),
    claim: (input) => boardFiles.claim(input),
  });

  // Long stale-heartbeat threshold: liveness failures must come from the
  // explicit thread/session states under test, not wall-clock staleness.
  const schedulerEnvironment = makeAgentBoardSchedulerLive({
    tickIntervalMs: 20,
    retryBaseDelayMs: 40,
    staleHeartbeatMs: 10 * 365 * 24 * 60 * 60 * 1000,
  }).pipe(
    Layer.provideMerge(countingBoardLayer),
    Layer.provideMerge(mockRunnerLayer),
    Layer.provideMerge(orchestrationEngineLayer),
    Layer.provideMerge(Layer.mock(GitWorkflowService)({})),
    Layer.provideMerge(projectionSnapshotQueryLayer),
    Layer.provideMerge(NodeServices.layer),
  );

  const scheduler = yield* AgentBoardScheduler.pipe(Effect.provide(schedulerEnvironment));

  return {
    cwd,
    start: () => scheduler.start().pipe(Effect.provide(schedulerEnvironment)),
    seedBoard: (cards: ReadonlyArray<AgentBoardCard>) =>
      boardFiles
        .save({
          cwd,
          board: {
            schemaVersion: 1,
            projectRoot: "",
            defaultView: "kanban",
            runner: {
              maxConcurrentCards: options?.maxConcurrentCards ?? 1,
              repairCycles: options?.repairCycles ?? 3,
            },
            cards: [...cards],
            graphLinks: [],
            createdAt: T0,
            updatedAt: T0,
          },
        })
        .pipe(Effect.asVoid),
    // Concurrent writers (scheduler + fake runner) make torn reads possible;
    // assertion reads retry transient decode failures instead of failing.
    readBoard: (): Effect.Effect<AgentBoardFile> => {
      const attempt = (remaining: number): Effect.Effect<AgentBoardFile> =>
        boardFiles.load({ cwd, createIfMissing: false }).pipe(
          Effect.map((loaded) => loaded.board),
          Effect.catch((error) =>
            isTornRead(error) && remaining > 0
              ? Effect.sleep(Duration.millis(5)).pipe(Effect.andThen(attempt(remaining - 1)))
              : Effect.fail(error as never),
          ),
        );
      return attempt(400);
    },
    threads: fakeThreads,
    dispatchedCommands: () => dispatched,
    runCalls: () => runCalls,
    setLaunchMode: (mode: "launch" | "missing-config") => {
      launchMode = mode;
    },
    schedulerSaves: () => schedulerSaveCount,
    setReviewText: (threadId: string, text: string) => {
      fakeDetails.set(threadId, { text });
    },
    setThread: (threadId: string, entry: FakeThreadEntry) => {
      fakeThreads.set(threadId, entry);
    },
  };
});

describe("AgentBoardSchedulerLive", () => {
  it.live("claims an eligible Ready card through the runner service", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.seedBoard([makeCard({ id: "c1" })]);
      yield* harness.start();

      yield* waitFor(() => Effect.sync(() => harness.runCalls().length === 1));
      expect(harness.runCalls()[0]).toEqual({ cwd: harness.cwd, cardId: "c1" });
      yield* waitFor(() =>
        harness.readBoard().pipe(Effect.map((board) => board.cards[0]?.state === "Running")),
      );
      const board = yield* harness.readBoard();
      const card = board.cards[0];
      expect(card?.runtime.implementationRunId).toBe("thread-1");
      expect(card?.runtime.attemptCount).toBe(1);
      // A plain claim involves the scheduler in no orchestration dispatches.
      expect(harness.dispatchedCommands()).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("never exceeds runner.maxConcurrentCards", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ maxConcurrentCards: 1 });
      yield* harness.seedBoard([makeCard({ id: "c1" }), makeCard({ id: "c2" })]);
      yield* harness.start();

      yield* waitFor(() => Effect.sync(() => harness.runCalls().length === 1));
      // Give several ticks a chance to over-claim before asserting the cap.
      yield* pause(150);
      expect(harness.runCalls().length).toBe(1);
      const board = yield* harness.readBoard();
      expect(board.cards.find((card) => card.id === "c2")?.state).toBe("Ready");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("skips Ready cards whose dependencies are not Done", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ maxConcurrentCards: 5 });
      yield* harness.seedBoard([
        makeCard({ id: "dep" }),
        makeCard({ id: "dependent", dependencies: ["dep"] }),
      ]);
      yield* harness.start();

      yield* waitFor(() =>
        Effect.sync(() => harness.runCalls().some((call) => call.cardId === "dep")),
      );
      yield* pause(80);
      expect(harness.runCalls().some((call) => call.cardId === "dependent")).toBe(false);

      // Once the dependency lands Done, the dependent card becomes eligible.
      const board = yield* harness.readBoard();
      yield* harness.seedBoard(
        board.cards.map((card) =>
          card.id === "dep"
            ? ({ ...card, state: "Done", intentBrief: card.intentBrief } as AgentBoardCard)
            : card,
        ),
      );
      yield* waitFor(() =>
        Effect.sync(() => harness.runCalls().some((call) => call.cardId === "dependent")),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live(
    "moves completed runs to Reviewing with a fresh review thread and clears the current error",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        harness.threads.set("t1", {
          latestTurnState: "completed",
          sessionStatus: "ready",
          lastError: null,
          updatedAt: TFRESH,
        });
        yield* harness.seedBoard([
          makeCard({
            id: "c1",
            state: "Running",
            runtime: {
              attemptCount: 1,
              implementationRunId: RuntimeSessionId.make("t1"),
              lastHeartbeatAt: T0,
              currentError: "stale error from earlier",
              workspacePath: ".t3/workspaces/c1",
              branchName: "board/c1",
            },
          }),
        ]);
        yield* harness.start();

        yield* waitFor(() =>
          harness.readBoard().pipe(Effect.map((board) => board.cards[0]?.state === "Reviewing")),
        );
        const card = (yield* harness.readBoard()).cards[0];
        expect(card?.runtime.currentError).toBeUndefined();
        expect(card?.runtime.attemptCount).toBe(1);
        expect(card?.runtime.reviewRunId).toBeDefined();
        expect(card?.runtime.reviewRunId).not.toBe(card?.runtime.implementationRunId);
        const creates = harness.dispatchedCommands().filter((c) => c.type === "thread.create");
        expect(creates.length).toBe(1);
        if (creates[0]?.type === "thread.create") {
          expect(creates[0].role).toBeUndefined();
          expect(creates[0].worktreePath).toBe(`${harness.cwd}/.t3/workspaces/c1`);
          expect(creates[0].branch).toBe("board/c1");
        }
        const reviewStarts = harness
          .dispatchedCommands()
          .filter(
            (c) =>
              c.type === "thread.turn.start" &&
              (c as { threadId: string }).threadId === card?.runtime.reviewRunId,
          );
        expect(reviewStarts.length).toBe(1);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("retries failed runs with backoff, then moves to Needs Decision at the cap", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ repairCycles: 3 });
      harness.threads.set("t1", {
        latestTurnState: "error",
        sessionStatus: "error",
        lastError: "boom",
        updatedAt: TFRESH,
      });
      yield* harness.seedBoard([
        makeCard({
          id: "c1",
          state: "Running",
          runtime: {
            attemptCount: 1,
            implementationRunId: RuntimeSessionId.make("t1"),
            lastHeartbeatAt: TFRESH,
          },
        }),
      ]);
      yield* harness.start();

      // First failure -> persistent attempt increment + scheduled retry.
      yield* waitFor(() =>
        harness.readBoard().pipe(Effect.map((board) => board.cards[0]?.runtime.attemptCount === 2)),
      );
      let card = (yield* harness.readBoard()).cards[0];
      expect(card?.state).toBe("Running");
      expect(card?.runtime.currentError).toContain("boom");

      // Backoff elapses -> one continuation turn on the SAME thread.
      yield* waitFor(() =>
        Effect.sync(() =>
          harness
            .dispatchedCommands()
            .some((command) => command.type === "thread.turn.start" && command.threadId === "t1"),
        ),
      );

      // The retried turn fails again -> second failure recorded.
      yield* waitFor(() =>
        harness.readBoard().pipe(Effect.map((board) => board.cards[0]?.runtime.attemptCount === 3)),
      );

      // Third failure crosses repairCycles -> Needs Decision with a summary.
      yield* waitFor(() =>
        harness.readBoard().pipe(Effect.map((board) => board.cards[0]?.state === "Needs Decision")),
      );
      card = (yield* harness.readBoard()).cards[0];
      expect(card?.runtime.currentError).toContain("3 attempt(s)");
      expect(card?.runtime.currentError).toContain("boom");

      // Exactly two continuation turns were attempted before giving up, both
      // on the same thread, neither resending the full implementation prompt.
      const continuationTurns = harness
        .dispatchedCommands()
        .filter((command) => command.type === "thread.turn.start");
      expect(continuationTurns.length).toBe(2);
      for (const command of continuationTurns) {
        if (command.type !== "thread.turn.start") throw new Error("unreachable");
        expect(command.threadId).toBe("t1");
        expect(command.message.text).toContain('Continue agent board card "c1"');
        expect(command.message.text).not.toContain("PLEASE IMPLEMENT");
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("aborts the active turn once when the user moves a card out of Running", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      harness.threads.set("t1", {
        latestTurnState: "running",
        sessionStatus: "running",
        lastError: null,
        updatedAt: TFRESH,
      });
      yield* harness.seedBoard([
        makeCard({
          id: "c1",
          state: "Running",
          runtime: {
            attemptCount: 1,
            implementationRunId: RuntimeSessionId.make("t1"),
            lastHeartbeatAt: TFRESH,
          },
        }),
      ]);
      yield* harness.start();
      yield* drainFibers;
      expect(harness.dispatchedCommands()).toEqual([]);

      // The user moves the claimed card to Done while its turn is active.
      const board = yield* harness.readBoard();
      yield* harness.seedBoard(
        board.cards.map((card) =>
          card.id === "c1"
            ? ({ ...card, state: "Done", intentBrief: card.intentBrief } as AgentBoardCard)
            : card,
        ),
      );

      yield* waitFor(() =>
        Effect.sync(() =>
          harness
            .dispatchedCommands()
            .some(
              (command) => command.type === "thread.turn.interrupt" && command.threadId === "t1",
            ),
        ),
      );

      // The abort guard prevents repeat interrupts, and the abandoned card is
      // never relaunched.
      yield* pause(120);
      const interrupts = harness
        .dispatchedCommands()
        .filter((command) => command.type === "thread.turn.interrupt");
      expect(interrupts.length).toBe(1);
      expect(harness.runCalls().length).toBe(0);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live(
    "treats an unresolvable implementationRunId thread as a failed attempt (restart recovery)",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({ repairCycles: 3 });
        // "ghost" was never registered in the fake projection: after a restart
        // the persisted thread reference no longer resolves.
        yield* harness.seedBoard([
          makeCard({
            id: "c1",
            state: "Running",
            runtime: {
              attemptCount: 1,
              implementationRunId: RuntimeSessionId.make("ghost"),
              lastHeartbeatAt: TFRESH,
            },
          }),
        ]);
        yield* harness.start();

        yield* waitFor(() =>
          harness
            .readBoard()
            .pipe(Effect.map((board) => board.cards[0]?.runtime.attemptCount === 2)),
        );
        const card = (yield* harness.readBoard()).cards[0];
        expect(card?.state).toBe("Running");
        expect(card?.runtime.currentError).toContain("ghost");
        // Nothing exists to continue onto: no orchestration dispatch ever fires.
        yield* pause(200);
        expect(harness.dispatchedCommands()).toEqual([]);
        // The repeated dead continuations drive the card to the cap.
        yield* waitFor(() =>
          harness
            .readBoard()
            .pipe(Effect.map((board) => board.cards[0]?.state === "Needs Decision")),
        );
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("refreshes the heartbeat only when the run actually progressed", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      harness.threads.set("t1", {
        latestTurnState: "running",
        sessionStatus: "running",
        lastError: null,
        updatedAt: TFRESH,
      });
      yield* harness.seedBoard([
        makeCard({
          id: "c1",
          state: "Running",
          runtime: {
            attemptCount: 1,
            implementationRunId: RuntimeSessionId.make("t1"),
            lastHeartbeatAt: T0,
          },
        }),
      ]);
      yield* harness.start();

      // Thread activity is newer than the stored heartbeat -> one refresh write.
      yield* waitFor(() =>
        harness.readBoard().pipe(
          Effect.map((board) => {
            const stored = board.cards[0]?.runtime.lastHeartbeatAt;
            return stored !== undefined && stored !== T0;
          }),
        ),
      );
      const refreshedHeartbeat = (yield* harness.readBoard()).cards[0]?.runtime.lastHeartbeatAt;
      const baselineSaves = harness.schedulerSaves();

      // No further thread progress -> idle ticks must not rewrite the board.
      yield* pause(150);
      const card = (yield* harness.readBoard()).cards[0];
      expect(card?.runtime.lastHeartbeatAt).toBe(refreshedHeartbeat);
      expect(harness.schedulerSaves()).toBe(baselineSaves);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("continues claiming after a launch failure and leaves the card Blocked", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ maxConcurrentCards: 5 });
      harness.setLaunchMode("missing-config");
      yield* harness.seedBoard([makeCard({ id: "c1" }), makeCard({ id: "c2" })]);
      yield* harness.start();

      yield* waitFor(() =>
        harness
          .readBoard()
          .pipe(Effect.map((board) => board.cards.every((card) => card.state === "Blocked"))),
      );
      expect(harness.runCalls().length).toBe(2);
      const board = yield* harness.readBoard();
      for (const card of board.cards) {
        expect(card.runtime.currentError).toBe(MISSING_WORKER_CONFIG_ERROR);
      }
      expect(harness.dispatchedCommands()).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("claims higher-priority cards first under the concurrency cap", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ maxConcurrentCards: 1 });
      yield* harness.seedBoard([
        makeCard({ id: "z-low", priority: 5 }),
        makeCard({ id: "a-high", priority: 1 }),
      ]);
      yield* harness.start();

      yield* waitFor(() => Effect.sync(() => harness.runCalls().length === 1));
      expect(harness.runCalls()[0]?.cardId).toBe("a-high");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("review PASS moves Reviewing to Review on fresh thread", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      harness.threads.set("t1", {
        latestTurnState: "completed",
        sessionStatus: "ready",
        lastError: null,
        updatedAt: TFRESH,
      });
      yield* harness.seedBoard([
        makeCard({
          id: "c1",
          state: "Running",
          runtime: {
            attemptCount: 1,
            implementationRunId: RuntimeSessionId.make("t1"),
            lastHeartbeatAt: T0,
            workspacePath: ".t3/workspaces/c1",
            branchName: "board/c1",
          },
        }),
      ]);
      yield* harness.start();
      yield* waitFor(() =>
        harness.readBoard().pipe(Effect.map((board) => board.cards[0]?.state === "Reviewing")),
      );
      const reviewingCard = (yield* harness.readBoard()).cards[0];
      const reviewId = reviewingCard?.runtime.reviewRunId as unknown as string;
      expect(reviewId).toBeDefined();
      harness.setReviewText(
        reviewId,
        "All acceptance criteria verified.\nREVIEW: PASS - proof complete",
      );
      harness.threads.set(reviewId, {
        latestTurnState: "completed",
        sessionStatus: "ready",
        lastError: null,
        updatedAt: TFRESH,
      });
      yield* waitFor(() =>
        harness.readBoard().pipe(Effect.map((board) => board.cards[0]?.state === "Review")),
      );
      const doneCard = (yield* harness.readBoard()).cards[0];
      expect(doneCard?.runtime.reviewRunId).toBe(reviewId);
      expect(doneCard?.runtime.currentError).toBeUndefined();
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("review FAIL moves to Diagnosing then repair and re-review", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ repairCycles: 3 });
      harness.threads.set("t1", {
        latestTurnState: "completed",
        sessionStatus: "ready",
        lastError: null,
        updatedAt: TFRESH,
      });
      yield* harness.seedBoard([
        makeCard({
          id: "c1",
          state: "Running",
          runtime: {
            attemptCount: 1,
            implementationRunId: RuntimeSessionId.make("t1"),
            lastHeartbeatAt: T0,
            workspacePath: ".t3/workspaces/c1",
          },
        }),
      ]);
      yield* harness.start();
      yield* waitFor(() =>
        harness.readBoard().pipe(Effect.map((board) => board.cards[0]?.state === "Reviewing")),
      );
      const reviewingCard = (yield* harness.readBoard()).cards[0];
      const reviewId = reviewingCard?.runtime.reviewRunId as unknown as string;
      harness.setReviewText(reviewId, "Missing tests.\nREVIEW: FAIL - tests failing");
      harness.threads.set(reviewId, {
        latestTurnState: "completed",
        sessionStatus: "ready",
        lastError: null,
        updatedAt: TFRESH,
      });
      yield* waitFor(() =>
        Effect.sync(() =>
          harness
            .dispatchedCommands()
            .some(
              (c) =>
                c.type === "thread.turn.start" && (c as { threadId: string }).threadId === "t1",
            ),
        ),
      );
      let card = (yield* harness.readBoard()).cards[0];
      expect(card?.runtime.attemptCount).toBe(2);
      expect(card?.runtime.currentError).toContain("tests failing");
      harness.threads.set("t1", {
        latestTurnState: "completed",
        sessionStatus: "ready",
        lastError: null,
        updatedAt: TFRESH,
      });
      yield* waitFor(() =>
        Effect.sync(
          () => harness.dispatchedCommands().filter((c) => c.type === "thread.create").length === 2,
        ),
      );
      // Now second review has been launched; complete it
      for (const [tid, entry] of Array.from(harness.threads.entries())) {
        if (entry.latestTurnState === "running") {
          harness.setReviewText(tid, "REVIEW: PASS");
          harness.threads.set(tid, {
            latestTurnState: "completed",
            sessionStatus: "ready",
            lastError: null,
            updatedAt: TFRESH,
          });
        }
      }
      yield* Effect.logInfo("test set second review to PASS", {
        threads: Array.from(harness.threads.entries()).map(([k, v]) => [k, v.latestTurnState]),
      });
      yield* waitFor(() =>
        harness.readBoard().pipe(Effect.map((board) => board.cards[0]?.state === "Review")),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("cap repairCycles moves to Needs Decision with summary", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ repairCycles: 2 });
      harness.threads.set("t1", {
        latestTurnState: "completed",
        sessionStatus: "ready",
        lastError: null,
        updatedAt: TFRESH,
      });
      yield* harness.seedBoard([
        makeCard({
          id: "c1",
          state: "Running",
          runtime: {
            attemptCount: 1,
            implementationRunId: RuntimeSessionId.make("t1"),
            lastHeartbeatAt: T0,
            workspacePath: ".t3/workspaces/c1",
          },
        }),
      ]);
      yield* harness.start();
      yield* waitFor(() =>
        harness.readBoard().pipe(Effect.map((board) => board.cards[0]?.state === "Reviewing")),
      );
      const r1 = (yield* harness.readBoard()).cards[0]?.runtime.reviewRunId as unknown as string;
      harness.setReviewText(r1, "REVIEW: FAIL - still broken");
      harness.threads.set(r1, {
        latestTurnState: "completed",
        sessionStatus: "ready",
        lastError: null,
        updatedAt: TFRESH,
      });
      yield* waitFor(() =>
        Effect.sync(() =>
          harness
            .dispatchedCommands()
            .some(
              (c) =>
                c.type === "thread.turn.start" && (c as { threadId: string }).threadId === "t1",
            ),
        ),
      );
      harness.threads.set("t1", {
        latestTurnState: "completed",
        sessionStatus: "ready",
        lastError: null,
        updatedAt: TFRESH,
      });
      yield* Effect.logInfo("test set t1 completed, waiting for second create", {
        dispatched: harness.dispatchedCommands().filter((c) => c.type === "thread.create").length,
      });
      yield* waitFor(() =>
        Effect.sync(
          () => harness.dispatchedCommands().filter((c) => c.type === "thread.create").length === 2,
        ),
      );
      yield* Effect.logInfo("test second create arrived", {
        dispatched: harness.dispatchedCommands().filter((c) => c.type === "thread.create").length,
      });
      for (const [tid, entry] of Array.from(harness.threads.entries())) {
        if (entry.latestTurnState === "running") {
          harness.setReviewText(tid, "REVIEW: FAIL - still broken again");
          harness.threads.set(tid, {
            latestTurnState: "completed",
            sessionStatus: "ready",
            lastError: null,
            updatedAt: TFRESH,
          });
        }
      }
      yield* Effect.logInfo("test set second review to FAIL", {
        threads: Array.from(harness.threads.entries()).map(([k, v]) => [k, v.latestTurnState]),
      });
      yield* waitFor(() =>
        harness.readBoard().pipe(Effect.map((board) => board.cards[0]?.state === "Needs Decision")),
      );
      const card = (yield* harness.readBoard()).cards[0];
      expect(card?.runtime.currentError).toContain("exhausted");
      expect(card?.runtime.currentError).toContain("still broken");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("intent question goes directly to Needs Decision", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      harness.threads.set("t1", {
        latestTurnState: "completed",
        sessionStatus: "ready",
        lastError: null,
        updatedAt: TFRESH,
      });
      yield* harness.seedBoard([
        makeCard({
          id: "c1",
          state: "Running",
          runtime: {
            attemptCount: 1,
            implementationRunId: RuntimeSessionId.make("t1"),
            lastHeartbeatAt: T0,
            workspacePath: ".t3/workspaces/c1",
          },
        }),
      ]);
      yield* harness.start();
      yield* waitFor(() =>
        harness.readBoard().pipe(Effect.map((board) => board.cards[0]?.state === "Reviewing")),
      );
      const reviewId = (yield* harness.readBoard()).cards[0]?.runtime
        .reviewRunId as unknown as string;
      harness.setReviewText(reviewId, "NEEDS_DECISION: Do we need OAuth for this?");
      harness.threads.set(reviewId, {
        latestTurnState: "completed",
        sessionStatus: "ready",
        lastError: null,
        updatedAt: TFRESH,
      });
      yield* waitFor(() =>
        harness.readBoard().pipe(Effect.map((board) => board.cards[0]?.state === "Needs Decision")),
      );
      const card = (yield* harness.readBoard()).cards[0];
      expect(card?.runtime.currentDecisionQuestion).toContain("OAuth");
      expect(card?.runtime.currentError).toContain("OAuth");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("survives an unreadable board and resumes once it decodes again", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const fileSystem = yield* FileSystem.FileSystem;
      // Corrupt JSON: decode failures are logged per tick but must never kill
      // the always-on loop or launch anything.
      yield* fileSystem.makeDirectory(`${harness.cwd}/.t3`, { recursive: true });
      yield* fileSystem.writeFileString(
        `${harness.cwd}/.t3/agent-board.json`,
        "{ this is not a board",
      );
      yield* harness.start();

      yield* pause(120);
      expect(harness.runCalls().length).toBe(0);
      expect(harness.dispatchedCommands()).toEqual([]);

      // Once the board becomes readable again, claiming resumes normally.
      yield* harness.seedBoard([makeCard({ id: "c1" })]);
      yield* waitFor(() => Effect.sync(() => harness.runCalls().length === 1));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
