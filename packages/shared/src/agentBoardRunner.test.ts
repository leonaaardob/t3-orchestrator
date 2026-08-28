import { describe, expect, it } from "vite-plus/test";

import { ProviderInstanceId, type AgentBoardFile } from "@t3tools/contracts";

import {
  MISSING_WORKER_CONFIG_ERROR,
  REVIEW_INDEPENDENCE_ERROR,
  describeStaleModelSelection,
  resolveAndValidateExecutionPresetForOperation,
  resolveEffectiveAgentExecutionPresets,
  resolveExecutionPresetForOperation,
  resolveWorkerModelSelection,
  validateModelSelectionAgainstProviders,
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
  const envSimple = {
    mode: "simple" as const,
    selection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-sol",
      options: [{ id: "reasoningEffort", value: "high" }],
    },
  };
  const legacyBoard = {
    instanceId: ProviderInstanceId.make("claudeAgent"),
    model: "fable-5",
  } as const;
  const legacyProjectDefault = {
    instanceId: ProviderInstanceId.make("opencode"),
    model: "opencode/grok-code",
  } as const;

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

  it("with project Inherit, uses environment presets over legacy board selection", () => {
    const effective = resolveEffectiveAgentExecutionPresets({
      globalPresets: envSimple,
      projectPresets: null,
      boardSelection: legacyBoard,
      projectDefault: legacyProjectDefault,
    });
    expect(effective).toEqual(envSimple);

    const resolution = resolveExecutionPresetForOperation({
      globalPresets: envSimple,
      projectPresets: null,
      boardSelection: legacyBoard,
      projectDefault: legacyProjectDefault,
      operation: "implementation",
    });
    expect(resolution).toMatchObject({
      _tag: "resolved",
      selection: envSimple.selection,
    });
  });

  it("with project Inherit, uses environment presets over legacy project default", () => {
    const resolution = resolveExecutionPresetForOperation({
      globalPresets: envSimple,
      projectPresets: undefined,
      projectDefault: legacyProjectDefault,
      operation: "review",
    });
    expect(resolution).toMatchObject({
      _tag: "resolved",
      selection: envSimple.selection,
      operation: "review",
    });
  });

  it("lets a modern project override win even when legacy fields differ", () => {
    const projectOverride = {
      mode: "simple" as const,
      selection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.2",
        options: [{ id: "reasoningEffort", value: "medium" }],
      },
    };
    const resolution = resolveExecutionPresetForOperation({
      globalPresets: envSimple,
      projectPresets: projectOverride,
      boardSelection: legacyBoard,
      projectDefault: legacyProjectDefault,
      operation: "repair",
    });
    expect(resolution).toMatchObject({
      _tag: "resolved",
      selection: projectOverride.selection,
    });
  });

  it("preserves pure-legacy synthesis when no modern preset exists", () => {
    expect(
      resolveEffectiveAgentExecutionPresets({
        globalPresets: null,
        projectPresets: null,
        boardSelection: legacyBoard,
        projectDefault: legacyProjectDefault,
      }),
    ).toEqual({ mode: "simple", selection: legacyBoard });

    expect(
      resolveEffectiveAgentExecutionPresets({
        globalPresets: undefined,
        projectPresets: undefined,
        boardSelection: null,
        projectDefault: legacyProjectDefault,
      }),
    ).toEqual({ mode: "simple", selection: legacyProjectDefault });

    expect(
      resolveExecutionPresetForOperation({
        projectPresets: null,
        boardSelection: legacyBoard,
        operation: "implementation",
      }),
    ).toMatchObject({ _tag: "resolved", selection: legacyBoard });
  });

  it("inherits the owning environment's presets, not another environment's", () => {
    const kyleHouse = envSimple;
    const thisMac = {
      mode: "simple" as const,
      selection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.2",
        options: [{ id: "reasoningEffort", value: "low" }],
      },
    };

    const onKyleHouse = resolveExecutionPresetForOperation({
      globalPresets: kyleHouse,
      projectPresets: null,
      boardSelection: thisMac.selection,
      operation: "implementation",
    });
    expect(onKyleHouse).toMatchObject({
      _tag: "resolved",
      selection: kyleHouse.selection,
    });

    const onThisMac = resolveExecutionPresetForOperation({
      globalPresets: thisMac,
      projectPresets: null,
      operation: "implementation",
    });
    expect(onThisMac).toMatchObject({
      _tag: "resolved",
      selection: thisMac.selection,
    });
  });

  it("inherits Advanced environment presets for every operation", () => {
    const advanced = {
      mode: "advanced" as const,
      implementation: boardSelection,
      review: projectSelection,
      repair: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.6-terra",
      },
    };
    expect(
      resolveExecutionPresetForOperation({
        globalPresets: advanced,
        projectPresets: null,
        boardSelection: legacyBoard,
        operation: "implementation",
      }),
    ).toMatchObject({ _tag: "resolved", selection: advanced.implementation });
    expect(
      resolveExecutionPresetForOperation({
        globalPresets: advanced,
        projectPresets: null,
        boardSelection: legacyBoard,
        operation: "review",
      }),
    ).toMatchObject({ _tag: "resolved", selection: advanced.review });
    expect(
      resolveExecutionPresetForOperation({
        globalPresets: advanced,
        projectPresets: null,
        boardSelection: legacyBoard,
        operation: "repair",
      }),
    ).toMatchObject({ _tag: "resolved", selection: advanced.repair });
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

  it("uses a changed Simple model and effort for every operation", () => {
    const simple = {
      mode: "simple" as const,
      selection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.6-sol",
        options: [{ id: "reasoningEffort", value: "high" }],
      },
    };

    for (const operation of ["implementation", "review", "repair"] as const) {
      expect(
        resolveExecutionPresetForOperation({ globalPresets: simple, operation }),
      ).toMatchObject({ _tag: "resolved", selection: simple.selection });
    }
  });
});

