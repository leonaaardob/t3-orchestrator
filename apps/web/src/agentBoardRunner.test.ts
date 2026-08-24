import { describe, expect, it } from "vite-plus/test";

import { ProviderInstanceId, type AgentBoardFile } from "@t3tools/contracts";

import { MISSING_WORKER_CONFIG_ERROR, resolveWorkerModelSelection } from "./agentBoardRunner";

const boardWithRunner = (
  runner: Partial<Pick<AgentBoardFile["runner"], "workerModelSelection">> = {},
): Pick<AgentBoardFile, "runner"> => ({
  runner: { maxConcurrentCards: 1, repairCycles: 3, ...runner },
});

const boardSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.2",
  options: [{ id: "reasoningEffort", value: "high" }],
} as const;

const projectSelection = {
  instanceId: ProviderInstanceId.make("opencode"),
  model: "opencode/grok-code",
} as const;

describe("resolveWorkerModelSelection", () => {
  it("prefers the board runner override over the project default", () => {
    const resolution = resolveWorkerModelSelection(boardWithRunner(), null);
    expect(resolution._tag).toBe("missing-config");

    const withOverride = resolveWorkerModelSelection(
      boardWithRunner({ workerModelSelection: boardSelection }),
      projectSelection,
    );
    expect(withOverride).toEqual({
      _tag: "resolved",
      source: "board-runner",
      selection: boardSelection,
    });
  });

  it("falls back to the project default when the board has no override", () => {
    const resolution = resolveWorkerModelSelection(boardWithRunner(), projectSelection);
    expect(resolution).toEqual({
      _tag: "resolved",
      source: "project-default",
      selection: projectSelection,
    });
  });

  it("reports missing config when neither board nor project pin a worker", () => {
    expect(resolveWorkerModelSelection(boardWithRunner(), null)._tag).toBe("missing-config");
    expect(resolveWorkerModelSelection(boardWithRunner(), undefined)._tag).toBe("missing-config");
  });

  it("exposes an operator-facing error message for the missing-config case", () => {
    expect(MISSING_WORKER_CONFIG_ERROR.length).toBeGreaterThan(0);
  });
});
