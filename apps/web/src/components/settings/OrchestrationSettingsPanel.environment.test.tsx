import type { ReactElement } from "react";
import {
  DEFAULT_UNIFIED_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";

const settingsState = vi.hoisted(() => ({
  byEnvironment: new Map<string, UnifiedSettings>(),
  readEnvironmentIds: [] as EnvironmentId[],
  updateEnvironmentIds: [] as EnvironmentId[],
  patchesByEnvironment: new Map<string, unknown[]>(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useCallback: reactHookHarness.useCallback,
    useMemo: reactHookHarness.useMemo,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentSettings: (environmentId: EnvironmentId) => {
    settingsState.readEnvironmentIds.push(environmentId);
    return settingsState.byEnvironment.get(String(environmentId)) ?? DEFAULT_UNIFIED_SETTINGS;
  },
  useUpdateEnvironmentSettings: (environmentId: EnvironmentId) => {
    settingsState.updateEnvironmentIds.push(environmentId);
    return (patch: unknown) => {
      const key = String(environmentId);
      const previous = settingsState.patchesByEnvironment.get(key) ?? [];
      settingsState.patchesByEnvironment.set(key, [...previous, patch]);
      const current = settingsState.byEnvironment.get(key) ?? DEFAULT_UNIFIED_SETTINGS;
      settingsState.byEnvironment.set(key, {
        ...current,
        ...(patch as UnifiedSettings),
      });
    };
  },
}));

import { EnvironmentAgentExecutionSection } from "./OrchestrationSettingsPanel";

const macId = EnvironmentId.make("mac");
const houseId = EnvironmentId.make("kyle-house");
const codexId = ProviderInstanceId.make("codex");
const claudeId = ProviderInstanceId.make("claudeAgent");

function provider(instanceId: ProviderInstanceId, model: string, driver: string): ServerProvider {
  return {
    instanceId,
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-29T00:00:00.000Z",
    models: [{ slug: model, name: model, isCustom: false, capabilities: null }],
    slashCommands: [],
    skills: [],
  };
}

function renderSection(input: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly readOnly?: boolean;
}): ReactElement<Record<string, unknown>> {
  hooks.beginRender();
  return EnvironmentAgentExecutionSection({
    environmentId: input.environmentId,
    environmentLabel: input.environmentLabel,
    providers: input.providers,
    readOnly: input.readOnly ?? false,
  }) as ReactElement<Record<string, unknown>>;
}

describe("EnvironmentAgentExecutionSection routing", () => {
  beforeEach(() => {
    hooks.reset();
    settingsState.readEnvironmentIds = [];
    settingsState.updateEnvironmentIds = [];
    settingsState.patchesByEnvironment.clear();
    settingsState.byEnvironment.set(String(macId), {
      ...DEFAULT_UNIFIED_SETTINGS,
      agentExecutionPresets: {
        mode: "simple",
        selection: { instanceId: codexId, model: "mac-model" },
      },
    });
    settingsState.byEnvironment.set(String(houseId), {
      ...DEFAULT_UNIFIED_SETTINGS,
      agentExecutionPresets: {
        mode: "advanced",
        implementation: { instanceId: codexId, model: "house-impl" },
        review: { instanceId: claudeId, model: "house-review" },
        repair: { instanceId: codexId, model: "house-repair" },
      },
    });
  });

  it("reads and writes Mac presets only when Mac is selected", () => {
    const panel = renderSection({
      environmentId: macId,
      environmentLabel: "This Mac",
      providers: [provider(codexId, "mac-model", "codex")],
    });
    expect(settingsState.readEnvironmentIds).toEqual([macId]);
    expect(settingsState.updateEnvironmentIds).toEqual([macId]);

    const mode = visitElements(
      panel,
      (element) => element.props["aria-label"] === "Agent execution mode",
    );
    expect(mode).not.toBeNull();

    const write = settingsState.updateEnvironmentIds.includes(macId)
      ? (patch: unknown) => {
          const key = String(macId);
          const current = settingsState.byEnvironment.get(key)!;
          settingsState.byEnvironment.set(key, { ...current, ...(patch as UnifiedSettings) });
          const previous = settingsState.patchesByEnvironment.get(key) ?? [];
          settingsState.patchesByEnvironment.set(key, [...previous, patch]);
        }
      : null;
    write?.({
      agentExecutionPresets: {
        mode: "simple",
        selection: { instanceId: codexId, model: "mac-changed" },
      },
    });
    expect(settingsState.byEnvironment.get(String(macId))?.agentExecutionPresets).toMatchObject({
      selection: { model: "mac-changed" },
    });
    expect(settingsState.byEnvironment.get(String(houseId))?.agentExecutionPresets).toMatchObject({
      mode: "advanced",
      implementation: { model: "house-impl" },
    });
  });

  it("shows kyle-house Advanced presets when that environment is selected", () => {
    const panel = renderSection({
      environmentId: houseId,
      environmentLabel: "kyle-house",
      providers: [
        provider(codexId, "house-impl", "codex"),
        provider(claudeId, "house-review", "claudeAgent"),
      ],
    });
    expect(settingsState.readEnvironmentIds).toEqual([houseId]);
    expect(settingsState.updateEnvironmentIds).toEqual([houseId]);
    expect(
      visitElements(panel, (element) => element.props.title === "Implementation"),
    ).not.toBeNull();
    expect(visitElements(panel, (element) => element.props.title === "Review")).not.toBeNull();
    expect(visitElements(panel, (element) => element.props.title === "Repair")).not.toBeNull();
  });

  it("warns on stale providers without replacing the stored selection", () => {
    settingsState.byEnvironment.set(String(houseId), {
      ...DEFAULT_UNIFIED_SETTINGS,
      agentExecutionPresets: {
        mode: "simple",
        selection: { instanceId: claudeId, model: "fable-5" },
      },
    });
    const panel = renderSection({
      environmentId: houseId,
      environmentLabel: "kyle-house",
      providers: [provider(codexId, "house-only", "codex")],
    });
    const warning = visitElements(
      panel,
      (element) =>
        typeof element.props.children === "string" &&
        String(element.props.children).includes("Unavailable on kyle-house"),
    );
    expect(warning).not.toBeNull();
    expect(settingsState.byEnvironment.get(String(houseId))?.agentExecutionPresets).toMatchObject({
      selection: { instanceId: claudeId, model: "fable-5" },
    });
    expect(settingsState.patchesByEnvironment.get(String(houseId)) ?? []).toHaveLength(0);
  });

  it("disables mode changes while read-only/offline cached", () => {
    const panel = renderSection({
      environmentId: houseId,
      environmentLabel: "kyle-house",
      providers: [provider(codexId, "house-repair", "codex")],
      readOnly: true,
    });
    const modeSelect = visitElements(
      panel,
      (element) =>
        element.props.disabled === true &&
        (element.props.value === "simple" || element.props.value === "advanced"),
    );
    expect(modeSelect).not.toBeNull();
    expect(settingsState.patchesByEnvironment.get(String(houseId)) ?? []).toHaveLength(0);
  });
});
