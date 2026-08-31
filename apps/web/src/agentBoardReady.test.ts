import { describe, expect, it } from "vite-plus/test";
import type { AgentBoardCard } from "@t3tools/contracts";

import { prepareCardForReady } from "./agentBoardReady.ts";

const baseCard = {
  id: "CARD-1",
  title: "Ready without repo writes",
  state: "Draft" as const,
  priority: 2,
  dependencies: [],
  parallelism: { safe: "false" as const, conflictsWith: [], allowedWriteScopes: [] },
  runtime: { attemptCount: 0, proofNotes: [] },
  workflowMode: "standard" as const,
  createdAt: "2026-08-31T12:00:00.000Z",
  updatedAt: "2026-08-31T12:00:00.000Z",
} satisfies AgentBoardCard;

describe("prepareCardForReady", () => {
  it("marks Ready with intent and does not invent task/slice paths", () => {
    const next = prepareCardForReady({
      card: baseCard,
      intentBrief: {
        intent: "Ship Ready without writing the user repo.",
        acceptanceCriteria: ["No docs/agents/tasks file"],
        constraints: [],
        nonGoals: [],
        openDecisions: [],
      },
      timestamp: "2026-08-31T12:05:00.000Z",
    });

    expect(next.state).toBe("Ready");
    expect(next.intentBrief?.intent).toContain("Ship Ready");
    expect(next.taskRecordPath).toBeUndefined();
    expect(next.slicePlanPath).toBeUndefined();
    expect(next.updatedAt).toBe("2026-08-31T12:05:00.000Z");
  });

  it("preserves explicit optional project references only", () => {
    const next = prepareCardForReady({
      card: {
        ...baseCard,
        taskRecordPath: "notes/manual.md",
        slicePlanPath: "docs/plan.md",
      },
      intentBrief: {
        intent: "Keep explicit refs.",
        acceptanceCriteria: [],
        constraints: [],
        nonGoals: [],
        openDecisions: [],
      },
      timestamp: "2026-08-31T12:06:00.000Z",
    });

    expect(next.taskRecordPath).toBe("notes/manual.md");
    expect(next.slicePlanPath).toBe("docs/plan.md");
  });
});
