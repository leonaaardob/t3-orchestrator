/**
 * ProjectionTurnRepository - Projection repository interface for unified turn state.
 *
 * Owns persistence operations for pending starts, running/completed turn lifecycle,
 * and checkpoint metadata in a single projection table.
 *
 * @module ProjectionTurnRepository
 */
import {
  CheckpointRef,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  OrchestrationProposedPlanId,
  OrchestrationCheckpointFile,
  OrchestrationCheckpointStatus,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionTurnState = Schema.Literals([
  "pending",
  "running",
  "interrupted",
  "completed",
  "error",
]);
export type ProjectionTurnState = typeof ProjectionTurnState.Type;

/** Human-readable server diagnostic for the durable provider handoff state. */
export const ProjectionPendingTurnDeliveryReason = Schema.Literals([
  "awaiting-provider-handoff",
  "automatic-recovery-paused-after-claim",
  "automatic-recovery-paused-after-provider-handoff",
  "provider-handoff-confirmed",
]);
export type ProjectionPendingTurnDeliveryReason = typeof ProjectionPendingTurnDeliveryReason.Type;

export const ProjectionTurn = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  pendingMessageId: Schema.NullOr(MessageId),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
  assistantMessageId: Schema.NullOr(MessageId),
  state: ProjectionTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  checkpointTurnCount: Schema.NullOr(NonNegativeInt),
  checkpointRef: Schema.NullOr(CheckpointRef),
  checkpointStatus: Schema.NullOr(OrchestrationCheckpointStatus),
  checkpointFiles: Schema.Array(OrchestrationCheckpointFile),
});
export type ProjectionTurn = typeof ProjectionTurn.Type;

export const ProjectionTurnById = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  pendingMessageId: Schema.NullOr(MessageId),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
  assistantMessageId: Schema.NullOr(MessageId),
  state: ProjectionTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  checkpointTurnCount: Schema.NullOr(NonNegativeInt),
  checkpointRef: Schema.NullOr(CheckpointRef),
  checkpointStatus: Schema.NullOr(OrchestrationCheckpointStatus),
  checkpointFiles: Schema.Array(OrchestrationCheckpointFile),
});
export type ProjectionTurnById = typeof ProjectionTurnById.Type;

export const ProjectionPendingTurnStart = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
  requestedAt: IsoDateTime,
  deliveryState: Schema.Literals(["pending", "claimed", "sending", "delivered"]),
  /** Present on persisted reads; explains whether restart recovery is safe. */
  deliveryReason: Schema.optional(ProjectionPendingTurnDeliveryReason),
});
export type ProjectionPendingTurnStart = typeof ProjectionPendingTurnStart.Type;

export const ListProjectionTurnsByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListProjectionTurnsByThreadInput = typeof ListProjectionTurnsByThreadInput.Type;

export const GetProjectionTurnByTurnIdInput = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
});
export type GetProjectionTurnByTurnIdInput = typeof GetProjectionTurnByTurnIdInput.Type;

export const GetProjectionPendingTurnStartInput = Schema.Struct({
  threadId: ThreadId,
});
export type GetProjectionPendingTurnStartInput = typeof GetProjectionPendingTurnStartInput.Type;

/** Identifies the exact durable start request a provider reactor may consume. */
export const ClaimProjectionPendingTurnStartInput = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  requestedAt: IsoDateTime,
});
export type ClaimProjectionPendingTurnStartInput = typeof ClaimProjectionPendingTurnStartInput.Type;

export const ListUndeliveredProjectionPendingTurnStartsInput = Schema.Void;
export type ListUndeliveredProjectionPendingTurnStartsInput =
  typeof ListUndeliveredProjectionPendingTurnStartsInput.Type;

export const MarkProjectionPendingTurnStartDeliveredInput = ClaimProjectionPendingTurnStartInput;
export type MarkProjectionPendingTurnStartDeliveredInput =
  typeof MarkProjectionPendingTurnStartDeliveredInput.Type;

export const MarkProjectionPendingTurnStartSendingInput = ClaimProjectionPendingTurnStartInput;
export type MarkProjectionPendingTurnStartSendingInput =
  typeof MarkProjectionPendingTurnStartSendingInput.Type;

export const DeleteProjectionTurnsByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionTurnsByThreadInput = typeof DeleteProjectionTurnsByThreadInput.Type;

export const ClearCheckpointTurnConflictInput = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
});
export type ClearCheckpointTurnConflictInput = typeof ClearCheckpointTurnConflictInput.Type;

export interface ProjectionTurnRepositoryShape {
  /**
   * Inserts or updates the canonical row for a concrete `{threadId, turnId}` turn lifecycle state.
   */
  readonly upsertByTurnId: (
    row: ProjectionTurnById,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Replaces any existing pending-start placeholder rows for a thread with exactly one latest pending-start row.
   */
  readonly replacePendingTurnStart: (
    row: ProjectionPendingTurnStart,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Returns the newest pending-start placeholder for a thread; this is expected to be at most one row after replacement writes.
   */
  readonly getPendingTurnStartByThreadId: (
    input: GetProjectionPendingTurnStartInput,
  ) => Effect.Effect<Option.Option<ProjectionPendingTurnStart>, ProjectionRepositoryError>;

  /**
   * Atomically claims an exact pending start request without deleting its durable
   * delivery intent. A later interrupt or session stop still removes the same row.
   */
  readonly claimPendingTurnStart: (
    input: ClaimProjectionPendingTurnStartInput,
  ) => Effect.Effect<Option.Option<ProjectionPendingTurnStart>, ProjectionRepositoryError>;

  /** Lists pending starts eligible for safe reactor recovery; ambiguous claims are excluded. */
  readonly listUndeliveredPendingTurnStarts: () => Effect.Effect<
    ReadonlyArray<ProjectionPendingTurnStart>,
    ProjectionRepositoryError
  >;

  /** Marks exactly the claimed durable intent as delivered after sendTurn returns. */
  readonly markPendingTurnStartDelivered: (
    input: MarkProjectionPendingTurnStartDeliveredInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /** Commits the point after which replay would be externally ambiguous. */
  readonly markPendingTurnStartSending: (
    input: MarkProjectionPendingTurnStartSendingInput,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;

  /**
   * Deletes only pending-start placeholder rows (`turnId = null`) for a thread and leaves concrete turn rows untouched.
   */
  readonly deletePendingTurnStartByThreadId: (
    input: GetProjectionPendingTurnStartInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Lists all projection rows for a thread, including pending placeholders, with checkpoint rows ordered before non-checkpoint rows.
   */
  readonly listByThreadId: (
    input: ListProjectionTurnsByThreadInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionTurn>, ProjectionRepositoryError>;

  /**
   * Looks up a concrete turn row by `{threadId, turnId}` and never returns pending placeholder rows.
   */
  readonly getByTurnId: (
    input: GetProjectionTurnByTurnIdInput,
  ) => Effect.Effect<Option.Option<ProjectionTurnById>, ProjectionRepositoryError>;

  /**
   * Clears checkpoint fields on conflicting rows that reuse the same checkpoint turn count in a thread, excluding the provided turn.
   */
  readonly clearCheckpointTurnConflict: (
    input: ClearCheckpointTurnConflictInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Hard-deletes all projection rows for a thread, including pending-start placeholders and checkpoint metadata rows.
   */
  readonly deleteByThreadId: (
    input: DeleteProjectionTurnsByThreadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionTurnRepository extends Context.Service<
  ProjectionTurnRepository,
  ProjectionTurnRepositoryShape
>()("t3-orchestrator/persistence/Services/ProjectionTurns/ProjectionTurnRepository") {}
