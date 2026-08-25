import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import type { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { AgentBoardFileSystem } from "./AgentBoardFileSystem.ts";
import type { AgentBoardRunner } from "./AgentBoardRunner.ts";

/**
 * Collaborators the tick fiber resolves per run (the same precedent as the
 * runner service): the Live layer builds without them, and the fiber that
 * calls `start` — the server runtime startup, or a test harness — carries
 * them in its environment. GitWorkflowService and the runner's other
 * collaborators are needed because the tick invokes `AgentBoardRunner.run`,
 * whose R requires them.
 */
export type AgentBoardSchedulerRequirements =
  | AgentBoardFileSystem
  | AgentBoardRunner
  | GitWorkflowService
  | OrchestrationEngineService
  | ProjectionSnapshotQuery;

export interface AgentBoardSchedulerShape {
  /**
   * Start the always-on board scheduler loop within the provided scope.
   *
   * The loop ticks on a fixed interval: it reconciles `Running` (success →
   * `Reviewing` with a fresh review thread, routine failure → bounded retry
   * with in-memory exponential backoff, exhausted → `Needs Decision`),
   * `Reviewing` (polls the review thread: `REVIEW: PASS` → `Review`,
   * `REVIEW: FAIL` routine → `Diagnosing` → repair turn on the implementation
   * thread → next `Reviewing`, capped → `Needs Decision`, `NEEDS_DECISION:`
   * intent → `Needs Decision` immediately), and `Diagnosing` (waits for the
   * repair turn to complete → next `Reviewing`) against the orchestration
   * projection, aborts active turns for cards moved out of
   * `Running`/`Reviewing`/`Diagnosing`, then claims eligible `Ready` cards
   * through the shared `AgentBoardRunner` service up to the board's
   * concurrency cap.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope | AgentBoardSchedulerRequirements>;
}

export class AgentBoardScheduler extends Context.Service<
  AgentBoardScheduler,
  AgentBoardSchedulerShape
>()("t3/agentBoard/Services/AgentBoardScheduler") {}
