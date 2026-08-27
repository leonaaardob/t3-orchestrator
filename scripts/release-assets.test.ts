import { describe, expect, it } from "vitest";

import { isBuilderDebugArtifactName } from "./lib/release-assets.ts";

describe("isBuilderDebugArtifactName", () => {
  it("rejects exact and suffixed builder-debug dumps", () => {
    expect(isBuilderDebugArtifactName("builder-debug.yml")).toBe(true);
    expect(isBuilderDebugArtifactName("builder-debug-win-x64.yml")).toBe(true);
    expect(isBuilderDebugArtifactName("builder-debug-win-arm64.yml")).toBe(true);
  });

  it("keeps updater manifests and installers", () => {
    expect(isBuilderDebugArtifactName("latest-linux.yml")).toBe(false);
    expect(isBuilderDebugArtifactName("latest-linux-x64.yml")).toBe(false);
    expect(isBuilderDebugArtifactName("latest-mac.yml")).toBe(false);
    expect(isBuilderDebugArtifactName("latest.yml")).toBe(false);
    expect(isBuilderDebugArtifactName("T3-Orchestrator-0.0.34-x86_64.AppImage")).toBe(false);
  });
});
