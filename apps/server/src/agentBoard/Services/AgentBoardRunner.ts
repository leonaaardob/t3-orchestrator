import { Context, Schema } from "effect";
import type { Effect } from "effect";
import type { AgentBoardRunInput, AgentBoardRunResult } from "@t3tools/contracts";

import type { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import type { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { VcsProvisioningService } from "../../vcs/VcsProvisioningService.ts";
import type { AgentBoardFileSystem } from "./AgentBoardFileSystem.ts";

export class AgentBoardRunnerError extends Schema.TaggedErrorClass<AgentBoardRunnerError>()(
  "AgentBoardRunnerError",
  {
    cwd: Schema.String,
    cardId: Schema.String,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

/**
 * Collaborators the runner resolves from the calling fiber's environment (the
 * RPC handler / scheduler fiber already carries them), keeping the Live layer
 * free of cross-domain build-time requirements.
 */
export interface AgentBoardRunnerShape {
  /**
   * Claim a Ready card and launch its implementation run server-side:
   * claim -> card git worktree (create or reuse) -> `thread.create` ->
   * `thread.turn.start` -> persist runtime state. Every failure path marks
   * the card `Blocked` with `runtime.currentError`; a thread created before a
   * failed turn start is deleted again.
   */
  readonly run: (
    input: AgentBoardRunInput,
  ) => Effect.Effect<
    AgentBoardRunResult,
    AgentBoardRunnerError,
    | AgentBoardFileSystem
    | GitWorkflowService
    | OrchestrationEngineService
    | ProjectionSnapshotQuery
    | VcsProvisioningService
  >;
}

export class AgentBoardRunner extends Context.Service<AgentBoardRunner, AgentBoardRunnerShape>()(
  "t3/agentBoard/Services/AgentBoardRunner",
) {}
