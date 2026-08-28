/**
 * Worker execution config resolution for board card runs.
 *
 * Resolution is config-only. The chat composer's live selection never
 * influences a board run.
 *
 * Preset hierarchy (environment → project inherit/override):
 *   - Project `agentExecutionPresets` overrides when non-null.
 *   - Null / Inherit uses the owning environment's `agentExecutionPresets`.
 *   - Legacy `runner.workerModelSelection` / `defaultModelSelection` synthesize
 *     a Simple preset only when neither level has a modern preset.
 *   - Runtime selects by operation (implementation / review / repair).
 *   - Review independence is enforced: same instanceId+model for impl and
 *     review blocks review with Needs Decision.
 *
 * `resolveWorkerModelSelection` remains for legacy board UI / pure-legacy
 * installs; orchestration runs go through `resolveExecutionPresetForOperation`.
 *
 * @module agentBoardRunner
 */
import type {
  AgentBoardFile,
  AgentExecutionPresets,
  ModelSelection,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";

export type WorkerModelSelectionSource = "board-runner" | "project-default";

export type WorkerModelSelectionResolution =
  | {
      readonly _tag: "resolved";
      readonly source: WorkerModelSelectionSource;
      readonly selection: ModelSelection;
    }
  | {
      readonly _tag: "missing-config";
    };

/** Shown to operators when neither the board nor the project pins a worker. */
export const MISSING_WORKER_CONFIG_ERROR =
  "No worker execution configured. Set a worker model in the Planning board or a project default model.";

/**
 * Resolve the model selection for a claimed-card run from central config.
 * `projectDefault` may be null/undefined when no project default exists;
 * `board.runner.workerModelSelection` always takes precedence over it.
 */
export function resolveWorkerModelSelection(
  board: Pick<AgentBoardFile, "runner">,
  projectDefault: ModelSelection | null | undefined,
): WorkerModelSelectionResolution {
  const override = board.runner.workerModelSelection;
  if (override) {
    return { _tag: "resolved", source: "board-runner", selection: override };
  }
  if (projectDefault) {
    return { _tag: "resolved", source: "project-default", selection: projectDefault };
  }
  return { _tag: "missing-config" };
}

// ── Execution presets (new) ──────────────────────────────────────

export type AgentExecutionOperation = "implementation" | "review" | "repair";

export const REVIEW_INDEPENDENCE_ERROR =
  "Review model must differ from implementation model (same instanceId and model). Configure Advanced presets with distinct implementation and review models.";

export function isSameModelSelection(a: ModelSelection, b: ModelSelection): boolean {
  return a.instanceId === b.instanceId && a.model === b.model;
}

export function isReviewIndependent(
  implementation: ModelSelection | null | undefined,
  review: ModelSelection | null | undefined,
): boolean {
  if (!implementation || !review) return true;
  return !isSameModelSelection(implementation, review);
}

/**
 * Resolve the effective presets via environment→project inheritance with
 * legacy fallbacks. Precedence:
 *   1. Project explicit presets (non-null override)
 *   2. Environment / global `agentExecutionPresets` (Inherit)
 *   3. Legacy board `workerModelSelection` (synthetic Simple) — only when no
 *      modern preset exists at either level
 *   4. Legacy project `defaultModelSelection` (synthetic Simple) — same gate
 * Returns null when no config exists at any level.
 *
 * Project UI "Inherit" means step 2: use the owning environment's presets.
 * Hidden legacy values must not beat an explicit environment default.
 */
export function resolveEffectiveAgentExecutionPresets(params: {
  readonly globalPresets?: AgentExecutionPresets | null | undefined;
  readonly projectPresets?: AgentExecutionPresets | null | undefined;
  readonly projectDefault?: ModelSelection | null | undefined;
  readonly boardSelection?: ModelSelection | null | undefined;
}): AgentExecutionPresets | null {
  if (params.projectPresets !== null && params.projectPresets !== undefined) {
    return params.projectPresets;
  }
  if (params.globalPresets) {
    return params.globalPresets;
  }
  // Pure-legacy installs: no modern preset at project or environment level.
  if (params.boardSelection) {
    return { mode: "simple", selection: params.boardSelection } as AgentExecutionPresets;
  }
  if (params.projectDefault) {
    return { mode: "simple", selection: params.projectDefault } as AgentExecutionPresets;
  }
  return null;
}

export function resolveModelSelectionForOperation(
  effective: AgentExecutionPresets | null | undefined,
  operation: AgentExecutionOperation,
): ModelSelection | null {
  if (!effective) return null;
  if (effective.mode === "simple") {
    return effective.selection;
  }
  if (operation === "implementation") return effective.implementation;
  if (operation === "review") return effective.review;
  return effective.repair;
}

export function resolveImplementationModelSelection(
  effective: AgentExecutionPresets | null | undefined,
): ModelSelection | null {
  return resolveModelSelectionForOperation(effective, "implementation");
}

export function resolveReviewModelSelection(
  effective: AgentExecutionPresets | null | undefined,
): ModelSelection | null {
  return resolveModelSelectionForOperation(effective, "review");
}

export function resolveRepairModelSelection(
  effective: AgentExecutionPresets | null | undefined,
): ModelSelection | null {
  return resolveModelSelectionForOperation(effective, "repair");
}

export type ExecutionPresetResolution =
  | {
      readonly _tag: "resolved";
      readonly selection: ModelSelection;
      readonly presets: AgentExecutionPresets;
      readonly operation: AgentExecutionOperation;
    }
  | {
      readonly _tag: "missing-config";
      readonly operation: AgentExecutionOperation;
    }
  | {
      readonly _tag: "needs-decision";
      readonly operation: AgentExecutionOperation;
      readonly error: string;
    };

/**
 * High-level helper: given hierarchy inputs, resolve the ModelSelection for
 * the requested operation, applying Global→Project inheritance and review
 * independence. `needs-decision` is returned for a blocked same-model review
 * instead of silently self-reviewing.
 */
export function resolveExecutionPresetForOperation(params: {
  readonly globalPresets?: AgentExecutionPresets | null | undefined;
  readonly projectPresets?: AgentExecutionPresets | null | undefined;
  readonly projectDefault?: ModelSelection | null | undefined;
  readonly boardSelection?: ModelSelection | null | undefined;
  readonly operation: AgentExecutionOperation;
}): ExecutionPresetResolution {
  const effective = resolveEffectiveAgentExecutionPresets(params);
  if (!effective) {
    return { _tag: "missing-config", operation: params.operation };
  }
  const selection = resolveModelSelectionForOperation(effective, params.operation);
  if (!selection) {
    return { _tag: "missing-config", operation: params.operation };
  }
  if (params.operation === "review" && effective.mode === "advanced") {
    const impl = resolveImplementationModelSelection(effective);
    if (impl && isSameModelSelection(impl, selection)) {
      return {
        _tag: "needs-decision",
        operation: params.operation,
        error: REVIEW_INDEPENDENCE_ERROR,
      };
    }
  }
  return { _tag: "resolved", selection, presets: effective, operation: params.operation };
}

// ── Environment catalog preflight ────────────────────────────────

export type ModelSelectionCatalogIssue =
  | {
      readonly kind: "missing-instance";
      readonly instanceId: ProviderInstanceId;
      readonly model: string;
    }
  | {
      readonly kind: "unavailable-instance";
      readonly instanceId: ProviderInstanceId;
      readonly model: string;
    }
  | {
      readonly kind: "missing-model";
      readonly instanceId: ProviderInstanceId;
      readonly model: string;
    };

export type ModelSelectionCatalogValidation =
  | { readonly _tag: "ok"; readonly provider: ServerProvider }
  | { readonly _tag: "invalid"; readonly issue: ModelSelectionCatalogIssue };

/**
 * Validate a resolved ModelSelection against one environment's provider
 * catalog. Never invents a replacement provider or model.
 *
 * When the catalog is empty/unknown, model existence cannot be proven — only
 * instance presence is checked when providers are supplied. Callers that have
 * no live catalog should skip this check rather than treat absence as valid.
 */
export function validateModelSelectionAgainstProviders(
  selection: ModelSelection,
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "models" | "availability">>,
): ModelSelectionCatalogValidation {
  const provider = providers.find((entry) => entry.instanceId === selection.instanceId);
  if (!provider) {
    return {
      _tag: "invalid",
      issue: {
        kind: "missing-instance",
        instanceId: selection.instanceId,
        model: selection.model,
      },
    };
  }
  if (provider.availability === "unavailable") {
    return {
      _tag: "invalid",
      issue: {
        kind: "unavailable-instance",
        instanceId: selection.instanceId,
        model: selection.model,
      },
    };
  }
  // Empty model lists mean the probe has not reported models yet — do not
  // treat that as "model missing" or we block every run during cold start.
  if (
    provider.models.length > 0 &&
    !provider.models.some((model) => model.slug === selection.model)
  ) {
    return {
      _tag: "invalid",
      issue: {
        kind: "missing-model",
        instanceId: selection.instanceId,
        model: selection.model,
      },
    };
  }
  return { _tag: "ok", provider: provider as ServerProvider };
}

/** Operator-facing message for a catalog validation failure. */
export function formatModelSelectionCatalogError(input: {
  readonly operation: AgentExecutionOperation;
  readonly environmentLabel: string;
  readonly issue: ModelSelectionCatalogIssue;
}): string {
  const opLabel =
    input.operation === "implementation"
      ? "Implementation"
      : input.operation === "review"
        ? "Review"
        : "Repair";
  const target = `${input.issue.instanceId} / ${input.issue.model}`;
  if (input.issue.kind === "missing-model") {
    return `${opLabel} model unavailable on ${input.environmentLabel}: ${target} is not available on this environment.`;
  }
  return `${opLabel} model unavailable on ${input.environmentLabel}: ${target} is not configured on this environment.`;
}

/**
 * Resolve an operation's selection and validate it against the environment
 * provider catalog. Preserves existing missing-config / needs-decision
 * outcomes; catalog failures become `needs-decision` with a clear error.
 */
export function resolveAndValidateExecutionPresetForOperation(params: {
  readonly globalPresets?: AgentExecutionPresets | null | undefined;
  readonly projectPresets?: AgentExecutionPresets | null | undefined;
  readonly projectDefault?: ModelSelection | null | undefined;
  readonly boardSelection?: ModelSelection | null | undefined;
  readonly operation: AgentExecutionOperation;
  readonly providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "models" | "availability">>;
  readonly environmentLabel: string;
}): ExecutionPresetResolution {
  const resolution = resolveExecutionPresetForOperation(params);
  if (resolution._tag !== "resolved") {
    return resolution;
  }
  const catalog = validateModelSelectionAgainstProviders(resolution.selection, params.providers);
  if (catalog._tag === "ok") {
    return resolution;
  }
  return {
    _tag: "needs-decision",
    operation: params.operation,
    error: formatModelSelectionCatalogError({
      operation: params.operation,
      environmentLabel: params.environmentLabel,
      issue: catalog.issue,
    }),
  };
}

/** UI helper: whether a stored selection is absent from the live catalog. */
export function describeStaleModelSelection(input: {
  readonly selection: ModelSelection;
  readonly providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "models" | "availability">>;
  readonly environmentLabel: string;
}): string | null {
  const catalog = validateModelSelectionAgainstProviders(input.selection, input.providers);
  if (catalog._tag === "ok") {
    return null;
  }
  if (catalog.issue.kind === "missing-model") {
    return `Unavailable on ${input.environmentLabel}: model ${catalog.issue.model} is not reported by ${catalog.issue.instanceId}.`;
  }
  return `Unavailable on ${input.environmentLabel}`;
}
