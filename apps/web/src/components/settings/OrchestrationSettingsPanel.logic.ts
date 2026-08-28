import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";

import {
  buildProviderEnvironmentOptions,
  classifyProviderEnvironmentAccess,
  resolvePrimaryOperateAccess,
  resolveRemoteOperateAccess,
  resolveSelectedProviderEnvironmentId,
  type ProviderEnvironmentAccess,
  type ProviderOperateAccess,
} from "./ProviderSettingsPanel.logic";

export {
  buildProviderEnvironmentOptions as buildOrchestrationEnvironmentOptions,
  classifyProviderEnvironmentAccess as classifyOrchestrationEnvironmentAccess,
  resolvePrimaryOperateAccess as resolveOrchestrationPrimaryOperateAccess,
  resolveRemoteOperateAccess as resolveOrchestrationRemoteOperateAccess,
  resolveSelectedProviderEnvironmentId as resolveSelectedOrchestrationEnvironmentId,
  type ProviderEnvironmentAccess as OrchestrationEnvironmentAccess,
  type ProviderOperateAccess as OrchestrationOperateAccess,
};

export function orchestrationEnvironmentOffline(access: ProviderEnvironmentAccess): boolean {
  return access.kind === "unavailable" || access.kind === "error";
}

export function orchestrationEnvironmentCanEdit(input: {
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly hasServerConfig: boolean;
  readonly operateAccess: ProviderOperateAccess;
}): {
  readonly access: ProviderEnvironmentAccess;
  readonly showCachedReadOnly: boolean;
} {
  const access = classifyProviderEnvironmentAccess(input);
  // Offline with a cached config: show saved presets read-only instead of
  // silently switching to the primary environment.
  if ((access.kind === "unavailable" || access.kind === "error") && input.hasServerConfig) {
    return { access, showCachedReadOnly: true };
  }
  return { access, showCachedReadOnly: false };
}

export function defaultOrchestrationEnvironmentId(input: {
  readonly environments: ReadonlyArray<{ readonly environmentId: EnvironmentId }>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): EnvironmentId | null {
  return resolveSelectedProviderEnvironmentId(
    input.environments,
    input.selectedEnvironmentId,
    input.primaryEnvironmentId,
  );
}
