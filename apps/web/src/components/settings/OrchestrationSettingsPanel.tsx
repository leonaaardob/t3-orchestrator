import { useAtomValue } from "@effect/atom-react";
import { connectionStatusText } from "@t3tools/client-runtime/connection";
import {
  type EnvironmentId,
  type ModelSelection,
  ProviderDriverKind,
  type ServerProvider,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { describeStaleModelSelection } from "@t3tools/shared/agentBoardRunner";
import { createModelSelection } from "@t3tools/shared/model";
import * as Equal from "effect/Equal";
import { useCallback, useMemo, useState } from "react";

import { isElectron } from "../../env";
import { usePrimarySessionState } from "../../environments/primary";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import {
  useEnvironments,
  usePrimaryEnvironmentId,
  type EnvironmentPresentation,
} from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useEnvironmentSessionState } from "../../state/session";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import {
  ConnectionStatusDot,
  connectionPhaseDotClassName,
  connectionPhasePingClassName,
} from "../ConnectionStatusDot";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import {
  buildOrchestrationEnvironmentOptions,
  defaultOrchestrationEnvironmentId,
  orchestrationEnvironmentCanEdit,
  resolveOrchestrationPrimaryOperateAccess,
  resolveOrchestrationRemoteOperateAccess,
  type OrchestrationOperateAccess,
} from "./OrchestrationSettingsPanel.logic";

