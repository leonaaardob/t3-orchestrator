import { Effect, FileSystem, Layer, Option, Path } from "effect";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type AgentBoardFile,
  MessageId,
  RuntimeSessionId,
  ThreadId,
} from "@t3tools/contracts";
import {
  buildAgentBoardImplementationPrompt,
  buildAgentBoardImplementationThreadTitle,
} from "@t3tools/shared/agentBoardPrompt";
import {
  MISSING_WORKER_CONFIG_ERROR,
  resolveWorkerModelSelection,
} from "@t3tools/shared/agentBoardRunner";

import { AgentBoardFileSystem } from "../Services/AgentBoardFileSystem.ts";
import {
  AgentBoardRunner,
  AgentBoardRunnerError,
  type AgentBoardRunnerShape,
} from "../Services/AgentBoardRunner.ts";
import { safeWorkspaceSegment } from "./AgentBoardFileSystem.ts";
import { WorkspacePaths } from "../../workspace/WorkspacePaths.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import type { OrchestrationDispatchError } from "../../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";

/** The card branch checked out inside the card worktree. */
const boardBranchForCard = (cardId: string): string => `board/${cardId}`;

export const makeAgentBoardRunner = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const workspacePaths = yield* WorkspacePaths;

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  // Random UUID generation has no recoverable failure mode; surfaced as a
  // defect so the service error channel stays fully typed.
  const nextUuid = Effect.orDie(crypto.randomUUIDv4);

  const toRunnerError =
    (input: { readonly cwd: string; readonly cardId: string }) =>
    (operation: string, cause: unknown): AgentBoardRunnerError =>
      new AgentBoardRunnerError({
        cwd: input.cwd,
        cardId: input.cardId,
        operation,
        detail: cause instanceof Error && cause.message.length > 0 ? cause.message : String(cause),
        ...(cause === undefined ? {} : { cause }),
      });

  /**
   * Persist one card's runtime delta onto the claimed board. Mirrors the
   * board-runtime save shape the web client performed before runs moved
   * server-side.
   */
  const saveCardRuntime = Effect.fn("AgentBoardRunner.saveCardRuntime")(function* (input: {
    readonly boardFiles: AgentBoardFileSystem["Service"];
    readonly cwd: string;
    readonly board: AgentBoardFile;
    readonly cardId: string;
    readonly state: "Running" | "Blocked";
    readonly implementationRunId?: RuntimeSessionId;
    readonly currentError?: string;
  }) {
    const timestamp = yield* nowIso;
    const nextBoard: AgentBoardFile = {
      ...input.board,
      cards: input.board.cards.map((card) => {
        if (card.id !== input.cardId) return card;
        const runtime = Object.assign(
          {},
          card.runtime,
          { lastHeartbeatAt: timestamp },
          input.implementationRunId ? { implementationRunId: input.implementationRunId } : {},
          input.currentError ? { currentError: input.currentError } : {},
        );
        return Object.assign({}, card, {
          state: input.state,
          runtime,
          updatedAt: timestamp,
        });
      }),
      updatedAt: timestamp,
    };
    return yield* input.boardFiles.save({ cwd: input.cwd, board: nextBoard });
  });

  const run: AgentBoardRunnerShape["run"] = (input) =>
    Effect.gen(function* () {
      // Collaborators resolve per call so the Live layer stays free of
      // cross-domain build-time requirements; the calling fiber (RPC handler
      // or the part-2 scheduler) carries them.
      const boardFiles = yield* AgentBoardFileSystem;
      const gitWorkflow = yield* GitWorkflowService;
      const orchestrationEngine = yield* OrchestrationEngineService;
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

      const toError = toRunnerError(input);

      // 1. Claim: Ready-only, attemptCount++, heartbeat + workspacePath set.
      const claimed = yield* boardFiles
        .claim(input)
        .pipe(Effect.mapError((cause) => toError("agentBoard.claim", cause)));

      // Every launch failure below must leave the card Blocked with the error
      // persisted; that save itself is best-effort so the original failure
      // still surfaces to the caller.
      const blockAndFail = Effect.fn("AgentBoardRunner.blockAndFail")(function* (
        operation: string,
        detail: string,
        cause?: unknown,
      ) {
        yield* saveCardRuntime({
          boardFiles,
          cwd: input.cwd,
          board: claimed.board,
          cardId: input.cardId,
          state: "Blocked",
          currentError: detail,
        }).pipe(Effect.ignoreCause({ log: true }));
        return yield* new AgentBoardRunnerError({
          cwd: input.cwd,
          cardId: input.cardId,
          operation,
          detail,
          ...(cause === undefined ? {} : { cause }),
        });
      });

      // 2. Resolve the owning project for thread creation and the default
      // model selection.
      const projectRoot = yield* workspacePaths
        .normalizeWorkspaceRoot(input.cwd)
        .pipe(Effect.mapError((cause) => toError("workspace.normalize", cause)));
      const projectOption = yield* projectionSnapshotQuery
        .getActiveProjectByWorkspaceRoot(projectRoot)
        .pipe(Effect.mapError((cause) => toError("project.lookup", cause)));

      // Worker execution is centrally configured, never composer-first: the
      // board's runner override wins, then the project default. Missing config
      // blocks the card before any thread exists.
      const resolution = resolveWorkerModelSelection(
        claimed.board,
        Option.isSome(projectOption) ? projectOption.value.defaultModelSelection : null,
      );
      if (resolution._tag === "missing-config") {
        return yield* blockAndFail("workerModelSelection.resolve", MISSING_WORKER_CONFIG_ERROR);
      }
      if (Option.isNone(projectOption)) {
        return yield* blockAndFail(
          "project.lookup",
          `No active project matches the board workspace root: ${projectRoot}`,
        );
      }
      const project = projectOption.value;

      // 3. Card worktree: a REAL git worktree at
      // <projectRoot>/.t3/workspaces/<safe-card-id> on branch board/<card-id>,
      // created once from the project HEAD and reused across attempts. Claim
      // pre-creates the plain folder, so reuse means "already contains a
      // worktree checkout" (.git marker file).
      const relativeWorktreePath = `.t3/workspaces/${safeWorkspaceSegment(input.cardId)}`;
      const resolvedWorktreePath = yield* workspacePaths
        .resolveRelativePathWithinRoot({
          workspaceRoot: projectRoot,
          relativePath: relativeWorktreePath,
        })
        .pipe(Effect.mapError((cause) => toError("workspace.resolve", cause)));
      const branchName = boardBranchForCard(input.cardId);

      const hasGitMarker = yield* fileSystem
        .exists(path.join(resolvedWorktreePath.absolutePath, ".git"))
        .pipe(Effect.mapError((cause) => toError("worktree.stat", cause)));
      const worktreePath = hasGitMarker
        ? resolvedWorktreePath.absolutePath
        : yield* gitWorkflow
            .createWorktree({
              cwd: projectRoot,
              refName: "HEAD",
              newRefName: branchName,
              path: resolvedWorktreePath.absolutePath,
            })
            .pipe(
              Effect.map((result) => result.worktree.path),
              Effect.mapError((cause) => toError("worktree.create", cause)),
            );

      // 4. Launch through the orchestration engine directly — dispatch is
      // fully self-contained (events + projections persist transactionally),
      // so no WS command normalization is needed.
      const createdAt = yield* nowIso;
      const threadId = ThreadId.make(yield* nextUuid);
      const threadTitle = buildAgentBoardImplementationThreadTitle(claimed.card);

      // Mirror ws.ts bootstrap cleanup: deleting a just-created thread after a
      // failed turn start must never mask the original launch failure.
      const deleteCreatedThread = () =>
        Effect.flatMap(nextUuid, (commandId) =>
          orchestrationEngine.dispatch({
            type: "thread.delete",
            commandId: CommandId.make(commandId),
            threadId,
          }),
        ).pipe(Effect.ignoreCause({ log: true }));

      // Engine dispatches are inspected rather than short-circuited so each
      // failure can persist the Blocked card state before surfacing.
      const dispatchOutcome = <A>(
        effect: Effect.Effect<A, OrchestrationDispatchError>,
      ): Effect.Effect<
        | { readonly _tag: "ok"; readonly value: A }
        | { readonly _tag: "error"; readonly error: OrchestrationDispatchError }
      > =>
        Effect.matchEffect(effect, {
          onFailure: (error) => Effect.succeed({ _tag: "error" as const, error }),
          onSuccess: (value) => Effect.succeed({ _tag: "ok" as const, value }),
        });

      const createOutcome = yield* dispatchOutcome(
        orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: CommandId.make(yield* nextUuid),
          threadId,
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
        return yield* blockAndFail(
          "thread.create",
          createOutcome.error.message,
          createOutcome.error,
        );
      }

      const turnStartOutcome = yield* dispatchOutcome(
        orchestrationEngine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(yield* nextUuid),
          threadId,
          message: {
            messageId: MessageId.make(yield* nextUuid),
            role: "user",
            text: buildAgentBoardImplementationPrompt(claimed.card),
            attachments: [],
          },
          modelSelection: resolution.selection,
          titleSeed: threadTitle,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          createdAt,
        }),
      );
      if (turnStartOutcome._tag === "error") {
        yield* deleteCreatedThread();
        return yield* blockAndFail(
          "thread.turn.start",
          turnStartOutcome.error.message,
          turnStartOutcome.error,
        );
      }

      // 5. Persist runtime state back to the board.
      const saved = yield* saveCardRuntime({
        boardFiles,
        cwd: input.cwd,
        board: claimed.board,
        cardId: input.cardId,
        state: "Running",
        implementationRunId: RuntimeSessionId.make(threadId),
      }).pipe(Effect.mapError((cause) => toError("agentBoard.save", cause)));

      return {
        board: saved.board,
        card: saved.board.cards.find((candidate) => candidate.id === input.cardId) ?? claimed.card,
        threadId: RuntimeSessionId.make(threadId),
        workspacePath: worktreePath,
      };
    });

  return { run } satisfies AgentBoardRunnerShape;
});

export const AgentBoardRunnerLive = Layer.effect(AgentBoardRunner, makeAgentBoardRunner);
