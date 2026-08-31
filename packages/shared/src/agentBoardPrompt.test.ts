import { describe, expect, it } from "@effect/vitest";
import type { AgentBoardCard } from "@t3tools/contracts";

import {
  REVIEWER_ORCHESTRATION_CONSTRAINTS,
  WORKER_ORCHESTRATION_CONSTRAINTS,
  buildAgentBoardImplementationPrompt,
  buildAgentBoardRepairPrompt,
  buildAgentBoardReviewPrompt,
  parseAgentBoardReviewResult,
} from "./agentBoardPrompt.ts";

const baseCard = {
  id: "ORCH-042",
  title: "Worker packets",
  state: "Ready" as const,
  priority: 2,
  area: "Backend",
  slice: "orchestration",
  taskRecordPath: "docs/agents/tasks/example.md",
  slicePlanPath: "docs/agents/slices/example.md",
  dependencies: ["ORCH-041"],
  parallelism: {
    safe: "false" as const,
    conflictsWith: ["ORCH-043"],
    allowedWriteScopes: ["packages/shared/src/agentBoardPrompt.ts"],
  },
  runtime: {
    attemptCount: 1,
    workspacePath: "/tmp/t3/orchestration/prj/workspaces/ORCH-042",
    branchName: "board/ORCH-042",
    proofNotes: ["seeded proof"],
  },
  intentBrief: {
    intent: "Rewrite worker prompts around T3 packets.",
    desiredOutcome: "No WORKFLOW.md as orchestration SoT.",
    acceptanceCriteria: ["Prompts omit WORKFLOW.md as SoT"],
    constraints: ["Do not invent repo orchestration files"],
    nonGoals: ["Fast Mode"],
    openDecisions: [],
  },
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
} satisfies AgentBoardCard;

describe("agentBoardPrompt", () => {
  it("implementation prompt uses T3 worker constraints and card packet", () => {
    const prompt = buildAgentBoardImplementationPrompt(baseCard);

    expect(prompt).toContain("PLEASE IMPLEMENT THIS T3 ORCHESTRATION CARD.");
    expect(prompt).toContain(WORKER_ORCHESTRATION_CONSTRAINTS);
    expect(prompt).toContain("Card: ORCH-042");
    expect(prompt).toContain("Allowed write scopes:");
    expect(prompt).toContain("packages/shared/src/agentBoardPrompt.ts");
    expect(prompt).toContain("Attempt count: 1");
    expect(prompt).toContain("Existing proof notes (T3-owned):");
    expect(prompt).toContain("seeded proof");
    expect(prompt).toContain("Optional task notes path");
    expect(prompt).not.toMatch(/Read these references first:[\s\S]*WORKFLOW\.md/);
    expect(prompt).not.toMatch(/Read these references first:[\s\S]*\.t3\/agent-board\.json/);
    expect(prompt).not.toContain("Update proof in the relevant task record");
    expect(prompt).not.toContain(
      "Treat the project-local board and task docs as the source of truth",
    );
  });

  it("review prompt uses reviewer constraints and keeps the review protocol", () => {
    const prompt = buildAgentBoardReviewPrompt(baseCard);

    expect(prompt).toContain("PLEASE REVIEW THIS T3 ORCHESTRATION CARD.");
    expect(prompt).toContain(REVIEWER_ORCHESTRATION_CONSTRAINTS);
    expect(prompt).toContain("REVIEW: PASS");
    expect(prompt).toContain("REVIEW: FAIL");
    expect(prompt).toContain("NEEDS_DECISION:");
    expect(prompt).not.toContain("Evaluate only the persisted task record");
    expect(prompt).not.toMatch(/Read these references first:[\s\S]*\.t3\/agent-board\.json/);
    expect(prompt).toContain("are not orchestration authority");
  });

  it("repair prompt carries review findings and worker constraints", () => {
    const prompt = buildAgentBoardRepairPrompt(baseCard, "Missing unit tests");

    expect(prompt).toContain(WORKER_ORCHESTRATION_CONSTRAINTS);
    expect(prompt).toContain("Missing unit tests");
    expect(prompt).toContain("Card: ORCH-042");
    expect(prompt).not.toContain("update the task record proof");
  });

  it("parseAgentBoardReviewResult still understands the protocol", () => {
    expect(parseAgentBoardReviewResult("done\nREVIEW: PASS - looks good")).toEqual({
      _tag: "pass",
      summary: "looks good",
    });
    expect(parseAgentBoardReviewResult("REVIEW: FAIL - missing tests")).toEqual({
      _tag: "fail",
      reason: "missing tests",
    });
    expect(parseAgentBoardReviewResult("NEEDS_DECISION: Use OAuth?")).toEqual({
      _tag: "needsDecision",
      question: "Use OAuth?",
      reason: "Use OAuth?",
    });
  });
});