export function EnvironmentAgentExecutionSection({
  environmentId,
  environmentLabel,
  readOnly,
  providers,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly readOnly: boolean;
  readonly providers: ReadonlyArray<ServerProvider>;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const presets = settings.agentExecutionPresets;
  const effective = presets ?? DEFAULT_UNIFIED_SETTINGS.agentExecutionPresets;
  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
      ),
    [providers, settings],
  );
  const modelOptionsByInstance = useMemo(
    () => getCustomModelOptionsByInstance(settings, providers),
    [providers, settings],
  );
  const isDirty = !Equal.equals(
    settings.agentExecutionPresets ?? null,
    DEFAULT_UNIFIED_SETTINGS.agentExecutionPresets ?? null,
  );

  const setSimpleSelection = useCallback(
    (selection: ModelSelection) => {
      if (readOnly) return;
      updateSettings({
        agentExecutionPresets: { mode: "simple", selection },
      });
    },
    [readOnly, updateSettings],
  );
  const setAdvanced = useCallback(
    (field: "implementation" | "review" | "repair", selection: ModelSelection) => {
      if (readOnly || effective.mode !== "advanced") return;
      updateSettings({
        agentExecutionPresets: { ...effective, [field]: selection },
      });
    },
    [effective, readOnly, updateSettings],
  );
  const switchMode = useCallback(
    (mode: "simple" | "advanced") => {
      if (readOnly || mode === effective.mode) return;
      if (mode === "simple") {
        const sel = effective.mode === "advanced" ? effective.implementation : effective.selection;
        updateSettings({
          agentExecutionPresets: { mode: "simple", selection: sel },
        });
      } else {
        const sel = effective.mode === "simple" ? effective.selection : effective.implementation;
        updateSettings({
          agentExecutionPresets: {
            mode: "advanced",
            implementation: sel,
            review: sel,
            repair: sel,
          },
        });
      }
    },
    [effective, readOnly, updateSettings],
  );

  const renderPicker = (
    selection: ModelSelection,
    onChange: (selection: ModelSelection) => void,
  ) => {
    const entry = instanceEntries.find((item) => item.instanceId === selection.instanceId);
    const provider: ProviderDriverKind = (entry?.driverKind ?? "codex") as ProviderDriverKind;
    const staleWarning = describeStaleModelSelection({
      selection,
      providers,
      environmentLabel,
    });
    return (
      <div className="flex min-w-0 flex-col items-end gap-1">
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <ProviderModelPicker
            activeInstanceId={selection.instanceId}
            model={selection.model}
            lockedProvider={null}
            instanceEntries={instanceEntries}
            modelOptionsByInstance={modelOptionsByInstance}
            triggerVariant="outline"
            triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
            disabled={readOnly}
            onInstanceModelChange={(instanceId, model) => {
              onChange(createModelSelection(instanceId, model, selection.options));
            }}
          />
          <TraitsPicker
            provider={provider}
            models={entry?.models ?? []}
            model={selection.model}
            prompt=""
            onPromptChange={() => {}}
            modelOptions={selection.options ?? []}
            allowPromptInjectedEffort={false}
            planModeEnabled={settings.planModeEnabled}
            triggerVariant="outline"
            triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
            onModelOptionsChange={(nextOptions) => {
              if (readOnly) return;
              onChange(createModelSelection(selection.instanceId, selection.model, nextOptions));
            }}
          />
        </div>
        {staleWarning ? (
          <p className="max-w-sm text-right text-xs text-destructive">{staleWarning}</p>
        ) : null}
      </div>
    );
  };

  const sameImplReview =
    effective.mode === "advanced" &&
    effective.implementation.instanceId === effective.review.instanceId &&
    effective.implementation.model === effective.review.model;

  return (
    <>
      <SettingsRow
        title="Mode"
        description="Simple uses one model for implementation, review, and repair. Advanced uses three distinct models; review must differ from implementation."
        resetAction={
          isDirty && !readOnly ? (
            <SettingResetButton
              label="agent execution"
              onClick={() =>
                updateSettings({
                  agentExecutionPresets: DEFAULT_UNIFIED_SETTINGS.agentExecutionPresets,
                })
              }
            />
          ) : null
        }
        control={
          <Select
            value={effective.mode}
            onValueChange={(value) => {
              if (value === "simple" || value === "advanced") switchMode(value);
            }}
            disabled={readOnly}
          >
            <SelectTrigger className="w-full sm:w-32" aria-label="Agent execution mode">
              <SelectValue>{effective.mode === "simple" ? "Simple" : "Advanced"}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="simple">
                Simple
              </SelectItem>
              <SelectItem hideIndicator value="advanced">
                Advanced
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      {effective.mode === "simple" ? (
        <SettingsRow
          title="Model"
          description="This single model is used for implementation, review, and repair. Same-model self-review is allowed in Simple mode."
          control={renderPicker(effective.selection, setSimpleSelection)}
        />
      ) : (
        <>
          <SettingsRow
            title="Implementation"
            description="Runs the implementation agent."
            control={renderPicker(effective.implementation, (selection) =>
              setAdvanced("implementation", selection),
            )}
          />
          <SettingsRow
            title="Review"
            description="Fresh review agent; must differ from implementation."
            control={renderPicker(effective.review, (selection) =>
              setAdvanced("review", selection),
            )}
          />
          <SettingsRow
            title="Repair"
            description="Repair turn on the implementation thread."
            control={renderPicker(effective.repair, (selection) =>
              setAdvanced("repair", selection),
            )}
          />
          {sameImplReview ? (
            <div className="px-3 py-2 text-sm text-destructive">
              Review model must differ from implementation model (same instanceId and model). Change
              one of them.
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

function OrchestrationEnvironmentUnavailable({
  environment,
  title,
  description,
}: {
  readonly environment: EnvironmentPresentation;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <SettingsSection title={`Defaults for projects on ${environment.label}`}>
      <SettingsRow title={title} description={description} />
    </SettingsSection>
  );
}

function AccessGatedOrchestrationSettings({
  environment,
  operateAccess,
}: {
  readonly environment: EnvironmentPresentation;
  readonly operateAccess: OrchestrationOperateAccess;
}) {
  const liveProviders = useAtomValue(
    serverEnvironment.providersValueAtom(environment.environmentId),
  );
  const { access, showCachedReadOnly } = orchestrationEnvironmentCanEdit({
    connectionPhase: environment.connection.phase,
    hasServerConfig: environment.serverConfig !== null,
    operateAccess,
  });

  if (access.kind === "loading") {
    return (
      <OrchestrationEnvironmentUnavailable
        environment={environment}
        title="Loading orchestration settings"
        description={
          access.reason === "permissions"
            ? "Checking what this session is allowed to change."
            : `Waiting for ${environment.label}'s configuration.`
        }
      />
    );
  }

  if ((access.kind === "unavailable" || access.kind === "error") && !showCachedReadOnly) {
    return (
      <OrchestrationEnvironmentUnavailable
        environment={environment}
        title={
          access.kind === "error"
            ? "Could not connect to this environment"
            : "Orchestration settings are unavailable"
        }
        description={`${environment.label} is offline. ${connectionStatusText(environment.connection)}`}
      />
    );
  }

  const providers = environment.serverConfig?.providers ?? liveProviders ?? EMPTY_SERVER_PROVIDERS;
  const readOnly = access.kind === "read-only" || showCachedReadOnly;

  return (
    <SettingsSection title={`Defaults for projects on ${environment.label}`}>
      <SettingsRow
        title="Environment defaults"
        description="These defaults apply to projects running on this environment."
      />
      {showCachedReadOnly ? (
        <SettingsRow
          title={`${environment.label} is offline`}
          description="Showing cached orchestration settings. Provider and model changes are disabled until this environment reconnects."
        />
      ) : null}
      {access.kind === "read-only" ? (
        <SettingsRow
          title="Limited permissions"
          description="This session can view orchestration settings but cannot change them."
        />
      ) : null}
      <EnvironmentAgentExecutionSection
        key={environment.environmentId}
        environmentId={environment.environmentId}
        environmentLabel={environment.label}
        readOnly={readOnly}
        providers={providers}
      />
    </SettingsSection>
  );
}

function SelectedEnvironmentOrchestrationSettings({
  environment,
}: {
  readonly environment: EnvironmentPresentation;
}) {
  const isPrimary = environment.entry.target._tag === "PrimaryConnectionTarget";
  if (isPrimary) {
    if (isElectron) {
      return <AccessGatedOrchestrationSettings environment={environment} operateAccess="granted" />;
    }
    return <PrimarySessionGatedOrchestrationSettings environment={environment} />;
  }
  return <RemoteSessionGatedOrchestrationSettings environment={environment} />;
}

function PrimarySessionGatedOrchestrationSettings({
  environment,
}: {
  readonly environment: EnvironmentPresentation;
}) {
  const primarySessionState = usePrimarySessionState();
  const operateAccess = resolveOrchestrationPrimaryOperateAccess({
    isPrimary: true,
    hasDesktopBridge: false,
    session: primarySessionState.data,
    isPending: primarySessionState.isPending,
    hasError: primarySessionState.error !== null,
  });
  return (
    <AccessGatedOrchestrationSettings environment={environment} operateAccess={operateAccess} />
  );
}

function RemoteSessionGatedOrchestrationSettings({
  environment,
}: {
  readonly environment: EnvironmentPresentation;
}) {
  const sessionState = useEnvironmentSessionState(environment.environmentId);
  const operateAccess = resolveOrchestrationRemoteOperateAccess({
    session: sessionState.data,
    isPending: sessionState.isPending,
    hasError: sessionState.hasError,
  });
  return (
    <AccessGatedOrchestrationSettings environment={environment} operateAccess={operateAccess} />
  );
}

/**
 * Environment-scoped execution presets. Each connected environment owns its
 * own `settings.json` / provider catalog; this panel never flattens catalogs
 * across machines.
 */
export function OrchestrationSettingsPanel() {
  const { environments, isReady } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const options = useMemo(
    () => buildOrchestrationEnvironmentOptions(environments, primaryEnvironmentId),
    [environments, primaryEnvironmentId],
  );
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(
    primaryEnvironmentId,
  );
  const effectiveEnvironmentId = defaultOrchestrationEnvironmentId({
    environments: options,
    selectedEnvironmentId,
    primaryEnvironmentId,
  });
  const selectedEnvironment =
    options.find((environment) => environment.environmentId === effectiveEnvironmentId) ?? null;

  return (
    <SettingsPageContainer>
      <SettingsSection title="Orchestration">
        <SettingsRow
          title="Environment"
          description="Choose which environment's execution defaults to view or edit."
          control={
            options.length === 0 ? (
              <span className="text-sm text-muted-foreground">
                {isReady ? "No known environments" : "Loading environments"}
              </span>
            ) : (
              <Select
                value={effectiveEnvironmentId ?? undefined}
                onValueChange={(value) => setSelectedEnvironmentId(value as EnvironmentId)}
              >
                <SelectTrigger className="w-full sm:w-56" aria-label="Orchestration environment">
                  <SelectValue>
                    {selectedEnvironment ? (
                      <span className="flex min-w-0 items-center gap-1.5">
                        <ConnectionStatusDot
                          tooltipText={connectionStatusText(selectedEnvironment.connection)}
                          dotClassName={connectionPhaseDotClassName(
                            selectedEnvironment.connection.phase,
                          )}
                          pingClassName={connectionPhasePingClassName(
                            selectedEnvironment.connection.phase,
                          )}
                        />
                        <span className="truncate">{selectedEnvironment.label}</span>
                      </span>
                    ) : (
                      "Select environment"
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {options.map((environment) => (
                    <SelectItem
                      key={environment.environmentId}
                      hideIndicator
                      value={environment.environmentId}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <ConnectionStatusDot
                          tooltipText={connectionStatusText(environment.connection)}
                          dotClassName={connectionPhaseDotClassName(environment.connection.phase)}
                          pingClassName={connectionPhasePingClassName(environment.connection.phase)}
                        />
                        <span className="truncate">{environment.label}</span>
                        <span className="truncate text-muted-foreground">
                          · {connectionStatusText(environment.connection)}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            )
          }
        />
      </SettingsSection>

      {selectedEnvironment ? (
        <SelectedEnvironmentOrchestrationSettings
          key={selectedEnvironment.environmentId}
          environment={selectedEnvironment}
        />
      ) : null}
    </SettingsPageContainer>
  );
}
