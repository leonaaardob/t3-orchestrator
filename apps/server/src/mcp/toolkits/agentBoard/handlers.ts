import {
  type AgentBoardCard,
  AgentBoardCard as AgentBoardCardSchema,
  AgentBoardFileError,
  type AgentBoardIntentBrief,
  ProjectId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { AgentBoardFileSystem } from "../../../agentBoard/Services/AgentBoardFileSystem.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import {
  type AgentBoardCardMutationResult,
  type AgentBoardCreateCardInput,
  type AgentBoardReadResult,
  type AgentBoardUpdateCardInput,
  AgentBoardToolkit,
} from "./tools.ts";

const decodeCard = Schema.decodeUnknownSync(AgentBoardCardSchema);

/**
 * Resolve the Supervisor session's project from T3 projection state.
 * Never trusts a model-supplied project root.
 */
const requireSupervisorProjectContext = Effect.fn(
  "AgentBoardToolkit.requireSupervisorProjectContext",
)(function* () {
  const invocation = yield* McpInvocationContext.requireMcpCapability("agent-board").pipe(
    Effect.mapError(
      (cause) =>
        new AgentBoardFileError({
          message: cause.message,
          cause,
        }),
    ),
  );
  const projection = yield* ProjectionSnapshotQuery;
  const threadOption = yield* projection.getThreadShellById(invocation.threadId).pipe(
    Effect.mapError(
      (cause) =>
        new AgentBoardFileError({
          message: `Failed to resolve Supervisor thread: ${cause.message}`,
          cause,
        }),
    ),
  );
  if (Option.isNone(threadOption)) {
    return yield* new AgentBoardFileError({
      message: `No active thread found for Supervisor session '${invocation.threadId}'.`,
    });
  }
  const thread = threadOption.value;
  if (thread.role !== "project-supervisor") {
    // Defense in depth: capability should already exclude non-Supervisors, but
    // role is the durable source of truth if a credential was over-granted.
    return yield* new AgentBoardFileError({
      message: "MCP credential does not grant the agent-board capability.",
    });
  }

  const projectOption = yield* projection
    .getProjectShellById(ProjectId.make(thread.projectId))
    .pipe(
      Effect.mapError(
        (cause) =>
          new AgentBoardFileError({
            message: `Failed to resolve Supervisor project: ${cause.message}`,
            cause,
          }),
      ),
    );
  if (Option.isNone(projectOption)) {
    return yield* new AgentBoardFileError({
      message: `No active project found for Supervisor thread '${invocation.threadId}'.`,
    });
  }

  return {
    invocation,
    projectId: projectOption.value.id,
    projectRoot: projectOption.value.workspaceRoot,
  } as const;
});

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const buildIntentBrief = (input: {
  readonly intent: string;
  readonly desiredOutcome?: string | undefined;
  readonly acceptanceCriteria?: ReadonlyArray<string> | undefined;
  readonly constraints?: ReadonlyArray<string> | undefined;
  readonly nonGoals?: ReadonlyArray<string> | undefined;
  readonly openDecisions?: ReadonlyArray<string> | undefined;
}): AgentBoardIntentBrief => ({
  intent: input.intent,
  ...(input.desiredOutcome !== undefined ? { desiredOutcome: input.desiredOutcome } : {}),
  acceptanceCriteria: [...(input.acceptanceCriteria ?? [])],
  constraints: [...(input.constraints ?? [])],
  nonGoals: [...(input.nonGoals ?? [])],
  openDecisions: [...(input.openDecisions ?? [])],
});

const slugCardId = (title: string, timestamp: string): string => {
  const day = timestamp.slice(0, 10).replaceAll("-", "");
  const slug = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 40);
  return `TASK-${day}-${slug || "card"}-${Date.now()}`;
};

const mapBoardFsError = (operation: string) => (cause: { readonly message: string }) =>
  new AgentBoardFileError({
    message: `Failed to ${operation} agent board: ${cause.message}`,
    cause,
  });

const readBoard = Effect.fn("AgentBoardToolkit.read")(function* (
  _input: Record<string, never>,
): Effect.fn.Return<
  AgentBoardReadResult,
  AgentBoardFileError,
  McpInvocationContext.McpInvocationContext | AgentBoardFileSystem | ProjectionSnapshotQuery
> {
  const { projectId, projectRoot } = yield* requireSupervisorProjectContext();
  const boardFs = yield* AgentBoardFileSystem;
  const loaded = yield* boardFs
    .load({ cwd: projectRoot, createIfMissing: true })
    .pipe(Effect.mapError(mapBoardFsError("load")));
  return {
    storageRef: "t3://orchestration/agent-board" as const,
    projectId,
    projectRoot,
    board: loaded.board,
  };
});

