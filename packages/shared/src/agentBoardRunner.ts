/**
 * Worker execution config resolution for board card runs.
 *
 * Resolution is config-only and project-central: the board's
 * `runner.workerModelSelection` wins, then the project's
 * `defaultModelSelection`, then the run is blocked with a typed
 * missing-config reason. The chat composer's live selection never
 * influences a board run.
 *
 * New preset hierarchy (Global→Project) reuses the same ModelSelection
 * architecture:
 *   - Global `agentExecutionPresets` provides the default Simple/Advanced
 *     presets.
 *   - Project `agentExecutionPresets` overrides when non-null (null = inherit).
 *   - Legacy `defaultModelSelection` / board runner selection are migrated to
 *     a synthetic Simple preset when no explicit presets exist.
 *   - Runtime selects by operation (implementation / review / repair).
 *   - Review independence is enforced: same instanceId+model for impl and
 *     review blocks review with Needs Decision.
 *
 * @module agentBoardRunner
 */
import type { AgentBoardFile, AgentExecutionPresets, ModelSelection } from "@t3tools/contracts";

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
 * Resolve the effective presets via Global→Project inheritance with legacy
 * fallbacks. Precedence:
 *   1. Project explicit presets (non-null)
 *   2. Board runner legacy selection (synthetic Simple)
 *   3. Project defaultModelSelection legacy (synthetic Simple)
 *   4. Global presets
 * Returns null when no config exists at any level.
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
  if (params.boardSelection) {
    return { mode: "simple", selection: params.boardSelection } as AgentExecutionPresets;
  }
  if (params.projectDefault) {
    return { mode: "simple", selection: params.projectDefault } as AgentExecutionPresets;
  }
  if (params.globalPresets) {
    return params.globalPresets;
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
