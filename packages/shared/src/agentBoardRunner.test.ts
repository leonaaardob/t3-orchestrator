import { describe, expect, it } from "vite-plus/test";

import { ProviderInstanceId, type AgentBoardFile } from "@t3tools/contracts";

import {
  MISSING_WORKER_CONFIG_ERROR,
  REVIEW_INDEPENDENCE_ERROR,
  resolveExecutionPresetForOperation,
  resolveWorkerModelSelection,
} from "./agentBoardRunner.ts";

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

describe("resolveExecutionPresetForOperation", () => {
  it("inherits global Advanced presets and picks the requested operation", () => {
    const resolution = resolveExecutionPresetForOperation({
      globalPresets: {
        mode: "advanced",
        implementation: boardSelection,
        review: projectSelection,
        repair: boardSelection,
      },
      operation: "review",
    });

    expect(resolution).toMatchObject({ _tag: "resolved", selection: projectSelection });
  });

  it("lets an explicit project preset override the global default", () => {
    const resolution = resolveExecutionPresetForOperation({
      globalPresets: { mode: "simple", selection: boardSelection },
      projectPresets: { mode: "simple", selection: projectSelection },
      operation: "implementation",
    });

    expect(resolution).toMatchObject({ _tag: "resolved", selection: projectSelection });
  });

  it("blocks Advanced review when it matches implementation", () => {
    const resolution = resolveExecutionPresetForOperation({
      globalPresets: {
        mode: "advanced",
        implementation: boardSelection,
        review: boardSelection,
        repair: boardSelection,
      },
      operation: "review",
    });

    expect(resolution).toEqual({
      _tag: "needs-decision",
      operation: "review",
      error: REVIEW_INDEPENDENCE_ERROR,
    });
  });

  it("allows Simple review when it matches implementation", () => {
    const simple = { mode: "simple" as const, selection: boardSelection };

    const implementation = resolveExecutionPresetForOperation({
      globalPresets: simple,
      operation: "implementation",
    });
    const review = resolveExecutionPresetForOperation({
      globalPresets: simple,
      operation: "review",
    });
    const repair = resolveExecutionPresetForOperation({
      globalPresets: simple,
      operation: "repair",
    });

    expect(review).toMatchObject({
      _tag: "resolved",
      selection: boardSelection,
      operation: "review",
    });
    expect(implementation).toMatchObject({ _tag: "resolved", selection: boardSelection });
    expect(repair).toMatchObject({ _tag: "resolved", selection: boardSelection });
  });
});
