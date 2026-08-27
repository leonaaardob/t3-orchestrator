import { describe, expect, it } from "vite-plus/test";

import {
  hasMacDeveloperIdApplicationAuthority,
  resolveDesktopUpdateInstallMode,
  resolveMacAppBundlePath,
} from "./macUpdateInstallCapability.ts";

describe("macUpdateInstallCapability", () => {
  it("resolves the .app bundle from a packaged Electron app path", () => {
    expect(
      resolveMacAppBundlePath("/Applications/T3 Orchestrator.app/Contents/Resources/app.asar"),
    ).toBe("/Applications/T3 Orchestrator.app");
    expect(resolveMacAppBundlePath("/Applications/T3 Orchestrator.app")).toBe(
      "/Applications/T3 Orchestrator.app",
    );
    expect(resolveMacAppBundlePath("/repo/apps/desktop")).toBeNull();
  });

  it("detects Developer ID Application authority from codesign output", () => {
    expect(
      hasMacDeveloperIdApplicationAuthority(
        "Authority=Developer ID Application: Example (TEAMID)\nTeamIdentifier=TEAMID",
      ),
    ).toBe(true);
    expect(hasMacDeveloperIdApplicationAuthority("Signature=adhoc\n")).toBe(false);
  });

  it("keeps automatic install on non-mac platforms", () => {
    expect(
      resolveDesktopUpdateInstallMode({
        platform: "win32",
        isPackaged: true,
        hasDeveloperIdApplicationSignature: false,
      }),
    ).toBe("automatic");
    expect(
      resolveDesktopUpdateInstallMode({
        platform: "linux",
        isPackaged: true,
        hasDeveloperIdApplicationSignature: false,
      }),
    ).toBe("automatic");
  });

  it("uses manual install for unsigned packaged macOS builds", () => {
    expect(
      resolveDesktopUpdateInstallMode({
        platform: "darwin",
        isPackaged: true,
        hasDeveloperIdApplicationSignature: false,
      }),
    ).toBe("manual");
  });

  it("keeps automatic install for Developer ID signed macOS builds", () => {
    expect(
      resolveDesktopUpdateInstallMode({
        platform: "darwin",
        isPackaged: true,
        hasDeveloperIdApplicationSignature: true,
      }),
    ).toBe("automatic");
  });

  it("honors an explicit install-mode override", () => {
    expect(
      resolveDesktopUpdateInstallMode({
        platform: "darwin",
        isPackaged: true,
        hasDeveloperIdApplicationSignature: false,
        installModeOverride: "automatic",
      }),
    ).toBe("automatic");
    expect(
      resolveDesktopUpdateInstallMode({
        platform: "darwin",
        isPackaged: true,
        hasDeveloperIdApplicationSignature: true,
        installModeOverride: "manual",
      }),
    ).toBe("manual");
  });
});