describe("validateModelSelectionAgainstProviders", () => {
  const providers = [
    {
      instanceId: ProviderInstanceId.make("codex"),
      availability: "available" as const,
      models: [{ slug: "gpt-5.2", name: "GPT-5.2", isCustom: false, capabilities: null }],
    },
    {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      availability: "unavailable" as const,
      models: [{ slug: "fable-5", name: "Fable 5", isCustom: false, capabilities: null }],
    },
  ];

  it("accepts a configured instance and model", () => {
    expect(
      validateModelSelectionAgainstProviders(
        { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.2" },
        providers,
      )._tag,
    ).toBe("ok");
  });

  it("rejects a missing instance without substituting another", () => {
    const result = validateModelSelectionAgainstProviders(
      { instanceId: ProviderInstanceId.make("opencode"), model: "opencode/grok-code" },
      providers,
    );
    expect(result).toEqual({
      _tag: "invalid",
      issue: {
        kind: "missing-instance",
        instanceId: ProviderInstanceId.make("opencode"),
        model: "opencode/grok-code",
      },
    });
  });

  it("rejects an unavailable instance", () => {
    const result = validateModelSelectionAgainstProviders(
      { instanceId: ProviderInstanceId.make("claudeAgent"), model: "fable-5" },
      providers,
    );
    expect(result._tag).toBe("invalid");
    if (result._tag === "invalid") {
      expect(result.issue.kind).toBe("unavailable-instance");
    }
  });

  it("rejects a missing model when the catalog lists models", () => {
    const result = validateModelSelectionAgainstProviders(
      { instanceId: ProviderInstanceId.make("codex"), model: "missing-model" },
      providers,
    );
    expect(result).toMatchObject({
      _tag: "invalid",
      issue: { kind: "missing-model", model: "missing-model" },
    });
  });

  it("does not invent a fallback when catalogs differ by environment", () => {
    const mac = [
      {
        instanceId: ProviderInstanceId.make("codex"),
        models: [{ slug: "gpt-5.2", name: "GPT-5.2", isCustom: false, capabilities: null }],
      },
    ];
    const house = [
      {
        instanceId: ProviderInstanceId.make("codex"),
        models: [{ slug: "house-only", name: "House", isCustom: false, capabilities: null }],
      },
    ];
    expect(
      validateModelSelectionAgainstProviders(
        { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.2" },
        mac,
      )._tag,
    ).toBe("ok");
    expect(
      validateModelSelectionAgainstProviders(
        { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.2" },
        house,
      ),
    ).toMatchObject({ _tag: "invalid", issue: { kind: "missing-model" } });
  });
});

describe("resolveAndValidateExecutionPresetForOperation", () => {
  it("blocks execution when the resolved instance is absent on the environment", () => {
    const resolution = resolveAndValidateExecutionPresetForOperation({
      globalPresets: {
        mode: "simple",
        selection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "fable-5",
        },
      },
      operation: "review",
      providers: [
        {
          instanceId: ProviderInstanceId.make("codex"),
          models: [{ slug: "gpt-5.2", name: "GPT-5.2", isCustom: false, capabilities: null }],
        },
      ],
      environmentLabel: "kyle-house",
    });
    expect(resolution._tag).toBe("needs-decision");
    if (resolution._tag === "needs-decision") {
      expect(resolution.error).toContain("Review model unavailable on kyle-house");
      expect(resolution.error).toContain("claudeAgent / fable-5");
      expect(resolution.error).toContain("not configured on this environment");
    }
  });

  it("allows a valid selection for the environment catalog", () => {
    const selection = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.2",
    };
    const resolution = resolveAndValidateExecutionPresetForOperation({
      globalPresets: { mode: "simple", selection },
      operation: "implementation",
      providers: [
        {
          instanceId: ProviderInstanceId.make("codex"),
          models: [{ slug: "gpt-5.2", name: "GPT-5.2", isCustom: false, capabilities: null }],
        },
      ],
      environmentLabel: "This Mac",
    });
    expect(resolution).toMatchObject({ _tag: "resolved", selection });
  });
});

describe("describeStaleModelSelection", () => {
  it("returns an explicit unavailable warning without suggesting a replacement", () => {
    expect(
      describeStaleModelSelection({
        selection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "fable-5",
        },
        providers: [
          {
            instanceId: ProviderInstanceId.make("codex"),
            models: [],
          },
        ],
        environmentLabel: "kyle-house",
      }),
    ).toBe("Unavailable on kyle-house");
  });
});
