import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { AgentBoardFile } from "./agentBoard.ts";

const decodeAgentBoardFile = Schema.decodeUnknownSync(AgentBoardFile);
// The server persists boards as JSON strings, so encode/decode through the
// same string codec shape (`Schema.fromJsonString`) for round-trip proofs.
const decodeAgentBoardFileJsonString = Schema.decodeSync(Schema.fromJsonString(AgentBoardFile));
const encodeAgentBoardFileJsonString = Schema.encodeSync(Schema.fromJsonString(AgentBoardFile));

// Board shape exactly as written before `runner.workerModelSelection` existed.
const PRE_CHANGE_BOARD_JSON = `{
  "schemaVersion": 1,
  "projectRoot": "/tmp/example-project",
  "defaultView": "kanban",
  "runner": {
    "maxConcurrentCards": 1,
    "repairCycles": 3
  },
  "cards": [
    {
      "id": "TASK-20260505-pre-change-card",
      "title": "Card saved before worker model selection existed",
      "state": "Backlog",
      "createdAt": "2026-05-05T12:00:00.000Z",
      "updatedAt": "2026-05-05T12:00:00.000Z"
    }
  ],
  "graphLinks": [],
  "createdAt": "2026-05-05T12:00:00.000Z",
  "updatedAt": "2026-05-05T12:00:00.000Z"
}`;

describe("AgentBoardFile", () => {
  it("decodes a minimal project-local board with defaults", () => {
    const decoded = decodeAgentBoardFile({
      projectRoot: "/tmp/example-project",
      createdAt: "2026-05-05T12:00:00.000Z",
      updatedAt: "2026-05-05T12:00:00.000Z",
    });

    expect(decoded.schemaVersion).toBe(1);
    expect(decoded.defaultView).toBe("kanban");
    expect(decoded.runner).toEqual({
      maxConcurrentCards: 1,
      repairCycles: 3,
    });
    expect(decoded.cards).toEqual([]);
  });

  it("decodes a ready card with an intent brief and task references", () => {
    const decoded = decodeAgentBoardFile({
      projectRoot: "/tmp/example-project",
      createdAt: "2026-05-05T12:00:00.000Z",
      updatedAt: "2026-05-05T12:00:00.000Z",
      graphLinks: [
        {
          from: "area:Backend",
          to: "area:Frontend",
          kind: "depends-on",
        },
      ],
      cards: [
        {
          id: "TASK-20260505-agent-board-contract",
          title: "Define board file contract",
          state: "Ready",
          taskRecordPath: "docs/agents/tasks/TASK-20260505-agent-board-contract.md",
          slicePlanPath: "docs/agents/slices/authoritative-agent-board.md",
          graphPosition: {
            x: 640,
            y: 120,
          },
          intentBrief: {
            intent: "Create the first durable schema for the project-local agent board file.",
            acceptanceCriteria: ["Board files decode through the shared contracts package."],
          },
          parallelism: {
            safe: "conditional",
            reason:
              "Schema-only work can run beside UI planning, but not another board schema edit.",
            allowedWriteScopes: ["packages/contracts/src/agentBoard.ts"],
          },
          createdAt: "2026-05-05T12:00:00.000Z",
          updatedAt: "2026-05-05T12:00:00.000Z",
        },
      ],
    });

    expect(decoded.cards[0]?.state).toBe("Ready");
    expect(decoded.cards[0]?.runtime.attemptCount).toBe(0);
    expect(decoded.cards[0]?.parallelism.allowedWriteScopes).toEqual([
      "packages/contracts/src/agentBoard.ts",
    ]);
    expect(decoded.cards[0]?.graphPosition).toEqual({ x: 640, y: 120 });
    expect(decoded.graphLinks).toEqual([
      {
        from: "area:Backend",
        to: "area:Frontend",
        kind: "depends-on",
      },
    ]);
  });

  it("rejects a title-only ready card because the intent brief is missing", () => {
    expect(() =>
      decodeAgentBoardFile({
        projectRoot: "/tmp/example-project",
        createdAt: "2026-05-05T12:00:00.000Z",
        updatedAt: "2026-05-05T12:00:00.000Z",
        cards: [
          {
            id: "TASK-20260505-title-only",
            title: "Title only",
            state: "Ready",
            createdAt: "2026-05-05T12:00:00.000Z",
            updatedAt: "2026-05-05T12:00:00.000Z",
          },
        ],
      }),
    ).toThrow();
  });

  it("decodes a pre-change board JSON string without runner.workerModelSelection unchanged", () => {
    const decoded = decodeAgentBoardFileJsonString(PRE_CHANGE_BOARD_JSON);

    expect(decoded.runner).toEqual({
      maxConcurrentCards: 1,
      repairCycles: 3,
    });
    expect(decoded.runner.workerModelSelection).toBeUndefined();
    expect(decoded.cards[0]?.id).toBe("TASK-20260505-pre-change-card");

    const encoded = encodeAgentBoardFileJsonString(decoded);
    expect(encoded).not.toContain("workerModelSelection");
  });

  it("round-trips a populated runner.workerModelSelection", () => {
    const decoded = decodeAgentBoardFile({
      projectRoot: "/tmp/example-project",
      createdAt: "2026-05-05T12:00:00.000Z",
      updatedAt: "2026-05-05T12:00:00.000Z",
      runner: {
        maxConcurrentCards: 2,
        repairCycles: 3,
        workerModelSelection: {
          instanceId: "codex",
          model: "gpt-5.2",
          options: [{ id: "reasoningEffort", value: "high" }],
        },
      },
    });

    expect(decoded.runner.workerModelSelection).toEqual({
      instanceId: "codex",
      model: "gpt-5.2",
      options: [{ id: "reasoningEffort", value: "high" }],
    });

    const encoded = encodeAgentBoardFileJsonString(decoded);
    expect(encoded).toContain("workerModelSelection");
    const roundTripped = decodeAgentBoardFileJsonString(encoded);
    expect(roundTripped.runner.workerModelSelection).toEqual(decoded.runner.workerModelSelection);
  });
});
