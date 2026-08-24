/**
 * Worker execution config resolution for board card runs.
 *
 * Resolution is config-only and project-central: the board's
 * `runner.workerModelSelection` wins, then the project's
 * `defaultModelSelection`, then the run is blocked with a typed
 * missing-config reason. The chat composer's live selection never
 * influences a board run.
 *
 * @module agentBoardRunner
 */
import type { AgentBoardFile, ModelSelection } from "@t3tools/contracts";

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
