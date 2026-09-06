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
  const { taskRecordPath, slicePlanPath, ...card } = input.card;
  return {
    ...card,
    state: "Ready",
    intentBrief: input.intentBrief,
    // Preserve explicit optional references only — never invent defaults.
    ...(taskRecordPath?.trim() ? { taskRecordPath } : {}),
    ...(slicePlanPath?.trim() ? { slicePlanPath } : {}),
    updatedAt: input.timestamp,
  };
}
