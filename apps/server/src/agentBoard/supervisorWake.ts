import * as NodeCrypto from "node:crypto";

import type { AgentBoardCard, AgentBoardFile } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** The writer is explicit so a Supervisor mutation cannot wake itself. */
export type AgentBoardSaveSource = "human" | "scheduler" | "supervisor";

export const SUPERVISOR_WAKE_MAX_DISPATCH_ATTEMPTS = 3;
export const SUPERVISOR_WAKE_RETRY_BASE_DELAY_MS = 5_000;
export const SUPERVISOR_WAKE_RETRY_MAX_DELAY_MS = 60_000;
const CardIdsJson = Schema.fromJsonString(Schema.Array(Schema.String));

export const encodeSupervisorWakeCardIds = Schema.encodeSync(CardIdsJson);
const decodeCardIdsOption = Schema.decodeUnknownOption(CardIdsJson);
export const decodeSupervisorWakeCardIds = (json: string): ReadonlyArray<string> =>
  Option.getOrElse(decodeCardIdsOption(json), () => []);

const RESULT_STATES = new Set<AgentBoardCard["state"]>(["Review", "Blocked", "Needs Decision"]);

const cardWakeShape = (card: AgentBoardCard) => ({
  id: card.id,
  state: card.state,
  attemptCount: card.runtime.attemptCount,
  implementationRunId: card.runtime.implementationRunId ?? null,
  reviewRunId: card.runtime.reviewRunId ?? null,
  currentError: card.runtime.currentError ?? null,
  currentDecisionQuestion: card.runtime.currentDecisionQuestion ?? null,
  updatedAt: card.updatedAt,
});

/** Stable board state used for idempotency; timestamps outside cards are ignored. */
export const supervisorWakeFingerprint = (board: AgentBoardFile): string => {
  const relevant = board.cards
    .filter((card) => RESULT_STATES.has(card.state) || card.state === "Ready")
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(cardWakeShape);
  return NodeCrypto.createHash("sha256")
    .update(
      relevant
        .map((card) =>
          [
            card.id,
            card.state,
            card.attemptCount,
            card.implementationRunId,
            card.reviewRunId,
            card.currentError,
            card.currentDecisionQuestion,
            card.updatedAt,
          ].join("\u001f"),
        )
        .join("\u001e"),
    )
    .digest("hex");
};

const changed = (before: AgentBoardCard | undefined, after: AgentBoardCard): boolean =>
  before === undefined || before.state !== after.state;

/**
 * Returns only transitions that need Supervisor attention. A board save that
 * merely updates a heartbeat, proof note, or a pending human decision is not
 * a wake event.
 */
export const supervisorWakeCardIds = (input: {
  readonly before: AgentBoardFile | undefined;
  readonly after: AgentBoardFile;
  readonly source: AgentBoardSaveSource;
}): ReadonlyArray<string> => {
  if (input.source === "supervisor") return [];
  const beforeById = new Map((input.before?.cards ?? []).map((card) => [card.id, card] as const));
  return input.after.cards
    .filter((card) => {
      const previous = beforeById.get(card.id);
      if (!changed(previous, card)) return false;
      if (input.source === "scheduler") return RESULT_STATES.has(card.state);
      return (
        ((previous?.state === "Blocked" || previous?.state === "Needs Decision") &&
          card.state === "Ready") ||
        (previous?.state === "Review" && card.state === "Done")
      );
    })
    .map((card) => card.id)
    .sort();
};

export const supervisorWakeReason = (input: {
  readonly after: AgentBoardFile;
  readonly cardIds: ReadonlyArray<string>;
}): string => {
  const cards = input.after.cards.filter((card) => input.cardIds.includes(card.id));
  return cards
    .map((card) => `${card.id}: ${card.state}`)
    .join(", ")
    .slice(0, 2_000);
};

export const buildSupervisorWakeMessage = (input: {
  readonly cardIds: ReadonlyArray<string>;
  readonly reason: string;
}): string =>
  [
    "T3 Supervisor follow-up is available for the current project.",
    `Relevant card results: ${input.cardIds.join(", ") || "see the current board"}.`,
    `Signal: ${input.reason}`,
    "First call agent_board_read and reason from the current persisted board, not this notification.",
    "Take only an allowed next action with Supervisor tools. Do not turn Review into Done, promote Draft cards, reset attempts, or bypass a human decision; state the precise decision needed when the board remains blocked.",
  ].join("\n");
