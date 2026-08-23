import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

/**
 * Web-only: the Planning board UI is the only consumer of the agent-board RPC
 * surface, so its command atoms live here instead of the shared client-runtime
 * project atoms consumed by the mobile app.
 */
export const agentBoardEnvironment = {
  load: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:agent-board:load",
    tag: WS_METHODS.projectsLoadAgentBoard,
  }),
  save: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:agent-board:save",
    tag: WS_METHODS.projectsSaveAgentBoard,
  }),
  claimCard: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:agent-board:claim-card",
    tag: WS_METHODS.projectsClaimAgentBoardCard,
  }),
};
