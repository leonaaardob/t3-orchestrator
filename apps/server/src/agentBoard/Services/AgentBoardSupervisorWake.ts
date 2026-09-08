import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface AgentBoardSupervisorWakeShape {
  /** Start the durable pending-wake dispatcher. */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  /** Process persisted wakes once; exposed for receipt-driven tests. */
  readonly processPending: () => Effect.Effect<void, never>;
}

export class AgentBoardSupervisorWake extends Context.Service<
  AgentBoardSupervisorWake,
  AgentBoardSupervisorWakeShape
>()("t3-orchestrator/agentBoard/Services/AgentBoardSupervisorWake") {}
