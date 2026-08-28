import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";

import {
  defaultOrchestrationEnvironmentId,
  orchestrationEnvironmentCanEdit,
} from "./OrchestrationSettingsPanel.logic";

const mac = EnvironmentId.make("mac");
const house = EnvironmentId.make("kyle-house");

describe("defaultOrchestrationEnvironmentId", () => {
  it("prefers the primary environment on first open", () => {
    expect(
      defaultOrchestrationEnvironmentId({
        environments: [{ environmentId: house }, { environmentId: mac }],
        selectedEnvironmentId: null,
        primaryEnvironmentId: mac,
      }),
    ).toBe(mac);
  });

  it("keeps an explicit selection when still known", () => {
    expect(
      defaultOrchestrationEnvironmentId({
        environments: [{ environmentId: mac }, { environmentId: house }],
        selectedEnvironmentId: house,
        primaryEnvironmentId: mac,
      }),
    ).toBe(house);
  });

  it("falls back to the first known environment when primary is absent", () => {
    expect(
      defaultOrchestrationEnvironmentId({
        environments: [{ environmentId: house }],
        selectedEnvironmentId: null,
        primaryEnvironmentId: mac,
      }),
    ).toBe(house);
  });
});

describe("orchestrationEnvironmentCanEdit", () => {
  it("keeps cached settings visible while offline instead of falling back", () => {
    const result = orchestrationEnvironmentCanEdit({
      connectionPhase: "disconnected",
      hasServerConfig: true,
      operateAccess: "granted",
    });
    expect(result.access.kind).toBe("unavailable");
    expect(result.showCachedReadOnly).toBe(true);
  });

  it("marks offline without cache as unavailable with no editable surface", () => {
    const result = orchestrationEnvironmentCanEdit({
      connectionPhase: "disconnected",
      hasServerConfig: false,
      operateAccess: "granted",
    });
    expect(result.access.kind).toBe("unavailable");
    expect(result.showCachedReadOnly).toBe(false);
  });

  it("allows edits when connected with operate access", () => {
    const result = orchestrationEnvironmentCanEdit({
      connectionPhase: "connected",
      hasServerConfig: true,
      operateAccess: "granted",
    });
    expect(result.access.kind).toBe("editable");
    expect(result.showCachedReadOnly).toBe(false);
  });
});