const createCard = Effect.fn("AgentBoardToolkit.createCard")(function* (
  input: AgentBoardCreateCardInput,
): Effect.fn.Return<
  AgentBoardCardMutationResult,
  AgentBoardFileError,
  McpInvocationContext.McpInvocationContext | AgentBoardFileSystem | ProjectionSnapshotQuery
> {
  const { projectId, projectRoot } = yield* requireSupervisorProjectContext();
  const boardFs = yield* AgentBoardFileSystem;
  const loaded = yield* boardFs
    .load({ cwd: projectRoot, createIfMissing: true })
    .pipe(Effect.mapError(mapBoardFsError("load")));

  const timestamp = yield* nowIso;
  const cardId = input.id?.trim() || slugCardId(input.title, timestamp);
  if (loaded.board.cards.some((card) => card.id === cardId)) {
    return yield* new AgentBoardFileError({
      message: `Agent board card already exists: ${cardId}`,
    });
  }

  const workflowMode = input.workflowMode ?? "standard";
  if (workflowMode === "fast") {
    return yield* new AgentBoardFileError({
      message:
        "Fast Mode cards require explicit human approval evidence before creation. Create as standard, then obtain approval through the Needs Decision gate.",
    });
  }

  const intentBrief = buildIntentBrief({
    intent: input.intent?.trim() || input.title,
    desiredOutcome: input.desiredOutcome,
    acceptanceCriteria: input.acceptanceCriteria,
    constraints: input.constraints,
    nonGoals: input.nonGoals,
  });
  const markReady = input.markReady === true;

  const card = decodeCard({
    id: cardId,
    title: input.title,
    priority: input.priority ?? 3,
    ...(input.area !== undefined ? { area: input.area } : {}),
    ...(input.slice !== undefined ? { slice: input.slice } : {}),
    dependencies: [...(input.dependencies ?? [])],
    parallelism: {
      safe: "conditional",
      reason: "Supervisor-created card; confirm parallelism before Ready execution.",
      conflictsWith: [],
      allowedWriteScopes: [...(input.allowedWriteScopes ?? [])],
    },
    runtime: { attemptCount: 0 },
    workflowMode,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(markReady
      ? { state: "Ready" as const, intentBrief }
      : { state: "Draft" as const, intentBrief }),
  });

  const saved = yield* boardFs
    .save({
      cwd: projectRoot,
      board: {
        ...loaded.board,
        cards: [...loaded.board.cards, card],
        updatedAt: timestamp,
      },
    })
    .pipe(Effect.mapError(mapBoardFsError("save")));

  const created = saved.board.cards.find((candidate) => candidate.id === cardId);
  if (!created) {
    return yield* new AgentBoardFileError({
      message: `Created card '${cardId}' was not persisted.`,
    });
  }

  return {
    storageRef: "t3://orchestration/agent-board" as const,
    projectId,
    projectRoot,
    card: created,
    board: saved.board,
  };
});

const updateCard = Effect.fn("AgentBoardToolkit.updateCard")(function* (
  input: AgentBoardUpdateCardInput,
): Effect.fn.Return<
  AgentBoardCardMutationResult,
  AgentBoardFileError,
  McpInvocationContext.McpInvocationContext | AgentBoardFileSystem | ProjectionSnapshotQuery
> {
  const { projectId, projectRoot } = yield* requireSupervisorProjectContext();
  const boardFs = yield* AgentBoardFileSystem;
  const loaded = yield* boardFs
    .load({ cwd: projectRoot, createIfMissing: false })
    .pipe(Effect.mapError(mapBoardFsError("load")));

  const existing = loaded.board.cards.find((card) => card.id === input.cardId);
  if (!existing) {
    return yield* new AgentBoardFileError({
      message: `Agent board card not found: ${input.cardId}`,
    });
  }

  if (input.workflowMode === "fast" && existing.fastModeApproval === undefined) {
    return yield* new AgentBoardFileError({
      message: "Cannot set workflowMode=fast without explicit human fastModeApproval on the card.",
    });
  }

  const timestamp = yield* nowIso;
  const previousIntent = existing.intentBrief;
  const nextIntent =
    input.intent !== undefined ||
    input.desiredOutcome !== undefined ||
    input.acceptanceCriteria !== undefined ||
    input.constraints !== undefined ||
    input.nonGoals !== undefined ||
    input.openDecisions !== undefined
      ? buildIntentBrief({
          intent: input.intent ?? previousIntent?.intent ?? existing.title,
          desiredOutcome: input.desiredOutcome ?? previousIntent?.desiredOutcome,
          acceptanceCriteria: input.acceptanceCriteria ?? previousIntent?.acceptanceCriteria,
          constraints: input.constraints ?? previousIntent?.constraints,
          nonGoals: input.nonGoals ?? previousIntent?.nonGoals,
          openDecisions: input.openDecisions ?? previousIntent?.openDecisions,
        })
      : previousIntent;

  const nextState = input.state ?? existing.state;
  if (nextState === "Ready" && nextIntent === undefined) {
    return yield* new AgentBoardFileError({
      message: `Card '${input.cardId}' cannot move to Ready without an intent brief.`,
    });
  }

  const updated = decodeCard({
    ...existing,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.area !== undefined ? { area: input.area } : {}),
    ...(input.slice !== undefined ? { slice: input.slice } : {}),
    ...(input.dependencies !== undefined ? { dependencies: [...input.dependencies] } : {}),
    ...(input.allowedWriteScopes !== undefined
      ? {
          parallelism: {
            ...existing.parallelism,
            allowedWriteScopes: [...input.allowedWriteScopes],
          },
        }
      : {}),
    ...(input.workflowMode !== undefined ? { workflowMode: input.workflowMode } : {}),
    ...(nextIntent !== undefined ? { intentBrief: nextIntent } : {}),
    state: nextState,
    updatedAt: timestamp,
  } as AgentBoardCard);

  const saved = yield* boardFs
    .save({
      cwd: projectRoot,
      board: {
        ...loaded.board,
        cards: loaded.board.cards.map((card) => (card.id === input.cardId ? updated : card)),
        updatedAt: timestamp,
      },
    })
    .pipe(Effect.mapError(mapBoardFsError("save")));

  const persisted = saved.board.cards.find((card) => card.id === input.cardId);
  if (!persisted) {
    return yield* new AgentBoardFileError({
      message: `Updated card '${input.cardId}' was not persisted.`,
    });
  }

  return {
    storageRef: "t3://orchestration/agent-board" as const,
    projectId,
    projectRoot,
    card: persisted,
    board: saved.board,
  };
});

export const AgentBoardToolkitHandlersLive = AgentBoardToolkit.toLayer({
  agent_board_read: readBoard,
  agent_board_create_card: createCard,
  agent_board_update_card: updateCard,
});
