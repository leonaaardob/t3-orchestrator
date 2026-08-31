import type { AgentBoardCard, AgentBoardIntentBrief } from "@t3tools/contracts";

/**
 * Ready transition for Planning UI: validate intent and update the internal
 * card only. Does not invent task/slice paths or write into the user repo.
 */
export function prepareCardForReady(input: {
  readonly card: AgentBoardCard;
  readonly intentBrief: AgentBoardIntentBrief;
  readonly timestamp: string;
}): AgentBoardCard {
  return {
    ...input.card,
    state: "Ready",
    intentBrief: input.intentBrief,
    // Preserve explicit optional references only — never invent defaults.
    taskRecordPath: input.card.taskRecordPath,
    slicePlanPath: input.card.slicePlanPath,
    updatedAt: input.timestamp,
  } as AgentBoardCard;
}
