import { describe, expect, it } from "@effect/vitest";

import type { AgentBoardCard, AgentBoardFile } from "@t3tools/contracts";
import {
  buildSupervisorWakeMessage,
  supervisorWakeCardIds,
  supervisorWakeFingerprint,
} from "./supervisorWake.ts";

const board = (cards: ReadonlyArray<AgentBoardCard>): AgentBoardFile =>
  ({
    schemaVersion: 1,
    projectRoot: "/project",
    defaultView: "kanban",
    runner: { maxConcurrentCards: 1, repairCycles: 3 },
    cards,
    graphLinks: [],
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
  }) as AgentBoardFile;

const card = (id: string, state: AgentBoardCard["state"], updatedAt = "2026-09-08T00:00:00.000Z") =>
  ({
    id,
    title: id,
    priority: 1,
    dependencies: [],
    parallelism: { safe: "true", conflictsWith: [], allowedWriteScopes: [] },
    runtime: { attemptCount: 1, proofNotes: [] },
    workflowMode: "standard",
    state,
    intentBrief: { intent: id },
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt,
  }) as unknown as AgentBoardCard;

describe("project Supervisor wake transitions", () => {
  it("wakes on every scheduler result, groups nearby results, and ignores unchanged heartbeats", () => {
    const before = board([card("A", "Running"), card("B", "Ready")]);
    const after = board([card("A", "Review", "2026-09-08T00:00:01.000Z"), card("B", "Blocked")]);

    expect(supervisorWakeCardIds({ before, after, source: "scheduler" })).toEqual(["A", "B"]);
    expect(
      supervisorWakeCardIds({
        before: after,
        after: board([card("A", "Review", "2026-09-08T00:00:02.000Z"), card("B", "Blocked")]),
        source: "scheduler",
      }),
    ).toEqual([]);
    expect(
      supervisorWakeCardIds({
        before: board([card("C", "Running")]),
        after: board([card("C", "Needs Decision", "2026-09-08T00:00:03.000Z")]),
        source: "scheduler",
      }),
    ).toEqual(["C"]);
  });

  it("wakes after a human unblock or Review validation, but never for a pending decision or Supervisor mutation", () => {
    const blocked = board([card("A", "Needs Decision")]);
    const ready = board([card("A", "Ready", "2026-09-08T00:00:01.000Z")]);
    const review = board([card("B", "Review")]);
    const done = board([card("B", "Done", "2026-09-08T00:00:01.000Z")]);

    expect(supervisorWakeCardIds({ before: blocked, after: ready, source: "human" })).toEqual([
      "A",
    ]);
    expect(supervisorWakeCardIds({ before: review, after: done, source: "human" })).toEqual(["B"]);
    expect(supervisorWakeCardIds({ before: ready, after: blocked, source: "human" })).toEqual([]);
    expect(supervisorWakeCardIds({ before: ready, after: blocked, source: "supervisor" })).toEqual(
      [],
    );
  });

  it("keeps a stable deduplication key and requires a current-board read", () => {
    const current = board([card("A", "Review")]);
    expect(supervisorWakeFingerprint(current)).toBe(supervisorWakeFingerprint(current));
    const message = buildSupervisorWakeMessage({ cardIds: ["A"], reason: "A: Review" });
    expect(message).toContain("agent_board_read");
    expect(message).toContain("Do not turn Review into Done");
    expect(message).toContain("reset attempts");
  });
});
